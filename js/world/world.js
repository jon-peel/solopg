// Core domain model.
//
// `hexes` is the keyed collection generators populate. Phase 1 stores generated
// hexes under throwaway "unplaced" keys ("u:<n>") with coords:null; Phase 2 will
// introduce axial coordinate keys ("q,r") and place these on a map.

import { axialKey } from "../core/hexgeo.js";

// v2: hexes gained structured contents (Phase 1). v1 worlds had empty hexes only.
// Phase 2 (the map) reused v2 (hexes already carried coords/placed).
// v3: POIs became a typed array (Phase 3) — `hex.pois` is now `POI[]`, not
// `{present,count}`. See migrateWorld in portability.js.
// v4: dungeon POIs gained a generated interior (Phase 4) at `detail.dungeon`,
// replacing the Phase-3 `detail.stub` placeholder.
// v5: the explorable POI types (ruin/cave/mine) were merged into `dungeon` as
// themes (Phase 4 arc) — such POIs become `type:"dungeon"` with `detail.theme`.
export const SCHEMA_VERSION = 5;

// Default hex scale in miles (classic 6-mile hex). Configurable per world.
const DEFAULT_HEX_SCALE = 6;

/**
 * Create a new, empty world.
 * @param {{ name?: string, seed?: number|string }} [opts]
 * @returns {object} world
 */
export function createWorld({ name = "Untitled World", seed } = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    name,
    // The seed makes generation reproducible/shareable; if none is supplied we
    // mint a random one and persist it as the world's canonical seed.
    seed: seed ?? randomSeed(),
    hexScale: DEFAULT_HEX_SCALE,
    hexes: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Next key for an unplaced (no-coordinates) hex: "u:<n>", monotonic so deleting
 * a hex never reuses its key. The "u:" namespace is intentionally disjoint from
 * Phase 2's axial "q,r" keys.
 * @param {object} world
 * @returns {string}
 */
export function nextUnplacedKey(world) {
  let max = -1;
  for (const key of Object.keys(world.hexes)) {
    const m = /^u:(\d+)$/.exec(key);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `u:${max + 1}`;
}

/**
 * Store a hex in the world under its own key. Mutates and returns the world.
 * @param {object} world
 * @param {object} hex must have a string `key`
 * @returns {object} world
 */
export function addHex(world, hex) {
  world.hexes[hex.key] = hex;
  return world;
}

/**
 * Hex at axial (q,r), or undefined. (Returns any hex stored under that key,
 * placed or not.)
 */
export function getHex(world, q, r) {
  return world.hexes[axialKey(q, r)];
}

/** True if a placed hex occupies axial (q,r). */
export function hasHexAt(world, q, r) {
  const h = world.hexes[axialKey(q, r)];
  return !!(h && h.placed);
}

/** All hexes placed on the map (those with coords and placed === true). */
export function placedHexes(world) {
  return Object.values(world.hexes).filter((h) => h.placed && h.coords);
}

/** Remove the hex at axial (q,r), if any. Mutates and returns the world. */
export function removeHex(world, q, r) {
  delete world.hexes[axialKey(q, r)];
  return world;
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (e.g. older test runtimes).
  return "w-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function randomSeed() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
