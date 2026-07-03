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

test("cappedSizeTable excludes oversized sizes and never mutates base", () => {
  const snapshot = JSON.parse(JSON.stringify(sizeTable));
  const capped = cappedSizeTable(sizeTable, "Town");
  const sizes = capped.entries.map((e) => e.value.size);
  assert.deepEqual(sizes, ["Thorp", "Hamlet", "Village", "Town"]);
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
