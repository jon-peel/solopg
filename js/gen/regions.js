// Named regions (3R.8) — evocative names for the big terrain tracts, engraved
// faintly across the map ("the Blackwood", "the Grey Peaks", "the Salt Marches").
//
// DERIVED, not stored: connected same-terrain clumps above a size threshold are
// named by a pure function of (seed, the clump's canonical hex), so map.js
// computes them on demand and nothing needs persisting. Order-independent for a
// given revealed set; a growing clump keeps its name as long as its canonical
// (lowest-key) hex is stable. Element lists are consts (like settlement-name.js)
// because the render path needs them synchronously.

import { subRng, pick } from "../core/rng.js";
import { neighbors, axialKey, parseKey } from "../core/hexgeo.js";
import { RACE_NAME_POOLS } from "./culture-data.js";

// Terrains worth naming as a region (Water bodies included; a river is its own
// overlay). Small/among-others terrains still clump — the size threshold filters.
const NAMED = new Set(["Forest", "Mountains", "Hills", "Swamp", "Desert", "Plains", "Sea", "Lake"]);

// Evocative place-name stems (grander than the settlement pool — these name whole
// tracts of land).
const REGION_PREFIX = [
  "Ash", "Black", "Bleak", "Cinder", "Cold", "Dusk", "Elder", "Fell", "Frost", "Gloam",
  "Gold", "Grey", "Grim", "Hoar", "Iron", "Mourn", "Old", "Pale", "Raven", "Red",
  "Salt", "Shadow", "Storm", "Sunder", "Thorn", "Wan", "Weir", "Wild", "Wither", "Wolf",
  "Amber", "Bram", "Dun", "Hollow", "Marrow", "Nether", "Slate", "Umber", "Wraith", "Yarrow",
];

// Collective nouns for a whole region, by terrain.
const REGION_NOUN = {
  Forest: ["Wood", "Forest", "Wilds", "Pines", "Thicket", "Wold"],
  Mountains: ["Peaks", "Range", "Heights", "Crags", "Spires", "Mountains"],
  Hills: ["Hills", "Downs", "Uplands", "Fells", "Barrows"],
  Swamp: ["Marches", "Fens", "Mire", "Moors", "Sloughs"],
  Desert: ["Waste", "Sands", "Barrens", "Dunes", "Reach"],
  Plains: ["Plains", "Fields", "Steppe", "Flats", "Reach", "Downs"],
  Sea: ["Sea", "Deeps", "Gulf", "Straits", "Waters"],
  Lake: ["Mere", "Water", "Loch", "Tarn"],
};

/**
 * A seeded region name, e.g. "the Blackwood", "the Grey Peaks", "Lake Mourn".
 * @param {number|string} seed world seed
 * @param {string} terrain the region's terrain
 * @param {string} anchorKey canonical (lowest) axial key in the region — keeps
 *   the name stable as the clump grows
 * @param {string} [race] (Phase 14.1 — "elf" | "dwarf" | "halfling" | "gnome")
 *   swaps in that race's realm-name pools instead of the Human ones below.
 *   Omitted/unknown race = Human, byte-for-byte as before.
 * @returns {string}
 */
export function regionName(seed, terrain, anchorKey, race) {
  const rng = subRng(seed, "region", anchorKey);

  // Phase 14.1: race-flavored path, entered only when a known race is passed —
  // the Human path below is untouched so the default (no race) behaviour stays
  // byte-for-byte identical to before.
  const racePools = race && RACE_NAME_POOLS[race];
  if (racePools) return raceRegionName(rng, racePools);

  const prefix = pick(rng, REGION_PREFIX);
  const noun = pick(rng, REGION_NOUN[terrain] || REGION_NOUN.Plains);
  const style = rng();
  if (terrain === "Lake") return style < 0.5 ? `Lake ${prefix}` : `the ${prefix} ${noun}`;
  // A forest often reads as one compound word ("Blackwood"); avoid a stutter.
  if (terrain === "Forest" && style < 0.5 && prefix.toLowerCase() !== noun.toLowerCase()) {
    return `the ${prefix}${noun.toLowerCase()}`;
  }
  return `the ${prefix} ${noun}`;
}

// Race-flavored region/realm name (Phase 14.1) — draws from the race's shared
// prefix pool (settlement prefixes double as region prefixes, per culture-data's
// pool shape) and its own region/realm noun pool. Simpler than the Human path:
// no per-terrain noun table and no Lake/Forest special-casing, since a
// demihuman realm name doesn't key off the land's terrain the way a Human
// tract name does — the race itself is the flavour.
function raceRegionName(rng, pools) {
  const prefix = pick(rng, pools.prefixes);
  const noun = pick(rng, pools.regionNouns);
  const style = rng();
  // Sometimes reads as one fused word ("the Silvaal"); avoid a stutter.
  if (style < 0.4 && prefix.toLowerCase() !== noun.toLowerCase()) {
    return `the ${prefix}${noun.toLowerCase()}`;
  }
  return `the ${prefix} ${noun}`;
}

/**
 * Group placed hexes into named regions: connected same-terrain clumps of at
 * least `minSize` hexes, each with a centroid (for the label) and a seeded name.
 * @param {number|string} seed world seed
 * @param {Map<string,string>} terrainByKey axialKey -> terrain for every placed hex
 * @param {{minSize?:number}} [opts]
 * @returns {{id:string,terrain:string,size:number,anchor:string,cq:number,cr:number,name:string}[]}
 */
export function computeRegions(seed, terrainByKey, { minSize = 8 } = {}) {
  const seen = new Set();
  const regions = [];
  for (const [key, terrain] of terrainByKey) {
    if (seen.has(key) || !NAMED.has(terrain)) continue;
    const stack = [key]; seen.add(key);
    const hexes = []; let anchor = key;
    while (stack.length) {
      const k = stack.pop(); hexes.push(k); if (k < anchor) anchor = k;
      const { q, r } = parseKey(k);
      for (const nb of neighbors(q, r)) {
        const nk = axialKey(nb.q, nb.r);
        if (!seen.has(nk) && terrainByKey.get(nk) === terrain) { seen.add(nk); stack.push(nk); }
      }
    }
    if (hexes.length < minSize) continue;
    let sq = 0, sr = 0;
    for (const k of hexes) { const { q, r } = parseKey(k); sq += q; sr += r; }
    regions.push({
      id: `region:${anchor}`, terrain, size: hexes.length, anchor,
      cq: sq / hexes.length, cr: sr / hexes.length,
      name: regionName(seed, terrain, anchor),
      keys: hexes, // the region's hex keys (for hover lookup)
    });
  }
  return regions;
}
