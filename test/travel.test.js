import { test } from "node:test";
import assert from "node:assert/strict";
import { TRAVEL_COST, ROAD_PACE_MULTIPLIER, paceFor, daysToCross } from "../js/gen/travel.js";

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
