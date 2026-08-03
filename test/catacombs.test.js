import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateDungeon } from "../js/gen/dungeon.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

// Catacombs (Phase 15, Step 7) — a monastery's explorable underground REUSES the
// existing dungeon interior generator with theme "Catacombs" (no new generator).
// These tests assert the reuse holds: a "Catacombs"-themed dungeon is a valid
// interior, sticks to the theme, scales depth by the forced size, and draws its
// per-level ecology from the Catacombs family spread (Undead/Vermin/Cultists/
// Aberrations) added to data/dungeon-family.json.

// Build the tables Map exactly as test/dungeon.test.js does.
function tables() {
  const ids = [
    "dungeon-size",
    "dungeon-theme",
    "dungeon-room",
    "dungeon-trap",
    "dungeon-special",
    "dungeon-dressing",
    "treasure-type",
    "dungeon-treasure-guard",
    "dungeon-monster-status",
    "dungeon-light",
    "occupiers",
  ];
  const t = new Map(
    ids.map((id) => [
      id,
      validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8"))),
    ]),
  );
  for (const id of ["monster-families", "dungeon-family"]) {
    t.set(id, JSON.parse(readFileSync(`./data/${id}.json`, "utf8")));
  }
  return t;
}

const CATACOMBS_FAMILIES = new Set(["Undead", "Vermin", "Cultists", "Aberrations"]);

test("a Catacombs dungeon carries the theme on the dungeon and every level", () => {
  const t = tables();
  for (let s = 0; s < 50; s++) {
    const d = generateDungeon(t, mulberry32(s), { theme: "Catacombs", size: "Sizable" });
    assert.equal(d.theme, "Catacombs", "dungeon theme is Catacombs");
    assert.ok(d.levels.every((l) => l.theme === "Catacombs"), "every level themed Catacombs");
  }
});

test("a Catacombs dungeon is a valid interior (levels, rooms, per-level layout)", () => {
  const t = tables();
  for (let s = 0; s < 60; s++) {
    const d = generateDungeon(t, mulberry32(s), { theme: "Catacombs", size: "Sizable" });
    assert.ok(Array.isArray(d.levels) && d.levels.length >= 1, "has levels");
    assert.equal(typeof d.build, "number", "carries the build stamp");
    for (const lvl of d.levels) {
      assert.ok(Array.isArray(lvl.rooms) && lvl.rooms.length >= 1, "level has rooms");
      assert.ok(lvl.layout && Array.isArray(lvl.layout.rooms), "level has a layout");
      assert.equal(lvl.layout.rooms.length, lvl.rooms.length, "layout covers every room");
    }
  }
});

test("catacombs depth scales with the forced size (Cramped -> 1 level, Sprawling -> 3-4)", () => {
  const t = tables();
  for (let s = 0; s < 40; s++) {
    const cramped = generateDungeon(t, mulberry32(s), { theme: "Catacombs", size: "Cramped" });
    assert.equal(cramped.size, "Cramped");
    assert.equal(cramped.levels.length, 1, "Cramped catacombs are a single level");

    const sprawling = generateDungeon(t, mulberry32(s), { theme: "Catacombs", size: "Sprawling" });
    assert.equal(sprawling.size, "Sprawling");
    assert.ok(sprawling.levels.length >= 3 && sprawling.levels.length <= 4, `Sprawling catacombs 3-4 levels (got ${sprawling.levels.length})`);
  }
});

test("every Catacombs level's family is drawn from the Catacombs spread", () => {
  const t = tables();
  for (let s = 0; s < 120; s++) {
    for (const sz of ["Cramped", "Modest", "Sizable", "Sprawling"]) {
      for (const lvl of generateDungeon(t, mulberry32(s), { theme: "Catacombs", size: sz }).levels) {
        assert.ok(CATACOMBS_FAMILIES.has(lvl.family), `level family "${lvl.family}" not in the Catacombs spread`);
      }
    }
  }
});

test("catacombs lean undead (the dominant family in the spread)", () => {
  const t = tables();
  let hits = 0, total = 0;
  for (let s = 0; s < 200; s++) {
    for (const lvl of generateDungeon(t, mulberry32(s), { theme: "Catacombs", size: "Sizable" }).levels) {
      total++;
      if (lvl.family === "Undead") hits++;
    }
  }
  assert.ok(hits / total > 0.5, `catacombs should be mostly undead (got ${(hits / total).toFixed(2)})`);
});

test("a Catacombs dungeon is deterministic for a seed", () => {
  const t = tables();
  const a = generateDungeon(t, mulberry32(17), { theme: "Catacombs", size: "Sizable" });
  const b = generateDungeon(t, mulberry32(17), { theme: "Catacombs", size: "Sizable" });
  assert.deepEqual(a, b);
});
