// IndexedDB persistence.
//
// Holds a list of worlds (not a single one), keyed by id, so the app can create,
// switch, and delete worlds. Kept deliberately thin: it's browser-only and so is
// verified by manual/browser smoke test rather than the node unit suite.

const DB_NAME = "world-oracle";
const DB_VERSION = 1;
const STORE = "worlds";
const LAST_WORLD_KEY = "lastWorldId";

let dbPromise = null;

/**
 * Open (and lazily create) the database.
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * List all worlds, most recently updated first.
 * @returns {Promise<object[]>}
 */
export async function listWorlds() {
  const db = await openDb();
  const all = await asPromise(tx(db, "readonly").getAll());
  return all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

/**
 * Save (insert or update) a world, refreshing its updatedAt timestamp.
 * @param {object} world
 * @returns {Promise<object>} the saved world
 */
export async function saveWorld(world) {
  const db = await openDb();
  const toSave = { ...world, updatedAt: new Date().toISOString() };
  await asPromise(tx(db, "readwrite").put(toSave));
  return toSave;
}

/**
 * Load a world by id.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function loadWorld(id) {
  const db = await openDb();
  return asPromise(tx(db, "readonly").get(id));
}

/**
 * Delete a world by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteWorld(id) {
  const db = await openDb();
  await asPromise(tx(db, "readwrite").delete(id));
}

/** Remember / recall the last-open world across reloads. */
export function setLastWorldId(id) {
  try {
    localStorage.setItem(LAST_WORLD_KEY, id);
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

export function getLastWorldId() {
  try {
    return localStorage.getItem(LAST_WORLD_KEY);
  } catch {
    return null;
  }
}
