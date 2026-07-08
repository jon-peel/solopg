// Bridges / fords + coastal ports (3R.8) — derived overlays over roads, rivers,
// and the coastline. Pure geometry, node-tested; nothing is stored on the world
// (map.js recomputes + caches like it does for named regions).
//
// A road that runs TRANSVERSELY across a river gets a crossing glyph — a bridge
// on the bigger roads (highway/road), a ford on the smaller ones (track/spur).
// A road running ALONGSIDE a river (hugging its valley) is not a crossing. A
// coastal big settlement (Town/City touching the Sea) is a port.

import { axialToPixel, axialKey, neighbors } from "../core/hexgeo.js";

// Bigger roads bridge; tracks/spurs ford. (tier 1 highway, 2 road, 3 track/spur)
export const BRIDGE_MAX_TIER = 2;
// |road·river| below this ⇒ the road runs across the river (angle > ~45°); at or
// above it the road is running alongside the river, so it isn't a crossing.
const TRANSVERSE_COS = 0.7;

// Unit pixel-space direction of a path at index i (from its i-1..i+1 neighbours).
function dirAt(pts, i) {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// Every river hex -> its unit travel direction (pixel space). A hex hosting two
// rivers keeps the first — enough to orient one crossing glyph.
function riverDirections(rivers) {
  const dir = new Map();
  for (const river of rivers || []) {
    const path = river && river.path;
    if (!path || path.length < 2) continue;
    const pts = path.map((c) => axialToPixel(c.q, c.r, 1));
    for (let i = 0; i < path.length; i++) {
      const k = axialKey(path[i].q, path[i].r);
      if (!dir.has(k)) dir.set(k, dirAt(pts, i));
    }
  }
  return dir;
}

/**
 * Road×river crossings. For each road, an INTERIOR hex that also carries a river
 * and where the road runs transverse to the river is a crossing. A hex crossed
 * by several roads keeps the biggest (lowest tier). Directions are unit pixel-
 * space vectors so map.js can orient the glyph without redoing the geometry.
 * @returns {{ q, r, kind:"bridge"|"ford", tier:number, riverDir:{x,y}, roadDir:{x,y} }[]}
 */
export function roadRiverCrossings(roads, rivers) {
  const riverDir = riverDirections(rivers);
  if (!riverDir.size) return [];
  const byHex = new Map(); // key -> crossing (dedupe, keep the biggest road)
  for (const road of roads || []) {
    const path = road && road.path;
    if (!path || path.length < 3) continue;
    const pts = path.map((c) => axialToPixel(c.q, c.r, 1));
    const tier = road.tier || 2;
    for (let i = 1; i < path.length - 1; i++) {
      const k = axialKey(path[i].q, path[i].r);
      const rdir = riverDir.get(k);
      if (!rdir) continue;
      const odir = dirAt(pts, i);
      if (Math.abs(odir.x * rdir.x + odir.y * rdir.y) >= TRANSVERSE_COS) continue; // alongside
      const prev = byHex.get(k);
      if (prev && prev.tier <= tier) continue; // a bigger road already owns this hex
      byHex.set(k, {
        q: path[i].q, r: path[i].r, tier,
        kind: tier <= BRIDGE_MAX_TIER ? "bridge" : "ford",
        riverDir: rdir, roadDir: odir,
      });
    }
  }
  return [...byHex.values()];
}

/**
 * Coastal ports: a Town or City with at least one Sea neighbour.
 * @param {Map<string,string>} settlementsByKey "q,r" -> settlement size
 * @param {Map<string,string>} terrainByKey     "q,r" -> terrain
 * @returns {{ q, r }[]}
 */
export function coastalPorts(settlementsByKey, terrainByKey) {
  const out = [];
  for (const [key, size] of settlementsByKey) {
    if (size !== "Town" && size !== "City") continue;
    const [q, r] = key.split(",").map(Number);
    if (neighbors(q, r).some((n) => terrainByKey.get(axialKey(n.q, n.r)) === "Sea")) {
      out.push({ q, r });
    }
  }
  return out;
}
