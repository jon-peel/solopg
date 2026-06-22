// Dungeon level layout (Phase 4 arc) — rooms + a corridor GRAPH on a coarse grid.
//
// Pure + deterministic: given a level's stocked rooms and an rng stream, place
// each room as a non-overlapping rectangle on a grid, then connect them as a
// GRAPH — a spanning tree for guaranteed connectivity plus extra "loop" edges so
// levels have multiple pathways (4.9.2). Corridors are carved per edge. No DOM —
// the canvas renderer (js/ui/dungeon-map.js) just draws the returned cells; this
// module is node-tested (no overlap, fully connected, has loops, deterministic).

import { randInt } from "../core/rng.js";
import { rollTable } from "./../core/table.js";

const ROOM_MIN = 3;
const ROOM_MAX = 5;

// Edge (passage) types. Weighted JS consts (structural, like the other layout
// consts). TREE edges connect the dungeon and are NEVER secret, so every room is
// reachable without finding a secret door; LOOP edges are redundant shortcuts and
// may be secret/locked/stuck. Two styles: "built" (crafted doors) and "natural"
// (caves — mostly open passages, the odd cave-in [stuck] or fissure [secret]).
const TREE_DOORS = {
  id: "door-tree",
  entries: [
    { weight: 6, value: "door" },
    { weight: 3, value: "open" },
    { weight: 1, value: "stuck" },
    { weight: 1, value: "locked" },
  ],
};
const LOOP_DOORS = {
  id: "door-loop",
  entries: [
    { weight: 4, value: "door" },
    { weight: 2, value: "open" },
    { weight: 3, value: "secret" },
    { weight: 1, value: "stuck" },
    { weight: 1, value: "locked" },
  ],
};
const CAVE_TREE_DOORS = {
  id: "door-cave-tree",
  entries: [
    { weight: 10, value: "open" },
    { weight: 1, value: "door" },
    { weight: 2, value: "stuck" },
    { weight: 1, value: "locked" },
  ],
};
const CAVE_LOOP_DOORS = {
  id: "door-cave-loop",
  entries: [
    { weight: 8, value: "open" },
    { weight: 1, value: "door" },
    { weight: 2, value: "secret" },
    { weight: 2, value: "stuck" },
  ],
};
const DOOR_STYLES = {
  built: { tree: TREE_DOORS, loop: LOOP_DOORS },
  natural: { tree: CAVE_TREE_DOORS, loop: CAVE_LOOP_DOORS },
};

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

// All cells along one L-shaped path between two cells (in path order), for the
// given leg order. Includes cells that fall inside rooms (filtered by callers).
function pathCells(a, b, horizFirst) {
  const cells = [];
  let { x, y } = a;
  const horiz = () => {
    while (x !== b.x) {
      x += x < b.x ? 1 : -1;
      cells.push({ x, y });
    }
  };
  const vert = () => {
    while (y !== b.y) {
      y += y < b.y ? 1 : -1;
      cells.push({ x, y });
    }
  };
  if (horizFirst) {
    horiz();
    vert();
  } else {
    vert();
    horiz();
  }
  return cells;
}

/**
 * Lay out one dungeon level.
 * @param {{n:number}[]} rooms the level's stocked rooms (only `n` is used).
 * @param {() => number} rng deterministic sub-stream.
 * @param {{ side?: number, pins?: {x:number,y:number,w:number,h:number}[], doorStyle?: string }} [opts]
 *   pins: rects placed FIRST (the first `pins.length` rooms), for vertical stairs.
 *   doorStyle: "built" (default) or "natural" (caves — open-heavy door weights).
 * @returns {{ grid:{w:number,h:number}, rooms:{n:number,x:number,y:number,w:number,h:number}[],
 *   corridors:{x:number,y:number}[], edges:{a:number,b:number,type:string}[],
 *   doors:{x:number,y:number,type:string,dx:number,dy:number}[], entrance:number }}
 *   (door dx,dy point from the door cell toward the room it adjoins — the wall side)
 */
export function layoutLevel(rooms, rng, opts = {}) {
  const count = rooms.length;
  if (count === 0)
    return { grid: { w: 8, h: 8 }, rooms: [], corridors: [], edges: [], doors: [], entrance: null };

  const pins = opts.pins || [];
  const pinnedCount = Math.min(pins.length, count);

  // Grid sized generously for the room count so placement (incl. a 1-cell gap)
  // reliably succeeds; grow and retry on the rare miss. Also large enough for any
  // pin (a pinned stair room from an adjacent level).
  let side = Math.max(18, opts.side || Math.ceil(Math.sqrt(count)) * 11);
  for (const p of pins) side = Math.max(side, p.x + p.w + 1, p.y + p.h + 1);
  let placed = null;
  for (let grow = 0; grow < 8 && !placed; grow++, side += 8) {
    const grid = { w: side, h: side };
    const acc = [];
    let ok = true;
    // Pinned rooms first, at their exact rects (clamped into the grid).
    for (let k = 0; k < pinnedCount; k++) {
      const p = pins[k];
      const w = Math.min(p.w, side - 2);
      const h = Math.min(p.h, side - 2);
      const x = Math.min(Math.max(1, p.x), side - w - 1);
      const y = Math.min(Math.max(1, p.y), side - h - 1);
      const rect = { x, y, w, h };
      if (acc.some((a) => overlaps(a, rect, 0))) {
        ok = false;
        break;
      }
      acc.push({ n: rooms[k].n, ...rect });
    }
    if (ok) {
      for (let i = pinnedCount; i < rooms.length; i++) {
        const rect = placeRoom(rng, grid, acc);
        if (!rect) {
          ok = false;
          break;
        }
        acc.push({ n: rooms[i].n, ...rect });
      }
    }
    if (ok) placed = acc;
  }
  if (!placed) {
    // Extremely unlikely; degrade gracefully — keep pinned rooms on their rects
    // (so vertical stairs still line up) and stack the rest in a side column.
    const acc = [];
    for (let k = 0; k < pinnedCount; k++) {
      const p = pins[k];
      acc.push({ n: rooms[k].n, x: p.x, y: p.y, w: p.w, h: p.h });
    }
    const colX = Math.max(1, ...pins.map((p) => p.x + p.w + 2), 1);
    for (let i = pinnedCount; i < rooms.length; i++) {
      acc.push({ n: rooms[i].n, x: colX, y: 1 + (i - pinnedCount) * 4, w: 3, h: 3 });
    }
    placed = acc;
    side = Math.max(colX + 5, 4 + rooms.length * 4);
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
  // ai, bi are indices into `placed`; `loop` marks a redundant (non-tree) edge.
  // Records an undirected edge once. Types are assigned after the graph is built.
  const addEdge = (ai, bi, loop) => {
    const a = placed[ai].n;
    const b = placed[bi].n;
    const key = edgeKey(a, b);
    if (a === b || edgeSet.has(key)) return false;
    edgeSet.add(key);
    edges.push({ a, b, loop });
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
    addEdge(i, best, false);
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
      if (addEdge(c.i, c.j, true)) want--;
    }
  }

  // 3) Type each edge. Tree edges never secret (keeps every room reachable);
  //    loop edges may be secret/locked/stuck. Door style varies by theme
  //    (caves lean to open passages).
  const style = DOOR_STYLES[opts.doorStyle] || DOOR_STYLES.built;
  for (const e of edges) {
    e.type = rollTable(e.loop ? style.loop : style.tree, rng).value;
    delete e.loop;
  }

  // 4) Carve corridors and record a door marker for each non-open passage. This
  //    is the GM map, so secret doors ARE shown (marked distinctly); a player
  //    view can hide them later (4.9.5). The cheaper L-orientation (fewer
  //    foreign-room cells) is chosen to reduce clipping.
  const byN = new Map(placed.map((p) => [p.n, p]));
  const foreignCount = (cells, ra, rb) =>
    cells.filter((c) => isRoomCell(c.x, c.y) && !inRect(c, ra) && !inRect(c, rb)).length;
  const corridorSet = new Set();
  const doors = [];
  const doorAt = new Set(); // dedupe: at most one marker per cell
  for (const e of edges) {
    const ra = byN.get(e.a);
    const rb = byN.get(e.b);
    const a = center(ra);
    const b = center(rb);
    const optionH = pathCells(a, b, true);
    const optionV = pathCells(a, b, false);
    const cells = foreignCount(optionV, ra, rb) < foreignCount(optionH, ra, rb) ? optionV : optionH;
    let doorCell = null;
    let prev = a; // previous path cell; for the first corridor cell it's a room cell
    let dx = 0;
    let dy = 0;
    for (const c of cells) {
      if (!isRoomCell(c.x, c.y)) {
        corridorSet.add(`${c.x},${c.y}`);
        if (!doorCell) {
          doorCell = c;
          // Direction from the door cell back toward the room it adjoins -> the
          // wall side, so the renderer can straddle/orient the door.
          dx = Math.sign(prev.x - c.x);
          dy = Math.sign(prev.y - c.y);
        }
      }
      prev = c;
    }
    if (doorCell && e.type !== "open") {
      const key = `${doorCell.x},${doorCell.y}`;
      if (!doorAt.has(key)) {
        doorAt.add(key);
        doors.push({ x: doorCell.x, y: doorCell.y, type: e.type, dx, dy });
      }
    }
  }

  const corridors = Array.from(corridorSet, (key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  return { grid, rooms: placed, corridors, edges, doors, entrance: placed[0].n };
}

// True if cell (x,y) is inside rectangle r.
function inRect(c, r) {
  return c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;
}
