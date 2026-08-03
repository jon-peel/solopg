import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBestiary, telegraphFor, buildTierIndex, rankBestiary, levelApex, tierPips } from "../js/gen/bestiary.js";
import { mulberry32 } from "../js/core/rng.js";

// A small dungeon-shaped fixture: two levels, room.monster present on some
// rooms (mirrors dungeon.js's { depth, rooms: [{ monster: { name } }] } shape).
function dungeonFixture() {
  return {
    levels: [
      {
        depth: 1,
        rooms: [
          { n: 1, monster: { name: "Skeletons" } },
          { n: 2, monster: null },
          { n: 3, monster: { name: "Wights" } },
        ],
      },
      {
        depth: 2,
        rooms: [
          { n: 1, monster: { name: "Skeletons" } }, // same name, different floor
          { n: 2, monster: { name: "Zombies" } },
        ],
      },
    ],
  };
}

const teleTable = {
  id: "monster-telegraph",
  entries: [
    { value: { monster: "Skeletons", telegraphs: ["Dry rattling stillness.", "Bone-dust, undisturbed."] } },
    { value: { monster: "Wights", telegraphs: ["Torches burn sickly blue."] } },
  ],
};

test("buildBestiary groups room monsters by name", () => {
  const b = buildBestiary(dungeonFixture());
  const names = b.map((m) => m.name);
  assert.deepEqual(names, ["Skeletons", "Wights", "Zombies"]); // sorted by name
});

test("buildBestiary: a monster on two levels gets both floor depths, sorted+deduped", () => {
  const b = buildBestiary(dungeonFixture());
  const skeletons = b.find((m) => m.name === "Skeletons");
  assert.deepEqual(skeletons.floors, [1, 2]);
  const wights = b.find((m) => m.name === "Wights");
  assert.deepEqual(wights.floors, [1]);
});

test("buildBestiary dedupes floors even with repeated monsters on the same level", () => {
  const dungeon = {
    levels: [
      { depth: 1, rooms: [{ n: 1, monster: { name: "Goblins" } }, { n: 2, monster: { name: "Goblins" } }] },
    ],
  };
  const b = buildBestiary(dungeon);
  assert.deepEqual(b, [{ name: "Goblins", floors: [1] }]);
});

test("buildBestiary: empty dungeon (no levels) returns []", () => {
  assert.deepEqual(buildBestiary({}), []);
  assert.deepEqual(buildBestiary({ levels: [] }), []);
});

test("buildBestiary: levels with no stocked monsters return []", () => {
  const dungeon = { levels: [{ depth: 1, rooms: [{ n: 1, monster: null }, { n: 2 }] }] };
  assert.deepEqual(buildBestiary(dungeon), []);
});

// Danger ranking (per-level apex + dungeon-wide deadliest) -----------------
const families = {
  id: "monster-families",
  entries: [
    { value: { family: "Undead", elite: "Vampire", members: [
      { value: "Skeletons", tier: 1 }, { value: "Zombies", tier: 1 }, { value: "Wights", tier: 3 },
    ] } },
  ],
};

test("buildTierIndex: members keep their tier; the elite ranks above all (5)", () => {
  const idx = buildTierIndex(families);
  assert.equal(idx.get("Skeletons"), 1);
  assert.equal(idx.get("Wights"), 3);
  assert.equal(idx.get("Vampire"), 5); // the boss outranks every member
  assert.equal(idx.get("Owlbear"), undefined); // unknown name has no tier
});

test("rankBestiary: deadliest-first (tier, then deepest floor, then name); apex flagged", () => {
  const ranked = rankBestiary(buildBestiary(dungeonFixture()), buildTierIndex(families));
  // Fixture: Wights t3 (L1); Skeletons t1 (L1-2); Zombies t1 (L2).
  assert.deepEqual(ranked.map((m) => m.name), ["Wights", "Skeletons", "Zombies"]);
  assert.equal(ranked[0].deadliest, true);
  assert.ok(!ranked[1].deadliest && !ranked[2].deadliest, "only one apex is flagged");
  assert.equal(ranked[0].tier, 3);
});

test("rankBestiary: no tier index → tier 0, no crash, still flags a (floor-ranked) apex", () => {
  const ranked = rankBestiary(buildBestiary(dungeonFixture()), null);
  assert.ok(ranked.every((m) => m.tier === 0));
  assert.equal(ranked.filter((m) => m.deadliest).length, 1);
});

test("tierPips: 1-4 render as dots, the elite as a skull, unknown as nothing", () => {
  assert.equal(tierPips(0), ""); // no family entry → no misleading mark
  assert.equal(tierPips(1), "•");
  assert.equal(tierPips(3), "•••");
  assert.equal(tierPips(4), "••••");
  assert.equal(tierPips(5), "☠");
});

test("tierPips: ranked tiers map to a descending pip count", () => {
  const ranked = rankBestiary(buildBestiary(dungeonFixture()), buildTierIndex(families));
  assert.deepEqual(ranked.map((m) => tierPips(m.tier)), ["•••", "•", "•"]);
});

test("levelApex: the highest-tier monster on each floor (ties by name)", () => {
  const apex = levelApex(dungeonFixture(), buildTierIndex(families));
  assert.equal(apex[1].name, "Wights"); // L1: Wights t3 beats Skeletons t1
  assert.equal(apex[1].tier, 3);
  assert.equal(apex[2].name, "Skeletons"); // L2: Skeletons/Zombies both t1 → name tie-break
});

test("telegraphFor: an authored monster returns one of its phrases", () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 50; i++) {
    const t = telegraphFor("Skeletons", teleTable, rng);
    assert.ok(teleTable.entries[0].value.telegraphs.includes(t), `"${t}" is an authored phrase`);
  }
});

test("telegraphFor: a single-phrase monster always returns that phrase", () => {
  const rng = mulberry32(2);
  assert.equal(telegraphFor("Wights", teleTable, rng), "Torches burn sickly blue.");
});

test("telegraphFor: an unknown/unauthored monster returns null (no generic fallback)", () => {
  const rng = mulberry32(3);
  assert.equal(telegraphFor("Owlbear", teleTable, rng), null);
});

test("telegraphFor is deterministic for a fixed seed", () => {
  const a = telegraphFor("Skeletons", teleTable, mulberry32(42));
  const b = telegraphFor("Skeletons", teleTable, mulberry32(42));
  assert.equal(a, b);
});
