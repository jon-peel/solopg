// Coastal ports (3R.8) — a derived overlay: a Town or City that touches the Sea
// is a port. Pure, node-tested; nothing is stored on the world (map.js caches it
// and draws a ⚓ marker). Bridges/fords need no module — they fall out of draw
// order (dashed tracks under the river = fords, solid roads over it = bridges).

import { axialKey, neighbors } from "../core/hexgeo.js";

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
