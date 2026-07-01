import { test } from "node:test";
import assert from "node:assert/strict";
import { valueNoise2D, fbm2D } from "../js/core/noise.js";

test("valueNoise2D: deterministic — same inputs always give the same value", () => {
  assert.equal(valueNoise2D(1, "elevation", 3.7, -2.2), valueNoise2D(1, "elevation", 3.7, -2.2));
  assert.equal(fbm2D(1, "elevation", 3.7, -2.2), fbm2D(1, "elevation", 3.7, -2.2));
});

test("valueNoise2D: stays in [0,1) over a sampled grid", () => {
  for (let x = -20; x <= 20; x += 0.37) {
    for (let y = -20; y <= 20; y += 0.53) {
      const v = valueNoise2D("seed", "elevation", x, y);
      assert.ok(v >= 0 && v < 1, `out of range at (${x},${y}): ${v}`);
    }
  }
});

test("fbm2D: stays in [0,1) over a sampled grid", () => {
  for (let x = -20; x <= 20; x += 0.9) {
    for (let y = -20; y <= 20; y += 1.1) {
      const v = fbm2D("seed", "moisture", x, y);
      assert.ok(v >= 0 && v < 1, `out of range at (${x},${y}): ${v}`);
    }
  }
});

test("valueNoise2D: continuous at integer lattice boundaries (no seams)", () => {
  // Just below and just above an integer x should be close, not a jump.
  const eps = 1e-6;
  const below = valueNoise2D(1, "elevation", 5 - eps, 2.5);
  const at = valueNoise2D(1, "elevation", 5, 2.5);
  const above = valueNoise2D(1, "elevation", 5 + eps, 2.5);
  assert.ok(Math.abs(at - below) < 1e-3);
  assert.ok(Math.abs(above - at) < 1e-3);
});

test("valueNoise2D: nearby coordinates differ less on average than far-apart ones", () => {
  const near = [];
  const far = [];
  for (let i = 0; i < 200; i++) {
    const x = i * 0.3;
    const y = i * 0.2;
    const a = valueNoise2D("s", "elevation", x, y);
    near.push(Math.abs(a - valueNoise2D("s", "elevation", x + 0.1, y)));
    far.push(Math.abs(a - valueNoise2D("s", "elevation", x + 37, y + 41)));
  }
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  assert.ok(mean(near) < mean(far), `near=${mean(near)} far=${mean(far)}`);
});

test("fbm2D: independent layers are decorrelated (different noise fields)", () => {
  const elev = [];
  const moist = [];
  for (let q = -15; q <= 15; q++) {
    for (let r = -15; r <= 15; r++) {
      elev.push(fbm2D("seed", "elevation", q, r));
      moist.push(fbm2D("seed", "moisture", q, r));
    }
  }
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const me = mean(elev);
  const mm = mean(moist);
  let cov = 0, varE = 0, varM = 0;
  for (let i = 0; i < elev.length; i++) {
    cov += (elev[i] - me) * (moist[i] - mm);
    varE += (elev[i] - me) ** 2;
    varM += (moist[i] - mm) ** 2;
  }
  const corr = cov / Math.sqrt(varE * varM);
  assert.ok(Math.abs(corr) < 0.3, `correlation too high: ${corr}`);
});

test("fbm2D: more octaves add short-range variation vs a single octave", () => {
  const sample = (octaves) => {
    const vals = [];
    for (let x = 0; x < 50; x += 0.5) vals.push(fbm2D("s", "elevation", x, 0, { octaves }));
    let totalDelta = 0;
    for (let i = 1; i < vals.length; i++) totalDelta += Math.abs(vals[i] - vals[i - 1]);
    return totalDelta / vals.length;
  };
  assert.ok(sample(3) > sample(1), "3 octaves should show more local variation than 1");
});

test("different seeds produce different fields", () => {
  assert.notEqual(valueNoise2D(1, "elevation", 3.3, 4.4), valueNoise2D(2, "elevation", 3.3, 4.4));
});
