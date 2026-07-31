// Phase 15 — cultural detail: settlement appearance, racial inscriptions, a POI's
// stamped local culture, and racial dungeon themes. The stamping logic
// (js/gen/culture.js) is pure, so it's exercised here without the DOM/table layer
// (shrine deities are covered in feature-detail.test.js, which has the tables).

import { test } from "node:test";
import assert from "node:assert/strict";
import { raceAppearance, raceInscription, stampSettlements, stampPois } from "../js/gen/culture.js";
import { RACE_APPEARANCE, RACE_INSCRIPTIONS } from "../js/gen/culture-data.js";

test("raceAppearance / raceInscription: from the race pool, deterministic, null for Human", () => {
  const a = raceAppearance(1, 0, 0, "dwarf");
  assert.ok(RACE_APPEARANCE.dwarf.includes(a));
  assert.equal(raceAppearance(1, 0, 0, "dwarf"), a); // deterministic
  assert.equal(raceAppearance(1, 0, 0, undefined), null); // Human = null

  const i = raceInscription(2, 3, 4, "poi:0", "elf");
  assert.ok(RACE_INSCRIPTIONS.elf.includes(i));
  assert.equal(raceInscription(2, 3, 4, "poi:0", "elf"), i); // deterministic
  assert.equal(raceInscription(2, 3, 4, "poi:0", undefined), null); // Human = null
});

test("stampSettlements bakes a racial appearance on a demihuman town (none for Human)", () => {
  let checked = 0;
  for (let s = 0; s < 40; s++) {
    const hex = { coords: { q: 0, r: 0 }, terrain: "Mountains", gen: 0, settlement: { present: true, size: "Hamlet" } };
    stampSettlements(s, [hex], { extraAnchors: [{ q: 0, r: 0, race: "dwarf" }] });
    if (hex.settlement.race === "dwarf") {
      assert.ok(RACE_APPEARANCE.dwarf.includes(hex.settlement.appearance), "dwarf town has a dwarf appearance");
      checked++;
    }
  }
  assert.ok(checked > 0, "the dwarf anchor stamps some dwarf towns");

  const human = { coords: { q: 9, r: 9 }, terrain: "Plains", gen: 0, settlement: { present: true, size: "Hamlet" } };
  stampSettlements(999, [human], {}); // culture-free -> Human
  assert.equal(human.settlement.race, undefined);
  assert.equal(human.settlement.appearance, undefined);
});

test("stampPois stamps cultureRace + inscription and biases a dungeon's theme to the builder race", () => {
  const mk = () => ({
    coords: { q: 0, r: 0 }, terrain: "Mountains", gen: 0,
    pois: [{ id: "poi:0", type: "dungeon", name: "Ruin", occupant: { kind: "none" }, detail: { theme: "Ruin" } }],
  });
  const themes = {};
  let insc = 0, cr = 0;
  for (let s = 0; s < 200; s++) {
    const hex = mk();
    stampPois(s, [hex], { extraAnchors: [{ q: 0, r: 0, race: "dwarf" }] });
    const p = hex.pois[0];
    themes[p.detail.theme] = (themes[p.detail.theme] || 0) + 1;
    if (p.detail.inscription) insc++;
    if (p.cultureRace === "dwarf") cr++;
  }
  // Dwarven works dominate: "Abandoned mine" is the most common re-rolled theme,
  // and the placeholder "Ruin" (not a Mountains theme) never survives.
  const top = Object.entries(themes).sort((a, b) => b[1] - a[1])[0][0];
  assert.equal(top, "Abandoned mine", "dwarf mountain dungeons lean to mines");
  assert.ok(!themes.Ruin, "the dungeon is always re-themed to a terrain-appropriate one");
  assert.ok(insc > 0, "in-culture POIs get a racial inscription");
  assert.ok(cr > 0, "in-culture POIs get a stamped cultureRace");

  // Frozen: a re-stamp never changes a resolved theme.
  const hex = mk();
  stampPois(7, [hex], { extraAnchors: [{ q: 0, r: 0, race: "dwarf" }] });
  const t1 = hex.pois[0].detail.theme;
  stampPois(7, [hex], { extraAnchors: [{ q: 0, r: 0, race: "dwarf" }] }); // heritageStamped -> skipped
  assert.equal(hex.pois[0].detail.theme, t1);
});

test("elf and dwarf lean to different dungeon themes (theme follows the race)", () => {
  const count = (race) => {
    const c = {};
    for (let s = 0; s < 250; s++) {
      const hex = { coords: { q: 0, r: 0 }, terrain: "Mountains", gen: 0,
        pois: [{ id: "poi:0", type: "dungeon", name: "Ruin", occupant: { kind: "none" }, detail: { theme: "Ruin" } }] };
      stampPois(s, [hex], { extraAnchors: [{ q: 0, r: 0, race }] });
      const t = hex.pois[0].detail.theme;
      c[t] = (c[t] || 0) + 1;
    }
    return c;
  };
  const dwarf = count("dwarf");
  const elf = count("elf");
  // Dwarves favour mines far more than elves do (elves get no mine boost).
  assert.ok((dwarf["Abandoned mine"] || 0) > (elf["Abandoned mine"] || 0), "dwarves mine more than elves");
  // Elves boost the wizard's sanctum; dwarves don't.
  assert.ok((elf["Wizard's sanctum"] || 0) > (dwarf["Wizard's sanctum"] || 0), "elves favour sanctums over dwarves");
});
