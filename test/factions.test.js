import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateFaction,
  factionLabel,
  factionDescription,
  FACTION_BUILD,
} from "../js/gen/factions.js";
import { factionName } from "../js/gen/faction-name.js";
import { validateTable } from "../js/core/table.js";
import { subRng } from "../js/core/rng.js";

function tables() {
  const ids = ["faction-archetype", "faction-goal", "faction-disposition"];
  return new Map(
    ids.map((id) => [id, validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8")))]),
  );
}

const valuesOf = (id, t) => new Set(t.get(id).entries.map((e) => e.value));

// Build a faction the way the app does: a dedicated sub-stream keyed on
// (seed, "faction", q, r, index), plus the world seed + coords in ctx.
function make(seed, q, r, n, extra = {}) {
  const t = tables();
  const rng = subRng(seed, "faction", q, r, n);
  return generateFaction(t, rng, { q, r, index: n, seed, ...extra });
}

test("generateFaction returns a well-formed faction from the tables", () => {
  const t = tables();
  const f = make(123, 4, -2, 0);
  assert.equal(f.id, "faction:0");
  assert.equal(f.build, FACTION_BUILD);
  assert.ok(valuesOf("faction-archetype", t).has(f.archetype));
  assert.ok(valuesOf("faction-disposition", t).has(f.disposition));
  assert.ok(valuesOf("faction-goal", t).has(f.goal.kind));
  assert.equal(f.goal.progress, 0);
  assert.ok(f.goal.max >= 5 && f.goal.max <= 8, `goal.max ${f.goal.max} in 5..8`);
  assert.ok(f.strength >= 2 && f.strength <= 4, `strength ${f.strength} in 2..4`);
  assert.deepEqual(f.clock, { turns: 0, sinceTurn: 0 });
  assert.equal(f.origin, null);
  assert.equal(f.status, "active");
  assert.equal(typeof f.name, "string");
  assert.ok(f.name.length > 0);
});

test("the starting faction has exactly one holding, at the origin coords", () => {
  const f = make(7, 3, 5, 1);
  assert.equal(f.holdings.length, 1);
  assert.deepEqual(f.holdings[0], { q: 3, r: 5 });
});

test("a holding carries the POI id when one is supplied", () => {
  const f = make(7, 3, 5, 1, { poiId: "poi:2" });
  assert.deepEqual(f.holdings[0], { q: 3, r: 5, poiId: "poi:2" });
});

test("generation is deterministic — same (seed,q,r,n) → identical faction", () => {
  const a = make(999, -1, 2, 3);
  const b = make(999, -1, 2, 3);
  assert.deepEqual(a, b);
});

test("different index → a different faction stream (and usually a different name)", () => {
  const a = make(999, 0, 0, 0);
  const b = make(999, 0, 0, 1);
  assert.notEqual(a.id, b.id);
  // Names are seeded on the index, so they vary across a run of factions.
  const names = new Set([0, 1, 2, 3, 4].map((n) => factionName(999, n)));
  assert.ok(names.size >= 3, `expected varied names, got ${[...names].join(", ")}`);
});

test("supplied archetype/disposition/name override the rolls (Promote seam, 8.8)", () => {
  const t = tables();
  const rng = subRng(1, "faction", 0, 0, 0);
  const f = generateFaction(t, rng, {
    q: 0, r: 0, index: 0, seed: 1,
    archetype: "bandits", disposition: "hostile", name: "The Red Company",
    origin: { fromPOI: { q: 0, r: 0, poiId: "poi:0" } },
  });
  assert.equal(f.archetype, "bandits");
  assert.equal(f.disposition, "hostile");
  assert.equal(f.name, "The Red Company");
  assert.deepEqual(f.origin, { fromPOI: { q: 0, r: 0, poiId: "poi:0" } });
});

test("factionName is deterministic for a given (seed,n)", () => {
  assert.equal(factionName(42, 5), factionName(42, 5));
});

test("a noble house reads as a dynasty", () => {
  assert.match(factionName(3, 0, { archetype: "noble house" }), /^House /);
});

test("factionLabel / factionDescription are pure functions of the picks", () => {
  const f = {
    name: "The Ashen Hand", archetype: "cult", disposition: "wary",
    goal: { kind: "spread the faith", progress: 2, max: 6 },
    strength: 3, holdings: [{ q: 0, r: 0 }], status: "active",
  };
  assert.equal(factionLabel(f), "The Ashen Hand");
  const lines = factionDescription(f);
  assert.deepEqual(lines, [
    "Cult · wary",
    "Goal: spread the faith (2 / 6)",
    "1 holding · strength 3",
  ]);
  // Plural + a non-active status surface too.
  const f2 = { ...f, holdings: [{ q: 0, r: 0 }, { q: 1, r: 1 }], status: "dormant" };
  const lines2 = factionDescription(f2);
  assert.ok(lines2.includes("2 holdings · strength 3"));
  assert.ok(lines2.includes("Status: dormant"));
});
