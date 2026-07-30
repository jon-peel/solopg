// Culture field engine (Phase 14.2) — the deterministic, bounded diffusion that
// turns terrain into demihuman cultures. Pure module: no DOM, no persisted state,
// no entity-to-entity influence. Everything here is a pure function of
// (seed, terrainByKey, anchors). See docs/plans/phase-14-cultures.md §1–§3 and,
// above all, §5 (the anti-bug non-negotiables the tests must prove).
//
// The model is two fields built from the same discrete cores:
//   • Living field — "who lives here now": terrain-modulated distance decay from
//     cores (slow through a race's favoured terrain, fast across hostile terrain,
//     never exactly zero within reach). Above THRESHOLD a hex belongs to the
//     dominant culture; below it the hex is Human (null — never "human").
//   • Heritage field — "who built here once": the same cores with a WIDER reach
//     (~1.5–2× living) and WEAK terrain modulation — a high-water mark of a
//     people's past extent (used by Step 4 for ancient/ruined POI builders).
//
// Bounded reach (§5 rule 2) is guaranteed structurally, not by tuning luck:
// strength starts at 1.0 at a source and is multiplied by a per-step decay factor
// that is ALWAYS < 1 (even in favoured terrain), so it drops geometrically; and
// every source's flood is additionally hard-capped at MAX_R hexes. A culture can
// therefore never cover the whole map, no matter how large.

import { subRng } from "../core/rng.js";
import { axialKey, parseKey, neighbors, axialDistance } from "../core/hexgeo.js";
import { MinHeap } from "../core/minheap.js";
import { computeRegions } from "./regions.js";
import {
  RACES,
  RACE_SET,
  CULTURE_DENSITY,
  TERRAIN_RACE_WEIGHTS,
  CULTURE_COLORS,
} from "./culture-data.js";

// Re-export for the renderer's convenience (Step 5) — one import for tint + field.
export { CULTURE_COLORS };

// --- Knobs (§3) --------------------------------------------------------------
//
// Per-step decay is interpolated between HOS (hostile) and FAV (favoured) by a
// race/terrain "favourability" in [0,1] (see favourInto). Reach to a strength s
// through uniform terrain of decay d is ln(s)/ln(d) hexes — so with THRESHOLD
// 0.30 the living claim reaches ~6 hexes through favoured terrain and ~1.5 across
// hostile terrain (verified against TERRAIN_RACE_WEIGHTS). Heritage uses a higher,
// tighter band (weak modulation) and a larger cap for its wider high-water mark.

/** Living field: tight, strongly terrain-modulated diffusion. */
export const LIVING_CFG = Object.freeze({
  FAV: 0.82, // per-step decay through the race's favoured terrain (slow)
  HOS: 0.45, // per-step decay through hostile terrain (fast)
  THRESHOLD: 0.3, // membership: strength >= this => the hex belongs to the culture
  MIN_FIELD: 0.02, // stop flooding / storing below this (kept < THRESHOLD)
  MAX_R: 10, // hard per-source radius cap (hexes) — the structural bound
  S0: 1.0, // strength at a source hex (cores and anchors alike)
});

/** Heritage field: wider reach (~1.5–2×), weak terrain modulation. */
export const HERITAGE_CFG = Object.freeze({
  FAV: 0.9, // slow decay everywhere...
  HOS: 0.78, // ...only slightly faster in hostile terrain (weak modulation)
  THRESHOLD: 0.3, // used by listCultures/labels; heritage.at does NOT null below it
  MIN_FIELD: 0.02,
  MAX_R: 18, // ~1.8× the living cap
  S0: 1.0,
});

export const CULTURE_KNOBS = Object.freeze({ living: LIVING_CFG, heritage: HERITAGE_CFG });

// The six land terrains cultures can seed/spread through. Sea/Lake are water
// (density 0, never a core); they are still crossable at the hostile decay so the
// "never exactly zero within reach" rule holds, but the field dies within ~1 hex
// of water so a land culture stays coastal.
const LAND_TERRAINS = ["Forest", "Mountains", "Hills", "Plains", "Swamp", "Desert"];

// Per-race max land weight — the denominator that normalizes a race's weight in a
// given terrain to a favourability in [0,1] (1 = its most-favoured terrain).
const RACE_MAX_WEIGHT = (() => {
  const out = {};
  for (const race of RACES) {
    let m = 0;
    for (const t of LAND_TERRAINS) m = Math.max(m, TERRAIN_RACE_WEIGHTS[t][race] || 0);
    out[race] = m || 1;
  }
  return out;
})();

/** True for water terrains — never seed a core, hostile to spread through. */
function isWater(terrain) {
  return terrain === "Sea" || terrain === "Lake";
}

/** Normalize a terrain to its CULTURE_DENSITY key (Sea/Lake -> Water). */
function densityKey(terrain) {
  return isWater(terrain) ? "Water" : terrain;
}

/**
 * Favourability in [0,1] of `terrain` for `race`: its epsilon-floored weight
 * there over its best land weight. 1 = the race's home terrain, ~0 = deeply
 * hostile. Water (and any unknown terrain) is fully hostile (0).
 */
function favour(race, terrain) {
  if (isWater(terrain)) return 0;
  const w = TERRAIN_RACE_WEIGHTS[terrain]?.[race];
  if (!w) return 0;
  return w / RACE_MAX_WEIGHT[race];
}

/** Per-step decay factor (< 1) for `race` entering a hex of `terrain`. */
function decayInto(race, terrain, cfg) {
  return cfg.HOS + (cfg.FAV - cfg.HOS) * favour(race, terrain);
}

// --- Cores (§1.1, §3) --------------------------------------------------------

/**
 * Deterministically pick a race from a terrain's epsilon-floored weight map.
 * Iterates RACES in canonical order so the choice depends only on the rng, not
 * on object key order.
 */
function pickRace(rng, weights) {
  let total = 0;
  for (const r of RACES) total += weights[r] || 0;
  let t = rng() * total;
  for (const r of RACES) {
    t -= weights[r] || 0;
    if (t < 0) return r;
  }
  return RACES[RACES.length - 1];
}

/**
 * The hex in a region nearest its centroid (Euclidean in axial space), lowest
 * key breaking ties — a stable, order-independent origin for the flood and a
 * central peak for map labels.
 */
function regionOrigin(region) {
  let best = null;
  let bestD = Infinity;
  for (const k of region.keys) {
    const { q, r } = parseKey(k);
    const d = (q - region.cq) ** 2 + (r - region.cr) ** 2;
    if (d < bestD || (d === bestD && (best === null || k < best))) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/**
 * Derive culture cores from terrain regions. Each region rolls (seeded from its
 * STABLE anchor key, per §5) against CULTURE_DENSITY[terrain]; if it fires, a race
 * is drawn weighted by TERRAIN_RACE_WEIGHTS[terrain] (already epsilon-floored, so
 * every race is possible anywhere — §5 rule 5). A single origin hex (region
 * centroid) seeds the flood; the density/race rolls key off the anchor so the
 * culture's existence and race never re-shuffle as the clump grows.
 *
 * @param {number|string} seed
 * @param {Map<string,string>} terrainByKey axialKey -> terrain for placed hexes
 * @param {{minSize?:number}} [opts]
 * @returns {{race:string, anchor:string, terrain:string, originKey:string,
 *   oq:number, or:number, cq:number, cr:number, regionSize:number}[]}
 *   sorted by originKey (deterministic order)
 */
export function computeCultureCores(seed, terrainByKey, { minSize = 8 } = {}) {
  const regions = computeRegions(seed, terrainByKey, { minSize });
  const cores = [];
  for (const region of regions) {
    const density = CULTURE_DENSITY[densityKey(region.terrain)] ?? 0;
    if (density <= 0) continue; // water & anything with no density never seeds
    if (subRng(seed, "culture-core", region.anchor)() >= density) continue;
    const race = pickRace(subRng(seed, "culture-race", region.anchor), TERRAIN_RACE_WEIGHTS[region.terrain]);
    const originKey = regionOrigin(region);
    const { q, r } = parseKey(originKey);
    cores.push({
      race,
      anchor: region.anchor,
      terrain: region.terrain,
      originKey,
      oq: q,
      or: r,
      cq: region.cq,
      cr: region.cr,
      regionSize: region.size,
    });
  }
  cores.sort((a, b) => (a.originKey < b.originKey ? -1 : a.originKey > b.originKey ? 1 : 0));
  return cores;
}

// --- The diffusion engine ----------------------------------------------------

/**
 * One field label is "better" than another at a hex iff it has strictly greater
 * strength, or equal strength and a lower source rank. Rank is a stable, unique
 * per-source integer (anchors before cores; then race order; then origin key), so
 * exact ties resolve identically regardless of processing order — this is what
 * makes the field order-independent (§5 rule 3).
 */
function betterLabel(a, b) {
  if (!b) return true;
  if (a.strength !== b.strength) return a.strength > b.strength;
  return a.rank < b.rank;
}

/**
 * Assemble the deterministic, ranked source list for a build: valid anchors
 * (kind 0) then cores (kind 1), each carrying its origin and a unique rank.
 */
function collectSources(cores, anchors) {
  const sources = [];
  for (const a of anchors || []) {
    if (!a || !RACE_SET.has(a.race)) continue;
    if (!Number.isFinite(a.q) || !Number.isFinite(a.r)) continue;
    const key = axialKey(a.q, a.r);
    sources.push({ kind: 0, race: a.race, oq: a.q, or: a.r, key, id: `anchor:${a.race}:${key}` });
  }
  for (const c of cores) {
    sources.push({ kind: 1, race: c.race, oq: c.oq, or: c.or, key: c.originKey, id: `core:${c.originKey}` });
  }
  // Stable total order -> stable, order-independent ranks.
  sources.sort((x, y) => {
    if (x.kind !== y.kind) return x.kind - y.kind;
    const rx = RACES.indexOf(x.race);
    const ry = RACES.indexOf(y.race);
    if (rx !== ry) return rx - ry;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  sources.forEach((s, i) => { s.rank = i; });
  return sources;
}

/**
 * Multi-source, terrain-modulated max-strength flood (generalized Dijkstra on
 * strength = product of per-step decays, all < 1). Each hex keeps the strongest
 * source that reaches it; strictly-better labels re-relax neighbours so the
 * result is the global max, independent of pop order. Bounded by MIN_FIELD and a
 * hard MAX_R radius cap per source. Returns Map<key, {strength,race,rank,srcId,
 * oq,or}> for every hex the field touches at/above MIN_FIELD.
 */
function flood(terrainByKey, sources, cfg) {
  const best = new Map();
  const heap = new MinHeap();

  const relax = (key, label) => {
    if (betterLabel(label, best.get(key))) {
      best.set(key, label);
      // d = -log(strength): smaller d = stronger, so the heap pops strongest first.
      heap.push({ d: -Math.log(label.strength), key, s: label });
    }
  };

  for (const s of sources) {
    if (!terrainByKey.has(s.key)) continue; // a source only exists on a placed hex
    relax(s.key, { strength: cfg.S0, race: s.race, rank: s.rank, srcId: s.id, oq: s.oq, or: s.or });
  }

  while (heap.size) {
    const { key, s: cur } = heap.pop();
    const live = best.get(key);
    // Skip stale heap entries (a better label superseded this one).
    if (!live || live.strength !== cur.strength || live.rank !== cur.rank) continue;
    const { q, r } = parseKey(key);
    for (const nb of neighbors(q, r)) {
      const terrain = terrainByKey.get(axialKey(nb.q, nb.r));
      if (terrain === undefined) continue; // field lives only on placed hexes
      if (axialDistance(cur.oq, cur.or, nb.q, nb.r) > cfg.MAX_R) continue; // hard bound
      const ns = cur.strength * decayInto(cur.race, terrain, cfg);
      if (ns < cfg.MIN_FIELD) continue;
      relax(axialKey(nb.q, nb.r), {
        strength: ns,
        race: cur.race,
        rank: cur.rank,
        srcId: cur.srcId,
        oq: cur.oq,
        or: cur.or,
      });
    }
  }
  return best;
}

/**
 * Read the field at a hex. Living fields null out the race below THRESHOLD (the
 * hex is Human — §5 rules 4 & 6 — though the sub-threshold strength is still
 * returned for probabilistic naming). Heritage fields never null by threshold:
 * even a faint strength names a possible builder. A hex the field never reached
 * returns {race:null, strength:0}.
 */
function readAt(field, q, r) {
  const e = field.strengthByKey.get(axialKey(q, r));
  if (!e) return { race: null, strength: 0 };
  if (field.kind === "living" && e.strength < field.cfg.THRESHOLD) {
    return { race: null, strength: e.strength };
  }
  return { race: e.race, strength: e.strength };
}

function buildField(seed, terrainByKey, opts, cfg, kind) {
  const { minSize = 8, anchors = [] } = opts || {};
  const cores = computeCultureCores(seed, terrainByKey, { minSize });
  const sources = collectSources(cores, anchors);
  const strengthByKey = flood(terrainByKey, sources, cfg);
  const field = { kind, cfg, cores, strengthByKey };
  field.at = (q, r) => readAt(field, q, r);
  return field;
}

/**
 * Build the LIVING culture field for a placed-hex terrain map. One flood over the
 * whole set (not O(hexes × cores) per query) — call once, then query with
 * `field.at` / `cultureAt`.
 *
 * @param {number|string} seed
 * @param {Map<string,string>} terrainByKey axialKey -> terrain
 * @param {{minSize?:number, anchors?:{q:number,r:number,race:string}[]}} [opts]
 *   `anchors` are fixed sources (Step 3 passes stored settlements) that pin the
 *   field — honoured here if given.
 * @returns {{kind:string, cfg:object, cores:object[],
 *   strengthByKey:Map<string,object>, at:(q:number,r:number)=>{race:?string,strength:number}}}
 */
export function buildLivingField(seed, terrainByKey, opts = {}) {
  return buildField(seed, terrainByKey, opts, LIVING_CFG, "living");
}

/**
 * Build the HERITAGE culture field (wider reach, weak terrain modulation) from
 * the same cores. Same signature as buildLivingField.
 */
export function buildHeritageField(seed, terrainByKey, opts = {}) {
  return buildField(seed, terrainByKey, opts, HERITAGE_CFG, "heritage");
}

/**
 * Living culture at a hex: {race, strength}. `race` is null (Human) below the
 * membership threshold or where the field never reached. Pass a field from
 * buildLivingField.
 */
export function cultureAt(field, q, r) {
  return readAt(field, q, r);
}

/**
 * Heritage builder-race at a hex: {race, strength}. No threshold null-out — a
 * faint strength still names a rare distant builder. Pass a field from
 * buildHeritageField.
 */
export function heritageAt(field, q, r) {
  return readAt(field, q, r);
}

/**
 * Summarize a field's cultures for labels/legend: one entry per source (core or
 * anchor) that claims at least one hex at/above the field's THRESHOLD. Each entry
 * gives the race, the peak hex (the source origin — where the label sits), the
 * claimed-hex centroid, and the culture's extent (hex count + keys).
 *
 * @returns {{race:string, srcId:string, originKey:string, peakKey:string,
 *   peakStrength:number, cq:number, cr:number, size:number, keys:string[]}[]}
 *   sorted by srcId (deterministic order)
 */
export function listCultures(field) {
  const cut = field.cfg.THRESHOLD;
  const groups = new Map();
  for (const [key, e] of field.strengthByKey) {
    if (e.strength < cut) continue;
    let g = groups.get(e.srcId);
    if (!g) {
      g = { race: e.race, srcId: e.srcId, oq: e.oq, or: e.or, keys: [], sq: 0, sr: 0, peakKey: key, peakStrength: -1 };
      groups.set(e.srcId, g);
    }
    const { q, r } = parseKey(key);
    g.keys.push(key);
    g.sq += q;
    g.sr += r;
    if (e.strength > g.peakStrength) {
      g.peakStrength = e.strength;
      g.peakKey = key;
    }
  }
  const out = [];
  for (const g of groups.values()) {
    const n = g.keys.length;
    out.push({
      race: g.race,
      srcId: g.srcId,
      originKey: axialKey(g.oq, g.or),
      peakKey: g.peakKey,
      peakStrength: g.peakStrength,
      cq: g.sq / n,
      cr: g.sr / n,
      size: n,
      keys: g.keys.slice().sort(),
    });
  }
  out.sort((a, b) => (a.srcId < b.srcId ? -1 : a.srcId > b.srcId ? 1 : 0));
  return out;
}
