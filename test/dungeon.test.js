import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateDungeon } from "../js/gen/dungeon.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

function tables() {
  const ids = ["dungeon-size", "dungeon-theme", "dungeon-room"];
  const t = new Map(
    ids.map((id) => [
      id,
      validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8"))),
    ]),
  );
  // Family tables aren't canonical weighted tables (value objects, no top-level
  // weights), so load without validateTable.
  for (const id of ["monster-families", "dungeon-family"]) {
    t.set(id, JSON.parse(readFileSync(`./data/${id}.json`, "utf8")));
  }
  return t;
}

// Index size metadata for range checks.
function sizeMeta(t) {
  const map = new Map();
  for (const e of t.get("dungeon-size").entries) map.set(e.value.size, e.value);
  return map;
}

// Family name -> Set of its member species (for cohesion checks).
function familyMembers(t) {
  const map = new Map();
  for (const e of t.get("monster-families").entries) {
    map.set(e.value.family, new Set(e.value.members.map((m) => m.value)));
  }
  return map;
}

test("generateDungeon is deterministic for a given seed", () => {
  const a = generateDungeon(tables(), mulberry32(42));
  const b = generateDungeon(tables(), mulberry32(42));
  assert.deepEqual(a, b);
});

test("level count and room counts fall within the rolled size's ranges", () => {
  const t = tables();
  const sizes = sizeMeta(t);
  for (let s = 0; s < 200; s++) {
    const d = generateDungeon(t, mulberry32(s));
    const meta = sizes.get(d.size);
    assert.ok(meta, `size ${d.size} comes from the table`);
    assert.ok(
      d.levels.length >= meta.levels[0] && d.levels.length <= meta.levels[1],
      `levels ${d.levels.length} within ${meta.levels}`,
    );
    for (const lvl of d.levels) {
      assert.ok(
        lvl.rooms.length >= meta.rooms[0] && lvl.rooms.length <= meta.rooms[1],
        `rooms ${lvl.rooms.length} within ${meta.rooms}`,
      );
    }
  }
});

test("each level has a non-empty, distinct random-monster table", () => {
  const t = tables();
  for (let s = 0; s < 100; s++) {
    for (const lvl of generateDungeon(t, mulberry32(s)).levels) {
      assert.ok(lvl.encounters.length > 0, "encounters non-empty");
      const values = lvl.encounters.map((e) => e.value);
      assert.equal(new Set(values).size, values.length, "encounters distinct");
    }
  }
});

test("every Monster room's monster is drawn from that level's encounter table", () => {
  const t = tables();
  for (let s = 0; s < 200; s++) {
    for (const lvl of generateDungeon(t, mulberry32(s)).levels) {
      const pool = new Set(lvl.encounters.map((e) => e.value));
      for (const room of lvl.rooms) {
        if (room.content === "Monster") {
          assert.ok(pool.has(room.monster), `${room.monster} in level pool`);
        } else {
          assert.equal(room.monster, null);
        }
      }
    }
  }
});

test("themes come from the dungeon-theme table", () => {
  const t = tables();
  const themes = new Set(t.get("dungeon-theme").entries.map((e) => e.value));
  for (let s = 0; s < 100; s++) {
    for (const lvl of generateDungeon(t, mulberry32(s)).levels) {
      assert.ok(themes.has(lvl.theme), `theme ${lvl.theme} from table`);
    }
  }
});

test("a level coheres: most of its monsters belong to its stated family", () => {
  const t = tables();
  const members = familyMembers(t);
  for (let s = 0; s < 200; s++) {
    for (const lvl of generateDungeon(t, mulberry32(s)).levels) {
      const fam = members.get(lvl.family);
      assert.ok(fam, `family ${lvl.family} is defined`);
      const inFamily = lvl.encounters.filter((e) => fam.has(e.value)).length;
      // Sampled mostly from the family; at most one interloper + maybe an elite.
      assert.ok(
        inFamily > lvl.encounters.length / 2,
        `level family ${lvl.family}: ${inFamily}/${lvl.encounters.length} in-family`,
      );
    }
  }
});

test("a Forgotten tomb leans undead; a Goblin warren leans goblinoid", () => {
  const t = tables();
  const tally = (theme, fam) => {
    let hits = 0, total = 0;
    for (let s = 0; s < 120; s++) {
      for (const lvl of generateDungeon(t, mulberry32(s), { theme }).levels) {
        total++;
        if (lvl.family === fam) hits++;
      }
    }
    return hits / total;
  };
  assert.ok(tally("Forgotten tomb", "Undead") > 0.6, "tomb should be mostly undead");
  assert.ok(tally("Goblin warren", "Goblinoids") > 0.6, "warren should be mostly goblinoid");
});

test("every dungeon carries the build stamp and a layout per level", () => {
  const t = tables();
  for (let s = 0; s < 100; s++) {
    const d = generateDungeon(t, mulberry32(s));
    assert.equal(typeof d.build, "number", "build version stamped");
    for (const lvl of d.levels) {
      assert.ok(lvl.layout && Array.isArray(lvl.layout.rooms), "level has a layout");
      assert.equal(lvl.layout.rooms.length, lvl.rooms.length, "layout covers every room");
    }
  }
});

test("ctx.theme is honored for every level", () => {
  const t = tables();
  for (let s = 0; s < 50; s++) {
    const d = generateDungeon(t, mulberry32(s), { theme: "Mausoleum" });
    assert.equal(d.theme, "Mausoleum");
    assert.ok(d.levels.every((l) => l.theme === "Mausoleum"));
  }
});
