// Phase 14.6 — GM paint / remove (manual culture anchors).
//
// Proves the plan's §1.2 framing ("GM paint is just a manual anchor; remove
// clears it. Mechanically identical to a town.") and the §5 non-negotiables this
// step calls out: Human is never stored (paint only writes real races; clear just
// removes an entry, it never writes a "human" marker); and a painted anchor
// actually changes the rendered/stamped field. World-model accessors
// (js/world/world.js) are tested directly; the field-threading (culture.js) is
// tested via the same pure functions Steps 2/3 already cover.

import { test } from "node:test";
import assert from "node:assert/strict";
import { axialKey } from "../js/core/hexgeo.js";
import { createWorld, setCultureAnchor, clearCultureAnchor, getCultureAnchors } from "../js/world/world.js";
import { RACE_SET } from "../js/gen/culture-data.js";
import {
  buildLivingField,
  cultureAt,
  stampSettlements,
  worldCultureAnchors,
} from "../js/gen/culture.js";

// --- helpers ----------------------------------------------------------------

/** A filled square of one terrain, axial coords [0..n) × [0..n). */
function fillSquare(n, terrain) {
  const m = new Map();
  for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) m.set(axialKey(q, r), terrain);
  return m;
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
// World-model accessors (js/world/world.js)
// ---------------------------------------------------------------------------

test("createWorld defaults cultureAnchors to [] (Phase 14.6)", () => {
  const w = createWorld({ name: "Fresh", seed: 1 });
  assert.deepEqual(w.cultureAnchors, []);
  assert.deepEqual(getCultureAnchors(w), []);
});

test("setCultureAnchor upserts by (q,r); getCultureAnchors round-trips", () => {
  const w = createWorld({ name: "Paint", seed: 1 });
  const ret = setCultureAnchor(w, 3, 4, "elf");
  assert.equal(ret, w, "mutates and returns the world");
  assert.deepEqual(getCultureAnchors(w), [{ q: 3, r: 4, race: "elf" }]);

  // Re-painting the SAME hex a different race upserts in place — never a duplicate.
  setCultureAnchor(w, 3, 4, "dwarf");
  assert.deepEqual(getCultureAnchors(w), [{ q: 3, r: 4, race: "dwarf" }]);

  // A second hex adds a second entry.
  setCultureAnchor(w, 5, 5, "gnome");
  assert.equal(getCultureAnchors(w).length, 2);
  assert.ok(getCultureAnchors(w).every((a) => RACE_SET.has(a.race)));
});

test("clearCultureAnchor removes only the matching anchor; an unknown coord is a no-op", () => {
  const w = createWorld({ name: "Paint", seed: 1 });
  setCultureAnchor(w, 1, 1, "halfling");
  setCultureAnchor(w, 2, 2, "gnome");

  const ret = clearCultureAnchor(w, 1, 1);
  assert.equal(ret, w, "mutates and returns the world");
  assert.deepEqual(getCultureAnchors(w), [{ q: 2, r: 2, race: "gnome" }]);

  clearCultureAnchor(w, 99, 99); // nothing there — no-op, no throw
  assert.equal(getCultureAnchors(w).length, 1);

  clearCultureAnchor(w, 2, 2);
  assert.deepEqual(getCultureAnchors(w), [], "clearing the last anchor leaves []");
});

test("clearCultureAnchor never writes a 'human' marker — clearing just removes the entry (§5 rule 4)", () => {
  const w = createWorld({ name: "Paint", seed: 1 });
  setCultureAnchor(w, 7, 7, "elf");
  clearCultureAnchor(w, 7, 7);
  assert.deepEqual(getCultureAnchors(w), []);
  assert.ok(!getCultureAnchors(w).some((a) => a.race === "human"), '"human" is never a stored race');
});

// ---------------------------------------------------------------------------
// A painted anchor is honoured by the field wherever `anchors` is threaded
// through (§ Step 6 acceptance: "an anchored hex reads as that race")
// ---------------------------------------------------------------------------

test("a painted anchor is honoured by buildLivingField immediately: the hex reads as that race", () => {
  const w = createWorld({ name: "Paint", seed: "pnt" });
  const terrain = fillSquare(20, "Plains"); // halfling-leaning; painting dwarf overrides it
  setCultureAnchor(w, 10, 10, "dwarf");
  const field = buildLivingField(w.seed, terrain, { anchors: getCultureAnchors(w) });
  assert.equal(cultureAt(field, 10, 10).race, "dwarf");
});

test("clearing a painted anchor removes its effect on the field", () => {
  const w = createWorld({ name: "Paint", seed: "pnt2" });
  const terrain = fillSquare(20, "Desert"); // very low natural density -> unlikely to self-seed
  setCultureAnchor(w, 10, 10, "elf");
  const painted = buildLivingField(w.seed, terrain, { anchors: getCultureAnchors(w) });
  assert.equal(cultureAt(painted, 10, 10).race, "elf");

  clearCultureAnchor(w, 10, 10);
  const cleared = buildLivingField(w.seed, terrain, { anchors: getCultureAnchors(w) });
  assert.notEqual(cultureAt(cleared, 10, 10).race, "elf");
});

// ---------------------------------------------------------------------------
// worldCultureAnchors: the combined-anchors helper (settlements + painted)
// ---------------------------------------------------------------------------

test("worldCultureAnchors merges stamped settlement anchors with painted anchors", () => {
  const w = createWorld({ name: "Combo", seed: "cmb" });
  w.hexes["1,1"] = {
    key: "1,1", coords: { q: 1, r: 1 }, placed: true, terrain: "Forest",
    settlement: { present: true, race: "elf", raceStamped: true },
  };
  w.hexes["2,2"] = {
    key: "2,2", coords: { q: 2, r: 2 }, placed: true, terrain: "Forest",
    settlement: { present: false }, // Human/no settlement -> contributes nothing
  };
  setCultureAnchor(w, 9, 9, "gnome");

  const anchors = worldCultureAnchors(w);
  assert.equal(anchors.length, 2);
  assert.ok(anchors.some((a) => a.q === 1 && a.r === 1 && a.race === "elf"), "settlement anchor present");
  assert.ok(anchors.some((a) => a.q === 9 && a.r === 9 && a.race === "gnome"), "painted anchor present");
});

test("worldCultureAnchors is [] for a fresh world (no placed hexes, no paint)", () => {
  const w = createWorld({ name: "Empty", seed: 1 });
  assert.deepEqual(worldCultureAnchors(w), []);
});

test("worldCultureAnchors ignores un-placed hexes and Human (raceless) settlements", () => {
  const w = createWorld({ name: "Combo2", seed: "cmb2" });
  w.hexes["u:0"] = { key: "u:0", placed: false, coords: null, settlement: { present: true, race: "elf" } };
  w.hexes["3,3"] = {
    key: "3,3", coords: { q: 3, r: 3 }, placed: true, terrain: "Plains",
    settlement: { present: true, raceStamped: true }, // Human town, no race
  };
  assert.deepEqual(worldCultureAnchors(w), []);
});

// ---------------------------------------------------------------------------
// Threading into stamping (syncCultures' path): stampSettlements' extraAnchors
// option must behave EXACTLY like an equivalent real settlement anchor (§1.2:
// "mechanically identical to a town").
// ---------------------------------------------------------------------------

test("stampSettlements' extraAnchors option pins the field identically to a real settlement anchor", () => {
  const n = 20;
  const build = () => {
    const hexes = [];
    for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) hexes.push(makeHex(q, r, "Forest", true));
    return hexes;
  };

  // Run A: a real, already-stamped dwarf settlement peg at (10,10).
  const runA = build();
  const pegA = runA.find((h) => h.coords.q === 10 && h.coords.r === 10);
  pegA.settlement.race = "dwarf";
  pegA.settlement.raceStamped = true;
  stampSettlements("parity", runA);

  // Run B: the same hex left UNSTAMPED, but the identical (q,r,race) supplied
  // as a painted extraAnchor instead.
  const runB = build();
  stampSettlements("parity", runB, { extraAnchors: [{ q: 10, r: 10, race: "dwarf" }] });

  // Every other hex reads the SAME field (same seed, terrain, and effective
  // anchor list either way) and rolls from the same (q,r,gen) sub-stream, so
  // every stamp outside the peg itself must match exactly.
  for (let i = 0; i < runA.length; i++) {
    const a = runA[i];
    const b = runB[i];
    if (a.coords.q === 10 && a.coords.r === 10) continue; // pre-frozen in A, freshly rolled in B
    assert.equal(a.settlement.race || null, b.settlement.race || null, `mismatch at ${a.key}`);
  }
});
