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
  translationMemory?: Record<string, string>,
  modelName: string = "gemini-3-flash-preview"
): Promise<TranslationResult> {
  const apiKey = getCustomApiKey() || (process.env.GEMINI_API_KEY as string);
  
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Please add it in Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = modelName || "gemini-3-flash-preview";

  let retries = 3;
  let delay = 4000;

  while (retries > 0) {
    try {
      console.log(`[translateMangaPage] Starting translation request. Retries left: ${retries}`);
      
      // Gemini Logic (Frontend)
      console.log("[translateMangaPage] Starting OCR...");
      const ocrPrompt = `Analyze this manga/comic page carefully. You must find and extract EVERY SINGLE piece of text on the page. 

Specific Instructions for Manga:
1. **Japanese Text**: Accurately extract all Kanji, Hiragana, and Katakana. Pay close attention to vertical text (top-to-bottom) which is common in manga.
2. **Sound Effects (SFX)**: Extract stylized sound effects (e.g., "ゴゴゴ", "ドキドキ"). Even if they are integrated into the art, try to capture them.
3. **Font Styles**: Handle various font styles, including standard bubble text, handwritten side-comments, bold emphasis, and narration boxes.
4. **Exhaustive Search**: Do not skip small text, background signs, or character thought bubbles.

For EACH piece of text found:
1. Extract the original text (which is in ${sourceLanguage}).
2. Provide its bounding box as [ymin, xmin, ymax, xmax] where coordinates are normalized between 0 and 1000.

Example Format:
{
  "box_2d": [100, 200, 150, 300],
  "originalText": "こんにちは"
}

Return ONLY a valid JSON array of objects. Be extremely thorough.`;

      const ocrResponse = await ai.models.generateContent({
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

      let ocrJsonStr = ocrResponse.text?.trim() || "[]";
      const match = ocrJsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) ocrJsonStr = match[0];
      else ocrJsonStr = ocrJsonStr.replace(/```json/g, '').replace(/```/g, '').trim();

      let extractedBubbles: { box_2d: number[], originalText: string }[] = [];
      try {
        extractedBubbles = JSON.parse(ocrJsonStr);
      } catch (e) {
        console.error("[translateMangaPage] Failed to parse OCR JSON:", ocrJsonStr);
        throw new Error("Invalid response format from OCR.");
      }

      console.log(`[translateMangaPage] OCR found ${extractedBubbles.length} bubbles.`);

      if (extractedBubbles.length === 0) {
        return { blocks: [], usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 } };
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
        const key = getCacheKey(targetLanguage, chunkTexts);

        let translatedChunk = getCached(key);

        if (!translatedChunk) {
          console.log(`[translateMangaPage] Translating chunk of ${chunk.length} bubbles...`);
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

          const chunkResponse = await ai.models.generateContent({
            model,
            contents: translatePrompt,
            config: {
              temperature: 0.2,
              maxOutputTokens: 400,
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
            console.error("[translateMangaPage] Failed to parse translation JSON:", jsonStr);
            translatedChunk = [];
          }
        } else {
          console.log(`[translateMangaPage] Using cached translation for chunk of ${chunk.length} bubbles.`);
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
        box_2d: b.box_2d as [number, number, number, number],
        originalText: b.originalText,
        translatedText: finalTranslations[i] || b.originalText
      }));

      const usage = {
        promptTokens: totalPromptTokens,
        candidatesTokens: totalCandidatesTokens,
        totalTokens: totalPromptTokens + totalCandidatesTokens,
        estimatedCost: calculateGeminiCost(totalPromptTokens, totalCandidatesTokens, model)
      };

      return { blocks, usage };

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
  translationMemory?: Record<string, string>,
  modelName: string = "gemini-3-flash-preview"
) {
  const cached = getCachedTranslation(imageHash);
  if (cached) {
    console.log("Using cached translation");
    return cached;
  }

  const result = await translateMangaPage(base64Image, mimeType, sourceLanguage, targetLanguage, customPrompt, translationMemory, modelName);

  setCachedTranslation(imageHash, result);

  return result;
}

export async function translateBatch(images: { base64: string, mimeType: string }[], modelName: string = "gemini-3-flash-preview") {
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
      temperature: 0.2,
      maxOutputTokens: 400,
      responseMimeType: "application/json"
    }
  });

  return response;
}
