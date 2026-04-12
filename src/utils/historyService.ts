import { get, set } from 'idb-keyval';
import { TranslationBlock, TokenUsage } from './geminiService';

export interface HistoryItem {
  id: string;
  timestamp: number;
  imageUrl: string; // base64 string
  sourceLang: string;
  targetLang: string;
  blocks: TranslationBlock[];
  usage?: TokenUsage;
}

const HISTORY_KEY = 'manga_translation_history';

export async function saveToHistory(item: HistoryItem): Promise<void> {
  try {
    const history = await getHistory();
    // Prepend new item
    const newHistory = [item, ...history];
    // Keep only last 50 items to avoid using too much storage
    if (newHistory.length > 50) {
      newHistory.length = 50;
    }
    await set(HISTORY_KEY, newHistory);
  } catch (error) {
    console.error('Failed to save history:', error);
  }
}

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    const history = await get<HistoryItem[]>(HISTORY_KEY);
    return history || [];
  } catch (error) {
    console.error('Failed to get history:', error);
    return [];
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await set(HISTORY_KEY, []);
  } catch (error) {
    console.error('Failed to clear history:', error);
  }
}

export async function deleteHistoryItem(id: string): Promise<void> {
  try {
    const history = await getHistory();
    const newHistory = history.filter(item => item.id !== id);
    await set(HISTORY_KEY, newHistory);
  } catch (error) {
    console.error('Failed to delete history item:', error);
  }
}
