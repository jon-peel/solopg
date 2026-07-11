import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateFaction,
  promoteFaction,
  addHolding,
  advanceFactionTurn,
  advanceFactionDays,
  TURN_LENGTH_DAYS,
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

// --- Promote (8.8) --------------------------------------------------------

function promote(seed, q, r, n, by) {
  const t = tables();
  const rng = subRng(seed, "faction", q, r, n);
  return promoteFaction(t, rng, { q, r, index: n, seed, poiId: "poi:0", occupant: { by } });
}

test("promoteFaction maps a known occupier label to its archetype + disposition", () => {
  assert.equal(promote(1, 0, 0, 0, "Bandits").archetype, "bandits");
  assert.equal(promote(1, 0, 0, 0, "Bandits").disposition, "hostile");
  assert.equal(promote(1, 2, 2, 0, "Smugglers").archetype, "thieves' guild");
  assert.equal(promote(1, 2, 2, 0, "Cultists").archetype, "cult");
  assert.equal(promote(1, 2, 2, 0, "A hermit").archetype, "hermit order");
});

test("promoteFaction records the source POI as origin + its single holding", () => {
  const f = promote(9, 3, -4, 2, "Cultists");
  assert.deepEqual(f.origin, { fromPOI: { q: 3, r: -4, poiId: "poi:0" } });
  assert.equal(f.holdings.length, 1);
  assert.deepEqual(f.holdings[0], { q: 3, r: -4, poiId: "poi:0" });
});

test("an unmapped occupier (Refugees) still promotes — archetype rolled, disposition seeded", () => {
  const t = tables();
  const f = promote(4, 1, 1, 0, "Refugees");
  assert.ok(valuesOf("faction-archetype", t).has(f.archetype), "archetype rolled from the table");
  assert.equal(f.disposition, "friendly");
});

test("an entirely unknown label falls back to fully-rolled archetype + disposition", () => {
  const t = tables();
  const f = promote(4, 1, 1, 0, "Nobody in particular");
  assert.ok(valuesOf("faction-archetype", t).has(f.archetype));
  assert.ok(valuesOf("faction-disposition", t).has(f.disposition));
});

test("promoteFaction is deterministic and otherwise well-formed", () => {
  const a = promote(5, 2, 3, 1, "Bandits");
  const b = promote(5, 2, 3, 1, "Bandits");
  assert.deepEqual(a, b);
  assert.equal(a.build, FACTION_BUILD);
  assert.equal(a.goal.progress, 0);
  assert.deepEqual(a.clock, { turns: 0, sinceTurn: 0 });
  assert.equal(a.status, "active");
});

// --- Multiple holdings (8.9) ----------------------------------------------

test("addHolding appends a new holding and reports it added", () => {
  const f = make(1, 0, 0, 0);
  assert.equal(f.holdings.length, 1);
  const added = addHolding(f, { q: 5, r: -2 });
  assert.equal(added, true);
  assert.equal(f.holdings.length, 2);
  assert.deepEqual(f.holdings[1], { q: 5, r: -2 });
});

test("addHolding dedupes by (q,r) — same hex twice is a no-op", () => {
  const f = make(1, 0, 0, 0); // holding at (0,0)
  assert.equal(addHolding(f, { q: 0, r: 0 }), false);
  assert.equal(f.holdings.length, 1);
});

test("addHolding preserves poiId when supplied, omits it otherwise", () => {
  const f = make(1, 0, 0, 0);
  addHolding(f, { q: 1, r: 1, poiId: "poi:3" });
  addHolding(f, { q: 2, r: 2 });
  assert.deepEqual(f.holdings[1], { q: 1, r: 1, poiId: "poi:3" });
  assert.deepEqual(f.holdings[2], { q: 2, r: 2 });
});

test("addHolding dedupes by coords, not poiId — same poiId at a new hex still adds", () => {
  const f = make(1, 0, 0, 0);
  assert.equal(addHolding(f, { q: 1, r: 0, poiId: "poi:0" }), true);
  assert.equal(addHolding(f, { q: 2, r: 0, poiId: "poi:0" }), true);
  assert.equal(f.holdings.length, 3);
});

test("addHolding on one faction leaves another untouched", () => {
  const a = make(1, 0, 0, 0);
  const b = make(1, 9, 9, 1);
  addHolding(a, { q: 3, r: 3 });
  assert.equal(a.holdings.length, 2);
  assert.equal(b.holdings.length, 1);
});

// --- Faction turns (8.10) -------------------------------------------------

test("advanceFactionDays only fires a turn once a full turn-length has banked", () => {
  const f = make(1, 0, 0, 0);
  assert.equal(advanceFactionDays({ factions: [f] }, TURN_LENGTH_DAYS - 1, 1), 0);
  assert.equal(f.clock.turns, 0);
  assert.equal(f.clock.sinceTurn, TURN_LENGTH_DAYS - 1);
  // One more day tips it over → exactly one turn, remainder 0.
  assert.equal(advanceFactionDays({ factions: [f] }, 1, 1), 1);
  assert.equal(f.clock.turns, 1);
  assert.equal(f.clock.sinceTurn, 0);
});

test("advanceFactionDays fires multiple turns and carries the remainder", () => {
  const f = make(1, 0, 0, 0);
  const fired = advanceFactionDays({ factions: [f] }, 2 * TURN_LENGTH_DAYS + 3, 1);
  assert.equal(fired, 2);
  assert.equal(f.clock.turns, 2);
  assert.equal(f.clock.sinceTurn, 3); // remainder carried, not lost
});

test("the day accumulator carries across separate advances", () => {
  const f = make(1, 0, 0, 0);
  advanceFactionDays({ factions: [f] }, TURN_LENGTH_DAYS - 2, 1); // banked, no turn
  assert.equal(f.clock.turns, 0);
  advanceFactionDays({ factions: [f] }, 2, 1); // now crosses the line
  assert.equal(f.clock.turns, 1);
});

test("advanceFactionTurn fires one manual turn per active faction, sinceTurn untouched", () => {
  const a = make(1, 0, 0, 0);
  const b = make(1, 5, 5, 1);
  const before = { a: a.clock.sinceTurn, b: b.clock.sinceTurn };
  const n = advanceFactionTurn({ factions: [a, b] }, 1);
  assert.equal(n, 2);
  assert.equal(a.clock.turns, 1);
  assert.equal(b.clock.turns, 1);
  assert.equal(a.goal.progress, 1);
  // Manual turns are independent of the day clock.
  assert.equal(a.clock.sinceTurn, before.a);
  assert.equal(b.clock.sinceTurn, before.b);
});

test("goal progress ticks each turn and caps at max", () => {
  const f = make(1, 0, 0, 0);
  const max = f.goal.max;
  for (let i = 0; i < max + 3; i++) advanceFactionTurn({ factions: [f] }, 1);
  assert.equal(f.goal.progress, max); // never exceeds max
  assert.equal(f.clock.turns, max + 3); // but the turn counter keeps climbing
});

test("only active factions tick (dormant/destroyed are skipped)", () => {
  const a = make(1, 0, 0, 0); a.status = "dormant";
  const b = make(1, 5, 5, 1); b.status = "destroyed";
  const c = make(1, 9, 9, 2); // active
  assert.equal(advanceFactionTurn({ factions: [a, b, c] }, 1), 1);
  assert.equal(a.clock.turns, 0);
  assert.equal(b.clock.turns, 0);
  assert.equal(c.clock.turns, 1);
  assert.equal(advanceFactionDays({ factions: [a, b, c] }, TURN_LENGTH_DAYS, 1), 1); // only c
});

test("faction turns are deterministic for a given seed + state", () => {
  const run = () => {
    const f = make(1, 2, 3, 0);
    advanceFactionDays({ factions: [f] }, 5 * TURN_LENGTH_DAYS, 77);
    return f;
  };
  assert.deepEqual(run(), run());
});

test("disposition drift never leaves the scale", () => {
  const valid = new Set(["hostile", "wary", "neutral", "friendly"]);
  const f = make(1, 0, 0, 0);
  for (let i = 0; i < 200; i++) {
    advanceFactionTurn({ factions: [f] }, 1);
    assert.ok(valid.has(f.disposition), `disposition ${f.disposition} stays on the scale`);
  }
});

test("a faction created mid-timeline doesn't retroactively catch up", () => {
  const early = make(1, 0, 0, 0);
  const world = { factions: [early] };
  advanceFactionDays(world, 3 * TURN_LENGTH_DAYS, 1); // early has run a while
  const late = make(1, 5, 5, 1); // brand new: sinceTurn 0
  world.factions.push(late);
  advanceFactionDays(world, TURN_LENGTH_DAYS, 1); // one more turn-length for everyone
  assert.equal(early.clock.turns, 4); // 3 + 1
  assert.equal(late.clock.turns, 1); // only the days since it existed
});

test("factionLabel / factionDescription are pure functions of the picks", () => {
  const f = {
    name: "The Ashen Hand", archetype: "cult", disposition: "wary",
    goal: { kind: "spread the faith", progress: 2, max: 6 },
    strength: 3, holdings: [{ q: 0, r: 0 }], status: "active",
    clock: { turns: 1, sinceTurn: 3 },
  };
  assert.equal(factionLabel(f), "The Ashen Hand");
  const lines = factionDescription(f);
  assert.deepEqual(lines, [
    "Cult · wary",
    "Goal: spread the faith (2 / 6)",
    "1 holding · strength 3",
    `Turn 1 · 3/${TURN_LENGTH_DAYS} d to next`,
  ]);
  // Plural + a non-active status surface too.
  const f2 = { ...f, holdings: [{ q: 0, r: 0 }, { q: 1, r: 1 }], status: "dormant" };
  const lines2 = factionDescription(f2);
  assert.ok(lines2.includes("2 holdings · strength 3"));
  assert.ok(lines2.includes("Status: dormant"));
});
