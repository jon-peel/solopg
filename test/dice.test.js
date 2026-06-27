import { test } from "node:test";
import assert from "node:assert/strict";
import { rollDice } from "../js/core/dice.js";
import { mulberry32 } from "../js/core/rng.js";

test("NdM totals stay within range", () => {
  const r = mulberry32(1);
  for (let i = 0; i < 1000; i++) {
    const { total, rolls } = rollDice("3d6", r);
    assert.equal(rolls.length, 3);
    assert.ok(total >= 3 && total <= 18, `out of range: ${total}`);
  }
});

test("dM defaults the count to 1", () => {
  const r = mulberry32(2);
  for (let i = 0; i < 1000; i++) {
    const { total, rolls } = rollDice("d20", r);
    assert.equal(rolls.length, 1);
    assert.ok(total >= 1 && total <= 20);
  }
});

test("multipliers (xK) scale the dice sum, before any modifier", () => {
  const r = mulberry32(7);
  for (let i = 0; i < 1000; i++) {
    const { total } = rollDice("2d6*10", r);
    assert.ok(total >= 20 && total <= 120 && total % 10 === 0, `bad ${total}`);
  }
  assert.equal(rollDice("1d1x100+5", mulberry32(1)).total, 105); // (1*100)+5
});

test("modifiers are applied", () => {
  const r = mulberry32(3);
  for (let i = 0; i < 500; i++) {
    const { total } = rollDice("1d4+10", r);
    assert.ok(total >= 11 && total <= 14);
  }
  const minus = rollDice("2d6-2", mulberry32(3));
  assert.ok(minus.total >= 0 && minus.total <= 10);
});

test("bare constants roll no dice", () => {
  assert.deepEqual(rollDice("5"), { total: 5, rolls: [], notation: "5" });
  assert.equal(rollDice("-3").total, -3);
});

test("whitespace is tolerated", () => {
  const { rolls } = rollDice(" 2 d 6 + 1 ", mulberry32(4));
  assert.equal(rolls.length, 2);
});

test("invalid notation throws", () => {
  assert.throws(() => rollDice("abc"));
  assert.throws(() => rollDice("d"));
  assert.throws(() => rollDice("3d"));
  assert.throws(() => rollDice("0d6"));
});

test("same seed reproduces the same roll", () => {
  assert.deepEqual(
    rollDice("4d8", mulberry32(777)),
    rollDice("4d8", mulberry32(777)),
  );
});
