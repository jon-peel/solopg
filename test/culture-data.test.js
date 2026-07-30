import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RACES,
  RACE_SET,
  RACE_LABELS,
  CULTURE_DENSITY,
  CULTURE_EPSILON,
  TERRAIN_RACE_WEIGHTS_BASE,
  TERRAIN_RACE_WEIGHTS,
  CULTURE_COLORS,
  RACE_JOIN,
  RACE_NAME_POOLS,
} from "../js/gen/culture-data.js";

const HEX = /^#[0-9a-f]{6}$/i;
const LAND_TERRAINS = ["Forest", "Hills", "Mountains", "Plains", "Swamp", "Desert"];
const POOL_KEYS = ["prefixes", "suffixes", "nouns", "regionNouns", "tavernWords", "heritage"];

// --- Race registry (§5: Human is null — never a race value) ----------------

test("RACES: exactly the four BX/OSE demihuman peoples; human is never one of them", () => {
  assert.deepEqual([...RACES].sort(), ["dwarf", "elf", "gnome", "halfling"]);
  assert.equal(RACES.length, 4);
  assert.ok(!RACES.includes("human"), "human must never appear in the race registry");
  assert.ok(!RACE_SET.has("human"));
  for (const r of RACES) assert.ok(RACE_SET.has(r));
});

test("RACE_LABELS: a display label for every race, and none for human", () => {
  for (const r of RACES) assert.equal(typeof RACE_LABELS[r], "string");
  assert.equal(RACE_LABELS.human, undefined);
});

// --- Density & weights (§3) -------------------------------------------------

test("CULTURE_DENSITY: every land terrain sits in the low band the plan asks for; Water is zero", () => {
  // Tuned low (Phase 14.5) so a Huge world averages ~1-2 realms over <8% of the
  // map — assert the BAND and the intent, not brittle exact numbers.
  assert.equal(CULTURE_DENSITY.Water, 0);
  for (const t of LAND_TERRAINS) {
    assert.ok(
      CULTURE_DENSITY[t] > 0 && CULTURE_DENSITY[t] <= 0.15,
      `${t} density ${CULTURE_DENSITY[t]} should sit in the low band (0, 0.15]`,
    );
  }
  // Favoured terrains are likelier hosts than the marginal ones.
  assert.ok(CULTURE_DENSITY.Forest >= CULTURE_DENSITY.Plains);
  assert.ok(CULTURE_DENSITY.Mountains >= CULTURE_DENSITY.Desert);
});

test("TERRAIN_RACE_WEIGHTS_BASE: matches the plan's per-terrain weights (§3)", () => {
  assert.deepEqual(TERRAIN_RACE_WEIGHTS_BASE.Forest, { elf: 60, gnome: 8, halfling: 6, dwarf: 3 });
  assert.deepEqual(TERRAIN_RACE_WEIGHTS_BASE.Mountains, { dwarf: 55, gnome: 20, elf: 1, halfling: 1 });
  assert.deepEqual(TERRAIN_RACE_WEIGHTS_BASE.Hills, { gnome: 30, halfling: 30, dwarf: 15, elf: 3 });
  assert.deepEqual(TERRAIN_RACE_WEIGHTS_BASE.Plains, { halfling: 40, gnome: 5, elf: 3, dwarf: 2 });
  assert.deepEqual(TERRAIN_RACE_WEIGHTS_BASE.Swamp, { elf: 3, gnome: 3, dwarf: 2, halfling: 2 });
  assert.deepEqual(TERRAIN_RACE_WEIGHTS_BASE.Desert, { dwarf: 3, gnome: 2, halfling: 2, elf: 1 });
});

test("TERRAIN_RACE_WEIGHTS: epsilon floor — every race has a nonzero weight in every land terrain", () => {
  for (const t of LAND_TERRAINS) {
    for (const r of RACES) {
      assert.ok(TERRAIN_RACE_WEIGHTS[t][r] > 0, `${r} has zero (or missing) weight in ${t}`);
    }
  }
});

test("TERRAIN_RACE_WEIGHTS: equals base weight + CULTURE_EPSILON, exactly, for every terrain/race", () => {
  assert.ok(CULTURE_EPSILON > 0 && CULTURE_EPSILON < 1, "epsilon should be a small floor, not a dominant weight");
  for (const t of LAND_TERRAINS) {
    for (const r of RACES) {
      const base = TERRAIN_RACE_WEIGHTS_BASE[t][r] || 0;
      assert.ok(
        Math.abs(TERRAIN_RACE_WEIGHTS[t][r] - (base + CULTURE_EPSILON)) < 1e-9,
        `${t}.${r}: expected ${base + CULTURE_EPSILON}, got ${TERRAIN_RACE_WEIGHTS[t][r]}`,
      );
    }
  }
});

test("TERRAIN_RACE_WEIGHTS: a race absent from a terrain's base table still floors above zero (e.g. deep elves in the mountains)", () => {
  // Elf is the rarest in Mountains (weight 1) but never literally 0 anywhere.
  assert.ok(TERRAIN_RACE_WEIGHTS.Mountains.elf > 0);
  assert.ok(TERRAIN_RACE_WEIGHTS.Mountains.elf < TERRAIN_RACE_WEIGHTS.Mountains.dwarf, "still the least likely in its hostile terrain");
});

// --- Colours (§3) ------------------------------------------------------------

test("CULTURE_COLORS: valid, distinct hex colours for every race, none colliding with reserved marker colours", () => {
  const reserved = new Set(["#8a2418", "#e8493a", "#ff4fd8"]); // selection / hook target / party marker (poi-style.js)
  const seen = new Set();
  for (const r of RACES) {
    const c = CULTURE_COLORS[r];
    assert.match(c, HEX, `bad colour for ${r}: ${c}`);
    assert.ok(!reserved.has(c.toLowerCase()), `${r} colour ${c} collides with a reserved marker colour`);
    assert.ok(!seen.has(c), `duplicate colour ${c} shared by two races`);
    seen.add(c);
  }
});

// --- Join glyphs (§4) --------------------------------------------------------

test("RACE_JOIN: a chance+glyph entry for every race; halfling/gnome never join (always fuse clean)", () => {
  for (const r of RACES) {
    const j = RACE_JOIN[r];
    assert.ok(j && typeof j.chance === "number" && typeof j.glyph === "string", `no join style for ${r}`);
    assert.ok(j.chance >= 0 && j.chance <= 1);
  }
  assert.equal(RACE_JOIN.halfling.chance, 0);
  assert.equal(RACE_JOIN.gnome.chance, 0);
  assert.ok(RACE_JOIN.elf.chance > 0 && RACE_JOIN.elf.glyph === "'");
  assert.ok(RACE_JOIN.dwarf.chance > 0 && RACE_JOIN.dwarf.glyph === "-");
});

// --- Name pools (§4) ----------------------------------------------------------

test("RACE_NAME_POOLS: human is absent — there is no human pool bundle to look up", () => {
  assert.equal(RACE_NAME_POOLS.human, undefined);
});

test("RACE_NAME_POOLS: every race has all six pools, each generously stocked with unique, non-empty strings", () => {
  for (const r of RACES) {
    const pools = RACE_NAME_POOLS[r];
    assert.ok(pools, `no pool bundle for ${r}`);
    for (const key of POOL_KEYS) {
      const arr = pools[key];
      assert.ok(Array.isArray(arr), `${r}.${key} is not an array`);
      assert.ok(arr.length >= 15, `${r}.${key} has only ${arr.length} entries (want >= 15)`);
      for (const entry of arr) {
        assert.equal(typeof entry, "string", `${r}.${key} has a non-string entry`);
        assert.ok(entry.length > 0, `${r}.${key} has an empty entry`);
      }
      assert.equal(new Set(arr).size, arr.length, `${r}.${key} has duplicate entries`);
    }
  }
});

test("RACE_NAME_POOLS: dwarf suffixes include the plan's signature endings (-grim/-dûr/-hold/-forge)", () => {
  const s = RACE_NAME_POOLS.dwarf.suffixes;
  for (const ending of ["grim", "dûr", "hold", "forge"]) assert.ok(s.includes(ending), `missing dwarf ending "${ending}"`);
});

test("RACE_NAME_POOLS: gnome suffixes include the plan's signature endings (-wick/-cog/-dell)", () => {
  const s = RACE_NAME_POOLS.gnome.suffixes;
  for (const ending of ["wick", "cog", "dell"]) assert.ok(s.includes(ending), `missing gnome ending "${ending}"`);
});

test("RACE_NAME_POOLS: halfling suffixes include the plan's homely endings (-borough/-hollow/-wick)", () => {
  const s = RACE_NAME_POOLS.halfling.suffixes;
  for (const ending of ["borough", "hollow", "wick"]) assert.ok(s.includes(ending), `missing halfling ending "${ending}"`);
});

test("RACE_NAME_POOLS: heritage descriptors read as builder flavour, race-tagged", () => {
  for (const r of RACES) {
    const h = RACE_NAME_POOLS[r].heritage;
    assert.ok(h.length >= 15);
    // At least a good chunk explicitly name-check the race (e.g. "elf-wrought"),
    // per §4's "elf-wrought / dwarf-delved" example.
    const tagged = h.filter((d) => d.toLowerCase().includes(r));
    assert.ok(tagged.length > 0, `no ${r}-tagged heritage descriptor (e.g. "${r}-wrought")`);
  }
});
