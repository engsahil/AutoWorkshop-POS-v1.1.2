import 'fake-indexeddb/auto';

// jsdom is not used: the modules under test are pure IndexedDB + WebCrypto.
// Node 20 ships WebCrypto, so we only need the IndexedDB shim plus a minimal
// localStorage for the session helpers.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, String(value)); }
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
}
