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

import { SIZE_ORDER } from "./terrain-profile.js";
import { neighbors, axialKey } from "../core/hexgeo.js";

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
