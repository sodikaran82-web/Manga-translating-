export const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
};

export const safeSetItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Ignore
  }
};

export const safeRemoveItem = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // Ignore
  }
};

export const loadTextCache = (): Record<string, string> => {
  const cacheStr = safeGetItem('textCache');
  if (cacheStr) {
    try {
      return JSON.parse(cacheStr);
    } catch (e) {
      return {};
    }
  }
  return {};
};

export const saveTextCache = (cache: Record<string, string>): void => {
  safeSetItem('textCache', JSON.stringify(cache));
};
