// Node 26 ships an inert `localStorage` global (it needs --localstorage-file),
// and Vitest's jsdom environment skips copying globals the runtime already
// defines. jsdom's own Storage therefore never reaches the tests, leaving
// `localStorage` undefined under `@vitest-environment jsdom`. Give those tests a
// real in-memory Storage so the ones that assert persistence can run.
if (typeof window !== "undefined" && typeof globalThis.localStorage === "undefined") {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() { return entries.size; },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(String(key)) ?? null,
    setItem: (key, value) => { entries.set(String(key), String(value)); },
    removeItem: (key) => { entries.delete(String(key)); },
    clear: () => { entries.clear(); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}
