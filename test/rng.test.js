import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mulberry32,
  hashString,
  makeRng,
  subRng,
  randInt,
  pick,
} from "../js/core/rng.js";

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test("mulberry32 outputs are floats in [0, 1)", () => {
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

test("different seeds produce different streams", () => {
  const a = mulberry32(1)();
  const b = mulberry32(2)();
  assert.notEqual(a, b);
});

test("hashString is stable and unsigned", () => {
  const h = hashString("forest");
  assert.equal(h, hashString("forest"));
  assert.ok(h >= 0 && Number.isInteger(h));
  assert.notEqual(hashString("forest"), hashString("hills"));
});

test("makeRng accepts numbers and strings", () => {
  assert.deepEqual(
    [makeRng(42)(), makeRng(42)()],
    [makeRng(42)(), makeRng(42)()],
  );
  const s1 = makeRng("seed-a")();
  const s2 = makeRng("seed-a")();
  assert.equal(s1, s2);
});

test("subRng is order-independent: same coords -> same stream", () => {
  // Generating hex (2,-1) then (0,0), vs (0,0) then (2,-1), must not change
  // either hex's roll sequence.
  const worldSeed = "my-world";
  const first = subRng(worldSeed, 2, -1);
  const firstSeq = [first(), first()];

  const second = subRng(worldSeed, 0, 0);
  second(); // advance the other stream

  const firstAgain = subRng(worldSeed, 2, -1);
  assert.deepEqual([firstAgain(), firstAgain()], firstSeq);
});

test("randInt stays within inclusive bounds and can hit both ends", () => {
  const r = mulberry32(99);
  let lo = false;
  let hi = false;
  for (let i = 0; i < 5000; i++) {
    const v = randInt(r, 1, 6);
    assert.ok(v >= 1 && v <= 6 && Number.isInteger(v));
    if (v === 1) lo = true;
    if (v === 6) hi = true;
  }
  assert.ok(lo && hi, "expected to see both extremes over many rolls");
});

test("pick returns an element of the array", () => {
  const r = mulberry32(5);
  const arr = ["a", "b", "c"];
  for (let i = 0; i < 100; i++) {
    assert.ok(arr.includes(pick(r, arr)));
  }
});
