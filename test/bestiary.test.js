import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBestiary, telegraphFor } from "../js/gen/bestiary.js";
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
