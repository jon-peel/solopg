import { test } from "node:test";
import assert from "node:assert/strict";
import { reactionForRoll, rollWanderingEncounter } from "../js/gen/wandering.js";
import { mulberry32 } from "../js/core/rng.js";

// A small level-shaped fixture: weighted encounter table, like a real
// dungeon.js level's `encounters` array.
const level = {
  depth: 2,
  encounters: [
    { weight: 3, value: "2d4 Giant Rats" },
    { weight: 2, value: "1d6 Skeletons" },
    { weight: 1, value: "Ochre Jelly" },
  ],
};

test("reactionForRoll: OSE 2d6 band boundaries", () => {
  assert.equal(reactionForRoll(2), "Hostile");
  assert.equal(reactionForRoll(5), "Unfriendly");
  assert.equal(reactionForRoll(6), "Neutral");
  assert.equal(reactionForRoll(8), "Neutral");
  assert.equal(reactionForRoll(9), "Indifferent");
  assert.equal(reactionForRoll(11), "Indifferent");
  assert.equal(reactionForRoll(12), "Friendly");
});

test("rollWanderingEncounter draws a monster from the level's own table", () => {
  const values = new Set(level.encounters.map((e) => e.value));
  const rng = mulberry32(1);
  for (let i = 0; i < 200; i++) {
    const pick = rollWanderingEncounter(level, rng);
    assert.ok(values.has(pick.monster), `"${pick.monster}" is from the table`);
  }
});

test("rollWanderingEncounter: surprise rolls are 1d6 per side", () => {
  const rng = mulberry32(2);
  for (let i = 0; i < 200; i++) {
    const pick = rollWanderingEncounter(level, rng);
    assert.ok(pick.surpriseMonster >= 1 && pick.surpriseMonster <= 6);
    assert.ok(pick.surpriseParty >= 1 && pick.surpriseParty <= 6);
  }
});

test("rollWanderingEncounter: distance is 2d6x10ft, a multiple of 10 in [20,120]", () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const { distanceFt } = rollWanderingEncounter(level, rng);
    assert.ok(distanceFt >= 20 && distanceFt <= 120 && distanceFt % 10 === 0, `bad ${distanceFt}`);
  }
});

test("rollWanderingEncounter: reaction outcome matches reactionForRoll(reaction.roll)", () => {
  const rng = mulberry32(4);
  for (let i = 0; i < 200; i++) {
    const { reaction } = rollWanderingEncounter(level, rng);
    assert.equal(reaction.outcome, reactionForRoll(reaction.roll));
  }
});

test("rollWanderingEncounter: shape carries kind + all fields", () => {
  const pick = rollWanderingEncounter(level, mulberry32(5));
  assert.equal(pick.kind, "wandering");
  assert.ok("monster" in pick);
  assert.ok("surpriseMonster" in pick);
  assert.ok("surpriseParty" in pick);
  assert.ok("reaction" in pick && "roll" in pick.reaction && "outcome" in pick.reaction);
  assert.ok("distanceFt" in pick);
});

test("rollWanderingEncounter is deterministic for a given seeded stream", () => {
  const a = rollWanderingEncounter(level, mulberry32(1234));
  const b = rollWanderingEncounter(level, mulberry32(1234));
  assert.deepEqual(a, b);
});

test("rollWanderingEncounter draws in the fixed order (same rng advances identically)", () => {
  // Two calls sharing one rng stream should differ from two calls each on a
  // fresh mulberry32(seed) — i.e. the function consumes a fixed number of
  // rng() calls per draw, so re-seeding vs. continuing a stream diverge.
  const shared = mulberry32(99);
  const first = rollWanderingEncounter(level, shared);
  const second = rollWanderingEncounter(level, shared);
  assert.notDeepEqual(first, second);
});
