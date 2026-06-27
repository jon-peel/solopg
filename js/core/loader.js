// JSON table loader.
//
// Tables are fetched at runtime (no build step, no import assertions) and
// validated on arrival so malformed content fails loudly in development.
// Requires an HTTP origin — the app cannot run from file:// (see PLAN.md).

import { validateTable } from "./table.js";

const cache = new Map();

/**
 * Fetch, validate and cache a table by id.
 * @param {string} id table id (file is `${basePath}/${id}.json`)
 * @param {string} [basePath]
 * @returns {Promise<object>} validated table
 */
export async function loadTable(id, basePath = "./data") {
  if (cache.has(id)) return cache.get(id);

  // Retry transient network failures. Loading many tables at once fires a burst of
  // concurrent fetches; a single-threaded dev server can occasionally drop one,
  // surfacing as a `fetch` rejection ("Failed to fetch") rather than an HTTP error.
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${basePath}/${id}.json`);
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  if (!res.ok) {
    throw new Error(`Failed to load table "${id}": HTTP ${res.status}`);
  }
  const table = validateTable(await res.json());
  cache.set(id, table);
  return table;
}

/**
 * Load several tables, returning a Map keyed by id.
 * @param {string[]} ids
 * @param {string} [basePath]
 * @returns {Promise<Map<string, object>>}
 */
export async function loadTables(ids, basePath = "./data") {
  const loaded = await Promise.all(ids.map((id) => loadTable(id, basePath)));
  return new Map(loaded.map((t) => [t.id, t]));
}

/**
 * Build a synchronous resolver over a preloaded Map of tables, for feeding
 * rollTable's nested-roll resolution.
 * @param {Map<string, object>} map
 * @returns {(id: string) => object | undefined}
 */
export function makeResolver(map) {
  return (id) => map.get(id);
}
