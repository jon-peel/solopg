import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutLevel } from "../js/gen/dungeon-layout.js";
import { mulberry32 } from "../js/core/rng.js";

const makeRooms = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1 }));

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Flood-fill over room-interior ∪ corridor cells from the entrance room; return
// the set of visited "x,y" cells.
function reachableCells(layout) {
  const room = layout.rooms.find((r) => r.n === layout.entrance);
  const open = new Set();
  for (const r of layout.rooms) {
    for (let dx = 0; dx < r.w; dx++)
      for (let dy = 0; dy < r.h; dy++) open.add(`${r.x + dx},${r.y + dy}`);
  }
  for (const c of layout.corridors) open.add(`${c.x},${c.y}`);

  const seen = new Set();
  const stack = [`${room.x},${room.y}`];
  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key) || !open.has(key)) continue;
    seen.add(key);
    const [x, y] = key.split(",").map(Number);
    stack.push(`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`);
  }
  return seen;
}

test("layoutLevel is deterministic for a given seed", () => {
  const a = layoutLevel(makeRooms(7), mulberry32(3));
  const b = layoutLevel(makeRooms(7), mulberry32(3));
  assert.deepEqual(a, b);
});

test("places exactly one rectangle per room, inside the grid", () => {
  for (let s = 0; s < 100; s++) {
    const count = 3 + (s % 8);
    const lay = layoutLevel(makeRooms(count), mulberry32(s));
    assert.equal(lay.rooms.length, count);
    assert.deepEqual(
      lay.rooms.map((r) => r.n).sort((x, y) => x - y),
      makeRooms(count).map((r) => r.n),
    );
    for (const r of lay.rooms) {
      assert.ok(r.x >= 0 && r.y >= 0, "non-negative origin");
      assert.ok(r.x + r.w <= lay.grid.w && r.y + r.h <= lay.grid.h, "within grid");
    }
  }
});

test("rooms never overlap", () => {
  for (let s = 0; s < 200; s++) {
    const lay = layoutLevel(makeRooms(3 + (s % 8)), mulberry32(s));
    for (let i = 0; i < lay.rooms.length; i++) {
      for (let j = i + 1; j < lay.rooms.length; j++) {
        assert.ok(
          !rectsOverlap(lay.rooms[i], lay.rooms[j]),
          `rooms ${i} and ${j} overlap (seed ${s})`,
        );
      }
    }
  }
});

test("every room is reachable from the entrance via corridors", () => {
  for (let s = 0; s < 200; s++) {
    const count = 3 + (s % 8);
    const lay = layoutLevel(makeRooms(count), mulberry32(s));
    const seen = reachableCells(lay);
    for (const r of lay.rooms) {
      // At least the room's center cell must be reachable.
      const cx = r.x + Math.floor(r.w / 2);
      const cy = r.y + Math.floor(r.h / 2);
      assert.ok(seen.has(`${cx},${cy}`), `room ${r.n} unreachable (seed ${s})`);
    }
  }
});

// Union-find connectivity over the edge graph (by room number).
function graphConnected(layout) {
  const parent = new Map(layout.rooms.map((r) => [r.n, r.n]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const e of layout.edges) parent.set(find(e.a), find(e.b));
  const roots = new Set(layout.rooms.map((r) => find(r.n)));
  return roots.size <= 1;
}

test("edges reference real rooms and connect the whole level", () => {
  for (let s = 0; s < 200; s++) {
    const count = 3 + (s % 8);
    const lay = layoutLevel(makeRooms(count), mulberry32(s));
    const ns = new Set(lay.rooms.map((r) => r.n));
    for (const e of lay.edges) {
      assert.ok(ns.has(e.a) && ns.has(e.b), "edge endpoints are real rooms");
      assert.notEqual(e.a, e.b, "no self-loop edge");
    }
    assert.ok(graphConnected(lay), `graph disconnected (seed ${s})`);
    // A spanning tree has count-1 edges; loops add more (never fewer).
    assert.ok(lay.edges.length >= count - 1, "at least a spanning tree");
  }
});

test("large levels usually contain loops; small levels are sometimes linear", () => {
  let bigLoopy = 0;
  for (let s = 0; s < 120; s++) {
    const lay = layoutLevel(makeRooms(10), mulberry32(s));
    if (lay.edges.length > lay.rooms.length - 1) bigLoopy++;
  }
  assert.ok(bigLoopy > 90, `expected most 10-room levels to loop, got ${bigLoopy}/120`);

  let smallLinear = 0;
  for (let s = 0; s < 120; s++) {
    const lay = layoutLevel(makeRooms(3), mulberry32(s));
    if (lay.edges.length === lay.rooms.length - 1) smallLinear++;
  }
  assert.ok(smallLinear > 0, "some 3-room levels should be linear (no loops)");
});

test("a single-room level needs no corridors", () => {
  const lay = layoutLevel(makeRooms(1), mulberry32(1));
  assert.equal(lay.rooms.length, 1);
  assert.equal(lay.corridors.length, 0);
  assert.equal(lay.entrance, 1);
});

test("an empty level degrades gracefully", () => {
  const lay = layoutLevel([], mulberry32(1));
  assert.deepEqual(lay.rooms, []);
  assert.equal(lay.entrance, null);
});
