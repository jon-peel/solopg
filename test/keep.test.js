import { test } from "node:test";
import assert from "node:assert/strict";
import { KEEP_RANK, KEEP_GARRISON } from "../js/gen/keep.js";
import { SIZE_ORDER } from "../js/gen/terrain-profile.js";

test("KEEP_RANK covers every settlement size and never echoes the size word", () => {
  assert.deepEqual(KEEP_RANK, { Hamlet: "Watchtower", Village: "Fort", Town: "Keep", City: "Citadel" });
  assert.deepEqual(Object.keys(KEEP_RANK).sort(), [...SIZE_ORDER].sort());
  const ranks = Object.values(KEEP_RANK);
  assert.equal(new Set(ranks).size, ranks.length, "each size reads as a distinct rank");
  // Pins the old "Town keep" wording as never returning: a rank is a martial
  // word, not the settlement tier it derives from.
  for (const size of SIZE_ORDER) assert.notEqual(KEEP_RANK[size], size);
});

test("KEEP_GARRISON covers every settlement size", () => {
  assert.deepEqual(Object.keys(KEEP_GARRISON).sort(), [...SIZE_ORDER].sort());
  for (const size of SIZE_ORDER) assert.ok(KEEP_GARRISON[size].length > 0, `${size} has a garrison`);
});
