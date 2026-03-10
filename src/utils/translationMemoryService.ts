import { get, set } from 'idb-keyval';

export interface TranslationMemoryEntry {
  originalText: string;
  translatedText: string;
  timestamp: number;
}

export type TranslationMemory = Record<string, TranslationMemoryEntry>;

const MEMORY_KEY_PREFIX = 'manga_translation_memory_';

export async function getTranslationMemory(sourceLang: string, targetLang: string): Promise<TranslationMemory> {
  const key = `${MEMORY_KEY_PREFIX}${sourceLang}_${targetLang}`;
  const memory = await get<TranslationMemory>(key);
  return memory || {};
}

export async function saveToTranslationMemory(
  sourceLang: string,
  targetLang: string,
  originalText: string,
  translatedText: string
): Promise<void> {
  if (!originalText.trim() || !translatedText.trim()) return;

  const key = `${MEMORY_KEY_PREFIX}${sourceLang}_${targetLang}`;
  const memory = await getTranslationMemory(sourceLang, targetLang);
  
  memory[originalText] = {
    originalText,
    translatedText,
    timestamp: Date.now(),
  };

  // Limit memory size to prevent token overflow (e.g., keep latest 500 entries)
  const entries = Object.values(memory).sort((a, b) => b.timestamp - a.timestamp);
  if (entries.length > 500) {
    const trimmedMemory: TranslationMemory = {};
    entries.slice(0, 500).forEach(entry => {
      trimmedMemory[entry.originalText] = entry;
    });
    await set(key, trimmedMemory);
  } else {
    await set(key, memory);
  }
}

export async function clearTranslationMemory(sourceLang: string, targetLang: string): Promise<void> {
  const key = `${MEMORY_KEY_PREFIX}${sourceLang}_${targetLang}`;
  await set(key, {});
}
