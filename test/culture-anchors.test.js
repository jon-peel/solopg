// Phase 14.3 — anchors & settlement stamping.
//
// Proves the tent-peg model (docs/plans/phase-14-cultures.md §1.2/§1.4 and the
// §5 non-negotiables): a new settlement is stamped with a race rolled against the
// living field, stored, and FROZEN; stored races feed back as anchors that pin the
// field; Human is the null case (never stored/"human"); and the stored race flows
// into naming. The stamping logic (js/gen/culture.js) is pure, so it's tested here
// without the DOM caller layer (app.js syncCultures just calls stampSettlements).

import { test } from "node:test";
import assert from "node:assert/strict";
import { axialKey, axialDistance } from "../js/core/hexgeo.js";
import { RACE_SET, RACE_NAME_POOLS } from "../js/gen/culture-data.js";
import {
  buildLivingField,
  cultureAt,
  stampSettlementRace,
  stampSettlements,
  settlementAnchors,
} from "../js/gen/culture.js";
import { settlementName } from "../js/gen/settlement-name.js";

// --- helpers ----------------------------------------------------------------

/** A filled square of one terrain, axial coords [0..n) × [0..n). */
function fillSquare(n, terrain) {
  const m = new Map();
  for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) m.set(axialKey(q, r), terrain);
  return m;
}

/** All axial hexes within `rad` of (cq,cr). */
function hexesWithin(cq, cr, rad) {
  const out = [];
  for (let dq = -rad; dq <= rad; dq++) {
    for (let dr = -rad; dr <= rad; dr++) {
      if (axialDistance(cq, cr, cq + dq, cr + dr) <= rad) out.push({ q: cq + dq, r: cr + dr });
    }
  }
  return out;
}

/** A placed hex, with or without a settlement, in the shape stampSettlements reads. */
function makeHex(q, r, terrain, settled) {
  return {
    key: axialKey(q, r),
    coords: { q, r },
    placed: true,
    terrain,
    gen: 0,
    settlement: settled ? { present: true, size: "Village" } : { present: false },
  };
}

// ---------------------------------------------------------------------------
// The stamping roll (§1.4)
// ---------------------------------------------------------------------------

test("a strong-culture hex stamps its field's race (elf near an elf anchor)", () => {
  const terrain = fillSquare(30, "Forest");
  const field = buildLivingField("s3a", terrain, { anchors: [{ q: 15, r: 15, race: "elf" }] });
  let elf = 0;
  let otherDemi = 0;
  let human = 0;
  for (const { q, r } of hexesWithin(15, 15, 2)) {
    const race = stampSettlementRace("s3a", q, r, 0, field);
    if (race) assert.ok(RACE_SET.has(race), `stamped race must be a real race, got ${race}`);
    if (race === "elf") elf++;
    else if (race) otherDemi++;
    else human++;
  }
  assert.ok(elf > 0, "strong-culture hexes do get stamped");
  assert.ok(elf >= otherDemi, "the field's dominant race dominates the stamps");
  // P_MAX < 1: even in a strong culture some towns stay Human (moved in later).
  assert.ok(human > 0, "a capped roll leaves some in-culture towns Human");
});

test("a hex the culture never reaches stays Human (null)", () => {
  const terrain = fillSquare(30, "Plains");
  const field = buildLivingField("s3b", terrain, { anchors: [{ q: 0, r: 0, race: "halfling" }] });
  // The far corner is well beyond the anchor's (and any core's) bounded reach.
  assert.equal(cultureAt(field, 29, 29).race, null);
  assert.equal(stampSettlementRace("s3b", 29, 29, 0, field), null);
});

// ---------------------------------------------------------------------------
// Anchors pin the field (§1.2)
// ---------------------------------------------------------------------------

test("a stored anchor pins the field: an anchored hex holds its race against the cores", () => {
  const terrain = fillSquare(24, "Forest"); // Forest cores lean elf, never dwarf-dominant here
  const q = 12;
  const r = 12;
  const noAnchor = buildLivingField("pin", terrain, {});
  const withDwarf = buildLivingField("pin", terrain, { anchors: [{ q, r, race: "dwarf" }] });
  // The anchor is a full-strength source; at its own hex it beats any core, so
  // the hex reads dwarf even though the surrounding forest cores would not.
  assert.equal(cultureAt(withDwarf, q, r).race, "dwarf");
  assert.notEqual(cultureAt(noAnchor, q, r).race, "dwarf");
});

test("settlementAnchors extracts stored settlement.race as [{q,r,race}] (Human contributes none)", () => {
  const hexes = [
    makeHex(1, 1, "Forest", true),
    makeHex(2, 2, "Forest", true), // Human town — no stored race
    makeHex(3, 3, "Forest", false), // no settlement
  ];
  hexes[0].settlement.race = "elf";
  assert.deepEqual(settlementAnchors(hexes), [{ q: 1, r: 1, race: "elf" }]);
});

// ---------------------------------------------------------------------------
// Frozen once stamped (§5 non-negotiable)
// ---------------------------------------------------------------------------

test("a stamped race is frozen: re-stamping with more terrain + anchors never changes a stored town", () => {
  const n = 16;
  const hexes = [];
  for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) hexes.push(makeHex(q, r, "Forest", true));
  stampSettlements("frz", hexes);
  const before = new Map(hexes.map((h) => [h.key, h.settlement.race])); // race or undefined
  for (const h of hexes) assert.equal(h.settlement.raceStamped, true, "every town is resolved");

  // Grow the world: append a distant, strongly-anchored second region and re-run.
  const grown = hexes.slice();
  for (let q = 40; q < 56; q++) {
    for (let r = 40; r < 56; r++) grown.push(makeHex(q, r, "Mountains", true));
  }
  // A dwarf peg to make the new region a strong culture that pins the re-derived field.
  const peg = grown.find((h) => h.coords.q === 48 && h.coords.r === 48);
  peg.settlement.race = "dwarf";
  peg.settlement.raceStamped = true;
  stampSettlements("frz", grown);

  // Every original town keeps its exact stamp — the field re-derive did not touch it.
  for (const h of hexes) {
    assert.equal(h.settlement.race, before.get(h.key), `stored race frozen for ${h.key}`);
    assert.equal(h.settlement.raceStamped, true);
  }
  // ...and the newly-added towns did get resolved (the pass isn't a no-op).
  assert.ok(grown.slice(hexes.length).every((h) => h.settlement.raceStamped === true));
});

// ---------------------------------------------------------------------------
// Naming reads the stored race (§4 wiring)
// ---------------------------------------------------------------------------

test("a stamped race flows into settlement naming", () => {
  const terrain = fillSquare(24, "Forest");
  const field = buildLivingField("nm", terrain, { anchors: [{ q: 12, r: 12, race: "elf" }] });
  // Near a strong anchor most stamps fire — take the first that lands a race.
  let stamped = null;
  for (const { q, r } of hexesWithin(12, 12, 2)) {
    const race = stampSettlementRace("nm", q, r, 0, field);
    if (race) { stamped = { q, r, race }; break; }
  }
  assert.ok(stamped, "expected at least one stamped town near a strong anchor");
  const { q, r, race } = stamped;
  const human = settlementName("nm", q, r, 0, { terrain: "Forest" });
  const named = settlementName("nm", q, r, 0, { terrain: "Forest", race });
  assert.notEqual(named, human, "the stored race changes the name");
  const prefixes = RACE_NAME_POOLS[race].prefixes;
  assert.ok(prefixes.some((p) => named.startsWith(p)), `"${named}" should use a ${race} prefix`);
});

// ---------------------------------------------------------------------------
// Full pass smoke: a seeded field of towns ends up with some stamped, mostly Human
// ---------------------------------------------------------------------------

test("stampSettlements: full pass stamps a culture, keeps the world mostly Human, round-trips anchors", () => {
  const n = 30;
  const hexes = [];
  for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) hexes.push(makeHex(q, r, "Forest", true));
  // One pre-stamped elf peg near the centre pins an elf cluster around it.
  const peg = hexes.find((h) => h.coords.q === 15 && h.coords.r === 15);
  peg.settlement.race = "elf";
  peg.settlement.raceStamped = true;

  stampSettlements("smoke", hexes);

  let demi = 0;
  let human = 0;
  for (const h of hexes) {
    assert.equal(h.settlement.raceStamped, true);
    if (h.settlement.race) {
      demi++;
      assert.ok(RACE_SET.has(h.settlement.race));
    } else {
      human++;
    }
  }
  assert.ok(demi > 0, "the elf peg's pinned field stamps some demihuman towns");
  assert.ok(human > demi, "the world stays mostly Human (low culture density)");

  // The peg pins an elf cluster in its immediate neighbourhood.
  let elfNearPeg = 0;
  for (const { q, r } of hexesWithin(15, 15, 1)) {
    const h = hexes.find((x) => x.coords.q === q && x.coords.r === r);
    if (h.settlement.race === "elf") elfNearPeg++;
  }
  assert.ok(elfNearPeg >= 2, "the elf peg pins an elf cluster");

  // Anchors reflect exactly the stored demihuman races.
  const anchors = settlementAnchors(hexes);
  assert.equal(anchors.length, demi);
  assert.ok(anchors.every((a) => RACE_SET.has(a.race)));
});
