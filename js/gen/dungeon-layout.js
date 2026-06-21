// Dungeon level layout (Phase 4 arc) — rooms + corridors on a coarse grid.
//
// Pure + deterministic: given a level's stocked rooms and an rng stream, place
// each room as a non-overlapping rectangle on a grid and connect them with
// L-shaped corridors so every room is reachable. No DOM — the canvas renderer
// (js/ui/dungeon-map.js) just draws the returned rectangles/cells; this module
// is node-tested (no overlap, fully connected, deterministic).

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
 *   corridors:{x:number,y:number}[], entrance:number }}
 */
export function layoutLevel(rooms, rng, opts = {}) {
  const count = rooms.length;
  if (count === 0) return { grid: { w: 8, h: 8 }, rooms: [], corridors: [], entrance: null };

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

  // Connect each room to its nearest already-placed room (builds a spanning
  // tree -> every room reachable from the entrance).
  const corridorSet = new Set();
  for (let i = 1; i < placed.length; i++) {
    const c = center(placed[i]);
    let best = null;
    let bestD = Infinity;
    for (let j = 0; j < i; j++) {
      const o = center(placed[j]);
      const d = Math.abs(c.x - o.x) + Math.abs(c.y - o.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    carve(c, best, isRoomCell, corridorSet);
  }

  const corridors = Array.from(corridorSet, (key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  return { grid, rooms: placed, corridors, entrance: placed[0].n };
}
