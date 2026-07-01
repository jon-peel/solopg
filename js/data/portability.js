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
 * - v3 -> v4: dungeon POIs replaced the `detail.stub` placeholder with a
 *   generated interior at `detail.dungeon`. Migration can't roll (no tables/rng
 *   here), so it just drops the stale stub; the dungeon detail view generates
 *   and persists `detail.dungeon` the first time the POI is opened.
 * - v4 -> v5: the explorable POI types (ruin/cave/mine) merged into `dungeon`
 *   as themes. Such POIs become `type:"dungeon"` with `detail.theme` carried
 *   over from the old type; any stale `detail.dungeon` is cleared so the themed
 *   interior regenerates on next open.
 * - v5 -> v6: worlds gained a top-level `hooks` array (Phase 6). Older worlds
 *   never had one, so we just seed an empty list; hooks are created by the user.
 * - v6 -> v7: hexes gained optional `name`/`note` annotations (Phase 7.5).
 *   Additive — older hexes simply have none, so there's nothing to transform;
 *   we just stamp the version.
 * - v7 -> v8: hexes gained `elevation`/`moisture` fields (Phase 3R.3). Additive
 *   and there's no rng/seed context here to retroactively sample them, so
 *   older hexes simply lack both until regenerated — just stamp the version.
 * - v8 -> v9: hexes gained a `basin` field, and generated water hexes now come
 *   out as `terrain:"Lake"`/`"Sea"` instead of `"Water"` (Phase 3R.4). No
 *   transform — old `Water` hexes still render/behave correctly (shared
 *   profile/bias via biasKey()) — just stamp the version.
 * - v9 -> v10: `basin` reworked into a real land/ocean gate, renamed
 *   `continent` (3R.4 revision — real coastlines). No transform — old hexes'
 *   `basin` field is simply unused going forward; `Lake`/`Sea` values are
 *   unchanged — just stamp the version.
 * @param {object} data
 * @returns {object} data (migrated)
 */
// Old explorable POI type -> the dungeon theme it becomes (v4 -> v5).
const MERGED_TYPE_THEME = {
  ruin: "Ruin",
  cave: "Cave complex",
  mine: "Abandoned mine",
};

export function migrateWorld(data) {
  if (data.schemaVersion < 3) {
    for (const hex of Object.values(data.hexes || {})) {
      hex.pois = [];
    }
    data.schemaVersion = 3;
  }
  if (data.schemaVersion < 4) {
    for (const hex of Object.values(data.hexes || {})) {
      for (const poi of hex.pois || []) {
        if (poi.detail && poi.detail.stub) delete poi.detail.stub;
      }
    }
    data.schemaVersion = 4;
  }
  if (data.schemaVersion < 5) {
    for (const hex of Object.values(data.hexes || {})) {
      for (const poi of hex.pois || []) {
        const theme = MERGED_TYPE_THEME[poi.type];
        if (theme) {
          poi.type = "dungeon";
          poi.detail = poi.detail || {};
          poi.detail.theme = theme;
          delete poi.detail.dungeon; // regenerate themed interior on next open
        }
      }
    }
    data.schemaVersion = 5;
  }
  if (data.schemaVersion < 6) {
    if (!Array.isArray(data.hooks)) data.hooks = [];
    data.schemaVersion = 6;
  }
  if (data.schemaVersion < 7) {
    // hex `name`/`note` are additive and default to none — just stamp the version.
    data.schemaVersion = 7;
  }
  if (data.schemaVersion < 8) {
    // hex `elevation`/`moisture` are additive and default to absent on old
    // hexes (no retrofit noise sample) — just stamp the version.
    data.schemaVersion = 8;
  }
  if (data.schemaVersion < 9) {
    // hex `basin` is additive (absent on old hexes); old `terrain:"Water"`
    // hexes are left as-is — Lake/Sea's shared profile/bias alias covers them
    // too — just stamp the version.
    data.schemaVersion = 9;
  }
  if (data.schemaVersion < 10) {
    // `basin` -> `continent` rename/rework; old hexes simply keep whatever
    // `basin` value they had (unused going forward) — just stamp the version.
    data.schemaVersion = 10;
  }
  return data;
}
