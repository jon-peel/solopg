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
  HOLDING_CAP,
  factionLabel,
  factionDescription,
  factionHookContext,
  autoHookChance,
  rollAutoHookCount,
  AUTO_HOOK_CAP,
  FACTION_BUILD,
} from "../js/gen/factions.js";
import { factionName } from "../js/gen/faction-name.js";
import { validateTable } from "../js/core/table.js";
import { subRng } from "../js/core/rng.js";
import { neighbors, axialKey } from "../js/core/hexgeo.js";

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

// --- Movement & expansion (8.13) ------------------------------------------

// A patch of placed Plains over q,r in [-2,2]; `sea` hexes are impassable, `skip`
// hexes are left unplaced (a hole in the map).
function placedWorld({ seed = 1, sea = [], skip = [] } = {}) {
  const seaSet = new Set(sea.map(([q, r]) => axialKey(q, r)));
  const skipSet = new Set(skip.map(([q, r]) => axialKey(q, r)));
  const hexes = {};
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
    const k = axialKey(q, r);
    if (skipSet.has(k)) continue;
    hexes[k] = { coords: { q, r }, placed: true, terrain: seaSet.has(k) ? "Sea" : "Plains" };
  }
  return { seed, hexes, factions: [] };
}

function factionAt(seed, q, r, n, archetype) {
  const rng = subRng(seed, "faction", q, r, n);
  return generateFaction(tables(), rng, { q, r, index: n, seed, archetype });
}

test("a roaming faction moves its camp to a passable placed neighbour, dropping poiId", () => {
  const world = placedWorld({ seed: 1 });
  const f = factionAt(1, 0, 0, 0, "bandits");
  f.holdings[0].poiId = "poi:0"; // started at a named POI
  world.factions.push(f);
  advanceFactionTurn(world, world.seed);
  const now = f.holdings[0];
  assert.ok(neighbors(0, 0).some((nb) => nb.q === now.q && nb.r === now.r), "moved to an adjacent hex");
  assert.equal(world.hexes[axialKey(now.q, now.r)].terrain !== "Sea", true);
  assert.ok(!("poiId" in now), "poiId dropped now the camp roams in the field");
});

test("a roaming faction with no passable placed neighbour stays put", () => {
  // Only (0,0) is placed; all six neighbours are unplaced → nowhere to go.
  const world = { seed: 1, hexes: { [axialKey(0, 0)]: { coords: { q: 0, r: 0 }, placed: true, terrain: "Plains" } }, factions: [] };
  const f = factionAt(1, 0, 0, 0, "bandits");
  world.factions.push(f);
  advanceFactionTurn(world, world.seed);
  assert.deepEqual(f.holdings[0], { q: 0, r: 0 });
});

test("a spreading faction claims one adjacent hex per turn, up to the cap", () => {
  const world = placedWorld({ seed: 2 });
  const f = factionAt(2, 0, 0, 0, "cult");
  world.factions.push(f);
  advanceFactionTurn(world, world.seed);
  assert.equal(f.holdings.length, 2, "grew by one on the first turn");
  const nb = neighbors(0, 0).some((n) => n.q === f.holdings[1].q && n.r === f.holdings[1].r);
  assert.ok(nb, "the new holding is adjacent to the first");
  for (let i = 0; i < 20; i++) advanceFactionTurn(world, world.seed);
  assert.equal(f.holdings.length, HOLDING_CAP, "stops growing at the cap");
});

test("a static faction (hermit order) never changes its holdings", () => {
  const world = placedWorld({ seed: 3 });
  const f = factionAt(3, 0, 0, 0, "hermit order");
  world.factions.push(f);
  const before = JSON.stringify(f.holdings);
  for (let i = 0; i < 10; i++) advanceFactionTurn(world, world.seed);
  assert.equal(JSON.stringify(f.holdings), before);
});

test("movement/expansion never lands on water or an unplaced hex", () => {
  const world = placedWorld({ seed: 4, sea: [[1, 0], [0, 1], [-1, 1]], skip: [[-1, 0]] });
  const f = factionAt(4, 0, 0, 0, "cult");
  world.factions.push(f);
  for (let i = 0; i < 30; i++) advanceFactionTurn(world, world.seed);
  for (const h of f.holdings) {
    const hex = world.hexes[axialKey(h.q, h.r)];
    assert.ok(hex && hex.placed && hex.terrain !== "Sea", `holding (${h.q},${h.r}) is placed & passable`);
  }
});

test("movement/expansion is deterministic for a given world + seed", () => {
  const run = () => {
    const world = placedWorld({ seed: 5 });
    const f = factionAt(5, 0, 0, 0, "cult");
    world.factions.push(f);
    for (let i = 0; i < 8; i++) advanceFactionTurn(world, world.seed);
    return f.holdings;
  };
  assert.deepEqual(run(), run());
});

test("day-driven turns move/expand too, not just the manual button", () => {
  const world = placedWorld({ seed: 6 });
  const f = factionAt(6, 0, 0, 0, "cult");
  world.factions.push(f);
  advanceFactionDays(world, TURN_LENGTH_DAYS, world.seed);
  assert.equal(f.holdings.length, 2);
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

// --- Faction-emitted hook context (Phase 8.11) ---------------------------
// A faction hook is always a `threat` pointing at the faction's lair; the deed is
// a rolled faction-deed and the opening alternates rumour/witness so stirs vary.

const hookTables = () => new Map(
  ["faction-deed", "hook-source"].map((id) => [id, validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8")))]),
);
const deedValues = () => valuesOf("faction-deed", hookTables());
const sourceValues = () => valuesOf("hook-source", hookTables());

// A deterministic rng that walks a fixed list, so a test pins each roll.
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test("factionHookContext is always a threat, with a rolled deed as the claim", () => {
  const t = hookTables();
  const deeds = deedValues();
  for (const archetype of ["bandits", "cult", "merchant guild", "noble house", "hermit order"]) {
    const ctx = factionHookContext({ archetype, goal: { kind: "hoard wealth" } }, seq(0, 0), t);
    assert.equal(ctx.verb, "threat");
    assert.ok(deeds.has(ctx.claim), `deed ${ctx.claim} from the table`);
  }
});

test("the opening is the goal rumour when the coin-flip is low, a witness when high", () => {
  const t = hookTables();
  const f = { archetype: "bandits", goal: { kind: "raid the frontier" } };
  // Rolls: [deed pick, rumour coin-flip]. 0 < 0.5 → rumour; 0.99 ≥ 0.5 → witness.
  assert.equal(factionHookContext(f, seq(0, 0), t).source, "Smoke on the frontier");
  assert.ok(sourceValues().has(factionHookContext(f, seq(0, 0.99), t).source));
});

test("a faction with no mapped/absent goal always draws a witness source", () => {
  const t = hookTables();
  const src = factionHookContext({ archetype: "cult", goal: { kind: "brew tea" } }, seq(0, 0), t).source;
  assert.ok(sourceValues().has(src), "falls back to a rolled hook-source");
  const src2 = factionHookContext({ archetype: "cult" }, seq(0, 0), t).source;
  assert.ok(sourceValues().has(src2));
});

test("per-stir seeding gives varied deeds across a run of stirs (variety fix)", () => {
  const t = hookTables();
  const f = { archetype: "bandits", goal: { kind: "raid the frontier" } };
  // The app seeds each stir on (seed, "stir", factionId, ordinal). Six stirs should
  // not all read the same — the whole point of the fix.
  const deeds = new Set();
  for (let n = 0; n < 6; n++) deeds.add(factionHookContext(f, subRng(1, "stir", "faction:0", n), t).claim);
  assert.ok(deeds.size >= 3, `expected varied deeds, got ${[...deeds].join(" | ")}`);
});

test("factionHookContext is deterministic for a given rng + tables", () => {
  const t = hookTables();
  const f = { archetype: "bandits", goal: { kind: "raid the frontier" } };
  assert.deepEqual(factionHookContext(f, seq(0.3, 0.1), t), factionHookContext(f, seq(0.3, 0.1), t));
});

// --- Auto-fire faction hooks (Phase 8.12) --------------------------------

const activeFaction = (extra = {}) => ({
  id: "faction:0", status: "active", strength: 3, holdings: [{ q: 5, r: 0 }], ...extra,
});
const PARTY = { q: 0, r: 0 };

test("autoHookChance is 0 for an inactive faction, no party, or no holding", () => {
  assert.equal(autoHookChance(activeFaction({ status: "dormant" }), PARTY), 0);
  assert.equal(autoHookChance(activeFaction({ status: "destroyed" }), PARTY), 0);
  assert.equal(autoHookChance(activeFaction(), null), 0);
  assert.equal(autoHookChance(activeFaction({ holdings: [] }), PARTY), 0);
  assert.equal(autoHookChance(null, PARTY), 0);
});

test("autoHookChance rises with strength and falls with distance", () => {
  const weak = autoHookChance(activeFaction({ strength: 2 }), PARTY);
  const strong = autoHookChance(activeFaction({ strength: 4 }), PARTY);
  assert.ok(strong > weak, `strong ${strong} > weak ${weak}`);

  const near = autoHookChance(activeFaction({ holdings: [{ q: 1, r: 0 }] }), PARTY);
  const far = autoHookChance(activeFaction({ holdings: [{ q: 12, r: 0 }] }), PARTY);
  assert.ok(near > far, `near ${near} > far ${far}`);
});

test("autoHookChance never exceeds the cap", () => {
  // A very strong faction the party stands on would exceed 0.2 uncapped.
  const c = autoHookChance(activeFaction({ strength: 99, holdings: [{ q: 0, r: 0 }] }), PARTY);
  assert.ok(c <= 0.2 + 1e-9, `chance ${c} <= cap`);
});

test("rollAutoHookCount is 0 when the chance is 0 or days < 1", () => {
  const alwaysLow = () => 0.999;
  assert.equal(rollAutoHookCount(activeFaction({ status: "dormant" }), PARTY, 30, () => 0), 0);
  assert.equal(rollAutoHookCount(activeFaction(), PARTY, 0, () => 0), 0);
  assert.equal(rollAutoHookCount(activeFaction(), PARTY, 30, alwaysLow), 0); // rolls never beat the chance
});

test("rollAutoHookCount is capped at AUTO_HOOK_CAP even if every day hits", () => {
  const alwaysHit = () => 0; // 0 < any positive chance → every day fires
  const n = rollAutoHookCount(activeFaction({ strength: 4, holdings: [{ q: 0, r: 0 }] }), PARTY, 50, alwaysHit);
  assert.equal(n, AUTO_HOOK_CAP);
});

test("rollAutoHookCount is deterministic for a given rng stream", () => {
  const f = activeFaction({ strength: 4, holdings: [{ q: 1, r: 0 }] });
  const a = rollAutoHookCount(f, PARTY, 40, subRng(9, "autohook", "faction:0", 0));
  const b = rollAutoHookCount(f, PARTY, 40, subRng(9, "autohook", "faction:0", 0));
  assert.equal(a, b);
});

test("a louder/nearer faction fires more often than a faint one (statistical)", () => {
  // Sum counts across many independent day-streams; loud+near should out-fire faint+far.
  const loud = activeFaction({ strength: 4, holdings: [{ q: 1, r: 0 }] });
  const faint = activeFaction({ strength: 2, holdings: [{ q: 11, r: 0 }] });
  let loudTotal = 0, faintTotal = 0;
  for (let s = 0; s < 200; s++) {
    loudTotal += rollAutoHookCount(loud, PARTY, 7, subRng(s, "autohook", "loud", 0));
    faintTotal += rollAutoHookCount(faint, PARTY, 7, subRng(s, "autohook", "faint", 0));
  }
  assert.ok(loudTotal > faintTotal, `loud ${loudTotal} > faint ${faintTotal}`);
});
