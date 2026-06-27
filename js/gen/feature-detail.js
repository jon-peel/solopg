// Above-ground POI detail (Phase 5, Tier 1).
//
// Pure: given preloaded tables + an rng stream + context, returns the STRUCTURED
// picks that describe a non-mapped POI (a shrine in 5.1; camp/landmark later).
// Prose is composed FROM these picks at render time (featureName /
// featureDescription) — the picks are stored, the finished sentence is not
// (mirrors the "render-time derived, not stored" rule used for art). No DOM /
// fetch / persistence, so it's node-testable.
//
// Determinism: app.js drives both the eager build (on add) and the self-heal
// (on open of an older save) from the SAME dedicated sub-stream
// subRng(seed,"hex",q,r,"feature",n), so both paths reproduce identical picks.

import { rollTable } from "../core/table.js";
import { pick } from "../core/rng.js";
import { shrineFormTable, SHRINE_SETTING, SHRINE_SETTING_DEFAULT } from "./terrain-profile.js";

// Detail-shape version, stamped on every generated feature. app.js rebuilds a
// POI whose feature.build differs (or is missing) on next open, so changing the
// shape self-heals old saves without a world-schema migration. Bump on shape change.
export const FEATURE_BUILD = 1;

// POI types that carry a Tier-1 text feature (no map). Grows in 5.2 / 5.3.
export const FEATURE_TYPES = new Set(["shrine"]);

// Conditions that can invite a light "watcher" (keep in sync with the
// corresponding values in data/shrine-condition.json).
const DESECRATED = new Set([
  "Toppled and cracked",
  "Defaced and desecrated",
  "Overgrown with vines",
]);
const WATCHER_CHANCE = 0.3;

function describeShrine(tables, rng, terrain) {
  const form = rollTable(shrineFormTable(terrain), rng).value;
  const dedication = rollTable(tables.get("shrine-dedication"), rng).value;
  const condition = rollTable(tables.get("shrine-condition"), rng).value;
  const detail = rollTable(tables.get("shrine-detail"), rng).value;
  const setting = pick(rng, SHRINE_SETTING[terrain] || SHRINE_SETTING_DEFAULT);
  // Optional light watcher: a single creatures roll, only at a desecrated shrine.
  // The chance is rolled UNCONDITIONALLY so the rng stream stays stable whether
  // or not the condition qualifies.
  const chance = rng();
  const watcher =
    DESECRATED.has(condition) && chance < WATCHER_CHANCE
      ? rollTable(tables.get("creatures"), rng).value
      : null;
  return { build: FEATURE_BUILD, type: "shrine", form, dedication, condition, setting, detail, watcher };
}

/**
 * Generate one POI's Tier-1 feature detail (structured picks), or null for a
 * type that has none yet.
 * @param {Map<string,object>} tables incl. shrine-* and creatures.
 * @param {() => number} rng a dedicated sub-stream for this POI's feature.
 * @param {{ type: string, terrain: string }} ctx
 */
export function describeFeature(tables, rng, { type, terrain }) {
  if (type === "shrine") return describeShrine(tables, rng, terrain);
  return null;
}

/** Short label for the POI list / map glyph (e.g. "Shrine to a war-god"). */
export function featureName(feature) {
  if (feature && feature.type === "shrine") return `Shrine ${feature.dedication}`;
  return null;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Composed description lines for the drill-in (prose built from the picks). */
export function featureDescription(feature) {
  if (!feature || feature.type !== "shrine") return [];
  const lines = [
    `${cap(feature.form)} ${feature.dedication}, ${feature.setting}.`,
    `${feature.condition} — ${feature.detail}.`,
  ];
  if (feature.watcher) lines.push(`Lurking nearby: ${feature.watcher}.`);
  return lines;
}
