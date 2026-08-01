import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateDungeon } from "../js/gen/dungeon.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

// Build the tables Map exactly as the existing dungeon tests do (js/gen/dungeon
// consumes a Map of canonical tables plus the two family tables loaded raw).
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

const ABBEY_FAMILIES = new Set(["Fallen Order", "Undead", "Cultists", "Vermin"]);

test("Ruined abbey: theme is honored and every level's family is from its ecology", () => {
  const t = tables();
  for (let s = 0; s < 120; s++) {
    const d = generateDungeon(t, mulberry32(s), { theme: "Ruined abbey", size: "Sizable" });
    assert.equal(d.theme, "Ruined abbey", "dungeon theme is Ruined abbey");
    for (const lvl of d.levels) {
      assert.equal(lvl.theme, "Ruined abbey", "every level carries the theme");
      assert.ok(ABBEY_FAMILIES.has(lvl.family), `family ${lvl.family} belongs to the abbey ecology`);
    }
  }
});

test("Ruined abbey leans toward the Fallen Order (its dominant family weight)", () => {
  const t = tables();
  let fallen = 0, total = 0;
  for (let s = 0; s < 200; s++) {
    for (const lvl of generateDungeon(t, mulberry32(s), { theme: "Ruined abbey", size: "Sizable" }).levels) {
      total++;
      if (lvl.family === "Fallen Order") fallen++;
    }
  }
  // Weights are 4/2/1/1 (total 8) → Fallen Order should be a clear plurality.
  assert.ok(fallen / total > 0.4, `Fallen Order should dominate, got ${(fallen / total).toFixed(2)}`);
});
