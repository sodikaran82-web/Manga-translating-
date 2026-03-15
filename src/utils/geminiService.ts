/// <reference types="vite/client" />
import { GoogleGenAI, Type } from "@google/genai";
import { safeGetItem, safeSetItem, safeRemoveItem } from './storage';

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

export const setOpenRouterApiKey = (key: string | null) => {
  if (key) {
    safeSetItem('openrouter_api_key', key);
  } else {
    safeRemoveItem('openrouter_api_key');
  }
};

export const getOpenRouterApiKey = (): string | null => {
  return safeGetItem('openrouter_api_key');
};

export const setCustomOpenRouterModel = (model: string | null) => {
  if (model) {
    safeSetItem('openrouter_custom_model', model);
  } else {
    safeRemoveItem('openrouter_custom_model');
  }
};

export const getCustomOpenRouterModel = (): string | null => {
  return safeGetItem('openrouter_custom_model') || 'anthropic/claude-3-opus';
};

export interface TranslationBlock {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  originalText: string;
  translatedText: string;
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
  let inputPricePerM = 0.075;
  let outputPricePerM = 0.30;
  
  if (modelName.includes('pro')) {
    inputPricePerM = 1.25;
    outputPricePerM = 5.00;
  }
  
  return (promptTokens / 1000000) * inputPricePerM + (candidatesTokens / 1000000) * outputPricePerM;
}

const withTimeout = <T>(requestFn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> => {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${ms / 1000} seconds`));
    }, ms);

    requestFn(controller.signal)
      .then((res) => {
        clearTimeout(timeoutId);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          reject(new Error(`Request timed out after ${ms / 1000} seconds`));
        } else {
          reject(err);
        }
      });
  });
};

export async function translateMangaPage(
  base64Image: string, 
  mimeType: string,
  sourceLanguage: string,
  targetLanguage: string,
  customPrompt?: string,
  translationMemory?: Record<string, string>,
  modelName: string = "gemini-3-flash-preview"
): Promise<TranslationResult> {
  const defaultPrompt = `Analyze this manga/comic page carefully. You must find and extract EVERY SINGLE piece of text on the page. This includes:
1. All main dialogue in speech bubbles.
2. Thought bubbles and narration boxes.
3. Small text outside bubbles (e.g., character side comments, background text).
4. Sound effects (SFX) and stylized text.

For EACH piece of text found:
1. Extract the original text (which is in ${sourceLanguage}).
2. Translate it accurately to ${targetLanguage}.
3. Provide its bounding box as [ymin, xmin, ymax, xmax] where coordinates are normalized between 0 and 1000.

Do not skip any text. Be exhaustive.`;
  let finalPrompt = customPrompt ? `${defaultPrompt}\n\nAdditional Instructions:\n${customPrompt}` : defaultPrompt;

  if (translationMemory && Object.keys(translationMemory).length > 0) {
    const memoryString = Object.entries(translationMemory)
      .map(([orig, trans]) => `"${orig}" -> "${trans}"`)
      .join('\n');
    finalPrompt += `\n\nTranslation Memory (Use these previously translated segments for consistency if you encounter the same or similar text):\n${memoryString}`;
  }

  let retries = 3;
  let delay = 4000;

  while (retries > 0) {
    try {
      console.log(`[translateMangaPage] Starting translation request. Retries left: ${retries}`);
      if (modelName === 'openrouter-custom') {
        const orKey = getOpenRouterApiKey();
        if (!orKey) {
          throw new Error("OpenRouter API key is missing. Please add it in Settings.");
        }
        const orModel = getCustomOpenRouterModel() || 'anthropic/claude-3-opus';
        
        const orPrompt = `${finalPrompt}\n\nIMPORTANT: You must return ONLY a valid JSON array of objects. Do not include markdown formatting like \`\`\`json. Just the raw JSON array. Each object must have: box_2d (array of 4 integers 0-1000), originalText (string), translatedText (string).`;
        
        const response = await withTimeout((signal) => fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${orKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": window.location.origin,
            "X-Title": "Manga Translator"
          },
          body: JSON.stringify({
            model: orModel,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: orPrompt },
                  { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                ]
              }
            ]
          }),
          signal
        }), 30000); // 30 seconds timeout

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter API error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        if (!data.choices || data.choices.length === 0) {
          throw new Error("OpenRouter API returned an empty response.");
        }
        let jsonStr = data.choices[0].message?.content || "[]";
        
        let usage: TokenUsage | undefined;
        if (data.usage) {
          const promptTokens = data.usage.prompt_tokens || 0;
          const candidatesTokens = data.usage.completion_tokens || 0;
          const totalTokens = data.usage.total_tokens || 0;
          usage = {
            promptTokens,
            candidatesTokens,
            totalTokens,
          };
        }

        if (typeof jsonStr === 'string') {
          console.log("[translateMangaPage] Raw OpenRouter response received:", jsonStr.substring(0, 150) + "...");
          
          const match = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (match) {
            jsonStr = match[0];
          } else {
            jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
          }
          
          let blocks: TranslationBlock[] = [];
          try {
            blocks = JSON.parse(jsonStr) as TranslationBlock[];
            console.log(`[translateMangaPage] Successfully parsed ${blocks.length} translation blocks from OpenRouter.`);
          } catch (parseError) {
            console.error("[translateMangaPage] Failed to parse OpenRouter JSON:", jsonStr);
            throw new Error("Invalid response format from OpenRouter API. Could not parse translation data.");
          }
          
          return { blocks, usage };
        }
        return { blocks: [], usage };
      }

      if (modelName !== 'openrouter-custom') {
        const customApiKey = safeGetItem('custom_gemini_api_key');
        const response = await withTimeout((signal) => fetch("/api/translate-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base64Image,
            mimeType,
            sourceLanguage,
            targetLanguage,
            customPrompt,
            modelName,
            translationMemory,
            customApiKey
          }),
          signal
        }), 60000); // 60 seconds timeout for full OCR + translation

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }

        let usage = data.usage;
        if (usage) {
          usage.estimatedCost = calculateGeminiCost(usage.promptTokens, usage.candidatesTokens, modelName);
        }

        return { blocks: data.blocks || [], usage };
      }
    } catch (e: any) {
      console.error("[translateMangaPage] Gemini API Error:", e);
      const errorMessage = e.message || String(e);
      
      // Check if it's a rate limit, quota error, 503 service unavailable, or timeout
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
        delay = Math.min(delay * 2, 30000); // Exponential backoff, capped at 30 seconds
      } else {
        // For other errors, throw immediately
        throw new Error(`Translation failed: ${errorMessage}`);
      }
    }
  }
  
  return { blocks: [] };
}
