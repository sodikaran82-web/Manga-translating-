const translationCache = new Map<string, any>();

export function getCachedTranslation(hash: string) {
  return translationCache.get(hash);
}

export function setCachedTranslation(hash: string, result: any) {
  translationCache.set(hash, result);
}
