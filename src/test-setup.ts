/**
 * Node 26 defines a global localStorage getter that returns undefined unless
 * --localstorage-file is set. Happy-dom then leaves the page storage unusable,
 * and tests crash on localStorage.clear(). Install one in-memory store.
 */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

function usable(storage: unknown): storage is Storage {
  return Boolean(storage) && typeof (storage as Storage).clear === "function";
}

const installed = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
if (!usable(installed && "value" in installed ? installed.value : undefined)) {
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  const page = globalThis.window;
  if (page) {
    Object.defineProperty(page, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}
