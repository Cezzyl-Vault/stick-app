// Lokale Speicherung in IndexedDB (funktioniert offline).
// Projekt: { id, name, createdAt, updatedAt, settings, crop, pattern, thumb, edited,
//            image (ArrayBuffer|null), imageType, imageRemote, dirty, deleted }

const DB_NAME = 'stickapp';
const VERSION = 1;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const storage = {
  all: () => tx('projects', 'readonly', (s) => s.getAll()),
  get: (id) => tx('projects', 'readonly', (s) => s.get(id)),
  put: (p) => tx('projects', 'readwrite', (s) => s.put(p)),
  remove: (id) => tx('projects', 'readwrite', (s) => s.delete(id)),
  clear: () => tx('projects', 'readwrite', (s) => s.clear()),
  getMeta: async (key) => (await tx('meta', 'readonly', (s) => s.get(key)))?.value,
  setMeta: (key, value) => tx('meta', 'readwrite', (s) => s.put({ key, value })),
};

/** Bittet den Browser, die Daten nicht automatisch zu löschen. */
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* egal */ }
}
