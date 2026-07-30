// Phase 14.4 — POI heritage, stateless clusters, and heritage naming.
//
// Proves the model in docs/plans/phase-14-cultures.md §1.3–§1.5 and the §5
// non-negotiables the plan calls out for this step:
//   • FLOOR & neutrality — ~99.99% neutral far from any culture and outside a hot
//     patch; neutral overwhelmingly dominates a large culture-free map.
//   • P_MAX < 1 — even inside a strong culture / hot patch some POIs stay neutral.
//   • Stateless clusters — cluster coherence (adjacent POIs in one hot patch share
//     a race with high probability) comes ONLY from the shared latent noise, with
//     NO POI-to-POI influence; and stamping in two hex orders is identical.
//   • Determinism & frozen — re-running stampPois never changes a stored heritage.
//   • Human/neutral is null — absent heritage, never "human".
//   • Builder ≠ occupier — the descriptor names the builder; the flavour folds in
//     the current occupant ("An elf-wrought tower, now held by goblins.").
//
// The stamping logic (js/gen/culture.js) is pure, so it is tested here without the
// DOM caller layer (app.js syncCultures just calls stampPois after stampSettlements).

import { test } from "node:test";
import assert from "node:assert/strict";
import { axialKey, axialDistance, neighbors } from "../js/core/hexgeo.js";
import { RACE_SET, RACE_NAME_POOLS } from "../js/gen/culture-data.js";
import {
  buildHeritageField,
  rollPoiHeritage,
  poiHeritageChance,
  stampPois,
  heritagePoiText,
  heritageDescriptor,
  heritageProperName,
  patchRaceAt,
  POI_HERITAGE_CFG,
} from "../js/gen/culture.js";

// --- helpers ----------------------------------------------------------------

/** A filled square of one terrain, axial coords [0..n) × [0..n). */
function fillSquare(n, terrain) {
  const m = new Map();
  for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) m.set(axialKey(q, r), terrain);
  return m;
}

/** A placed hex carrying one POI, in the shape stampPois reads. */
function makeHexWithPoi(q, r, terrain, poi) {
  return { key: axialKey(q, r), coords: { q, r }, placed: true, terrain, pois: [poi] };
}

/** A minimal empty POI (no heritage yet). */
function barePoi(id = "poi:0", extra = {}) {
  return { id, type: "tower", name: "Tower", occupant: { kind: "none" }, detail: { flavor: "Long abandoned." }, ...extra };
}

// A field-like object standing in for "no culture reaches here" — strength 0
// everywhere, so heritage rides only on the FLOOR + the latent patch field.
const ZERO_FIELD = { at: () => ({ race: null, strength: 0 }) };

// ---------------------------------------------------------------------------
// FLOOR & neutrality (§1.3, §5)
// ---------------------------------------------------------------------------

test("far from culture and outside a hot patch, the fire chance is exactly FLOOR (~99.99% neutral)", () => {
  // With a zero field, poiHeritageChance == FLOOR wherever the patch is cold.
  let cold = 0;
  let hot = 0;
  for (let q = 0; q < 90; q++) {
    for (let r = 0; r < 90; r++) {
      const p = poiHeritageChance("floor-seed", q, r, ZERO_FIELD);
      if (p > POI_HERITAGE_CFG.FLOOR) hot++;
      else {
        cold++;
        assert.equal(p, POI_HERITAGE_CFG.FLOOR, `cold hex ${q},${r} must sit at FLOOR`);
      }
    }
  }
  assert.ok(POI_HERITAGE_CFG.FLOOR <= 0.001, "FLOOR must be tiny (a rare artifact anywhere)");
  assert.ok(cold > hot * 4, "the map is mostly cold (hot patches are rare)");
});

test("neutral overwhelmingly dominates a large culture-free map (patches included)", () => {
  let demi = 0;
  let neutral = 0;
  const n = 100;
  for (let q = 0; q < n; q++) {
    for (let r = 0; r < n; r++) {
      const race = rollPoiHeritage("neutral-seed", q, r, "poi:0", "Forest", ZERO_FIELD);
      if (race) { demi++; assert.ok(RACE_SET.has(race)); } else neutral++;
    }
  }
  // Hot patches raise the local rate, but overall neutrality must dominate hugely.
  assert.ok(neutral > demi * 9, `neutral must dominate: neutral=${neutral} demi=${demi}`);
});

// ---------------------------------------------------------------------------
// Proximity scaling & P_MAX < 1 (§1.3/§1.4)
// ---------------------------------------------------------------------------

test("the fire chance rises with heritage-field strength (proximity to a culture)", () => {
  const terrain = fillSquare(40, "Forest");
  const c = 20;
  const field = buildHeritageField("prox", terrain, { anchors: [{ q: c, r: c, race: "elf" }] });
  const near = poiHeritageChance("prox", c, c, field); // strength ≈ 1 at the anchor
  // strength ≈ 1 at the anchor, so the chance reflects (about) the full GAIN —
  // assert relative to the tuned GAIN, not a brittle absolute.
  assert.ok(
    near >= POI_HERITAGE_CFG.FLOOR + 0.8 * POI_HERITAGE_CFG.GAIN,
    `chance at a strong anchor should reflect GAIN, got ${near}`,
  );
  // A hex well beyond the heritage reach has strength 0, so its chance is the
  // patch-only chance — find a patch-cold one and confirm near ≫ it.
  let coldFar = null;
  for (let d = 60; d < 200 && !coldFar; d++) {
    if (poiHeritageChance("prox", c + d, c + d, field) === POI_HERITAGE_CFG.FLOOR) coldFar = c + d;
  }
  assert.ok(coldFar !== null, "expected a patch-cold hex far from the anchor");
  const far = poiHeritageChance("prox", coldFar, coldFar, field);
  assert.ok(
    near > far + 0.5 * POI_HERITAGE_CFG.GAIN,
    `proximity clearly lifts the chance (near ${near} vs far ${far})`,
  );
});

test("P_MAX < 1: even at a strong heritage core some POIs stay neutral", () => {
  assert.ok(POI_HERITAGE_CFG.P_MAX < 1, "P_MAX must be capped below 1");
  const terrain = fillSquare(40, "Forest");
  const c = 20;
  const field = buildHeritageField("pmax", terrain, { anchors: [{ q: c, r: c, race: "elf" }] });
  let neutral = 0;
  let fired = 0;
  // Many independent POIs on the single strongest hex — the cap must leave some neutral.
  for (let i = 0; i < 400; i++) {
    const race = rollPoiHeritage("pmax", c, c, `poi:${i}`, "Forest", field);
    if (race) fired++; else neutral++;
  }
  assert.ok(fired > 0, "a strong core does fire most of the time");
  assert.ok(neutral > 0, "P_MAX < 1 leaves some in-culture POIs neutral");
});

// ---------------------------------------------------------------------------
// Stateless clusters (§1.5, §5 non-negotiable #1)
// ---------------------------------------------------------------------------

test("clusters are coherent: adjacent POIs in one hot patch share a race, with NO POI-to-POI state", () => {
  // Uniform Forest, culture-free (zero field): every fired POI's race comes purely
  // from the shared latent noise (patchRaceAt) — never from a neighbour. Each roll
  // below is an independent pure call, so any agreement is structural, not chained.
  // Coherence is a property of the shared latent race field (patchRaceAt) — a pure
  // function of position — so adjacent hexes agree WITHOUT any cross-POI state.
  // Verifying it on the field directly is robust to how rarely a POI actually fires.
  const seed = "cluster";
  const N = 100;
  const hot = [];
  for (let q = 0; q < N; q++) {
    for (let r = 0; r < N; r++) {
      if (poiHeritageChance(seed, q, r, ZERO_FIELD) > POI_HERITAGE_CFG.FLOOR) hot.push([q, r]);
    }
  }
  assert.ok(hot.length > 20, `expected hot-patch hexes to exist, got ${hot.length}`);
  const raceAt = new Map(hot.map(([q, r]) => [axialKey(q, r), patchRaceAt(seed, q, r, "Forest")]));
  let agree = 0;
  let pairs = 0;
  for (const [q, r] of hot) {
    const a = raceAt.get(axialKey(q, r));
    for (const nb of neighbors(q, r)) {
      const nk = axialKey(nb.q, nb.r);
      if (!raceAt.has(nk)) continue; // stay within one hot patch
      pairs++;
      if (a === raceAt.get(nk)) agree++;
    }
  }
  assert.ok(pairs > 20, `expected plenty of adjacent in-patch pairs, got ${pairs}`);
  assert.ok(agree / pairs >= 0.8, `in-patch race coherence should be high, got ${(agree / pairs).toFixed(3)}`);
  // And the FIRE path draws from that same shared field, never from a neighbour:
  // whenever rollPoiHeritage fires in the culture-free zone, its race equals
  // patchRaceAt for that hex — independent of poiId (no chaining possible).
  let checked = 0;
  for (const [q, r] of hot) {
    for (let i = 0; i < 12 && checked < 30; i++) {
      const fired = rollPoiHeritage(seed, q, r, `poi:${i}`, "Forest", ZERO_FIELD);
      if (fired) { assert.equal(fired, raceAt.get(axialKey(q, r))); checked++; }
    }
  }
  assert.ok(checked > 0, "at least some POIs fired in hot patches to verify the fire path");
});

test("stamping in two different hex orders yields identical poi.heritage (order-independent)", () => {
  const build = () => {
    const hexes = [];
    for (let q = 0; q < 24; q++) for (let r = 0; r < 24; r++) hexes.push(makeHexWithPoi(q, r, "Forest", barePoi()));
    return hexes;
  };
  const forward = build();
  const reversed = build().reverse();
  stampPois("order", forward);
  stampPois("order", reversed);
  const key = (h) => axialKey(h.coords.q, h.coords.r);
  const map = new Map(reversed.map((h) => [key(h), h.pois[0]]));
  for (const h of forward) {
    const other = map.get(key(h));
    const a = h.pois[0];
    const b = other;
    assert.deepEqual(a.heritage, b.heritage, `heritage differs at ${key(h)} by order`);
    assert.equal(a.name, b.name, `name differs at ${key(h)} by order`);
    if (a.detail) assert.equal(a.detail.flavor, b.detail.flavor);
  }
});

// ---------------------------------------------------------------------------
// Determinism & frozen (§5 non-negotiable)
// ---------------------------------------------------------------------------

test("rollPoiHeritage is deterministic for a given (seed, q, r, poiId, terrain, field)", () => {
  const field = buildHeritageField("det", fillSquare(30, "Forest"), { anchors: [{ q: 15, r: 15, race: "elf" }] });
  for (const [q, r] of [[15, 15], [16, 15], [3, 27], [0, 0]]) {
    assert.equal(
      rollPoiHeritage("det", q, r, "poi:0", "Forest", field),
      rollPoiHeritage("det", q, r, "poi:0", "Forest", field),
    );
  }
});

test("a stamped heritage is frozen: re-running stampPois never changes it", () => {
  const hexes = [];
  for (let q = 0; q < 30; q++) for (let r = 0; r < 30; r++) hexes.push(makeHexWithPoi(q, r, "Forest", barePoi()));
  stampPois("frozen", hexes);
  const snap = hexes.map((h) => ({
    heritage: h.pois[0].heritage ? { ...h.pois[0].heritage } : undefined,
    name: h.pois[0].name,
    flavor: h.pois[0].detail && h.pois[0].detail.flavor,
    stamped: h.pois[0].heritageStamped,
  }));
  for (const s of snap) assert.equal(s.stamped, true, "every POI is resolved");

  // Grow the world with a strongly-anchored elf region + re-run; originals frozen.
  const grown = hexes.slice();
  for (let q = 60; q < 76; q++) for (let r = 60; r < 76; r++) grown.push(makeHexWithPoi(q, r, "Forest", barePoi()));
  stampPois("frozen", grown);
  for (let i = 0; i < hexes.length; i++) {
    const poi = hexes[i].pois[0];
    assert.deepEqual(poi.heritage, snap[i].heritage, `frozen heritage at ${hexes[i].key}`);
    assert.equal(poi.name, snap[i].name, `frozen name at ${hexes[i].key}`);
    assert.equal(poi.detail && poi.detail.flavor, snap[i].flavor);
  }
  assert.ok(grown.slice(hexes.length).every((h) => h.pois[0].heritageStamped === true), "new POIs got resolved");
});

// ---------------------------------------------------------------------------
// Human/neutral is null (§5 rule 4)
// ---------------------------------------------------------------------------

test("neutral POIs carry NO heritage (never 'human'); fired POIs carry a real race", () => {
  const hexes = [];
  for (let q = 0; q < 30; q++) for (let r = 0; r < 30; r++) hexes.push(makeHexWithPoi(q, r, "Forest", barePoi()));
  stampPois("null-case", hexes);
  let demi = 0;
  let neutral = 0;
  for (const h of hexes) {
    const poi = h.pois[0];
    assert.equal(poi.heritageStamped, true);
    if (poi.heritage) {
      demi++;
      assert.ok(RACE_SET.has(poi.heritage.race), `heritage race must be real, got ${poi.heritage.race}`);
      assert.notEqual(poi.heritage.race, "human");
    } else {
      neutral++;
      assert.equal(poi.heritage, undefined, "a neutral POI stores no heritage");
      assert.equal(poi.name, "Tower", "a neutral POI keeps its base name unchanged");
    }
  }
  assert.ok(neutral > demi, "the world stays mostly neutral (low heritage density)");
});

// ---------------------------------------------------------------------------
// Heritage naming / flavour, builder ≠ occupier (§1.3/§4)
// ---------------------------------------------------------------------------

test("heritagePoiText: names the builder; the flavour folds in the current occupier (builder ≠ occupier)", () => {
  const held = { id: "poi:0", type: "tower", name: "Tower — Goblins", occupant: { kind: "occupied", by: "Goblins" }, detail: {} };
  const t = heritagePoiText("nm", 1, 2, "poi:0", "elf", held);
  const descriptor = heritageDescriptor("nm", 1, 2, "poi:0", "elf");
  const properName = heritageProperName("nm", 1, 2, "poi:0", "elf");
  assert.ok(RACE_NAME_POOLS.elf.heritage.includes(descriptor), "descriptor from the elf heritage pool");
  // Name reads "<Proper>, an/a <descriptor> tower" (e.g. "Kaelthar, an elf-wrought tower").
  assert.equal(t.name, `${properName}, ${/^[aeiou]/i.test(descriptor) ? "an" : "a"} ${descriptor} tower`);
  assert.ok(t.name.startsWith(properName), "name leads with the builder's proper name");
  // Flavour keeps the BUILDER descriptor but now reads as held by the occupier.
  assert.ok(t.flavor.includes(descriptor), "flavour still names the builder");
  assert.ok(/now held by goblins\.$/.test(t.flavor), `flavour should fold in the occupier, got "${t.flavor}"`);
});

test("heritagePoiText: an unoccupied builder site reads as builders long gone; a lair reads as a lair", () => {
  const empty = { id: "poi:0", type: "tower", name: "Tower", occupant: { kind: "none" }, detail: {} };
  const lair = { id: "poi:0", type: "dungeon", name: "Ruin — Troll lair", occupant: { kind: "lair", creature: "Troll" }, detail: { theme: "Ruin" } };
  const te = heritagePoiText("nm2", 4, 5, "poi:0", "dwarf", empty);
  assert.ok(/, its builders long gone\.$/.test(te.flavor), te.flavor);
  const tl = heritagePoiText("nm2", 4, 5, "poi:0", "dwarf", lair);
  assert.ok(/now a lair of troll\.$/.test(tl.flavor), tl.flavor);
  // Dungeon base label is the theme, lowercased: "…-delved ruin".
  assert.ok(tl.name.toLowerCase().endsWith(" ruin"), `dungeon heritage name uses its theme, got "${tl.name}"`);
});

test("naming helpers are deterministic and race-scoped", () => {
  for (const race of ["elf", "dwarf", "halfling", "gnome"]) {
    assert.equal(heritageDescriptor("d", 2, 3, "poi:1", race), heritageDescriptor("d", 2, 3, "poi:1", race));
    assert.equal(heritageProperName("d", 2, 3, "poi:1", race), heritageProperName("d", 2, 3, "poi:1", race));
    assert.ok(RACE_NAME_POOLS[race].heritage.includes(heritageDescriptor("d", 2, 3, "poi:1", race)));
    const pn = heritageProperName("d", 2, 3, "poi:1", race);
    assert.ok(RACE_NAME_POOLS[race].prefixes.some((p) => pn.startsWith(p)), `${race} proper name "${pn}" uses its own prefix`);
  }
});

// ---------------------------------------------------------------------------
// Full pass smoke: stampPois surfaces some heritage, occasionally adjacent
// ---------------------------------------------------------------------------

test("stampPois: full pass surfaces heritage POIs, occasionally adjacent (a cluster), mostly neutral", () => {
  const n = 40;
  const hexes = [];
  for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) hexes.push(makeHexWithPoi(q, r, "Forest", barePoi()));
  // Seed a people so in-culture ruins reliably surface (and cluster) near them —
  // a settlement anchor is how stampPois learns of a culture. (At the tuned-low
  // rates, a culture-free map would surface only a handful world-wide.)
  const center = hexes.find((h) => h.coords.q === 20 && h.coords.r === 20);
  center.settlement = { present: true, size: "Town", race: "elf", raceStamped: true };
  stampPois("smoke", hexes);
  const byKey = new Map(hexes.map((h) => [h.key, h.pois[0]]));

  let demi = 0;
  for (const h of hexes) if (h.pois[0].heritage) demi++;
  assert.ok(demi > 0, "some heritage POIs surface");
  assert.ok(demi < hexes.length / 2, "the world stays mostly neutral");

  // At least one adjacent pair of same-race heritage POIs exists (a cluster).
  let clustered = false;
  for (const h of hexes) {
    const poi = h.pois[0];
    if (!poi.heritage) continue;
    for (const nb of neighbors(h.coords.q, h.coords.r)) {
      const other = byKey.get(axialKey(nb.q, nb.r));
      if (other && other.heritage && other.heritage.race === poi.heritage.race) { clustered = true; break; }
    }
    if (clustered) break;
  }
  assert.ok(clustered, "heritage POIs occasionally form a same-race cluster");
});
