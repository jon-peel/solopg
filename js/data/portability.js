// JSON export / import for backup and sharing.
//
// Every world carries a schemaVersion so future format changes can be detected
// and migrated. Phase 0 accepts versions up to the current one and rejects
// anything newer (produced by a later app version).

import { SCHEMA_VERSION } from "../world/world.js";

/**
 * Serialize a world to a pretty JSON string.
 * @param {object} world
 * @returns {string}
 */
export function exportWorld(world) {
  return JSON.stringify(world, null, 2);
}

/**
 * Parse and validate an exported world.
 * @param {string} json
 * @returns {object} world
 */
export function importWorld(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`Import failed: not valid JSON (${err.message})`);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Import failed: expected a world object");
  }
  if (typeof data.schemaVersion !== "number") {
    throw new Error("Import failed: missing schemaVersion");
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Import failed: world schemaVersion ${data.schemaVersion} is newer than ` +
        `this app supports (${SCHEMA_VERSION}). Update the app.`,
    );
  }
  if (typeof data.id !== "string" || typeof data.name !== "string") {
    throw new Error("Import failed: world is missing id/name");
  }

  return migrateWorld(data);
}

/**
 * Migrate an older world up to the current SCHEMA_VERSION. Pure; mutates and
 * returns the given object. Called by importWorld AND on load from IndexedDB so
 * persisted older worlds upgrade too.
 *
 * - v1 -> v2: v1 worlds only had an empty `hexes` map — no transform needed.
 * - v2 -> v3: POIs changed from `{present,count}` to a typed `POI[]`. The old
 *   count carried no type/occupant (never rolled), so we reset each hex's
 *   `pois` to `[]`; terrain/settlement are preserved. POIs reappear (typed)
 *   when the user regenerates the hex.
 * @param {object} data
 * @returns {object} data (migrated)
 */
export function migrateWorld(data) {
  if (data.schemaVersion < 3) {
    for (const hex of Object.values(data.hexes || {})) {
      hex.pois = [];
    }
    data.schemaVersion = 3;
  }
  return data;
}
