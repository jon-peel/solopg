import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NEIGHBOR_DIRS,
  axialKey,
  parseKey,
  axialToPixel,
  pixelToAxial,
  roundAxial,
  hexCorners,
  neighbors,
} from "../js/core/hexgeo.js";

const S = 28;
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("axialToPixel: origin maps to (0,0)", () => {
  assert.deepEqual(axialToPixel(0, 0, S), { x: 0, y: 0 });
});

test("axialToPixel: known values", () => {
  const a = axialToPixel(1, 0, S);
  assert.ok(close(a.x, S * Math.sqrt(3)) && close(a.y, 0));
  const b = axialToPixel(0, 1, S);
  assert.ok(close(b.x, (S * Math.sqrt(3)) / 2) && close(b.y, S * 1.5));
});

test("pixelToAxial round-trips on hex centers across a grid", () => {
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      const { x, y } = axialToPixel(q, r, S);
      assert.deepEqual(pixelToAxial(x, y, S), { q, r });
    }
  }
});

test("pixelToAxial snaps small jitter back to the center cell", () => {
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const { x, y } = axialToPixel(q, r, S);
      // Nudge well within the hex; should still resolve to (q,r).
      assert.deepEqual(pixelToAxial(x + 3, y - 3, S), { q, r });
    }
  }
});

test("roundAxial returns integers preserving the cube invariant", () => {
  const r = roundAxial(0.4, -1.2);
  assert.ok(Number.isInteger(r.q) && Number.isInteger(r.r));
  // cube: x=q, z=r, y=-x-z must sum to zero
  assert.equal(r.q + r.r + -(r.q + r.r), 0);
});

test("neighbors returns the six directions applied to a cell", () => {
  assert.deepEqual(
    neighbors(0, 0),
    NEIGHBOR_DIRS.map(([dq, dr]) => ({ q: dq, r: dr })),
  );
  const n = neighbors(2, -1);
  assert.equal(n.length, 6);
  assert.deepEqual(n[0], { q: 3, r: -1 });
  // all distinct
  assert.equal(new Set(n.map((c) => axialKey(c.q, c.r))).size, 6);
});

test("axialKey/parseKey round-trip incl. negatives", () => {
  for (const [q, r] of [
    [0, 0],
    [5, -2],
    [-3, 4],
    [-1, -1],
  ]) {
    assert.equal(axialKey(q, r), `${q},${r}`);
    assert.deepEqual(parseKey(axialKey(q, r)), { q, r });
  }
  assert.throws(() => parseKey("nope"));
  assert.throws(() => parseKey("1,"));
});

test("hexCorners: 6 points at distance s, first at -30deg", () => {
  const pts = hexCorners(10, 20, S);
  assert.equal(pts.length, 6);
  for (const p of pts) {
    assert.ok(close(Math.hypot(p.x - 10, p.y - 20), S));
  }
  assert.ok(
    close(pts[0].x, 10 + S * Math.cos(-Math.PI / 6)) &&
      close(pts[0].y, 20 + S * Math.sin(-Math.PI / 6)),
  );
});
