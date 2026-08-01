import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEME_GLYPHS } from "../js/ui/poi-style.js";

const read = (id) => JSON.parse(readFileSync(`./data/${id}.json`, "utf8"));

test("every dungeon theme has a glyph and a family mapping", () => {
  const themes = read("dungeon-theme").entries.map((e) => e.value);
  const mapped = new Set(read("dungeon-family").entries.map((e) => e.value.theme));
  for (const theme of themes) {
    assert.ok(THEME_GLYPHS[theme], `theme "${theme}" has a THEME_GLYPHS entry`);
    assert.ok(mapped.has(theme), `theme "${theme}" has a dungeon-family mapping`);
  }
});

test("every family member has a tier 1-4 and every family has a string elite", () => {
  for (const e of read("monster-families").entries) {
    const fam = e.value;
    assert.equal(typeof fam.elite, "string", `${fam.family} elite is a string`);
    assert.ok(fam.members.length >= 4, `${fam.family} has a decent roster`);
    for (const m of fam.members) {
      assert.ok(Number.isInteger(m.tier) && m.tier >= 1 && m.tier <= 4, `${m.value} tier 1-4`);
      assert.ok(m.weight > 0 && typeof m.value === "string");
    }
  }
});

test("every family referenced by a theme exists in monster-families", () => {
  const families = new Set(read("monster-families").entries.map((e) => e.value.family));
  for (const e of read("dungeon-family").entries) {
    for (const f of e.value.families) {
      assert.ok(families.has(f.value), `family "${f.value}" (theme ${e.value.theme}) exists`);
    }
  }
});

test("Catacombs is a glyphed, family-mapped theme but NOT a rollable wilderness theme", () => {
  // Step 7: a monastery's underground reuses the dungeon interior with theme
  // "Catacombs". It needs a glyph and a family spread, but must NOT be added to
  // dungeon-theme.json — it must never surface as a rollable wilderness dungeon.
  assert.ok(THEME_GLYPHS.Catacombs, "Catacombs has a THEME_GLYPHS entry");
  const mapped = new Set(read("dungeon-family").entries.map((e) => e.value.theme));
  assert.ok(mapped.has("Catacombs"), "Catacombs has a dungeon-family mapping");
  const wildernessThemes = new Set(read("dungeon-theme").entries.map((e) => e.value));
  assert.equal(wildernessThemes.has("Catacombs"), false, "Catacombs is intentionally absent from dungeon-theme.json");
});
