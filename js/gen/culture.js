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
import { fbm2D } from "../core/noise.js";
import { axialKey, parseKey, neighbors, axialDistance } from "../core/hexgeo.js";
import { MinHeap } from "../core/minheap.js";
import { computeRegions } from "./regions.js";
import {
  RACES,
  RACE_SET,
  CULTURE_DENSITY,
  TERRAIN_RACE_WEIGHTS,
  CULTURE_COLORS,
  RACE_NAME_POOLS,
  RACE_JOIN,
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

// --- Anchors & settlement stamping (Phase 14.3) ------------------------------
//
// A culture is a tent: the field is the fabric, the SETTLEMENTS are the pegs
// (§1.2). When a settlement first appears it is stamped with a race rolled
// against the living field there (§1.4), stored on `settlement.race`, and never
// re-rolled. Stored anchors then feed back into the living field as fixed
// sources, so the field near towns is pinned by the pegs and only the town-less
// frontier is free to breathe. Human is the null case: a Human town stores NO
// race (§5 rule 4). `settlement.raceStamped` marks a settlement as resolved so
// the roll happens exactly once, frozen thereafter.

/**
 * The settlement-stamp probability model (§1.4). `P(demihuman) = clamp(FLOOR +
 * strength·GAIN, 0, P_MAX)`, evaluated only where the living field already claims
 * the hex for a culture (strength >= THRESHOLD). P_MAX < 1 so even a strong-
 * culture town is sometimes Human (the people moved in later); the fringe (near
 * THRESHOLD) is mostly Human. ENCLAVE_EPSILON is the small chance the stamped
 * race differs from the field's dominant one — a minority enclave.
 */
export const STAMP_CFG = Object.freeze({
  FLOOR: 0.05, // base fire chance at the membership threshold
  GAIN: 0.8, // how hard strength drives the fire chance
  P_MAX: 0.85, // cap (< 1): fringe & some in-culture towns stay Human
  ENCLAVE_EPSILON: 0.02, // per-race weight for a different-race minority enclave
});

/**
 * Weighted pick of the stamped race once the roll fires: the field's dominant
 * race by far, with a small ENCLAVE_EPSILON chance of any other race (a minority
 * enclave). Iterates RACES in canonical order so the pick depends only on the rng.
 */
function pickStampRace(rng, dominant) {
  const eps = STAMP_CFG.ENCLAVE_EPSILON;
  const total = 1 + eps * RACES.length;
  let t = rng() * total;
  for (const race of RACES) {
    t -= eps + (race === dominant ? 1 : 0);
    if (t < 0) return race;
  }
  return dominant;
}

/**
 * Roll the race for a settlement at (q,r) against a LIVING field (§1.4). Returns
 * a race string, or null for Human (never "human"): null below the membership
 * threshold (the field leaves the hex Human), and null when the capped
 * strength-scaled roll doesn't fire. Uses its OWN sub-stream
 * (`subRng(seed,"settlement-race",q,r,gen)`) so it never perturbs the hex
 * generator's rng order.
 *
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @param {number} [gen] the hex's regenerate counter (a re-rolled hex re-stamps)
 * @param {{at:(q:number,r:number)=>{race:?string,strength:number}}} field a
 *   living field from buildLivingField
 * @returns {?string} race or null (Human)
 */
export function stampSettlementRace(seed, q, r, gen = 0, field) {
  const { race, strength } = field.at(q, r);
  if (!race) return null; // below THRESHOLD -> Human/null
  const rng = subRng(seed, "settlement-race", q, r, gen);
  const p = Math.min(STAMP_CFG.P_MAX, Math.max(0, STAMP_CFG.FLOOR + strength * STAMP_CFG.GAIN));
  if (rng() >= p) return null; // fringe / moved-in-later -> stays Human
  return pickStampRace(rng, race);
}

/**
 * Extract living-field anchors from placed hexes: the stored `settlement.race`
 * of every settled hex, as `[{q,r,race}]`. These pin the field (§1.2). Human
 * towns (no stored race) contribute no anchor — Human is the null case.
 *
 * @param {{coords?:{q:number,r:number}, settlement?:{race?:string}}[]} placedHexes
 * @returns {{q:number,r:number,race:string}[]}
 */
export function settlementAnchors(placedHexes) {
  const anchors = [];
  for (const hex of placedHexes || []) {
    const race = hex && hex.settlement && hex.settlement.race;
    if (race && RACE_SET.has(race) && hex.coords) {
      anchors.push({ q: hex.coords.q, r: hex.coords.r, race });
    }
  }
  return anchors;
}

/**
 * Stamp every not-yet-resolved settlement in `placedHexes` in ONE pass, against
 * the living field pinned by the already-resolved settlement anchors (§1.2/§1.4).
 * Mutates the hexes (like seedWaterSettlements): a stamped demihuman town gets
 * `settlement.race`; a Human town gets none; both get `settlement.raceStamped`
 * so the roll is FROZEN — a later re-derive with more terrain/anchors never
 * re-rolls a resolved town (§5, non-negotiable). Idempotent and cheap when there
 * is nothing pending (no field is built). All pending towns read the SAME field,
 * so the batch is order-independent within itself.
 *
 * @param {number|string} seed
 * @param {{coords?:{q:number,r:number}, terrain?:string, gen?:number,
 *   settlement?:object}[]} placedHexes
 * @param {{minSize?:number}} [opts] forwarded to buildLivingField
 * @returns {{coords?:object, settlement?:object}[]} the same array (mutated)
 */
export function stampSettlements(seed, placedHexes, opts = {}) {
  const pending = (placedHexes || []).filter(
    (h) => h.settlement && h.settlement.present && !h.settlement.raceStamped,
  );
  if (!pending.length) return placedHexes; // nothing to do — skip the field build
  const terrainByKey = new Map();
  for (const h of placedHexes) {
    if (h.coords) terrainByKey.set(axialKey(h.coords.q, h.coords.r), h.terrain);
  }
  const anchors = settlementAnchors(placedHexes);
  const field = buildLivingField(seed, terrainByKey, { ...opts, anchors });
  for (const h of pending) {
    const race = stampSettlementRace(seed, h.coords.q, h.coords.r, h.gen ?? 0, field);
    if (race) h.settlement.race = race; // demihuman -> store; Human stays absent
    h.settlement.raceStamped = true; // resolved — frozen, never re-rolled
  }
  return placedHexes;
}

// --- POI heritage & clusters (Phase 14.4) ------------------------------------
//
// Every POI rolls a BUILDER-race against the HERITAGE field (§1.3/§1.4): who dug
// or raised the thing, long before anyone moved in. The roll is deliberately
// almost-always-neutral (FLOOR ≈ 0.0001 — a cultural artifact can surface
// anywhere, but ~99.99% are plain), rising with heritage-field strength (near a
// people's past extent) and capped BELOW 1 (even in a heartland some POIs stay
// neutral — the people came after it was built). A fired POI stores
// `poi.heritage = { race }`; absent = neutral (never "human", §5 rule 4).
//
// Clusters (§1.5, §5 non-negotiable #1) are STATELESS. A POI never influences the
// next. Instead every POI independently samples two SHARED latent noise fields:
//   • "heritage-patch" — thresholded so most of the map is flat but occasional
//     coherent blobs are "hot": inside a blob the fire chance is raised
//     (patchBump), so 2–5 nearby POIs surface together as one vanished outpost.
//   • "heritage-race"  — a lower-frequency field that maps position -> a race, so
//     the whole blob AGREES on which people built there — for free, no cross-POI
//     communication. Because both are pure functions of (seed, position), the
//     result is deterministic and order-independent (§5 rules 1 & 3).
//
// Everything below is frozen once stamped (`poi.heritageStamped`), mirroring the
// settlement raceStamped anchor logic: a later re-derive never re-rolls a POI.

// Latent field for the cluster "hot patches". octaves/frequency tuned so a hot
// blob spans ~3–5 hexes; PATCH_HI (below) sets how rare hot blobs are.
const PATCH_NOISE = Object.freeze({ octaves: 2, frequency: 0.28, persistence: 0.5 });

// Lower-frequency latent field for the per-blob race pick — its regions are wider
// than a patch, so a whole blob reads one race (high within-blob coherence).
const RACE_NOISE = Object.freeze({ octaves: 1, frequency: 0.11 });

/**
 * POI heritage roll model (§1.4/§1.5).
 *   P = clamp(FLOOR + heritageStrength·GAIN + patchBump, 0, P_MAX)
 * FLOOR keeps the map ~99.99% neutral where there is neither culture nor a hot
 * patch; GAIN lifts the chance with proximity to a people's past extent; a hot
 * patch adds patchBump (a base step at the blob edge, ramping to PATCH_GAIN at a
 * blob's core). P_MAX < 1 so even a strong heritage/patch leaves some POIs plain.
 */
export const POI_HERITAGE_CFG = Object.freeze({
  FLOOR: 0.0001, // base fire chance anywhere — a rare artifact far from everything
  GAIN: 0.13, // how hard heritage-field strength drives the fire chance (in/near a culture)
  P_MAX: 0.5, // cap (< 1): even a heartland/hot-patch POI is often neutral
  PATCH_HI: 0.80, // heritage-patch value at/above which a hex is a "hot" blob (rare)
  PATCH_BASE: 0.14, // fire-chance step the moment a hex is inside a hot blob (strong, so a blob makes a real cluster)
  PATCH_GAIN: 0.20, // extra fire chance ramping from blob edge to blob core
});

/** Uniform fallback weights for terrains with no TERRAIN_RACE_WEIGHTS entry. */
const EQUAL_WEIGHTS = Object.freeze({ elf: 1, dwarf: 1, halfling: 1, gnome: 1 });

/** Pick a race from a weight map using a precomputed roll in [0,1) (canonical order). */
function weightedPickByRoll(roll, weights) {
  let total = 0;
  for (const race of RACES) total += weights[race] || 0;
  let t = roll * total;
  for (const race of RACES) {
    t -= weights[race] || 0;
    if (t < 0) return race;
  }
  return RACES[RACES.length - 1];
}

/**
 * The coherent per-position ("patch") builder race: a terrain-weighted pick whose
 * "roll" is the spatially-smooth "heritage-race" noise, so neighbouring hexes
 * (and thus a whole hot blob) agree on the race WITHOUT any cross-POI state.
 * Terrain-aware (TERRAIN_RACE_WEIGHTS, already epsilon-floored, so every race is
 * possible anywhere) with a uniform fallback for water/unknown terrain.
 */
export function patchRaceAt(seed, q, r, terrain) {
  const weights = TERRAIN_RACE_WEIGHTS[terrain] || EQUAL_WEIGHTS;
  return weightedPickByRoll(fbm2D(seed, "heritage-race", q, r, RACE_NOISE), weights);
}

/** patchBump for the roll: 0 outside a hot blob, PATCH_BASE..PATCH_BASE+PATCH_GAIN inside. */
function patchBumpAt(seed, q, r) {
  const v = fbm2D(seed, "heritage-patch", q, r, PATCH_NOISE);
  if (v < POI_HERITAGE_CFG.PATCH_HI) return 0;
  const ramp = (v - POI_HERITAGE_CFG.PATCH_HI) / (1 - POI_HERITAGE_CFG.PATCH_HI);
  return POI_HERITAGE_CFG.PATCH_BASE + POI_HERITAGE_CFG.PATCH_GAIN * ramp;
}

/**
 * The POI-heritage FIRE probability at (q,r) — the pure §1.4 model, no rng draw:
 * `clamp(FLOOR + heritageStrength·GAIN + patchBump, 0, P_MAX)`. Away from any
 * culture (strength 0) and outside a hot patch (patchBump 0) this is exactly
 * FLOOR — the ~99.99%-neutral guarantee. Exposed for tests/rendering.
 *
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @param {{at:(q:number,r:number)=>{race:?string,strength:number}}} [field]
 * @returns {number} probability in [0, P_MAX]
 */
export function poiHeritageChance(seed, q, r, field) {
  const strength = field ? field.at(q, r).strength : 0;
  return Math.min(
    POI_HERITAGE_CFG.P_MAX,
    Math.max(0, POI_HERITAGE_CFG.FLOOR + strength * POI_HERITAGE_CFG.GAIN + patchBumpAt(seed, q, r)),
  );
}

/**
 * Roll a POI's BUILDER race at (q,r) against a HERITAGE field (§1.4/§1.5). Returns
 * a race string, or null for neutral (never "human"). Uses its OWN sub-stream
 * (`subRng(seed,"poi-heritage",q,r,poiId)`) so it never perturbs the POI
 * generator's rng order. When it fires the race is the heritage field's dominant
 * race (with a small enclave epsilon) where the field reaches, else the coherent
 * per-blob patch race — so far-from-culture clusters still agree on one people.
 * Depends ONLY on (seed, position, poiId) and the shared fields — never on any
 * other POI (§5 rule 1), so it is order-independent.
 *
 * @param {number|string} seed
 * @param {number} q
 * @param {number} r
 * @param {string|number} poiId the POI's id (a hex may hold several POIs)
 * @param {string} terrain the hex's terrain (for the terrain-weighted patch race)
 * @param {{at:(q:number,r:number)=>{race:?string,strength:number}}} [field] a
 *   heritage field from buildHeritageField; omitted/absent = no culture reach
 * @returns {?string} race or null (neutral)
 */
export function rollPoiHeritage(seed, q, r, poiId, terrain, field) {
  const p = poiHeritageChance(seed, q, r, field);
  const rng = subRng(seed, "poi-heritage", q, r, poiId);
  if (rng() >= p) return null; // neutral — the ~99.99% case away from culture/patch
  const fieldRace = field ? field.at(q, r).race : null;
  if (fieldRace) return pickStampRace(rng, fieldRace); // within a culture's high-water mark
  return patchRaceAt(seed, q, r, terrain); // a coherent vanished-outpost cluster
}

// --- Heritage naming/flavour (§4) --------------------------------------------
//
// Pure, deterministic composers for a stamped POI's builder identity. Builder ≠
// occupier (§1.3): the descriptor + proper name always name the BUILDER; the
// flavour folds in the CURRENT occupant, so an elf ruin now held by goblins reads
// "An elf-wrought tower, now held by goblins."

/** The POI's plain base label (theme for a dungeon; the pre-occupant name else). */
function poiBaseLabel(poi) {
  if (poi.type === "dungeon" && poi.detail && poi.detail.theme) return poi.detail.theme;
  const n = poi.name || "";
  return n.split(" — ")[0] || n;
}

/** "a"/"an" for a descriptor by its leading sound (elf-wrought -> an, dwarf-delved -> a). */
function articleFor(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** A deterministic heritage descriptor word for a POI (e.g. "elf-wrought"). */
export function heritageDescriptor(seed, q, r, poiId, race) {
  const pool = RACE_NAME_POOLS[race].heritage;
  return pool[Math.floor(subRng(seed, "poi-heritage-desc", q, r, poiId)() * pool.length)];
}

/** A deterministic proper name for a heritage POI (e.g. "Kaelthar", "Karr-dûr"). */
export function heritageProperName(seed, q, r, poiId, race) {
  const pools = RACE_NAME_POOLS[race];
  const rng = subRng(seed, "poi-heritage-name", q, r, poiId);
  const prefix = pools.prefixes[Math.floor(rng() * pools.prefixes.length)];
  const suffix = pools.suffixes[Math.floor(rng() * pools.suffixes.length)];
  const join = RACE_JOIN[race];
  const glyph = join && join.chance > 0 && rng() < join.chance ? join.glyph : "";
  return prefix + glyph + suffix;
}

/**
 * Compose a stamped POI's heritage display: a proper-named builder place plus an
 * occupant-aware flavour line. Pure and idempotent for a given (seed,q,r,poiId,
 * race,poi). Reads the POI's base label + current occupant; does NOT mutate.
 *
 * @returns {{name:string, descriptor:string, properName:string, flavor:string}}
 *   e.g. name "Kaelthar, an elf-wrought tower", flavor "An elf-wrought tower,
 *   now held by goblins."
 */
export function heritagePoiText(seed, q, r, poiId, race, poi) {
  const descriptor = heritageDescriptor(seed, q, r, poiId, race);
  const properName = heritageProperName(seed, q, r, poiId, race);
  const base = poiBaseLabel(poi).toLowerCase();
  const builder = `${descriptor} ${base}`; // "elf-wrought tower"
  const art = articleFor(descriptor);
  const name = `${properName}, ${art} ${builder}`;
  const lead = `${art === "an" ? "An" : "A"} ${builder}`; // "An elf-wrought tower"
  const occ = (poi && poi.occupant) || { kind: "none" };
  let flavor;
  if (occ.kind === "occupied") flavor = `${lead}, now held by ${String(occ.by).toLowerCase()}.`;
  else if (occ.kind === "lair") flavor = `${lead}, now a lair of ${String(occ.creature).toLowerCase()}.`;
  else flavor = `${lead}, its builders long gone.`;
  return { name, descriptor, properName, flavor };
}

/** Bake the heritage builder identity into a POI's name + flavour (mutates once). */
function applyHeritageText(seed, q, r, poiId, race, poi) {
  const t = heritagePoiText(seed, q, r, poiId, race, poi);
  poi.name = t.name;
  poi.detail = poi.detail || {};
  poi.detail.flavor = t.flavor;
}

/**
 * Stamp every not-yet-resolved POI in `placedHexes` in ONE pass, against a single
 * heritage field pinned by the settlement anchors (§1.3/§1.4/§1.5). Mutates the
 * POIs: a fired POI gets `poi.heritage = { race }` and a heritage-composed
 * name/flavour; a neutral POI gets neither; both get `poi.heritageStamped` so the
 * roll is FROZEN — a later re-derive with more terrain/anchors never re-rolls a
 * resolved POI (§5 non-negotiable). Idempotent and cheap when nothing is pending
 * (no field is built). All pending POIs read the SAME field and roll from their
 * own (q,r,poiId) sub-stream, so the batch is order-independent within itself; and
 * clusters come only from the shared latent noise, never from POI-to-POI state.
 *
 * @param {number|string} seed
 * @param {{coords?:{q:number,r:number}, terrain?:string, pois?:object[]}[]} placedHexes
 * @param {{minSize?:number}} [opts] forwarded to buildHeritageField
 * @returns {object[]} the same array (mutated)
 */
export function stampPois(seed, placedHexes, opts = {}) {
  const hexes = placedHexes || [];
  let pending = false;
  for (const h of hexes) {
    for (const poi of (h && h.pois) || []) {
      if (!poi.heritageStamped) { pending = true; break; }
    }
    if (pending) break;
  }
  if (!pending) return placedHexes; // nothing to do — skip the field build

  const terrainByKey = new Map();
  for (const h of hexes) {
    if (h.coords) terrainByKey.set(axialKey(h.coords.q, h.coords.r), h.terrain);
  }
  const anchors = settlementAnchors(hexes);
  const field = buildHeritageField(seed, terrainByKey, { ...opts, anchors });

  for (const h of hexes) {
    if (!h.coords || !h.pois || !h.pois.length) continue;
    const { q, r } = h.coords;
    for (const poi of h.pois) {
      if (poi.heritageStamped) continue;
      const race = rollPoiHeritage(seed, q, r, poi.id, h.terrain, field);
      if (race) {
        poi.heritage = { race }; // fired -> store the builder race; neutral stays absent
        applyHeritageText(seed, q, r, poi.id, race, poi);
      }
      poi.heritageStamped = true; // resolved — frozen, never re-rolled
    }
  }
  return placedHexes;
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
