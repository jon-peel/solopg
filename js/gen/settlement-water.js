// River / coast settlement size boosts (3R.6).
//
// Civilisation follows water: a settlement on or beside a river is bumped up a
// size tier, one on the sea coast likewise, and one at a river MOUTH (both — an
// estuary) gets the biggest bump. This is the "reason to grow/cluster" the
// size-suppression left room for at generation (js/gen/hex.js), applied AFTER
// the derived river overlay exists.
//
// IDEMPOTENT by construction: the rolled size is captured once as `baseSize`, and
// the effective `size` is always re-derived from `baseSize` + the current water
// context. `applyWaterBoosts` runs on every `syncRivers` (every generation batch
// and on load); re-deriving from the base means it never compounds. The boost may
// exceed a terrain's normal maxSize — the water IS the reason (a river-valley
// town in the mountains, a great estuary port).

import { SIZE_ORDER, isLargeSize } from "./terrain-profile.js";
import { neighbors, axialKey, parseKey } from "../core/hexgeo.js";
import { subRng } from "../core/rng.js";

/** Move a size up `tiers` steps along SIZE_ORDER, capped at the largest (City). */
export function raiseSize(size, tiers) {
  const i = SIZE_ORDER.indexOf(size);
  if (i < 0 || tiers <= 0) return size;
  return SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, i + tiers)];
}

/** Size-tier boost for a water context: estuary +2, riverside/coast +1, else 0. */
export function waterBoostTiers(ctx) {
  if (ctx.estuary) return 2;
  if (ctx.riverside || ctx.coast) return 1;
  return 0;
}

/**
 * Water context of the hex at (q, r): whether it's on/beside a river, on the sea
 * coast, or at a river mouth (both = estuary).
 * @param {number} q
 * @param {number} r
 * @param {Set<string>} riverKeys axial keys of every hex on any river path
 * @param {Map<string,string>} terrainByKey axialKey -> terrain
 */
export function settlementWaterContext(q, r, riverKeys, terrainByKey) {
  let riverside = riverKeys.has(axialKey(q, r));
  let coast = false;
  for (const n of neighbors(q, r)) {
    const nk = axialKey(n.q, n.r);
    if (riverKeys.has(nk)) riverside = true;
    if (terrainByKey.get(nk) === "Sea") coast = true;
  }
  return { riverside, coast, estuary: riverside && coast };
}

// --- generate NEW settlements at water (3R.6) ------------------------------
// Separate from the size boost below: water bodies SEED settlements. Scattered
// small ones run ALONG a river's course; where a river MEETS the water (its
// mouth on the sea or a big lake) is the "double whammy" — a City most of the
// time; big lakes get a shore City, and even a small lake sometimes does.
//
// Deterministic + IDEMPOTENT: each hex is decided at most once (marked
// `waterSeeded`), so the repeated syncRivers calls never duplicate, and a
// settlement a GM deletes is not resurrected. Runs BEFORE applyWaterBoosts, so a
// seeded river hamlet then also gets the +1 riverside bump.
const MOUTH_SETTLE_CHANCE = 0.6;    // a river mouth settles this often (not every one)
const MOUTH_KEEP_CHANCE = 0.25;     // ...and is occasionally a martial keep guarding the crossing
const RIVER_SETTLE_CHANCE = 0.08;   // per mid-course river hex -> a small settlement
const RIVER_HAMLET_FRAC = 0.7;      // else a Village (the +1 riverside boost then lifts it to a Town)
const MIN_LAKE_FOR_CITY = 3;        // 1-2 hex puddles never earn a city
const BIG_LAKE_SIZE = 6;            // a real lake (>= this) always earns a shore City
const SMALL_LAKE_CITY_CHANCE = 0.4; // a smaller lake (3-5 hexes) sometimes does
const WATER = new Set(["Sea", "Lake"]);

// Place (or promote an existing settlement up to) `size` at hex, once. Honours
// the decided-flag so it never double-places or resurrects a deleted one.
function seedAt(hex, size) {
  if (!hex || WATER.has(hex.terrain) || hex.waterSeeded) return;
  hex.waterSeeded = true;
  const s = hex.settlement;
  if (s && s.present) {
    const base = s.baseSize ?? s.size;
    if (SIZE_ORDER.indexOf(size) > SIZE_ORDER.indexOf(base)) s.baseSize = size; // promote
    return;
  }
  hex.settlement = { present: true, size, baseSize: size };
}

/**
 * Generate new settlements at water: scattered along rivers, a (mostly City-sized,
 * sometimes a keep) settlement at river mouths (the double whammy), and shore
 * Cities on lakes (big always, small sometimes).
 * MUTATES the hexes in `hexByKey`. Idempotent (see the note above).
 * @param {Map<string,object>} hexByKey axialKey -> hex object
 * @param {{path:{q:number,r:number}[]}[]} rivers world.rivers
 * @param {Map<string,string>} terrainByKey axialKey -> terrain
 * @param {number|string} seed world seed
 */
export function seedWaterSettlements(hexByKey, rivers, terrainByKey, seed) {
  // 1. Water bodies (connected Sea/Lake) — size, sea-or-lake, land shore keys.
  const bodyOf = new Map(), size = new Map(), isSea = new Map(), shore = new Map(), canon = new Map();
  let bid = 0;
  for (const [key, hex] of hexByKey) {
    if (!WATER.has(hex.terrain) || bodyOf.has(key)) continue;
    const stack = [key]; bodyOf.set(key, bid); let n = 0; const sh = new Set(); let mn = key;
    isSea.set(bid, hex.terrain === "Sea");
    while (stack.length) {
      const k = stack.pop(); n++; if (k < mn) mn = k;
      const { q, r } = parseKey(k);
      for (const nb of neighbors(q, r)) {
        const nk = axialKey(nb.q, nb.r); const nh = hexByKey.get(nk);
        if (!nh) continue;
        if (WATER.has(nh.terrain)) { if (!bodyOf.has(nk)) { bodyOf.set(nk, bid); stack.push(nk); } }
        else sh.add(nk);
      }
    }
    size.set(bid, n); shore.set(bid, sh); canon.set(bid, mn); bid++;
  }

  // 2. River mouths — where a river MEETS water (the "double whammy"). Most, but
  //    not every, mouth settles; the seeded type is random (leaning City) and the
  //    +2 estuary boost from applyWaterBoosts then makes it a proper port. A few
  //    are martial keeps guarding the crossing. Mouths are recorded so the course
  //    pass below doesn't also settle them.
  const mouthKeys = new Set();
  for (const rv of rivers || []) {
    const path = rv && rv.path;
    if (!path || !path.length) continue;
    // A river's path ENDS on the water sink (a Sea/Lake hex — computeRivers pushes
    // it as the last element), so the mouth is the last LAND hex, adjacent to it.
    let mouth = null;
    for (let i = path.length - 1; i >= 0; i--) {
      if (!WATER.has(terrainByKey.get(axialKey(path[i].q, path[i].r)))) { mouth = path[i]; break; }
    }
    if (!mouth) continue;
    if (!neighbors(mouth.q, mouth.r).some((nb) => WATER.has(terrainByKey.get(axialKey(nb.q, nb.r))))) continue;
    const k = axialKey(mouth.q, mouth.r);
    mouthKeys.add(k);
    if (subRng(seed, "mouthsettle", mouth.q, mouth.r)() >= MOUTH_SETTLE_CHANCE) continue;
    const hex = hexByKey.get(k);
    // Random base type. The estuary boost (+2 at a sea mouth) then lifts it, so a
    // seeded Hamlet still surfaces as a Town — that spread is the visible variety.
    const roll = subRng(seed, "mouthsize", mouth.q, mouth.r)();
    const size = roll < 0.55 ? "City" : roll < 0.75 ? "Town" : "Hamlet";
    seedAt(hex, size);
    if (hex && hex.settlement && hex.settlement.present &&
        subRng(seed, "mouthkeep", mouth.q, mouth.r)() < MOUTH_KEEP_CHANCE) {
      hex.settlement.kind = "keep";
    }
  }

  // 3. Scattered settlements along the river course (mouths already handled).
  for (const rv of rivers || []) {
    for (const p of rv.path || []) {
      const k = axialKey(p.q, p.r);
      if (mouthKeys.has(k)) continue;
      if (subRng(seed, "riversettle", p.q, p.r)() >= RIVER_SETTLE_CHANCE) continue;
      const sz = subRng(seed, "riversize", p.q, p.r)() < RIVER_HAMLET_FRAC ? "Hamlet" : "Village";
      seedAt(hexByKey.get(k), sz);
    }
  }

  // 4. Lake shore Cities — a real lake always earns one, a small one sometimes;
  //    1-2 hex puddles never do, and the sea gets cities only via river mouths
  //    (above), so we don't carpet the coast.
  for (const [id, sh] of shore) {
    if (isSea.get(id) || size.get(id) < MIN_LAKE_FOR_CITY) continue;
    const shoreHexes = [...sh].map((k) => hexByKey.get(k)).filter((h) => h && !WATER.has(h.terrain));
    if (!shoreHexes.length) continue;
    const big = size.get(id) >= BIG_LAKE_SIZE;
    if (!big && subRng(seed, "lakecity", canon.get(id))() >= SMALL_LAKE_CITY_CHANCE) continue;
    // Already has a shore City (a river mouth, or a prior run)? Done — idempotent.
    if (shoreHexes.some((h) => h.settlement && h.settlement.present && h.settlement.size === "City")) continue;
    // Guarantee the city: PROMOTE an existing shore settlement (even a seeded
    // river village — a lakeside town becomes the lake's city), else place a
    // fresh City on the canonical shore hex.
    const settled = shoreHexes.find((h) => h.settlement && h.settlement.present);
    if (settled) {
      settled.settlement.size = "City";
      settled.settlement.baseSize = "City";
      settled.waterSeeded = true;
    } else {
      const t = shoreHexes.sort((a, b) => (axialKey(a.coords.q, a.coords.r) < axialKey(b.coords.q, b.coords.r) ? -1 : 1))[0];
      seedAt(t, "City");
    }
  }
}

// --- farming hamlet clusters (3R.6) ----------------------------------------
// A light SPRINKLING: a large settlement (Town/City) is a market for a few
// farming hamlets in the arable land ringing it — a "breadbasket". Kept sparse
// on purpose: a low per-neighbour chance, farmland terrain only, the immediate
// ring only. Runs AFTER the water passes so anchors are already their final,
// boosted size. Deterministic + IDEMPOTENT via a per-hex `clusterSeeded`
// decided-flag — repeated syncs never duplicate and a GM-deleted hamlet is not
// resurrected. Like the rest of settlement placement it's mildly order-dependent
// (two nearby anchors contending for a shared neighbour), an accepted tradeoff.
const CLUSTER_HAMLET_CHANCE = 0.2; // per farmland neighbour of a large settlement (kept a sprinkling)
const FARMLAND = new Set(["Plains", "Hills"]);

/**
 * Sprinkle a few farming Hamlets in the farmland immediately around each large
 * (Town/City) settlement. MUTATES hexes in `hexByKey`. Idempotent (see above).
 * @param {Map<string,object>} hexByKey axialKey -> hex object
 * @param {number|string} seed world seed
 */
export function seedHamletClusters(hexByKey, seed) {
  // Snapshot the anchors first — the Hamlets we place must not themselves anchor.
  const anchors = [];
  for (const hex of hexByKey.values()) {
    const s = hex.settlement;
    if (s && s.present && isLargeSize(s.size)) anchors.push(hex);
  }
  for (const hex of anchors) {
    const { q, r } = hex.coords;
    neighbors(q, r).forEach((nb, i) => {
      const nh = hexByKey.get(axialKey(nb.q, nb.r));
      if (!nh || !FARMLAND.has(nh.terrain) || nh.clusterSeeded) return;
      if (subRng(seed, "cluster", q, r, i)() >= CLUSTER_HAMLET_CHANCE) return;
      nh.clusterSeeded = true; // decided — even if it's already settled (we don't override)
      if (nh.settlement && nh.settlement.present) return;
      nh.settlement = { present: true, size: "Hamlet", baseSize: "Hamlet" };
    });
  }
}

/**
 * Re-derive every settlement's effective size from its base + water context.
 * MUTATES each settled hex: captures `baseSize` once, sets `size` (boosted) and a
 * `waterBoost` tag ("estuary" | "river" | "coast" | null) for display.
 * @param {{coords:{q:number,r:number}, settlement?:object}[]} hexes placed hexes
 * @param {{path:{q:number,r:number}[]}[]} rivers world.rivers
 * @param {Map<string,string>} terrainByKey axialKey -> terrain
 */
export function applyWaterBoosts(hexes, rivers, terrainByKey) {
  const riverKeys = new Set();
  for (const rv of rivers || []) for (const p of rv.path || []) riverKeys.add(axialKey(p.q, p.r));

  for (const hex of hexes) {
    const s = hex.settlement;
    if (!s || !s.present) continue;
    if (s.baseSize === undefined) s.baseSize = s.size; // capture the rolled size once
    const ctx = settlementWaterContext(hex.coords.q, hex.coords.r, riverKeys, terrainByKey);
    s.size = raiseSize(s.baseSize, waterBoostTiers(ctx));
    s.waterBoost = ctx.estuary ? "estuary" : ctx.riverside ? "river" : ctx.coast ? "coast" : null;
  }
}
