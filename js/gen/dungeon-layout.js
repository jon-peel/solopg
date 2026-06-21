// Dungeon level layout (Phase 4 arc) — rooms + a corridor GRAPH on a coarse grid.
//
// Pure + deterministic: given a level's stocked rooms and an rng stream, place
// each room as a non-overlapping rectangle on a grid, then connect them as a
// GRAPH — a spanning tree for guaranteed connectivity plus extra "loop" edges so
// levels have multiple pathways (4.9.2). Corridors are carved per edge. No DOM —
// the canvas renderer (js/ui/dungeon-map.js) just draws the returned cells; this
// module is node-tested (no overlap, fully connected, has loops, deterministic).

import { randInt } from "../core/rng.js";

const ROOM_MIN = 3;
const ROOM_MAX = 5;

// True if rectangles a and b overlap when each is grown by `pad` cells.
function overlaps(a, b, pad) {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function center(rect) {
  return { x: rect.x + Math.floor(rect.w / 2), y: rect.y + Math.floor(rect.h / 2) };
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Chance a level has NO loops (a single connected tree). Higher for small
// levels, so big levels are reliably loopy and tiny ones are sometimes linear.
function linearChance(count) {
  if (count <= 3) return 0.6;
  if (count <= 5) return 0.3;
  if (count <= 7) return 0.12;
  return 0.05;
}

// Try to place one room rectangle on the grid, preferring a 1-cell gap and
// falling back to merely non-overlapping. Returns a rect or null.
function placeRoom(rng, grid, placed) {
  for (const pad of [1, 0]) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const w = randInt(rng, ROOM_MIN, ROOM_MAX);
      const h = randInt(rng, ROOM_MIN, ROOM_MAX);
      const x = randInt(rng, 1, grid.w - w - 1);
      const y = randInt(rng, 1, grid.h - h - 1);
      const rect = { x, y, w, h };
      if (!placed.some((p) => overlaps(p, rect, pad))) return rect;
    }
  }
  return null;
}

// Carve an L-shaped corridor between two cell coordinates, adding every path
// cell that is NOT inside a room to `corridorSet` (keyed "x,y").
function carve(a, b, isRoomCell, corridorSet) {
  let { x, y } = a;
  const add = () => {
    if (!isRoomCell(x, y)) corridorSet.add(`${x},${y}`);
  };
  // Horizontal leg, then vertical leg (meeting at b.x, a.y).
  while (x !== b.x) {
    x += x < b.x ? 1 : -1;
    add();
  }
  while (y !== b.y) {
    y += y < b.y ? 1 : -1;
    add();
  }
}

/**
 * Lay out one dungeon level.
 * @param {{n:number}[]} rooms the level's stocked rooms (only `n` is used).
 * @param {() => number} rng deterministic sub-stream.
 * @param {{ side?: number }} [opts]
 * @returns {{ grid:{w:number,h:number}, rooms:{n:number,x:number,y:number,w:number,h:number}[],
 *   corridors:{x:number,y:number}[], edges:{a:number,b:number,type:string}[], entrance:number }}
 */
export function layoutLevel(rooms, rng, opts = {}) {
  const count = rooms.length;
  if (count === 0)
    return { grid: { w: 8, h: 8 }, rooms: [], corridors: [], edges: [], entrance: null };

  // Grid sized generously for the room count so placement (incl. a 1-cell gap)
  // reliably succeeds; grow and retry on the rare miss.
  let side = Math.max(16, opts.side || Math.ceil(Math.sqrt(count)) * 9);
  let placed = null;
  for (let grow = 0; grow < 6 && !placed; grow++, side += 6) {
    const grid = { w: side, h: side };
    const acc = [];
    let ok = true;
    for (const room of rooms) {
      const rect = placeRoom(rng, grid, acc);
      if (!rect) {
        ok = false;
        break;
      }
      acc.push({ n: room.n, ...rect });
    }
    if (ok) placed = acc;
  }
  if (!placed) {
    // Extremely unlikely; degrade gracefully with a stacked column.
    placed = rooms.map((room, i) => ({ n: room.n, x: 1, y: 1 + i * 4, w: 3, h: 3 }));
    side = 4 + rooms.length * 4;
  }
  const grid = { w: side, h: side };

  // Membership test for room-interior cells.
  const roomAt = new Set();
  for (const r of placed) {
    for (let dx = 0; dx < r.w; dx++) {
      for (let dy = 0; dy < r.h; dy++) roomAt.add(`${r.x + dx},${r.y + dy}`);
    }
  }
  const isRoomCell = (x, y) => roomAt.has(`${x},${y}`);

  // --- Connection graph -------------------------------------------------
  const centers = placed.map(center);
  const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const edgeSet = new Set();
  const edges = [];
  // ai, bi are indices into `placed`. Records an undirected edge once.
  const addEdge = (ai, bi) => {
    const a = placed[ai].n;
    const b = placed[bi].n;
    const key = edgeKey(a, b);
    if (a === b || edgeSet.has(key)) return false;
    edgeSet.add(key);
    edges.push({ a, b, type: "open" });
    return true;
  };

  // 1) Spanning tree: each room to its nearest already-placed room -> every
  //    room reachable from the entrance.
  for (let i = 1; i < placed.length; i++) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < i; j++) {
      const d = manhattan(centers[i], centers[j]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    addEdge(i, best);
  }

  // 2) Loop edges: add nearby non-tree connections so the level has multiple
  //    routes. Sometimes none (linear); more on larger levels.
  if (placed.length >= 3 && rng() >= linearChance(count)) {
    const lo = Math.max(1, Math.floor(count * 0.3));
    const hi = Math.max(lo, Math.floor(count * 0.6));
    let want = randInt(rng, lo, hi);
    const cands = [];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (!edgeSet.has(edgeKey(placed[i].n, placed[j].n))) {
          cands.push({ i, j, d: manhattan(centers[i], centers[j]) });
        }
      }
    }
    // Nearest-first (with stable tiebreak) keeps loops local + deterministic.
    cands.sort((p, q) => p.d - q.d || p.i - q.i || p.j - q.j);
    for (const c of cands) {
      if (want <= 0) break;
      if (addEdge(c.i, c.j)) want--;
    }
  }

  // Carve a corridor for every edge.
  const corridorSet = new Set();
  const byN = new Map(placed.map((p) => [p.n, p]));
  for (const e of edges) {
    carve(center(byN.get(e.a)), center(byN.get(e.b)), isRoomCell, corridorSet);
  }

  const corridors = Array.from(corridorSet, (key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  return { grid, rooms: placed, corridors, edges, entrance: placed[0].n };
}
