import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TERRAIN_PROFILE,
  DUNGEON_THEME_BIAS,
  profileFor,
  cappedSizeTable,
  poiTypeTable,
  dungeonThemeTable,
  SIZE_ORDER,
  KNOWN_TERRAINS,
  biasKey,
  isLargeSize,
  suppressLargeSizes,
  LARGE_SUPPRESSION,
} from "../js/gen/terrain-profile.js";
import { THEME_GLYPHS } from "../js/ui/poi-style.js";

const manifestThemes = new Set(
  JSON.parse(readFileSync("./data/dungeon-theme.json", "utf8")).entries.map(
    (e) => e.value,
  ),
);

const sizeTable = {
  id: "settlement-size",
  entries: SIZE_ORDER.map((size) => ({ value: { size } })),
};

test("Water allows no settlement", () => {
  assert.equal(TERRAIN_PROFILE.Water.settlement, null);
});

test("biasKey: Lake/Sea alias to Water; other terrains pass through unchanged (3R.4)", () => {
  assert.equal(biasKey("Lake"), "Water");
  assert.equal(biasKey("Sea"), "Water");
  assert.equal(biasKey("Forest"), "Forest");
  assert.equal(biasKey("Water"), "Water");
});

test("profileFor(Lake)/profileFor(Sea) share Water's profile (no settlement, same POI weights)", () => {
  assert.equal(profileFor("Lake"), TERRAIN_PROFILE.Water);
  assert.equal(profileFor("Sea"), TERRAIN_PROFILE.Water);
});

test("every styled terrain has a profile", () => {
  for (const t of KNOWN_TERRAINS) {
    assert.ok(profileFor(t), `missing profile for ${t}`);
  }
});

test("Desert caps at Town; Mountains/Swamp at Hamlet", () => {
  assert.equal(TERRAIN_PROFILE.Desert.settlement.maxSize, "Town");
  assert.equal(TERRAIN_PROFILE.Mountains.settlement.maxSize, "Hamlet");
  assert.equal(TERRAIN_PROFILE.Swamp.settlement.maxSize, "Hamlet");
});

test("isLargeSize: Town/City are large; Village and smaller are not", () => {
  assert.ok(isLargeSize("Town") && isLargeSize("City"));
  for (const s of ["Hamlet", "Village"]) assert.ok(!isLargeSize(s), `${s} is not large`);
});

test("Thorp is gone; Hamlet is the smallest tier", () => {
  assert.equal(SIZE_ORDER[0], "Hamlet");
  assert.ok(!SIZE_ORDER.includes("Thorp"));
  const table = JSON.parse(readFileSync("./data/settlement-size.json", "utf8"));
  assert.ok(!table.entries.some((e) => e.value.size === "Thorp"), "no Thorp in the size table");
});

test("shipped settlement-size skews small: Town+City ~10% of weight, Hamlet the majority (3R.6)", () => {
  const table = JSON.parse(readFileSync("./data/settlement-size.json", "utf8"));
  const w = Object.fromEntries(table.entries.map((e) => [e.value.size, e.weight]));
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  const largeFrac = (w.Town + w.City) / total;
  assert.ok(largeFrac >= 0.08 && largeFrac <= 0.12, `large weight fraction ${largeFrac} outside 8–12%`);
  assert.ok(w.Hamlet / total > 0.5, "Hamlet (smallest tier) should be the majority");
});

test("suppressLargeSizes scales only large weights by factor**count, never mutating or zeroing", () => {
  const base = cappedSizeTable(sizeTable, "City"); // full [Thorp..City], weight 1 each here
  const snapshot = JSON.parse(JSON.stringify(base));
  const out = suppressLargeSizes(base, 2);
  const bw = Object.fromEntries(base.entries.map((e) => [e.value.size, e.weight ?? 1]));
  const ow = Object.fromEntries(out.entries.map((e) => [e.value.size, e.weight ?? 1]));
  for (const s of ["Thorp", "Hamlet", "Village"]) assert.equal(ow[s], bw[s], `${s} weight changed`);
  for (const s of ["Town", "City"]) {
    assert.ok(Math.abs(ow[s] - bw[s] * LARGE_SUPPRESSION ** 2) < 1e-9, `${s} not scaled`);
    assert.ok(ow[s] > 0, `${s} weight must stay > 0 (clustering possible, just rare)`);
  }
  assert.deepEqual(base, snapshot); // input untouched
  assert.equal(suppressLargeSizes(base, 0), base); // no-op at count 0
});

test("cappedSizeTable excludes oversized sizes and never mutates base", () => {
  const snapshot = JSON.parse(JSON.stringify(sizeTable));
  const capped = cappedSizeTable(sizeTable, "Town");
  const sizes = capped.entries.map((e) => e.value.size);
  assert.deepEqual(sizes, ["Hamlet", "Village", "Town"]);
  assert.ok(!sizes.includes("City"));
  assert.deepEqual(sizeTable, snapshot); // unchanged
});

test("Water POI weights exclude dungeon (no explorable on open water)", () => {
  const types = Object.keys(TERRAIN_PROFILE.Water.poi.weights);
  assert.ok(!types.includes("dungeon"), "Water should not auto-roll a dungeon");
});

test("dungeon is an allowed POI type on every land terrain", () => {
  for (const [terrain, p] of Object.entries(TERRAIN_PROFILE)) {
    if (terrain === "Water") continue;
    assert.ok(p.poi.weights.dungeon > 0, `${terrain} should allow dungeons`);
  }
});

test("the merged explorable types are gone (ruin/cave/mine are themes now)", () => {
  for (const p of Object.values(TERRAIN_PROFILE)) {
    for (const gone of ["ruin", "cave", "mine"]) {
      assert.equal(p.poi.weights[gone], undefined, `${gone} should be a theme, not a type`);
    }
  }
});

test("poiTypeTable builds weighted entries from the profile", () => {
  const t = poiTypeTable("Mountains");
  const values = t.entries.map((e) => e.value);
  assert.ok(values.includes("dungeon") && values.includes("tower"));
  assert.ok(t.entries.every((e) => typeof e.weight === "number"));
});

test("dungeonThemeTable uses only themes that exist in the manifest", () => {
  for (const terrain of [...KNOWN_TERRAINS, "Unknown"]) {
    for (const e of dungeonThemeTable(terrain).entries) {
      assert.ok(manifestThemes.has(e.value), `${terrain}: ${e.value} not in manifest`);
      assert.ok(typeof e.weight === "number");
    }
  }
});

test("every DUNGEON_THEME_BIAS theme is a known manifest theme", () => {
  for (const [terrain, themes] of Object.entries(DUNGEON_THEME_BIAS)) {
    for (const theme of Object.keys(themes)) {
      assert.ok(manifestThemes.has(theme), `${terrain}: ${theme} not in manifest`);
    }
  }
});

test("every manifest theme has a glyph", () => {
  for (const theme of manifestThemes) {
    assert.ok(THEME_GLYPHS[theme], `no glyph for theme ${theme}`);
  }
});
