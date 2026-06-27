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
  HOOK_BUILD,
} from "../js/gen/hooks.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";
import { axialDistance } from "../js/core/hexgeo.js";

function tables() {
  const ids = ["hook-pattern", "hook-verb", "hook-source", "hook-accuracy", "hook-explore", "hook-threat"];
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

test("rollHookPattern falls back to distant when there are no subjects", () => {
  const t = tables();
  for (let s = 0; s < 50; s++) {
    assert.equal(rollHookPattern(t, mulberry32(s), false), "distant");
  }
  // With subjects, both patterns appear over many seeds.
  const seen = new Set();
  for (let s = 0; s < 200; s++) seen.add(rollHookPattern(t, mulberry32(s), true));
  assert.deepEqual([...seen].sort(), ["distant", "known"]);
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
