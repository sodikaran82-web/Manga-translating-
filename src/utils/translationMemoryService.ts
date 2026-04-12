import { get, set, keys } from 'idb-keyval';

export interface TranslationMemoryEntry {
  originalText: string;
  translatedText: string;
  timestamp: number;
}

export type TranslationMemory = Record<string, TranslationMemoryEntry>;

const MEMORY_KEY_PREFIX = 'manga_translation_memory_';

export async function getAllTranslationMemoryPairs(): Promise<string[]> {
  try {
    const allKeys = await keys();
    return allKeys
      .filter(k => typeof k === 'string' && k.startsWith(MEMORY_KEY_PREFIX))
      .map(k => (k as string).replace(MEMORY_KEY_PREFIX, ''));
  } catch (e) {
    console.warn("Failed to get translation memory keys", e);
    return [];
  }
}

export async function deleteTranslationMemoryEntry(sourceLang: string, targetLang: string, originalText: string): Promise<void> {
  try {
    const key = `${MEMORY_KEY_PREFIX}${sourceLang}_${targetLang}`;
    const memory = await getTranslationMemory(sourceLang, targetLang);
    if (memory[originalText]) {
      delete memory[originalText];
      await set(key, memory);
    }
  } catch (e) {
    console.warn("Failed to delete translation memory entry", e);
  }
}

export async function getTranslationMemory(sourceLang: string, targetLang: string): Promise<TranslationMemory> {
  try {
    const key = `${MEMORY_KEY_PREFIX}${sourceLang}_${targetLang}`;
    const memory = await get<TranslationMemory>(key);
    return memory || {};
  } catch (e) {
    console.warn("Failed to get translation memory", e);
    return {};
  }
}

export async function saveToTranslationMemory(
  sourceLang: string,
  targetLang: string,
  originalText: string,
  translatedText: string
): Promise<void> {
  if (!originalText.trim() || !translatedText.trim()) return;

  // Do not save to memory if the translation is identical to the original text
  if (originalText.trim().toLowerCase() === translatedText.trim().toLowerCase()) {
    return;
  }

  try {
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
  } catch (e) {
    console.warn("Failed to save to translation memory", e);
  }
}

export async function saveMultipleToTranslationMemory(
  sourceLang: string,
  targetLang: string,
  blocks: { originalText: string; translatedText: string }[]
): Promise<void> {
  if (!blocks || blocks.length === 0) return;

  try {
    const key = `${MEMORY_KEY_PREFIX}${sourceLang}_${targetLang}`;
    const memory = await getTranslationMemory(sourceLang, targetLang);
    
    let added = false;
    for (const block of blocks) {
      if (!block.originalText.trim() || !block.translatedText.trim()) continue;
      
      // Do not save to memory if the translation is identical to the original text
      // This prevents failed translations from being permanently cached
      if (block.originalText.trim().toLowerCase() === block.translatedText.trim().toLowerCase()) {
        continue;
      }

      memory[block.originalText] = {
        originalText: block.originalText,
        translatedText: block.translatedText,
        timestamp: Date.now(),
      };
      added = true;
    }

    if (!added) return;

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
  } catch (e) {
    console.warn("Failed to save multiple to translation memory", e);
  }
}

export async function clearTranslationMemory(sourceLang: string, targetLang: string): Promise<void> {
  try {
    const key = `${MEMORY_KEY_PREFIX}${sourceLang}_${targetLang}`;
    await set(key, {});
  } catch (e) {
    console.warn("Failed to clear translation memory", e);
  }
}
