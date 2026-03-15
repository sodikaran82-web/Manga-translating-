import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CHUNK_SIZE = 12;
const MAX_RETRIES = 4;

const cache = new Map();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(targetLanguage: string, bubbles: string[]) {
  return `${targetLanguage}::${bubbles.map(normalizeText).join("\n")}`;
}

function getCached(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;

  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return hit.value;
}

function setCached(key: string, value: any) {
  cache.set(key, { value, ts: Date.now() });
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || err).toLowerCase();
      
      const retryable = 
        msg.includes("429") || 
        msg.includes("503") || 
        msg.includes("overloaded") || 
        msg.includes("unavailable") || 
        msg.includes("timeout") || 
        msg.includes("rate limit") ||
        msg.includes("quota");

      if (!retryable || attempt === maxRetries - 1) throw err;

      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
      console.log(`[Backend] Retryable error hit. Retrying in ${delay}ms... (${attempt + 1}/${maxRetries})`);
      await sleep(delay);
    }
  }

  throw lastError;
}

app.post("/api/translate-page", async (req, res) => {
  try {
    const { base64Image, mimeType, sourceLanguage, targetLanguage, customPrompt, modelName, translationMemory, customApiKey } = req.body;
    
    const apiKey = customApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY on server" });
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = modelName || "gemini-3-flash-preview";

    // STEP 1: OCR
    console.log("[Backend] Starting OCR...");
    const ocrPrompt = `Analyze this manga/comic page carefully. You must find and extract EVERY SINGLE piece of text on the page. This includes:
1. All main dialogue in speech bubbles.
2. Thought bubbles and narration boxes.
3. Small text outside bubbles (e.g., character side comments, background text).
4. Sound effects (SFX) and stylized text.

For EACH piece of text found:
1. Extract the original text (which is in ${sourceLanguage}).
2. Provide its bounding box as [ymin, xmin, ymax, xmax] where coordinates are normalized between 0 and 1000.

Do not skip any text. Be exhaustive. Return ONLY a valid JSON array.`;

    const ocrResponse = await retryWithBackoff(async () => {
      return await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { data: base64Image, mimeType } },
            { text: ocrPrompt }
          ]
        },
        config: {
          systemInstruction: "You are an expert manga/comic OCR system. Your job is to extract EVERY SINGLE piece of text on the page. Do not miss any text, no matter how small or stylized. Be extremely thorough.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                box_2d: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: "Bounding box [ymin, xmin, ymax, xmax] normalized 0-1000",
                },
                originalText: { type: Type.STRING },
              },
              required: ["box_2d", "originalText"],
            },
          },
        }
      });
    });

    let ocrJsonStr = ocrResponse.text?.trim() || "[]";
    const match = ocrJsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) ocrJsonStr = match[0];
    else ocrJsonStr = ocrJsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

    let extractedBubbles: { box_2d: number[], originalText: string }[] = [];
    try {
      extractedBubbles = JSON.parse(ocrJsonStr);
    } catch (e) {
      console.error("[Backend] Failed to parse OCR JSON:", ocrJsonStr);
      throw new Error("Invalid response format from OCR.");
    }

    console.log(`[Backend] OCR found ${extractedBubbles.length} bubbles.`);

    if (extractedBubbles.length === 0) {
      return res.json({ blocks: [], usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 } });
    }

    // STEP 2: Translate Chunks
    const chunks = chunkArray(
      extractedBubbles.map((b, index) => ({ text: b.originalText, index })),
      MAX_CHUNK_SIZE
    );

    const finalTranslations = new Array(extractedBubbles.length).fill("");
    let totalPromptTokens = ocrResponse.usageMetadata?.promptTokenCount || 0;
    let totalCandidatesTokens = ocrResponse.usageMetadata?.candidatesTokenCount || 0;

    let memoryString = "";
    if (translationMemory && Object.keys(translationMemory).length > 0) {
      memoryString = Object.entries(translationMemory)
        .map(([orig, trans]) => `"${orig}" -> "${trans}"`)
        .join('\n');
    }

    for (const chunk of chunks) {
      const chunkTexts = chunk.map(item => item.text);
      const key = cacheKey(targetLanguage, chunkTexts);

      let translatedChunk = getCached(key);

      if (!translatedChunk) {
        console.log(`[Backend] Translating chunk of ${chunk.length} bubbles...`);
        const translatePrompt = [
          `Translate the following manga speech bubbles from ${sourceLanguage} into natural ${targetLanguage}.`,
          "Keep the tone short, conversational, and faithful to the original meaning.",
          customPrompt ? `Additional Instructions: ${customPrompt}` : "",
          memoryString ? `\nTranslation Memory (Use these previously translated segments for consistency):\n${memoryString}` : "",
          "Return ONLY valid JSON that matches the schema.",
          "",
          "Bubbles:",
          ...chunkTexts.map((text, index) => `${index}: ${normalizeText(text)}`)
        ].join("\n");

        const chunkResponse = await retryWithBackoff(async () => {
          return await ai.models.generateContent({
            model,
            contents: translatePrompt,
            config: {
              temperature: 0.2,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    index: { type: Type.INTEGER },
                    translation: { type: Type.STRING },
                  },
                  required: ["index", "translation"],
                },
              },
            }
          });
        });

        totalPromptTokens += chunkResponse.usageMetadata?.promptTokenCount || 0;
        totalCandidatesTokens += chunkResponse.usageMetadata?.candidatesTokenCount || 0;

        let jsonStr = chunkResponse.text?.trim() || "[]";
        const tMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (tMatch) jsonStr = tMatch[0];
        else jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

        try {
          translatedChunk = JSON.parse(jsonStr);
          setCached(key, translatedChunk);
        } catch (e) {
          console.error("[Backend] Failed to parse translation JSON:", jsonStr);
          // If parsing fails for a chunk, we just leave it empty and continue
          translatedChunk = [];
        }
      } else {
        console.log(`[Backend] Using cached translation for chunk of ${chunk.length} bubbles.`);
      }

      for (const item of translatedChunk) {
        const originalIndex = chunk[item.index]?.index;
        if (typeof originalIndex === "number") {
          finalTranslations[originalIndex] = String(item.translation || "");
        }
      }
    }

    // STEP 3: Merge
    const blocks = extractedBubbles.map((b, i) => ({
      box_2d: b.box_2d,
      originalText: b.originalText,
      translatedText: finalTranslations[i] || b.originalText // Fallback to original if translation missing
    }));

    return res.json({
      blocks,
      usage: {
        promptTokens: totalPromptTokens,
        candidatesTokens: totalCandidatesTokens,
        totalTokens: totalPromptTokens + totalCandidatesTokens
      }
    });

  } catch (err: any) {
    console.error("[Backend] Translate page failed:", err);
    return res.status(502).json({
      error: err?.message || "Failed to translate page",
    });
  }
});

// Global error handler for JSON parsing errors or other Express errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Backend] Global Error:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error"
  });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
