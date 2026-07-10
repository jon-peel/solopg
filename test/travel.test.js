import { test } from "node:test";
import assert from "node:assert/strict";
import { TRAVEL_COST, ROAD_PACE_MULTIPLIER, ENCUMBRANCE_FACTOR, paceFor, daysToCross } from "../js/gen/travel.js";

test("TRAVEL_COST covers every terrain with the documented pace", () => {
  assert.deepEqual(TRAVEL_COST, {
    Plains: 4, Forest: 2, Hills: 2, Desert: 2, Swamp: 1, Mountains: 1, Lake: 0, Sea: 0,
  });
});

test("paceFor matches the terrain table off-road", () => {
  assert.equal(paceFor("Plains"), 4);
  assert.equal(paceFor("Forest"), 2);
  assert.equal(paceFor("Hills"), 2);
  assert.equal(paceFor("Desert"), 2);
  assert.equal(paceFor("Swamp"), 1);
  assert.equal(paceFor("Mountains"), 1);
});

test("paceFor doubles pace on a road", () => {
  assert.equal(paceFor("Plains", { road: true }), 8);
  assert.equal(paceFor("Swamp", { road: true }), 2);
  assert.equal(ROAD_PACE_MULTIPLIER, 2);
});

test("paceFor is 0 (impassable) on Lake/Sea, on or off road", () => {
  assert.equal(paceFor("Lake"), 0);
  assert.equal(paceFor("Sea"), 0);
  assert.equal(paceFor("Lake", { road: true }), 0);
  assert.equal(paceFor("Sea", { road: true }), 0);
});

test("paceFor defaults an unknown terrain to impassable rather than throwing", () => {
  assert.equal(paceFor("Nonsense"), 0);
});

test("daysToCross is the reciprocal of pace", () => {
  assert.equal(daysToCross("Plains"), 1 / 4);
  assert.equal(daysToCross("Swamp"), 1);
  assert.equal(daysToCross("Plains", { road: true }), 1 / 8);
});

test("daysToCross is Infinity when impassable", () => {
  assert.equal(daysToCross("Sea"), Infinity);
  assert.equal(daysToCross("Lake"), Infinity);
});

test("paceFor defaults to unencumbered — today's numbers are unchanged", () => {
  assert.equal(paceFor("Plains"), paceFor("Plains", { encumbrance: "unencumbered" }));
  assert.equal(paceFor("Plains", { road: true }), paceFor("Plains", { road: true, encumbrance: "unencumbered" }));
});

test("ENCUMBRANCE_FACTOR matches the B/X tooltip ladder (1 / .75 / .5 / .25)", () => {
  assert.deepEqual(ENCUMBRANCE_FACTOR, { unencumbered: 1, light: 0.75, encumbered: 0.5, heavy: 0.25 });
});

test("paceFor scales by encumbrance tier", () => {
  assert.equal(paceFor("Plains", { encumbrance: "light" }), 3);
  assert.equal(paceFor("Plains", { encumbrance: "encumbered" }), 2);
  assert.equal(paceFor("Plains", { encumbrance: "heavy" }), 1);
});

test("paceFor combines road and encumbrance multiplicatively", () => {
  assert.equal(paceFor("Plains", { road: true, encumbrance: "heavy" }), 2); // 4 * 2 * 0.25
});

test("paceFor stays impassable on Lake/Sea regardless of encumbrance", () => {
  assert.equal(paceFor("Sea", { encumbrance: "light" }), 0);
  assert.equal(paceFor("Lake", { encumbrance: "heavy" }), 0);
});

test("paceFor falls back to unencumbered for an unrecognised encumbrance tier", () => {
  assert.equal(paceFor("Plains", { encumbrance: "sprinting" }), 4);
});
