import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateDungeon } from "../js/gen/dungeon.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

function tables() {
  const ids = ["dungeon-size", "dungeon-theme", "dungeon-room", "creatures"];
  return new Map(
    ids.map((id) => [
      id,
      validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8"))),
    ]),
  );
}

// Index size metadata for range checks.
function sizeMeta(t) {
  const map = new Map();
  for (const e of t.get("dungeon-size").entries) map.set(e.value.size, e.value);
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
