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
import { rollDice } from "../core/dice.js";
import {
  shrineFormTable,
  SHRINE_SETTING,
  SHRINE_SETTING_DEFAULT,
  CAMP_SETTING,
  CAMP_SETTING_DEFAULT,
  landmarkFeatureTable,
  LANDMARK_SETTING,
  LANDMARK_SETTING_DEFAULT,
} from "./terrain-profile.js";

// Detail-shape version, stamped on every generated feature. app.js rebuilds a
// POI whose feature.build differs (or is missing) on next open, so changing the
// shape self-heals old saves without a world-schema migration. Bump on shape change.
export const FEATURE_BUILD = 1;

// POI types that carry a Tier-1 text feature (no map).
export const FEATURE_TYPES = new Set(["shrine", "camp", "landmark"]);

// A landmark sometimes carries an optional rumour/secret hook.
const HOOK_CHANCE = 0.5;

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

// A camp's narrative hangs off its scale (size + visible signs + a head-count
// dice) and its OCCUPANT — the same occupier already rolled on the POI, so the
// camp has a single "who". Occupant "occupied" → a manned camp (head-count +
// reaction); "none" → an abandoned, cold camp.
function describeCamp(tables, rng, terrain, occupant) {
  const scale = rollTable(tables.get("camp-scale"), rng).value; // { size, signs, na }
  const setting = pick(rng, CAMP_SETTING[terrain] || CAMP_SETTING_DEFAULT);
  const who = occupant && occupant.kind === "occupied" ? occupant.by : null;
  // Manned camps get a concrete head-count + a reaction; cold camps get neither.
  // The branch turns on persisted data (occupant), so the eager build and the
  // self-heal stay in lock-step.
  const number = who ? rollDice(scale.na, rng).total : null;
  const reaction = who ? rollTable(tables.get("camp-reaction"), rng).value : null;
  return { build: FEATURE_BUILD, type: "camp", size: scale.size, signs: scale.signs, setting, who, number, reaction };
}

// A landmark is pure description: a terrain-biased feature, a notable trait, a
// terrain setting, and (about half the time) a light rumour/secret hook. No
// occupant, no encounter.
function describeLandmark(tables, rng, terrain) {
  const feature = rollTable(landmarkFeatureTable(terrain), rng).value;
  const trait = rollTable(tables.get("landmark-trait"), rng).value;
  const setting = pick(rng, LANDMARK_SETTING[terrain] || LANDMARK_SETTING_DEFAULT);
  // Chance rolled unconditionally so the stream stays stable whether or not a
  // hook lands.
  const chance = rng();
  const hook = chance < HOOK_CHANCE ? rollTable(tables.get("landmark-hook"), rng).value : null;
  return { build: FEATURE_BUILD, type: "landmark", feature, trait, setting, hook };
}

/**
 * Generate one POI's Tier-1 feature detail (structured picks), or null for a
 * type that has none yet.
 * @param {Map<string,object>} tables incl. shrine-*, camp-*, landmark-*, creatures, occupiers.
 * @param {() => number} rng a dedicated sub-stream for this POI's feature.
 * @param {{ type: string, terrain: string, occupant?: object }} ctx
 */
export function describeFeature(tables, rng, { type, terrain, occupant }) {
  if (type === "shrine") return describeShrine(tables, rng, terrain);
  if (type === "camp") return describeCamp(tables, rng, terrain, occupant);
  if (type === "landmark") return describeLandmark(tables, rng, terrain);
  return null;
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stripArticle = (s) => (s ? s.replace(/^(a |an |the )/i, "") : s);

/** Short label for the POI list / map glyph (e.g. "Shrine to a war-god"). */
export function featureName(feature) {
  if (!feature) return null;
  if (feature.type === "shrine") return `Shrine ${feature.dedication}`;
  if (feature.type === "camp") return feature.who ? `Camp — ${feature.who}` : "Deserted camp";
  if (feature.type === "landmark") return cap(stripArticle(feature.feature));
  return null;
}

/** Composed description lines for the drill-in (prose built from the picks). */
export function featureDescription(feature) {
  if (!feature) return [];
  if (feature.type === "shrine") {
    const lines = [
      `${cap(feature.form)} ${feature.dedication}, ${feature.setting}.`,
      `${feature.condition} — ${feature.detail}.`,
    ];
    if (feature.watcher) lines.push(`Lurking nearby: ${feature.watcher}.`);
    return lines;
  }
  if (feature.type === "camp") {
    const who = feature.who ? ` of ${feature.who.toLowerCase()}` : "";
    const lines = [
      `${cap(feature.size)}${who}, ${feature.setting}.`,
      `${cap(feature.signs)} — ${feature.who ? "still in use" : "long cold"}.`,
    ];
    if (feature.who) lines.push(`About ${feature.number} of them — ${feature.reaction}.`);
    return lines;
  }
  if (feature.type === "landmark") {
    const lines = [
      `${cap(feature.feature)}, ${feature.setting}.`,
      `${cap(feature.trait)}.`,
    ];
    if (feature.hook) lines.push(feature.hook); // hook carries its own punctuation
    return lines;
  }
  return [];
}
