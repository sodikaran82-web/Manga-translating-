// Polyfill for Promise.withResolvers required by pdfjs-dist 4+
if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Polyfill for localStorage and indexedDB when blocked by browser privacy settings
try {
  if (typeof window !== 'undefined') {
    window.localStorage;
  }
} catch (e: any) {
  if (e.name === 'SecurityError' || (e.message && e.message.includes('SecurityError'))) {
    const memoryStorage = {
      _data: {} as Record<string, string>,
      setItem: function(id: string, val: string) { return this._data[id] = String(val); },
      getItem: function(id: string) { return this._data.hasOwnProperty(id) ? this._data[id] : null; },
      removeItem: function(id: string) { return delete this._data[id]; },
      clear: function() { return this._data = {}; },
      get length() { return Object.keys(this._data).length; },
      key: function(i: number) { return Object.keys(this._data)[i] || null; }
    };
    try {
      Object.defineProperty(window, 'localStorage', {
        value: memoryStorage,
        configurable: true,
        enumerable: true,
        writable: true
      });
    } catch (err) {
      console.warn('Could not redefine localStorage:', err);
    }
  }
}

try {
  if (typeof window !== 'undefined') {
    window.sessionStorage;
  }
} catch (e: any) {
  if (e.name === 'SecurityError' || (e.message && e.message.includes('SecurityError'))) {
    const memoryStorage = {
      _data: {} as Record<string, string>,
      setItem: function(id: string, val: string) { return this._data[id] = String(val); },
      getItem: function(id: string) { return this._data.hasOwnProperty(id) ? this._data[id] : null; },
      removeItem: function(id: string) { return delete this._data[id]; },
      clear: function() { return this._data = {}; },
      get length() { return Object.keys(this._data).length; },
      key: function(i: number) { return Object.keys(this._data)[i] || null; }
    };
    try {
      Object.defineProperty(window, 'sessionStorage', {
        value: memoryStorage,
        configurable: true,
        enumerable: true,
        writable: true
      });
    } catch (err) {
      console.warn('Could not redefine sessionStorage:', err);
    }
  }
}

try {
  if (typeof window !== 'undefined') {
    window.indexedDB;
  }
} catch (e: any) {
  if (e.name === 'SecurityError' || (e.message && e.message.includes('SecurityError'))) {
    try {
      Object.defineProperty(window, 'indexedDB', {
        value: null,
        configurable: true,
        enumerable: true,
        writable: true
      });
    } catch (err) {
      console.warn('Could not redefine indexedDB:', err);
    }
  }
}
