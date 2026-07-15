import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateTower, TOWER_BUILD } from "../js/gen/tower.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

function tables() {
  const ids = [
    "dungeon-room",
    "dungeon-trap",
    "dungeon-special",
    "dungeon-dressing",
    "dungeon-treasure",
    "dungeon-treasure-guard",
    "dungeon-monster-status",
    "creatures",
    "tower-kind",
    "tower-master",
  ];
  return new Map(
    ids.map((id) => [id, validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8")))]),
  );
}

const occupied = { kind: "occupied", by: "Bandits" };
const empty = { kind: "none" };

test("a tower stacks floors that go up, with the master on top", () => {
  const t = tables();
  const masters = new Set(t.get("tower-master").entries.map((e) => e.value));
  for (let s = 0; s < 40; s++) {
    const tower = generateTower(t, mulberry32(s), { occupant: occupied });
    assert.equal(tower.build, TOWER_BUILD);
    assert.equal(tower.orientation, "up");
    assert.ok(tower.levels.length >= 2 && tower.levels.length <= 5);
    // Floors are 1-indexed bottom-up; each carries a layout.
    tower.levels.forEach((lvl, i) => {
      assert.equal(lvl.depth, i + 1);
      assert.ok(lvl.layout && lvl.layout.rooms.length >= 1);
      assert.deepEqual(lvl.encounters, []);
    });
    // One staircase between each pair of consecutive floors (lower=down, upper=up).
    assert.equal(tower.stairs.length, tower.levels.length - 1);
    for (const st of tower.stairs) {
      assert.equal(st.up.level, st.down.level + 1);
    }
    // The ground floor holds the surface entrance.
    assert.equal(tower.entrances.length, 1);
    assert.equal(tower.entrances[0].level, 0);
    // The master waits on the top floor (number appearing 1).
    const top = tower.levels[tower.levels.length - 1];
    const boss = top.rooms.find((r) => r.monster && r.monster.na === "1");
    assert.ok(boss, "expected a single master on the top floor");
    assert.ok(masters.has(boss.monster.name), `master ${boss.monster.name} from table`);
  }
});

test("a manned tower is garrisoned by its occupant and lit; an empty tower is dark", () => {
  const t = tables();
  const held = generateTower(t, mulberry32(3), { occupant: occupied });
  for (const lvl of held.levels) {
    for (const r of lvl.rooms) {
      assert.ok(r.light, "held tower rooms are lit");
      // Non-master monster rooms are the garrison.
      if (r.content === "Monster" && r.monster.na !== "1") {
        assert.equal(r.monster.name, "Bandits");
      }
    }
  }
  const bare = generateTower(t, mulberry32(3), { occupant: empty });
  assert.equal(bare.master, null);
  // The master chamber is still lit, but ordinary floors are dark.
  const darkRooms = bare.levels.flatMap((l) => l.rooms).filter((r) => !r.light);
  assert.ok(darkRooms.length > 0, "an empty tower has dark rooms");
});

test("generateTower is deterministic for a given seed + occupant", () => {
  const a = generateTower(tables(), mulberry32(12), { occupant: occupied });
  const b = generateTower(tables(), mulberry32(12), { occupant: occupied });
  assert.deepEqual(a, b);
});

// --- Lord-infused towers (Phase 8.18) ------------------------------------

test("a lord fills its tower with its family and sits as the master", () => {
  const t = tables();
  t.set("monster-families", JSON.parse(readFileSync("./data/monster-families.json", "utf8")));
  const undead = new Set(
    t.get("monster-families").entries.find((e) => e.value.family === "Undead").value.members.map((m) => m.value),
  );
  const tower = generateTower(t, mulberry32(4), {
    occupant: { kind: "occupied", by: "Bandits" },
    overlord: { family: "Undead", boss: "Necromancer", id: "faction:0" },
  });
  assert.equal(tower.overlordId, "faction:0", "interior stamped with its lord");
  for (const lvl of tower.levels) assert.equal(lvl.family, "Undead");
  const top = tower.levels[tower.levels.length - 1];
  assert.equal(top.rooms[top.rooms.length - 1].monster.name, "Necromancer", "the lord is the master on top");
  const names = tower.levels.flatMap((l) => l.rooms.filter((r) => r.monster).map((r) => r.monster.name));
  assert.ok(names.every((n) => undead.has(n) || n === "Necromancer"), "every manned room is undead (or the lord)");
  assert.ok(!names.includes("Bandits"), "the old garrison label is gone");
});

test("without a lord, a tower has no overlord stamp", () => {
  const tower = generateTower(tables(), mulberry32(4), { occupant: { kind: "occupied", by: "Bandits" } });
  assert.ok(!("overlordId" in tower));
});

// --- Garrisoned tower: a rank-and-file faction mans it (Phase 8.19) -------

test("a rank-and-file faction garrisons its tower with its own people, not its name", () => {
  const tower = generateTower(tables(), mulberry32(4), {
    // The POI occupant is tagged with the faction's NAME once it's held...
    occupant: { kind: "occupied", by: "The Ashen Hand", factionId: "faction:3" },
    garrison: { id: "faction:3", label: "Cultists" }, // ...but the interior reads as its people
  });
  assert.equal(tower.garrisonId, "faction:3", "interior stamped with its garrison");
  const names = tower.levels.flatMap((l) => l.rooms.filter((r) => r.monster).map((r) => r.monster.name));
  assert.ok(names.includes("Cultists"), "the tower is manned by the faction's creatures");
  assert.ok(!names.includes("The Ashen Hand"), "the faction's proper name is not used as a creature");
});

test("a lord takes precedence over a garrison in a tower", () => {
  const tower = generateTower(tables(), mulberry32(4), {
    occupant: { kind: "occupied", by: "The Pale King", factionId: "faction:0" },
    overlord: { family: "Undead", boss: "Necromancer", id: "faction:0" },
    garrison: { id: "faction:0", label: "Cultists" },
  });
  assert.equal(tower.overlordId, "faction:0");
  assert.ok(!("garrisonId" in tower), "no garrison stamp when a lord holds it");
});
