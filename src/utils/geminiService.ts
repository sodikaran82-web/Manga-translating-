import { GoogleGenAI, Type } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;

const getAiInstance = (): GoogleGenAI => {
  if (!aiInstance) {
    const key = localStorage.getItem('custom_gemini_api_key') || process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) {
      throw new Error("API key is missing. Please add your Gemini API key in Settings.");
    }
    aiInstance = new GoogleGenAI({ apiKey: key });
  }
  return aiInstance;
};

export const setCustomApiKey = (key: string | null) => {
  if (key) {
    localStorage.setItem('custom_gemini_api_key', key);
    aiInstance = new GoogleGenAI({ apiKey: key });
  } else {
    localStorage.removeItem('custom_gemini_api_key');
    const defaultKey = process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
    if (defaultKey) {
      aiInstance = new GoogleGenAI({ apiKey: defaultKey });
    } else {
      aiInstance = null;
    }
  }
};

export const getCustomApiKey = (): string | null => {
  return localStorage.getItem('custom_gemini_api_key');
};

export interface TranslationBlock {
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  originalText: string;
  translatedText: string;
}

export async function translateMangaPage(
  base64Image: string, 
  mimeType: string,
  sourceLanguage: string,
  targetLanguage: string,
  customPrompt?: string,
  translationMemory?: Record<string, string>,
  modelName: string = "gemini-3.1-pro-preview"
): Promise<TranslationBlock[]> {
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

  const ai = getAiInstance();

  let retries = 3;
  let delay = 2000;

  while (retries > 0) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: mimeType,
              },
            },
            {
              text: finalPrompt,
            },
          ],
        },
        config: {
          systemInstruction: "You are an expert manga/comic translator. Your job is to extract and translate EVERY SINGLE piece of text on the page. Do not miss any text, no matter how small or stylized. Be extremely thorough.",
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
        },
      });

      const jsonStr = response.text?.trim() || "[]";
      return JSON.parse(jsonStr) as TranslationBlock[];
    } catch (e: any) {
      console.error("Gemini API Error:", e);
      const errorMessage = e.message || String(e);
      
      // Check if it's a rate limit or quota error
      if (errorMessage.toLowerCase().includes("quota") || errorMessage.toLowerCase().includes("429") || errorMessage.toLowerCase().includes("too many requests")) {
        retries--;
        if (retries === 0) {
          throw new Error("API quota exceeded or rate limit reached. Please wait a moment and try again, or add your own API key in Settings.");
        }
        console.log(`Rate limit hit. Retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else {
        // For other errors, throw immediately
        throw new Error(`Translation failed: ${errorMessage}`);
      }
    }
  }
  
  return [];
}
