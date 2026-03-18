/// <reference types="vite/client" />
import { GoogleGenAI, Type } from "@google/genai";
import { safeGetItem, safeSetItem, safeRemoveItem } from './storage';
import { getCachedTranslation, setCachedTranslation } from "./translationCache";

export const setCustomApiKey = (key: string | null) => {
  if (key) {
    safeSetItem('custom_gemini_api_key', key);
  } else {
    safeRemoveItem('custom_gemini_api_key');
  }
};

export const getCustomApiKey = (): string | null => {
  return safeGetItem('custom_gemini_api_key');
};

export interface TranslationBlock {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  originalText: string;
  translatedText: string;
  fontSize?: number;
  cached?: boolean;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  estimatedCost?: number; // in USD
}

export interface TranslationResult {
  blocks: TranslationBlock[];
  usage?: TokenUsage;
}

function calculateGeminiCost(promptTokens: number, candidatesTokens: number, modelName: string): number {
  let inputPricePerM = 0.075; // Default Flash
  let outputPricePerM = 0.30;
  
  if (modelName.includes('pro')) {
    inputPricePerM = 1.25;
    outputPricePerM = 5.00;
  } else if (modelName.includes('lite')) {
    inputPricePerM = 0.0375; // Lite is roughly half price of Flash
    outputPricePerM = 0.15;
  }
  
  return (promptTokens / 1000000) * inputPricePerM + (candidatesTokens / 1000000) * outputPricePerM;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CHUNK_SIZE = 12;

function normalizeText(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCacheKey(targetLanguage: string, bubbles: string[]) {
  return `${targetLanguage}::${bubbles.map(normalizeText).join("\n")}`;
}

function getCached(key: string) {
  return getCachedTranslation(key);
}

function setCached(key: string, value: any) {
  setCachedTranslation(key, value);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function translateMangaPage(
  base64Image: string, 
  mimeType: string,
  sourceLanguage: string,
  targetLanguage: string,
  customPrompt?: string,
  translationMemory?: Record<string, any>,
  modelName: string = "gemini-3.1-pro-preview",
  temperature: number = 0.4
): Promise<TranslationResult> {
  const apiKey = getCustomApiKey() || (process.env.GEMINI_API_KEY as string);
  
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Please add it in Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = modelName || "gemini-3.1-pro-preview";

  let retries = 3;
  let delay = 4000;

  while (retries > 0) {
    try {
      console.log(`[translateMangaPage] Starting single-pass translation request. Retries left: ${retries}`);
      
      let memoryString = "";
      if (translationMemory && Object.keys(translationMemory).length > 0) {
        // Limit to 50 most recent entries for the prompt to save tokens
        const recentMemoryEntries = Object.values(translationMemory)
          .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, 50);
          
        memoryString = recentMemoryEntries
          .map((entry: any) => `"${entry.originalText || entry}" -> "${entry.translatedText || entry}"`)
          .join('\n');
      }

      const ocrPrompt = `Analyze this manga/comic page carefully. You must find and extract EVERY SINGLE piece of text on the page, AND translate it into ${targetLanguage}.

Specific Instructions for High-Quality Manga Localization:
1. **Extraction**: Accurately extract all text (${sourceLanguage}). Pay close attention to vertical text (top-to-bottom), handwritten notes, and stylized fonts.
2. **Natural Translation & Localization**: Translate the extracted text into highly natural, conversational ${targetLanguage}. 
   - Adapt idioms, jokes, and cultural references so they make sense to a ${targetLanguage} speaker while preserving the original intent.
   - Maintain the character's voice and tone (e.g., formal, casual, aggressive, polite, slang).
   - Ensure the dialogue flows smoothly and sounds like something a native speaker would actually say in that situation.
3. **Sound Effects (SFX)**: Extract and translate stylized sound effects (e.g., "ゴゴゴ" -> "RUMBLE", "ドキドキ" -> "THUMP THUMP"). Provide dynamic equivalents in ${targetLanguage}.
4. **Exhaustive Search**: Do not skip small text, background signs, or character thought bubbles.
${customPrompt ? `5. **Additional Instructions**: ${customPrompt}` : ""}
${memoryString ? `\nTranslation Memory (Use these previously translated segments for consistency):\n${memoryString}` : ""}

For EACH piece of text found, provide:
1. "box_2d": Its bounding box as [ymin, xmin, ymax, xmax] where coordinates are normalized between 0 and 1000.
2. "originalText": The original text in ${sourceLanguage}.
3. "translatedText": The localized translation in ${targetLanguage}.

Return ONLY a valid JSON array of objects. Be extremely thorough and prioritize translation quality.`;

      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { data: base64Image, mimeType } },
            { text: ocrPrompt }
          ]
        },
        config: {
          temperature,
          topP: 0.95,
          topK: 64,
          systemInstruction: `You are a professional manga translator and typesetter.

Your task is to translate manga text and also properly format it for readability.

STRICT INSTRUCTIONS:

1. FONT SIZE:
- Ensure translated text is large enough to be easily readable on mobile screens.
- Text should fill the speech bubble appropriately (not too small, not overflowing).
- Maintain consistent font size across similar dialogue types.

2. TEXT ALIGNMENT:
- Center-align text inside speech bubbles.
- Maintain proper spacing between lines.
- Avoid uneven line breaks and awkward spacing.
- Keep text visually balanced within the bubble shape.

3. LINE BREAKING:
- Break lines naturally like real manga dialogue.
- Do NOT split sentences awkwardly.
- Keep phrases together for smooth reading.

4. STYLE:
- Maintain original tone (casual, emotional, funny, etc.)
- Translate naturally into ${targetLanguage}.
- Keep dialogues short and punchy.

5. SPECIAL EFFECT TEXT:
- For sound effects (SFX), use slightly stylized or ALL CAPS text.
- Keep them visually distinct from dialogue.

6. CONSISTENCY:
- Same character → same speaking style
- Maintain uniform formatting across all panels

7. OUTPUT FORMAT:
Return clean, well-formatted text ready for manga bubbles.
No extra explanations.

IMPORTANT:
Focus equally on translation + visual readability (like real manga typesetting).

Optimize output for mobile reading (clear, bold, properly spaced text).`,
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
                translatedText: { type: Type.STRING },
              },
              required: ["box_2d", "originalText", "translatedText"],
            },
          },
        }
      });

      let jsonStr = response.text?.trim() || "[]";
      const match = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) jsonStr = match[0];
      else jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

      let extractedBlocks: TranslationBlock[] = [];
      try {
        extractedBlocks = JSON.parse(jsonStr);
      } catch (e) {
        console.error("[translateMangaPage] Failed to parse JSON:", jsonStr);
        throw new Error("Invalid response format from Gemini.");
      }

      console.log(`[translateMangaPage] Found and translated ${extractedBlocks.length} bubbles.`);

      const totalPromptTokens = response.usageMetadata?.promptTokenCount || 0;
      const totalCandidatesTokens = response.usageMetadata?.candidatesTokenCount || 0;

      const usage = {
        promptTokens: totalPromptTokens,
        candidatesTokens: totalCandidatesTokens,
        totalTokens: totalPromptTokens + totalCandidatesTokens,
        estimatedCost: calculateGeminiCost(totalPromptTokens, totalCandidatesTokens, model)
      };

      // Cache individual translations to memory for future pages
      if (translationMemory && extractedBlocks.length > 0) {
        for (const block of extractedBlocks) {
          if (block.originalText && block.translatedText) {
            const text = normalizeText(block.originalText);
            translationMemory[text] = {
              originalText: text,
              translatedText: block.translatedText,
              timestamp: Date.now()
            };
            
            // Also save to local cache
            const singleKey = getCacheKey(targetLanguage, [text]);
            setCached(singleKey, [{ index: 0, translation: block.translatedText }]);
          }
        }
      }

      return { blocks: extractedBlocks, usage };

    } catch (e: any) {
      console.error("[translateMangaPage] Gemini API Error:", e);
      const errorMessage = e.message || String(e);
      
      if (
        errorMessage.toLowerCase().includes("quota") || 
        errorMessage.toLowerCase().includes("429") || 
        errorMessage.toLowerCase().includes("too many requests") ||
        errorMessage.toLowerCase().includes("503") ||
        errorMessage.toLowerCase().includes("unavailable") ||
        errorMessage.toLowerCase().includes("high demand") ||
        errorMessage.toLowerCase().includes("timed out")
      ) {
        retries--;
        if (retries === 0) {
          throw new Error("API is currently overloaded or rate limit reached. Please wait a moment and try again, or add your own API key in Settings.");
        }
        console.log(`[translateMangaPage] API overloaded/rate limit hit. Retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30000);
      } else {
        throw new Error(`Translation failed: ${errorMessage}`);
      }
    }
  }
  
  return { blocks: [] };
}

export async function translateImage(
  imageHash: string, 
  base64Image: string, 
  mimeType: string, 
  sourceLanguage: string = "Japanese",
  targetLanguage: string = "English",
  customPrompt?: string,
  translationMemory?: Record<string, any>,
  modelName: string = "gemini-3.1-pro-preview",
  force: boolean = false,
  temperature: number = 0.4
) {
  if (!force) {
    const cached = getCachedTranslation(imageHash);
    if (cached) {
      console.log("Using cached translation");
      return cached;
    }
  }

  const result = await translateMangaPage(base64Image, mimeType, sourceLanguage, targetLanguage, customPrompt, translationMemory, modelName, temperature);

  setCachedTranslation(imageHash, result);

  return result;
}

export async function translateBatch(images: { base64: string, mimeType: string }[], modelName: string = "gemini-3.1-pro-preview", temperature: number = 0.4) {
  const apiKey = getCustomApiKey() || (process.env.GEMINI_API_KEY as string);
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
Translate manga text to Hinglish.
Return JSON.

Images:
${images.map((_, i) => `Image ${i + 1}`).join("\n")}
`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: {
      parts: [
        { text: prompt },
        ...images.map(img => ({ inlineData: { data: img.base64, mimeType: img.mimeType } }))
      ]
    },
    config: {
      temperature,
      maxOutputTokens: 400,
      responseMimeType: "application/json"
    }
  });

  return response;
}
