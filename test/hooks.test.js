import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateHook,
  hookName,
  hookDescription,
  bearingTo,
  rollHookPattern,
  chooseDistantTarget,
  startChain,
  buildChainStep,
  HOOK_BUILD,
} from "../js/gen/hooks.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";
import { axialDistance, axialLine } from "../js/core/hexgeo.js";

function tables() {
  const ids = ["hook-pattern", "hook-verb", "hook-source", "hook-accuracy", "hook-explore", "hook-threat", "hook-clue", "hook-payoff"];
  return new Map(
    ids.map((id) => [id, validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8")))]),
  );
}

const valuesOf = (t) => new Set(t.entries.map((e) => e.value));

// A couple of subjects around an origin, at known offsets.
function subjects() {
  return [
    { poiId: "poi:0", name: "Ruin — Troll lair", type: "dungeon", q: 2, r: -1, occupant: { kind: "lair", creature: "Troll" } },
    { poiId: "poi:1", name: "Old shrine", type: "shrine", q: 0, r: 3, occupant: { kind: "none" } },
    { poiId: "poi:2", name: "Bandit camp", type: "camp", q: -2, r: 1, occupant: { kind: "occupied", by: "Bandits" } },
  ];
}
const ORIGIN = { q: 0, r: 0 };

test("generateHook returns a well-formed Known hook drawn from the tables", () => {
  const t = tables();
  const verbs = valuesOf(t.get("hook-verb"));
  const sources = valuesOf(t.get("hook-source"));
  const accuracies = valuesOf(t.get("hook-accuracy"));
  const subs = subjects();
  const byId = new Map(subs.map((s) => [s.poiId, s]));
  for (let s = 0; s < 100; s++) {
    const h = generateHook(t, mulberry32(s), { subjects: subs, origin: ORIGIN, index: s });
    assert.equal(h.build, HOOK_BUILD);
    assert.equal(h.pattern, "known");
    assert.equal(h.id, `hook:${s}`);
    assert.equal(h.status, "open");
    assert.ok(verbs.has(h.verb));
    assert.ok(sources.has(h.source));
    assert.ok(accuracies.has(h.accuracy));
    // Subject is one of ours, and the true target is that subject's hex.
    const subj = byId.get(h.subject.poiId);
    assert.ok(subj, "subject is a provided POI");
    assert.equal(h.target.q, subj.q);
    assert.equal(h.target.r, subj.r);
    assert.equal(h.target.poiId, subj.poiId);
    // The claim comes from the verb's table.
    assert.ok(valuesOf(t.get(`hook-${h.verb}`)).has(h.claim));
  }
});

test("accuracy controls indicated vs target: off-by-one points at a neighbour", () => {
  const t = tables();
  const subs = subjects();
  let sawAccurate = false, sawOff = false, sawFalse = false;
  for (let s = 0; s < 400; s++) {
    const h = generateHook(t, mulberry32(s), { subjects: subs, origin: ORIGIN, index: s });
    const d = axialDistance(h.indicated.q, h.indicated.r, h.target.q, h.target.r);
    if (h.accuracy === "off-by-one") {
      sawOff = true;
      assert.equal(d, 1, "off-by-one indicated is exactly one hex from the true target");
    } else {
      assert.equal(d, 0, "accurate/false point straight at the true target");
      if (h.accuracy === "accurate") sawAccurate = true;
      else sawFalse = true;
    }
  }
  assert.ok(sawAccurate && sawOff && sawFalse, "all three accuracies appear over many seeds");
});

test("accuracy distribution leans reliable (accurate > off-by-one > false)", () => {
  const t = tables();
  const subs = subjects();
  const count = { accurate: 0, "off-by-one": 0, false: 0 };
  for (let s = 0; s < 600; s++) {
    const h = generateHook(t, mulberry32(s), { subjects: subs, origin: ORIGIN, index: s });
    count[h.accuracy]++;
  }
  assert.ok(count.accurate > count["off-by-one"], "more accurate than off-by-one");
  assert.ok(count["off-by-one"] > count.false, "more off-by-one than false");
});

test("generateHook is deterministic for a given seed + context", () => {
  const a = generateHook(tables(), mulberry32(13), { subjects: subjects(), origin: ORIGIN, index: 0 });
  const b = generateHook(tables(), mulberry32(13), { subjects: subjects(), origin: ORIGIN, index: 0 });
  assert.deepEqual(a, b);
});

test("forced verb + accuracy are honoured", () => {
  const t = tables();
  const h = generateHook(t, mulberry32(1), {
    subjects: subjects(), origin: ORIGIN, index: 0, verb: "threat", accuracy: "accurate",
  });
  assert.equal(h.verb, "threat");
  assert.equal(h.accuracy, "accurate");
  assert.ok(valuesOf(t.get("hook-threat")).has(h.claim));
});

test("generateHook returns null when there is nothing to point at", () => {
  assert.equal(generateHook(tables(), mulberry32(1), { subjects: [], origin: ORIGIN }), null);
});

test("proximity bias: a much nearer subject is chosen far more often", () => {
  const t = tables();
  const near = { poiId: "poi:near", name: "Near", type: "shrine", q: 1, r: 0, occupant: { kind: "none" } };
  const far = { poiId: "poi:far", name: "Far", type: "shrine", q: 20, r: 0, occupant: { kind: "none" } };
  let nearCount = 0;
  for (let s = 0; s < 300; s++) {
    const h = generateHook(t, mulberry32(s), { subjects: [near, far], origin: ORIGIN, index: s });
    if (h.subject.poiId === "poi:near") nearCount++;
  }
  assert.ok(nearCount > 250, `near subject dominates (got ${nearCount}/300)`);
});

test("bearingTo gives a sensible compass label (and null when coincident)", () => {
  assert.equal(bearingTo({ q: 0, r: 0 }, { q: 3, r: 0 }), "E");
  assert.equal(bearingTo({ q: 0, r: 0 }, { q: -3, r: 0 }), "W");
  assert.equal(bearingTo({ q: 0, r: 0 }, { q: 0, r: 0 }), null);
});

// --- 6.2: distant pattern ---------------------------------------------------

test("rollHookPattern never yields known without subjects (only known needs one)", () => {
  const t = tables();
  for (let s = 0; s < 100; s++) {
    // Distant and Map make their own target, so they're fine with no subjects;
    // only Known needs an existing POI, and it must fall back when there is none.
    assert.notEqual(rollHookPattern(t, mulberry32(s), false), "known");
  }
  // With subjects, all patterns appear over many seeds.
  const seen = new Set();
  for (let s = 0; s < 300; s++) seen.add(rollHookPattern(t, mulberry32(s), true));
  assert.deepEqual([...seen].sort(), ["chain", "distant", "known", "map"]);
});

test("chooseDistantTarget lands a free cell at the requested straight-line distance", () => {
  const origin = { q: 0, r: 0 };
  for (let s = 0; s < 200; s++) {
    const spot = chooseDistantTarget(mulberry32(s), origin, () => false, { minDistance: 2, maxDistance: 6 });
    assert.ok(spot, "found a spot on empty ground");
    assert.ok(spot.distance >= 2 && spot.distance <= 6);
    // Walking a straight axial direction, the hex distance equals the step count.
    assert.equal(axialDistance(origin.q, origin.r, spot.q, spot.r), spot.distance);
    // And a straight line yields a clean compass bearing.
    assert.ok(bearingTo(origin, spot));
  }
});

test("chooseDistantTarget avoids occupied cells, and gives up when boxed in", () => {
  const origin = { q: 0, r: 0 };
  // Everything occupied → null.
  assert.equal(chooseDistantTarget(mulberry32(1), origin, () => true), null);
  // Only one specific cell free: every returned spot must be unoccupied.
  const free = (q, r) => !(q === 0 && r === 0);
  for (let s = 0; s < 50; s++) {
    const spot = chooseDistantTarget(mulberry32(s), origin, (q, r) => !free(q, r));
    if (spot) assert.ok(free(spot.q, spot.r));
  }
});

test("a distant hook carries pattern + distance and points at its lone subject", () => {
  const t = tables();
  const subject = { poiId: "poi:0", name: "Tomb", type: "dungeon", q: 4, r: -4, occupant: { kind: "none" } };
  const h = generateHook(t, mulberry32(5), {
    subjects: [subject], origin: { q: 0, r: 0 }, index: 0, pattern: "distant", distance: 4,
  });
  assert.equal(h.pattern, "distant");
  assert.equal(h.distance, 4);
  assert.equal(h.subject.poiId, "poi:0");
  assert.equal(h.target.q, 4);
  assert.equal(h.target.r, -4);
  const lines = hookDescription(h);
  assert.match(lines[0], /Tomb, 4 hexes to the /);
});

test("a known hook's distance is derived from the geometry", () => {
  const subject = { poiId: "poi:0", name: "Ruin", type: "dungeon", q: 0, r: 3, occupant: { kind: "none" } };
  const h = generateHook(tables(), mulberry32(2), { subjects: [subject], origin: { q: 0, r: 0 }, index: 0 });
  assert.equal(h.pattern, "known");
  assert.equal(h.distance, 3);
});

// --- 6.3: map pattern (treasure maps) --------------------------------------

test("axialLine returns a contiguous straight run inclusive of both ends", () => {
  const line = axialLine(0, 0, 4, -4);
  assert.equal(line.length, 5); // distance 4 → 5 cells
  assert.deepEqual(line[0], { q: 0, r: 0 });
  assert.deepEqual(line[line.length - 1], { q: 4, r: -4 });
  for (let i = 1; i < line.length; i++) {
    assert.equal(axialDistance(line[i - 1].q, line[i - 1].r, line[i].q, line[i].r), 1, "each step is adjacent");
  }
  // A zero-length line is just the single cell.
  assert.deepEqual(axialLine(2, 2, 2, 2), [{ q: 2, r: 2 }]);
});

test("a map hook carries pattern, a path, and a charted-route description", () => {
  const t = tables();
  const origin = { q: 0, r: 0 };
  const subject = { poiId: "poi:0", name: "Tomb", type: "dungeon", q: 0, r: 4, occupant: { kind: "none" } };
  const path = axialLine(origin.q, origin.r, subject.q, subject.r);
  const h = generateHook(t, mulberry32(8), {
    subjects: [subject], origin, index: 0, pattern: "map", distance: 4, verb: "explore", path,
    source: "A map found below",
  });
  assert.equal(h.pattern, "map");
  assert.equal(h.verb, "explore");
  assert.deepEqual(h.path, path);
  assert.equal(h.source, "A map found below"); // ctx.source override honoured
  const lines = hookDescription(h);
  assert.match(lines[0], /^A map found below: a map marks Tomb, 4 hexes to the /);
});

test("a non-map hook has no path field", () => {
  const subject = { poiId: "poi:0", name: "Ruin", type: "dungeon", q: 0, r: 3, occupant: { kind: "none" } };
  const h = generateHook(tables(), mulberry32(2), { subjects: [subject], origin: { q: 0, r: 0 }, index: 0 });
  assert.equal("path" in h, false);
});

// --- 6.4: breadcrumb chains -------------------------------------------------

test("startChain builds a chain hook with a named prize and a first clue", () => {
  const t = tables();
  const clues = valuesOf(t.get("hook-clue"));
  const prizes = valuesOf(t.get("hook-payoff"));
  const origin = { q: 0, r: 0 };
  const target = { q: 3, r: 0, poiId: "poi:0" };
  const subject = { poiId: "poi:0", name: "Crypt", type: "dungeon" };
  for (let s = 0; s < 100; s++) {
    const h = startChain(t, mulberry32(s), { origin, target, subject, index: 0 });
    assert.equal(h.pattern, "chain");
    assert.equal(h.verb, "explore");
    assert.equal(h.chain.step, 1);
    assert.ok(h.chain.total >= 3 && h.chain.total <= 5);
    assert.ok(prizes.has(h.chain.prize), `prize ${h.chain.prize} from hook-payoff`);
    assert.deepEqual(h.target, target);
    assert.ok(clues.has(h.claim), `step-1 claim ${h.claim} is a clue`);
    assert.equal(h.distance, 3); // leg from origin to target
  }
});

test("buildChainStep carries an onward clue + this leg's bearing/distance", () => {
  const t = tables();
  const clues = valuesOf(t.get("hook-clue"));
  const legOrigin = { q: 0, r: 0 };
  const target = { q: 0, r: 4, poiId: "poi:1" };
  const step = buildChainStep(t, mulberry32(1), { legOrigin, target });
  assert.ok(clues.has(step.claim));
  assert.equal(step.distance, 4);
  // off-by-one nudges the indicated cell off the true target.
  const off = buildChainStep(t, mulberry32(1), { legOrigin, target, accuracy: "off-by-one" });
  assert.equal(axialDistance(off.indicated.q, off.indicated.r, target.q, target.r), 1);
});

test("startChain is deterministic for a given seed", () => {
  const args = { origin: { q: 0, r: 0 }, target: { q: 2, r: 1, poiId: "poi:0" }, subject: { poiId: "poi:0", name: "Tomb", type: "dungeon" }, index: 0 };
  const a = startChain(tables(), mulberry32(4), args);
  const b = startChain(tables(), mulberry32(4), args);
  assert.deepEqual(a, b);
});

test("chain prose: a lure names the prize up front and the payoff names it again", () => {
  const t = tables();
  const start = startChain(t, mulberry32(3), {
    origin: { q: 0, r: 0 }, target: { q: 0, r: 3, poiId: "poi:0" },
    subject: { poiId: "poi:0", name: "Tomb", type: "dungeon" }, index: 0, source: "An old map-seller",
  });
  assert.equal(hookName(start), "Hunt → Tomb");
  const sl = hookDescription(start);
  // Step 1 is the lure: it states the prize and points at the first site.
  assert.match(sl[0], new RegExp(`^An old map-seller: word of ${start.chain.prize.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} sets a trail — the first clue lies at Tomb,`));
  assert.match(sl[1], /^Clue 1 of [345]\.$/);

  // A mid-trail step shows the onward clue.
  const mid = hookDescription({ ...start, chain: { ...start.chain, step: 2 }, claim: "a worn inscription points onward" });
  assert.match(mid[0], /A worn inscription points onward — the trail leads on to Tomb,/);

  // The final step names the prize again.
  const finalHook = {
    pattern: "chain", verb: "explore", subject: { name: "Vault" }, source: "An old map-seller",
    target: { q: 0, r: 5 }, bearing: "S", distance: 2, accuracy: "accurate",
    claim: "ignored at the end", chain: { total: 3, step: 3, prize: "a dragon's hoard" },
  };
  const fl = hookDescription(finalHook);
  assert.match(fl[0], /the trail ends at Vault, .* — and a dragon's hoard with it\./);
  assert.match(fl[1], /Clue 3 of 3 — the prize\./);
});

test("hookName + hookDescription compose prose from the picks", () => {
  const base = {
    build: HOOK_BUILD, pattern: "known", verb: "explore",
    subject: { poiId: "poi:0", name: "Old shrine", type: "shrine" },
    origin: { q: 0, r: 0 }, indicated: { q: 0, r: 3 }, target: { q: 0, r: 3, poiId: "poi:0" },
    bearing: "S", accuracy: "accurate", claim: "a lost relic is said to lie hidden",
    source: "Tavern talk", status: "open",
  };
  assert.equal(hookName(base), "Explore: Old shrine");
  const lines = hookDescription(base);
  assert.equal(lines[0], "Tavern talk: A lost relic is said to lie hidden at Old shrine to the south.");
  assert.match(lines[1], /directions hold true/);

  // off-by-one reveals the true target to the GM.
  const off = hookDescription({ ...base, accuracy: "off-by-one", indicated: { q: 1, r: 2 } });
  assert.match(off[1], /a hex off/);
  assert.match(off[1], /\(0, 3\)/);

  // false reads as a dead end.
  const bad = hookDescription({ ...base, accuracy: "false" });
  assert.match(bad[1], /false lead/);
});
