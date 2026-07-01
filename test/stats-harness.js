// 3R.2 stats harness — a diagnostic, NOT part of `node --test` (it prints a
// report, it doesn't assert). Generates a large area under TODAY's engine
// (unchanged hex-by-hex generateHex + the neighbour-affinity bias) and reports
// terrain distribution, biome clump-size / lone-hex rate, and settlement
// spacing — the baseline 3R.3+ tunes against.
//
// Usage: node test/stats-harness.js [seed] [radius]
//   seed   default 1        any string/number (subRng seed)
//   radius default 25       hex-disc radius around (0,0); ~1 + 3*r*(r+1) hexes

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWorld, addHex, getHex, placedHexes } from "../js/world/world.js";
import { generateHex } from "../js/gen/hex.js";
import { subRng } from "../js/core/rng.js";
import { axialKey, neighbors, hexDisc, axialDistance } from "../js/core/hexgeo.js";

const HEX_TABLE_IDS = [
  "terrain", "swamp-feature", "settlement-size",
  "poi-types", "poi-occupant", "creatures", "occupiers",
];

function loadTables() {
  const t = new Map();
  for (const id of HEX_TABLE_IDS) {
    t.set(id, JSON.parse(readFileSync(new URL(`../data/${id}.json`, import.meta.url), "utf8")));
  }
  return t;
}

// Terrain strings of a cell's existing placed neighbors — mirrors app.js's
// neighborTerrains() exactly, so the harness measures the real generation path.
function neighborTerrains(world, q, r) {
  return neighbors(q, r)
    .map((n) => getHex(world, n.q, n.r))
    .filter((h) => h && h.placed)
    .map((h) => h.terrain);
}

// Fill a hex disc of `radius` around the origin, center-first then ring-by-ring
// (hexDisc's own deterministic order) — so each hex sees only the neighbours
// generated before it in that fixed order, same as the app's batch fill.
function generateArea(seed, radius) {
  const tables = loadTables();
  const world = createWorld({ name: "stats-harness", seed });
  for (const { q, r } of hexDisc(0, 0, radius)) {
    const rng = subRng(seed, "hex", q, r, 0);
    const hex = generateHex(tables, rng, {
      key: axialKey(q, r),
      coords: { q, r },
      placed: true,
      neighborTerrains: neighborTerrains(world, q, r),
      seed,
      gen: 0,
    });
    hex.gen = 0;
    addHex(world, hex);
  }
  return world;
}

function terrainHistogram(hexes) {
  const counts = new Map();
  for (const h of hexes) counts.set(h.terrain, (counts.get(h.terrain) || 0) + 1);
  return counts;
}

// Connected components of same-terrain adjacent hexes (BFS over the existing
// placed set). Returns { clumpSizes: Map<terrain, number[]>, loneCount, total }.
function biomeClumps(world, hexes) {
  const byKey = new Map(hexes.map((h) => [axialKey(h.coords.q, h.coords.r), h]));
  const seen = new Set();
  const clumpSizes = new Map();
  let loneCount = 0;

  for (const h of hexes) {
    const key = axialKey(h.coords.q, h.coords.r);
    if (seen.has(key)) continue;
    // BFS this terrain's connected component.
    const queue = [h];
    seen.add(key);
    let size = 0;
    while (queue.length) {
      const cur = queue.pop();
      size++;
      for (const n of neighbors(cur.coords.q, cur.coords.r)) {
        const nKey = axialKey(n.q, n.r);
        const nh = byKey.get(nKey);
        if (nh && nh.terrain === h.terrain && !seen.has(nKey)) {
          seen.add(nKey);
          queue.push(nh);
        }
      }
    }
    if (!clumpSizes.has(h.terrain)) clumpSizes.set(h.terrain, []);
    clumpSizes.get(h.terrain).push(size);
    if (size === 1) loneCount++;
  }
  return { clumpSizes, loneCount, total: hexes.length };
}

function settlementSpacing(hexes) {
  const settled = hexes.filter((h) => h.settlement && h.settlement.present);
  if (settled.length < 2) return { count: settled.length, nearest: [] };
  const nearest = settled.map((h, i) => {
    let best = Infinity;
    for (let j = 0; j < settled.length; j++) {
      if (i === j) continue;
      const o = settled[j];
      const d = axialDistance(h.coords.q, h.coords.r, o.coords.q, o.coords.r);
      if (d < best) best = d;
    }
    return best;
  });
  return { count: settled.length, nearest };
}

function stats(arr) {
  if (!arr.length) return { min: 0, max: 0, mean: 0, median: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return { min: sorted[0], max: sorted[sorted.length - 1], mean, median };
}

function report(seed, radius) {
  const world = generateArea(seed, radius);
  const hexes = placedHexes(world);
  const total = hexes.length;

  console.log(`\n3R.2 stats harness — seed=${JSON.stringify(seed)} radius=${radius} (${total} hexes)\n`);

  console.log("Terrain histogram:");
  const hist = terrainHistogram(hexes);
  for (const [terrain, count] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${terrain.padEnd(10)} ${String(count).padStart(5)}  (${(100 * count / total).toFixed(1)}%)`);
  }

  console.log("\nBiome clump sizes (connected same-terrain hexes):");
  const { clumpSizes, loneCount } = biomeClumps(world, hexes);
  for (const [terrain, sizes] of [...clumpSizes.entries()].sort()) {
    const s = stats(sizes);
    console.log(`  ${terrain.padEnd(10)} clumps=${String(sizes.length).padStart(4)}  min=${s.min} median=${s.median} mean=${s.mean.toFixed(1)} max=${s.max}`);
  }
  console.log(`  Lone-hex rate (clump size 1, any terrain): ${loneCount}/${total} (${(100 * loneCount / total).toFixed(1)}%)`);

  console.log("\nSettlement spacing:");
  const { count, nearest } = settlementSpacing(hexes);
  const s = stats(nearest);
  console.log(`  settlements=${count} (${(100 * count / total).toFixed(1)}% of hexes)`);
  console.log(`  nearest-neighbor distance (hexes): min=${s.min} median=${s.median} mean=${s.mean.toFixed(2)} max=${s.max}`);
  console.log("");
}

// A diagnostic script, not a `node --test` suite — but it lives under test/
// (per convention alongside the other generation logic it drives), which
// node's default test-file discovery treats as fair game. Guard the report so
// `node --test` importing this file as a candidate test doesn't print a
// report or execute anything; only `node test/stats-harness.js` runs it.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const seed = process.argv[2] ?? 1;
  const radius = Number(process.argv[3] ?? 25);
  report(seed, radius);
}
