import { test } from "node:test";
import assert from "node:assert/strict";
import { axialKey, axialDistance, parseKey } from "../js/core/hexgeo.js";
import { RACES, RACE_SET, TERRAIN_RACE_WEIGHTS, CULTURE_COLORS } from "../js/gen/culture-data.js";
import {
  buildLivingField,
  buildHeritageField,
  cultureAt,
  heritageAt,
  computeCultureCores,
  listCultures,
  LIVING_CFG,
  HERITAGE_CFG,
  CULTURE_COLORS as CULTURE_COLORS_REEXPORT,
} from "../js/gen/culture.js";

// --- helpers ----------------------------------------------------------------

/** A filled square of one terrain, axial coords [0..n) × [0..n). */
function fillSquare(n, terrain, order = "rowmajor") {
  const entries = [];
  for (let q = 0; q < n; q++) for (let r = 0; r < n; r++) entries.push([axialKey(q, r), terrain]);
  if (order === "reverse") entries.reverse();
  return new Map(entries);
}

/** A stable, comparable dump of a field's raw strengths (order-independent). */
function dumpField(field) {
  return [...field.strengthByKey.entries()]
    .map(([k, e]) => `${k}|${e.race}|${e.strength.toFixed(9)}|${e.srcId}`)
    .sort()
    .join("\n");
}

/** Fraction of placed hexes the LIVING field claims for a demihuman culture. */
function claimedFraction(field, terrainByKey) {
  let claimed = 0;
  for (const k of terrainByKey.keys()) {
    const { q, r } = parseKey(k);
    if (cultureAt(field, q, r).race) claimed++;
  }
  return claimed / terrainByKey.size;
}

// ---------------------------------------------------------------------------
// §5 rule 1 — No entity-to-entity influence (pure fn of seed/terrain/anchors;
//             no chaining). EXPLICIT TEST.
// ---------------------------------------------------------------------------

test("§5.1 no entity-to-entity influence: a far source never alters another's field (no chaining)", () => {
  const big = fillSquare(60, "Forest");
  const a = buildLivingField("z", big, { anchors: [{ q: 10, r: 10, race: "elf" }] });
  const ab = buildLivingField("z", big, {
    anchors: [{ q: 10, r: 10, race: "elf" }, { q: 50, r: 50, race: "dwarf" }],
  });
  // Every hex within A's neighbourhood must read identically with or without the
  // distant B — B cannot "reach" or amplify A. This is the anti-chaining guard.
  for (const [k, e] of a.strengthByKey) {
    const { q, r } = parseKey(k);
    if (axialDistance(q, r, 10, 10) > LIVING_CFG.MAX_R) continue;
    const e2 = ab.strengthByKey.get(k);
    assert.ok(e2, `hex ${k} vanished when a far source was added`);
    assert.equal(e2.race, e.race);
    assert.equal(e2.strength, e.strength);
  }
});

test("§5.1 the field is a pure function of (seed, terrain, anchors) — and reacts to each of them", () => {
  const terr = fillSquare(30, "Forest");
  const anchors = [{ q: 5, r: 5, race: "gnome" }];
  // Same three inputs => identical output (no hidden state / call-order feed).
  assert.equal(dumpField(buildLivingField("A", terr, { anchors })), dumpField(buildLivingField("A", terr, { anchors })));
  // Reacts to the anchors input: adding an anchor changes the field.
  const withMore = buildLivingField("A", terr, { anchors: [...anchors, { q: 24, r: 24, race: "dwarf" }] });
  assert.notEqual(dumpField(buildLivingField("A", terr, { anchors })), dumpField(withMore));
  // Reacts to the seed input: cores vary across seeds (the seed-driven part).
  const coreSigs = new Set();
  for (let i = 0; i < 60; i++) {
    coreSigs.add(computeCultureCores("seed" + i, terr).map((c) => c.originKey + ":" + c.race).join("|"));
  }
  assert.ok(coreSigs.size > 1, "different seeds must be able to produce different cores");
});

// ---------------------------------------------------------------------------
// §5 rule 2 — Bounded reach (monotone decay; a culture can NEVER cover the map).
//             EXPLICIT TEST.
// ---------------------------------------------------------------------------

test("§5.2 bounded reach: a single source on a large single-terrain map claims a small fraction, never the whole map", () => {
  const N = 41; // 1681 hexes, all favoured terrain for an elf
  const terr = fillSquare(N, "Forest");
  const mid = (N - 1) >> 1;
  const field = buildLivingField("s", terr, { anchors: [{ q: mid, r: mid, race: "elf" }] });
  const frac = claimedFraction(field, terr);
  assert.ok(frac > 0, "the culture exists");
  assert.ok(frac < 0.25, `claimed fraction ${frac.toFixed(3)} must stay well under 100% (bounded reach)`);
  // The far corners are Human (null), never claimed.
  assert.equal(cultureAt(field, 0, 0).race, null);
  assert.equal(cultureAt(field, N - 1, N - 1).race, null);
});

test("§5.2 bounded reach holds even for naturally-seeded cores across many seeds", () => {
  const N = 41;
  const terr = fillSquare(N, "Forest");
  for (let i = 0; i < 40; i++) {
    const field = buildLivingField("world" + i, terr);
    assert.ok(claimedFraction(field, terr) < 0.5, "cores can never blanket the map");
  }
});

test("§5.2 monotone decay: strength is non-increasing with distance from the source", () => {
  const N = 31;
  const terr = fillSquare(N, "Forest");
  const mid = (N - 1) >> 1;
  const field = buildLivingField("m", terr, { anchors: [{ q: mid, r: mid, race: "elf" }] });
  // Max strength within each distance ring must not rise as the ring grows.
  const ringMax = [];
  for (const [k, e] of field.strengthByKey) {
    const { q, r } = parseKey(k);
    const d = axialDistance(q, r, mid, mid);
    ringMax[d] = Math.max(ringMax[d] ?? 0, e.strength);
  }
  assert.equal(ringMax[0], LIVING_CFG.S0, "source hex is at full strength");
  for (let d = 1; d < ringMax.length; d++) {
    if (ringMax[d] === undefined) continue;
    assert.ok(ringMax[d] <= ringMax[d - 1] + 1e-12, `ring ${d} max (${ringMax[d]}) exceeded ring ${d - 1}`);
  }
  // ...and strictly decays near the source (decay factor < 1).
  assert.ok(ringMax[1] < ringMax[0], "strength strictly drops one step out");
});

// ---------------------------------------------------------------------------
// §5 rule 3 — Order independence. EXPLICIT TEST.
// ---------------------------------------------------------------------------

test("§5.3 order independence: same terrain set in two key orders yields identical fields", () => {
  const forward = fillSquare(24, "Forest", "rowmajor");
  const reverse = fillSquare(24, "Forest", "reverse");
  const anchors = [{ q: 3, r: 20, race: "halfling" }];
  const f1 = buildLivingField("seed", forward, { anchors });
  const f2 = buildLivingField("seed", reverse, { anchors });
  assert.equal(dumpField(f1), dumpField(f2), "field values must not depend on insertion order");
  assert.deepEqual(listCultures(f1), listCultures(f2), "culture summaries must match too");
});

test("§5.3 order independence extends to heritage and to naturally-seeded cores", () => {
  // Mixed terrain so real cores are derived from regions, not just anchors.
  const forward = new Map();
  for (let q = 0; q < 20; q++) for (let r = 0; r < 20; r++) {
    forward.set(axialKey(q, r), q < 10 ? "Mountains" : "Plains");
  }
  const reverse = new Map([...forward.entries()].reverse());
  assert.equal(dumpField(buildHeritageField("t", forward)), dumpField(buildHeritageField("t", reverse)));
  assert.deepEqual(
    computeCultureCores("t", forward).map((c) => c.originKey + ":" + c.race),
    computeCultureCores("t", reverse).map((c) => c.originKey + ":" + c.race),
  );
});

// ---------------------------------------------------------------------------
// §5 rule 4 — Determinism. EXPLICIT TEST.
// ---------------------------------------------------------------------------

test("§5.4 determinism: identical inputs give byte-identical fields across repeated calls", () => {
  const terr = fillSquare(28, "Hills");
  const anchors = [{ q: 4, r: 4, race: "gnome" }, { q: 20, r: 20, race: "dwarf" }];
  const runs = [];
  for (let i = 0; i < 4; i++) runs.push(dumpField(buildLivingField("d", terr, { anchors })));
  for (const r of runs) assert.equal(r, runs[0]);
  // computeCultureCores is deterministic too.
  assert.deepEqual(computeCultureCores("d", terr), computeCultureCores("d", terr));
});

// ---------------------------------------------------------------------------
// §5 rule 5 — Epsilon floor: every race possible in every land terrain.
// ---------------------------------------------------------------------------

test("§5.5 epsilon floor (weights): every race has a nonzero weight in every land terrain", () => {
  for (const t of ["Forest", "Mountains", "Hills", "Plains", "Swamp", "Desert"]) {
    for (const race of RACES) {
      assert.ok(TERRAIN_RACE_WEIGHTS[t][race] > 0, `${race} has zero weight in ${t}`);
    }
  }
});

test("§5.5 epsilon floor (core assignment): a single terrain seeds every race over enough seeds", () => {
  // A forest region hugely favours elves, but the epsilon floor means even the
  // long-odds dwarf-in-the-woods surfaces given enough seeds.
  const forest = fillSquare(6, "Forest"); // 36 hexes -> one region above minSize
  const seen = new Set();
  for (let i = 0; i < 600 && seen.size < RACES.length; i++) {
    for (const c of computeCultureCores("seed" + i, forest)) seen.add(c.race);
  }
  for (const race of RACES) assert.ok(seen.has(race), `${race} never surfaced as a forest core`);
});

// ---------------------------------------------------------------------------
// §5 rule 6 — Human is null (never a race value).
// ---------------------------------------------------------------------------

test("§5.6 Human is null: sub-threshold and unreached hexes return race null, never 'human'", () => {
  const N = 31;
  const terr = fillSquare(N, "Forest");
  const mid = (N - 1) >> 1;
  const field = buildLivingField("h", terr, { anchors: [{ q: mid, r: mid, race: "elf" }] });
  // Unreached far corner -> {race:null, strength:0}.
  assert.deepEqual(cultureAt(field, 0, 0), { race: null, strength: 0 });
  // A ring sitting just below THRESHOLD keeps its strength but reports race null.
  let sawSubThreshold = false;
  for (const [k, e] of field.strengthByKey) {
    const { q, r } = parseKey(k);
    const c = cultureAt(field, q, r);
    assert.notEqual(c.race, "human", "the string 'human' must never be a race value");
    if (e.strength < LIVING_CFG.THRESHOLD) {
      assert.equal(c.race, null, `sub-threshold hex ${k} must be Human (null)`);
      assert.equal(c.strength, e.strength, "sub-threshold strength is still reported (for naming)");
      sawSubThreshold = true;
    } else {
      assert.ok(RACE_SET.has(c.race));
    }
  }
  assert.ok(sawSubThreshold, "the fringe should contain sub-threshold (Human) hexes");
});

// ---------------------------------------------------------------------------
// Cores & density behaviour (§1.1, §3).
// ---------------------------------------------------------------------------

test("cores: water never seeds a culture; a demihuman forest core rolls a plausible race", () => {
  const sea = fillSquare(10, "Sea");
  assert.equal(computeCultureCores("x", sea).length, 0, "water bodies never seed cores");

  const forest = fillSquare(6, "Forest");
  let elfCores = 0;
  for (let i = 0; i < 100; i++) {
    for (const c of computeCultureCores("f" + i, forest)) {
      assert.ok(RACE_SET.has(c.race));
      assert.equal(c.terrain, "Forest");
      assert.ok(forest.has(c.originKey), "origin is a hex inside the region");
      if (c.race === "elf") elfCores++;
    }
  }
  assert.ok(elfCores > 0, "elves should dominate forest cores");
});

test("density: low-density swamp seeds far fewer cores than high-density forest", () => {
  const forest = fillSquare(6, "Forest"); // density 0.25
  const swamp = fillSquare(6, "Swamp"); // density 0.05
  let fCount = 0;
  let sCount = 0;
  for (let i = 0; i < 300; i++) {
    fCount += computeCultureCores("d" + i, forest).length;
    sCount += computeCultureCores("d" + i, swamp).length;
  }
  assert.ok(fCount > sCount * 2, `forest cores ${fCount} should far exceed swamp cores ${sCount}`);
});

// ---------------------------------------------------------------------------
// Anchor pinning (Step 3 will pass stored settlements; honoured here).
// ---------------------------------------------------------------------------

test("anchor pinning: an anchor of race R forces R at its hex, at full strength", () => {
  const terr = fillSquare(20, "Plains");
  const field = buildLivingField("p", terr, { anchors: [{ q: 8, r: 8, race: "elf" }] });
  const c = cultureAt(field, 8, 8);
  assert.equal(c.race, "elf", "the anchor hex belongs to the anchored race");
  assert.equal(c.strength, LIVING_CFG.S0, "the anchor pins full strength at its hex");
  // Without the anchor (and with no core landing there) the hex is Human.
  const bare = buildLivingField("p", terr);
  assert.equal(cultureAt(bare, 8, 8).race, null);
});

test("anchor pinning: an anchor raises its race over a competing neighbouring culture", () => {
  // Uniform mountains: a dwarf anchor claims the field; an elf anchor 3 hexes away
  // must still win ITS hex (full strength beats the dwarf's decayed reach there).
  const terr = fillSquare(30, "Mountains");
  const field = buildLivingField("c", terr, {
    anchors: [{ q: 15, r: 15, race: "dwarf" }, { q: 18, r: 15, race: "elf" }],
  });
  assert.equal(cultureAt(field, 18, 15).race, "elf", "the elf anchor pins elf at its own hex");
  assert.equal(cultureAt(field, 15, 15).race, "dwarf", "the dwarf anchor still holds its core");
});

// ---------------------------------------------------------------------------
// Heritage field (§1.1): wider reach than living, same cores.
// ---------------------------------------------------------------------------

test("heritage: reaches farther than the living field from the same source", () => {
  const N = 51;
  const terr = fillSquare(N, "Forest");
  const mid = (N - 1) >> 1;
  const anchors = [{ q: mid, r: mid, race: "elf" }];
  const living = buildLivingField("hz", terr, { anchors });
  const heritage = buildHeritageField("hz", terr, { anchors });

  const reach = (field) => {
    let max = 0;
    for (const [k, e] of field.strengthByKey) {
      const { q, r } = parseKey(k);
      if (e.strength >= field.cfg.THRESHOLD) max = Math.max(max, axialDistance(q, r, mid, mid));
    }
    return max;
  };
  const lr = reach(living);
  const hr = reach(heritage);
  assert.ok(hr > lr, `heritage reach ${hr} should exceed living reach ${lr}`);
  assert.ok(hr >= lr * 1.4, `heritage reach ${hr} should be markedly wider (~1.5–2×) than living ${lr}`);
  // heritageAt keeps a race even at faint strength (no threshold null-out).
  const faint = [...heritage.strengthByKey.values()].find((e) => e.strength < HERITAGE_CFG.THRESHOLD);
  if (faint) assert.ok(RACE_SET.has(faint.race), "heritage names a builder even at low strength");
});

// ---------------------------------------------------------------------------
// listCultures & re-exports.
// ---------------------------------------------------------------------------

test("listCultures: one entry per claiming culture, with race, peak, and extent", () => {
  const terr = fillSquare(40, "Forest");
  const field = buildLivingField("lc", terr, {
    anchors: [{ q: 8, r: 8, race: "elf" }, { q: 30, r: 30, race: "gnome" }],
  });
  const cultures = listCultures(field);
  const races = cultures.map((c) => c.race).sort();
  assert.deepEqual(races, ["elf", "gnome"]);
  for (const c of cultures) {
    assert.ok(RACE_SET.has(c.race));
    assert.ok(c.size >= 1 && c.keys.length === c.size, "extent hex count matches keys");
    assert.ok(c.peakStrength >= LIVING_CFG.THRESHOLD, "peak is a claimed hex");
    assert.ok(terr.has(c.peakKey) && terr.has(c.originKey));
  }
});

test("CULTURE_COLORS is re-exported from culture.js unchanged", () => {
  assert.equal(CULTURE_COLORS_REEXPORT, CULTURE_COLORS);
  for (const race of RACES) assert.match(CULTURE_COLORS_REEXPORT[race], /^#[0-9a-f]{6}$/i);
});

test("heritageAt/cultureAt accept a field and hex, returning {race, strength}", () => {
  const terr = fillSquare(12, "Hills");
  const lf = buildLivingField("api", terr, { anchors: [{ q: 6, r: 6, race: "gnome" }] });
  const hf = buildHeritageField("api", terr, { anchors: [{ q: 6, r: 6, race: "gnome" }] });
  const lc = cultureAt(lf, 6, 6);
  const hc = heritageAt(hf, 6, 6);
  assert.equal(lc.race, "gnome");
  assert.equal(hc.race, "gnome");
  assert.equal(typeof lc.strength, "number");
  assert.equal(typeof hc.strength, "number");
});
