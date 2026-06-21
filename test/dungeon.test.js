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
      assert.equal(st.up.level, st.down.level + 1, "stairs join adjacent levels");
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

test("an up-stair sits at the lower-level room nearest below its down-stair", () => {
  const t = tables();
  const centerOf = (d, lvl, n) => {
    const r = d.levels[lvl].layout.rooms.find((rr) => rr.n === n);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  for (let s = 0; s < 200; s++) {
    const d = generateDungeon(t, mulberry32(s), { size: "Sizable" });
    // Only check level-pairs with a single stair (unambiguous nearest).
    const byPair = new Map();
    for (const st of d.stairs) byPair.set(st.down.level, (byPair.get(st.down.level) || 0) + 1);
    for (const st of d.stairs) {
      if (byPair.get(st.down.level) !== 1) continue;
      const dc = centerOf(d, st.down.level, st.down.room);
      let nearest = null;
      let best = Infinity;
      for (const r of d.levels[st.up.level].layout.rooms) {
        const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        const dd = (c.x - dc.x) ** 2 + (c.y - dc.y) ** 2;
        if (dd < best) { best = dd; nearest = r.n; }
      }
      assert.equal(st.up.room, nearest, `stair not aligned (seed ${s}, level ${st.down.level})`);
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

test("ctx.theme is honored for every level", () => {
  const t = tables();
  for (let s = 0; s < 50; s++) {
    const d = generateDungeon(t, mulberry32(s), { theme: "Mausoleum" });
    assert.equal(d.theme, "Mausoleum");
    assert.ok(d.levels.every((l) => l.theme === "Mausoleum"));
  }
});
