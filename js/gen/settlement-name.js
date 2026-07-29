// Settlement names (3R.6) — a seeded, evocative place-name for every settlement.
//
// DERIVED, not stored: a pure function of (seed, q, r, gen) plus the settlement's
// own attributes, so map.js and panel.js compute it on demand (no schema field,
// and a manually-placed settlement is named for free). Regenerating a hex bumps
// its `gen`, which reshuffles the name. A GM's own hex `name` annotation still
// overrides the label.
//
// Element lists live here as consts (like terrain-profile.js's SHRINE_SETTING /
// CAMP_SETTING flavor arrays), not JSON tables — the render path needs them
// synchronously and there's no in-app table editing.

import { subRng, pick } from "../core/rng.js";

// First elements — mostly evocative nouns/adjectives that read as English/OSR
// place-name stems.
const PREFIX = [
  "Ash", "Black", "Bram", "Brack", "Crow", "Dun", "Elder", "Fen", "Frost", "Grim",
  "Green", "Hart", "Hollow", "Marsh", "Mel", "Oak", "Old", "Raven", "Red", "Rook",
  "Salt", "Stone", "Thorn", "Wester", "White", "Wolf", "Wyn", "Yarrow", "Ald", "Gorse",
  "Harrow", "Mire", "Nether", "Over", "Pyke", "Slate", "Tarn", "Umber", "Weir", "Wych",
  "Briar", "Birch", "Willow", "Rowan", "Hazel", "Reed", "Heath", "Nettle", "Ember", "Flint",
  "Iron", "Fox", "Hawk", "Boar", "Heron", "Otter", "Drake", "Storm", "Mist", "Bleak",
  "Grey", "Fair", "Foul", "Glen", "Bryn", "Murk", "Rime", "Adder",
];

// Common place-endings, joined onto the prefix as one word (Ashford, Blackwick).
const COMMON_SUFFIX = [
  "ford", "ton", "bury", "dale", "wick", "field", "bridge", "gate", "mere", "combe",
  "stead", "cross", "ham", "by", "worth", "side", "leigh", "wold", "march",
  "burn", "beck", "thorpe", "thwaite", "holm", "ness", "minster", "chester", "mouth", "pool",
  "haven", "garth", "den", "hope", "cote",
];

// Terrain-flavored endings — grounds a name in its landscape (a "-wood" in the
// forest, a "-crag" in the hills). Merged with the common pool at generation.
export const TERRAIN_SUFFIX = {
  Forest: ["wood", "holt", "hurst", "shaw", "leigh", "glade"],
  Plains: ["field", "meadow", "dale", "ton", "furrow", "acre"],
  Hills: ["crag", "tor", "fell", "wold", "crest", "barrow"],
  Mountains: ["crag", "fell", "pike", "gap", "hold", "scar"],
  Swamp: ["mire", "marsh", "fen", "moor", "sedge", "slough"],
  Desert: ["reach", "waste", "well", "span", "scar", "cross"],
};

// Second words for two-word names ("Raven Cross", "Stone Barrow").
const NOUN = [
  "Cross", "Bridge", "Barrow", "Hollow", "Watch", "Reach", "Ford", "Mill",
  "Gate", "Green", "End", "Rest", "Landing", "Market", "Hallow", "Fields",
  "Ferry", "Wharf", "Quay", "Harbour", "Downs", "Moor", "Vale", "Grange",
  "Court", "Hall", "Chapel", "Rise", "Knoll", "Warren",
];

// Martial endings + patterns for a Keep/Fort.
export const MARTIAL_SUFFIX = ["hold", "watch", "guard", "gard", "wall", "gate", "mote", "tower", "ward", "dyke", "rath", "burh"];

/**
 * A seeded settlement name.
 * @param {number|string} seed world seed
 * @param {number} q
 * @param {number} r
 * @param {number} [gen] the hex's regenerate counter (reshuffles on regen)
 * @param {{ kind?: string, terrain?: string }} [opts] kind "keep" -> martial name;
 *   terrain flavors the ending.
 * @returns {string}
 */
export function settlementName(seed, q, r, gen = 0, opts = {}) {
  const rng = subRng(seed, "sname", q, r, gen);
  const prefix = pick(rng, PREFIX);

  if (opts.kind === "keep") {
    const roll = rng();
    if (roll < 0.4) return `${prefix}${pick(rng, MARTIAL_SUFFIX)}`; // Grimhold
    if (roll < 0.7) return `Fort ${prefix}`;                        // Fort Raven
    return `${prefix} Keep`;                                        // Raven Keep
  }

  const roll = rng();
  if (roll < 0.25) return `${prefix} ${pick(rng, NOUN)}`; // two-word: Raven Cross
  // one word: terrain-flavored ending ~half the time, else a common ending.
  // Filter out a suffix that equals the prefix, so "Fen" + "fen" never stutters.
  const terrainPool = TERRAIN_SUFFIX[opts.terrain];
  const base = terrainPool && rng() < 0.5 ? terrainPool : COMMON_SUFFIX;
  const lower = prefix.toLowerCase();
  const pool = base.filter((s) => s !== lower);
  return `${prefix}${pick(rng, pool)}`;
}
