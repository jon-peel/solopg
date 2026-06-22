import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateDungeon } from "../js/gen/dungeon.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";

function tables() {
  const ids = [
    "dungeon-size",
    "dungeon-theme",
    "dungeon-room",
    "dungeon-trap",
    "dungeon-special",
    "dungeon-dressing",
    "dungeon-treasure",
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
        if (room.held) continue; // occupied rooms hold the interloper group, not the pool
        if (room.content === "Monster") {
          assert.ok(pool.has(room.monster.name), `${room.monster.name} in level pool`);
        } else {
          assert.equal(room.monster, null);
        }
      }
    }
  }
});

test("each room carries content-appropriate detail", () => {
  const t = tables();
  const traps = new Set(t.get("dungeon-trap").entries.map((e) => e.value.name));
  const specials = new Set(t.get("dungeon-special").entries.map((e) => e.value));
  const dressings = new Set(t.get("dungeon-dressing").entries.map((e) => e.value));
  const kinds = new Set(t.get("dungeon-treasure").entries.map((e) => e.value));
  const guards = new Set(t.get("dungeon-treasure-guard").entries.map((e) => e.value));
  const statuses = new Set(t.get("dungeon-monster-status").entries.map((e) => e.value));
  for (let s = 0; s < 120; s++) {
    for (const lvl of generateDungeon(t, mulberry32(s)).levels) {
      for (const room of lvl.rooms) {
        if (room.content === "Monster" && !room.held) {
          assert.ok(room.monster.number >= 1 && room.monster.number <= 6, "1-6 appear");
          assert.ok(statuses.has(room.monster.status), "valid status");
        }
        if (room.content === "Trap") {
          assert.ok(traps.has(room.trap.name) && room.trap.trigger && room.trap.effect);
        } else {
          assert.equal(room.trap, null);
        }
        if (room.content === "Special") {
          assert.ok(specials.has(room.special));
          assert.equal(room.treasure, null, "no separate treasure in Special rooms");
        }
        if (room.content === "Empty") assert.ok(dressings.has(room.dressing));
        if (room.treasure) {
          assert.ok(kinds.has(room.treasure.kind) && guards.has(room.treasure.guard));
        }
      }
    }
  }
});

test("cave dungeons have far fewer crafted doors than built dungeons", () => {
  const t = tables();
  const doorRate = (theme) => {
    let doors = 0, edges = 0;
    for (let s = 0; s < 120; s++) {
      for (const lvl of generateDungeon(t, mulberry32(s), { size: "Sizable", theme }).levels) {
        for (const e of lvl.layout.edges) {
          edges++;
          if (e.type === "door" || e.type === "locked") doors++;
        }
      }
    }
    return doors / edges;
  };
  const cave = doorRate("Cave complex");
  const ruin = doorRate("Ruin");
  assert.ok(cave < ruin * 0.5, `caves (${cave.toFixed(2)}) should have far fewer doors than ruin (${ruin.toFixed(2)})`);
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

test("ctx.size is honored and its level/room counts stay in range", () => {
  const t = tables();
  const sizes = sizeMeta(t);
  for (const [name, meta] of sizes) {
    for (let s = 0; s < 25; s++) {
      const d = generateDungeon(t, mulberry32(s), { size: name });
      assert.equal(d.size, name);
      assert.ok(
        d.levels.length >= meta.levels[0] && d.levels.length <= meta.levels[1],
        `${name}: levels ${d.levels.length} within ${meta.levels}`,
      );
    }
  }
});

test("an unknown ctx.size falls back to a rolled size", () => {
  const t = tables();
  const valid = new Set([...sizeMeta(t).keys()]);
  const d = generateDungeon(t, mulberry32(1), { size: "Gigantic" });
  assert.ok(valid.has(d.size), "fell back to a real size");
});

test("stairs connect adjacent levels and every level is reachable from an entrance", () => {
  const t = tables();
  for (let s = 0; s < 200; s++) {
    const d = generateDungeon(t, mulberry32(s), { size: "Sprawling" });
    for (const st of d.stairs) {
      assert.ok(st.up.level > st.down.level, "a stair goes down a level");
      assert.equal(st.up.level - st.down.level, st.kind === "shaft" ? 2 : 1, "stairs adjacent, shafts skip one");
      assert.ok(d.levels[st.down.level].rooms.some((r) => r.n === st.down.room));
      assert.ok(d.levels[st.up.level].rooms.some((r) => r.n === st.up.room));
    }
    // BFS over levels using stairs, seeded from entrance levels.
    const reach = new Set(d.entrances.map((e) => e.level));
    let grew = true;
    while (grew) {
      grew = false;
      for (const st of d.stairs) {
        if (reach.has(st.down.level) && !reach.has(st.up.level)) { reach.add(st.up.level); grew = true; }
        if (reach.has(st.up.level) && !reach.has(st.down.level)) { reach.add(st.down.level); grew = true; }
      }
    }
    for (let i = 0; i < d.levels.length; i++) assert.ok(reach.has(i), `level ${i} unreachable (seed ${s})`);
  }
});

test("entrances are on level 0, capped by rooms, and multi-entrance scales with size", () => {
  const t = tables();
  const multiRate = (sz) => {
    let multi = 0;
    for (let s = 0; s < 200; s++) {
      const d = generateDungeon(t, mulberry32(s), { size: sz });
      assert.ok(d.entrances.length >= 1, "at least one entrance");
      assert.ok(d.entrances.every((e) => e.level === 0), "entrances on level 0");
      assert.ok(d.entrances.length <= d.levels[0].rooms.length, "capped by room count");
      if (d.entrances.length > 1) multi++;
    }
    return multi / 200;
  };
  const cramped = multiRate("Cramped");
  const sprawling = multiRate("Sprawling");
  assert.ok(cramped > 0, "even small dungeons can have multiple entrances");
  assert.ok(sprawling > cramped, "multi-entrance likelihood rises with size");
});

test("large dungeons commonly have multiple stairs between levels", () => {
  const t = tables();
  let multi = 0;
  let pairs = 0;
  for (let s = 0; s < 200; s++) {
    const d = generateDungeon(t, mulberry32(s), { size: "Sprawling" });
    const byPair = new Map();
    for (const st of d.stairs) {
      if (st.kind !== "stairs") continue;
      byPair.set(st.down.level, (byPair.get(st.down.level) || 0) + 1);
    }
    for (const [, c] of byPair) {
      pairs++;
      if (c >= 2) multi++;
    }
  }
  assert.ok(multi / pairs > 0.45, `expected many multi-stair pairs, got ${((multi / pairs) * 100).toFixed(0)}%`);
});

test("every stair's down-room and up-room overlap on the shared grid", () => {
  const t = tables();
  const rectOf = (d, lvl, n) => d.levels[lvl].layout.rooms.find((r) => r.n === n);
  const overlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  for (let s = 0; s < 250; s++) {
    for (const sz of ["Modest", "Sizable", "Sprawling"]) {
      const d = generateDungeon(t, mulberry32(s), { size: sz });
      for (const st of d.stairs) {
        const a = rectOf(d, st.down.level, st.down.room);
        const b = rectOf(d, st.up.level, st.up.room);
        assert.ok(overlap(a, b), `${st.kind} rooms don't overlap (${sz} seed ${s})`);
      }
    }
  }
});

test("exits only surface on deeper levels for hill/mountain terrain", () => {
  const t = tables();
  for (let s = 0; s < 120; s++) {
    const plains = generateDungeon(t, mulberry32(s), { size: "Sprawling", terrain: "Plains" });
    assert.equal(plains.exits.length, 0, "no exits on Plains");
  }
  let sawDeepExit = false;
  for (let s = 0; s < 200; s++) {
    const mtn = generateDungeon(t, mulberry32(s), { size: "Sprawling", terrain: "Mountains" });
    for (const ex of mtn.exits) {
      assert.ok(ex.level >= 1, "exit surfaces on a deeper level");
      if (ex.level >= 1) sawDeepExit = true;
    }
  }
  assert.ok(sawDeepExit, "Mountains dungeons sometimes have a deeper exit");
});

test("rooms are dark or lit with a source; lighting thins with depth", () => {
  const t = tables();
  const sources = new Set(t.get("dungeon-light").entries.map((e) => e.value));
  let l0lit = 0, l0tot = 0, deepLit = 0, deepTot = 0;
  for (let s = 0; s < 300; s++) {
    const d = generateDungeon(t, mulberry32(s), { size: "Sprawling" });
    for (const lvl of d.levels) {
      for (const r of lvl.rooms) {
        if (r.light && !r.held) assert.ok(sources.has(r.light.source), "light source from table");
      }
    }
    for (const r of d.levels[0].rooms) { l0tot++; if (r.light) l0lit++; }
    const deep = d.levels[d.levels.length - 1];
    for (const r of deep.rooms) { deepTot++; if (r.light) deepLit++; }
  }
  const l0 = l0lit / l0tot;
  const deep = deepLit / deepTot;
  assert.ok(l0 > deep * 3, `level 0 lighting (${l0.toFixed(3)}) should far exceed deep (${deep.toFixed(4)})`);
  assert.ok(deep < 0.03, `deep lighting should be rare, got ${deep.toFixed(4)}`);
});

test("an occupied dungeon holds a lit, locked-off cluster by an entrance", () => {
  const t = tables();
  const occupiers = new Set(t.get("occupiers").entries.map((e) => e.value));
  let sawOccupied = 0;
  for (let s = 0; s < 400 && sawOccupied < 60; s++) {
    // Smugglers' tunnels has the highest occupation chance.
    const d = generateDungeon(t, mulberry32(s), { size: "Sizable", theme: "Smugglers' tunnels" });
    if (!d.occupation) continue;
    sawOccupied++;
    assert.ok(occupiers.has(d.occupation.by), "occupier from the table");
    assert.equal(d.occupation.level, 0);
    const held = new Set(d.occupation.rooms);
    assert.ok(held.size >= 1 && held.size < d.levels[0].rooms.length, "a frontier (not whole level)");
    // Held rooms are lit + tagged.
    for (const r of d.levels[0].rooms) {
      if (held.has(r.n)) {
        assert.equal(r.held, d.occupation.by);
        assert.ok(r.light, "held room is lit");
      }
    }
    // Every boundary edge is locked (never secret) and the level stays connected.
    for (const e of d.levels[0].layout.edges) {
      if (held.has(e.a) !== held.has(e.b)) assert.equal(e.type, "locked", "boundary is locked");
    }
  }
  assert.ok(sawOccupied > 20, `expected occupied dungeons, saw ${sawOccupied}`);
});

test("native-occupant themes are rarely occupied by interlopers", () => {
  const t = tables();
  let occ = 0;
  for (let s = 0; s < 300; s++) {
    if (generateDungeon(t, mulberry32(s), { size: "Sizable", theme: "Beast den" }).occupation) occ++;
  }
  assert.ok(occ / 300 < 0.15, `Beast den rarely occupied, got ${(occ / 300).toFixed(2)}`);
});

test("ctx.theme is honored for every level", () => {
  const t = tables();
  for (let s = 0; s < 50; s++) {
    const d = generateDungeon(t, mulberry32(s), { theme: "Mausoleum" });
    assert.equal(d.theme, "Mausoleum");
    assert.ok(d.levels.every((l) => l.theme === "Mausoleum"));
  }
});
