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
  regionHeat,
  regionStirChance,
  rollRegionStir,
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
  advanceFactionDays({ factions: [f] }, TURN_LENGTH_DAYS - 1, 1);
  assert.equal(f.clock.turns, 0); // not banked enough for a turn yet
  assert.equal(f.clock.sinceTurn, TURN_LENGTH_DAYS - 1);
  // One more day tips it over → exactly one turn, remainder 0.
  advanceFactionDays({ factions: [f] }, 1, 1);
  assert.equal(f.clock.turns, 1);
  assert.equal(f.clock.sinceTurn, 0);
});

test("advanceFactionDays fires multiple turns and carries the remainder", () => {
  const f = make(1, 0, 0, 0);
  advanceFactionDays({ factions: [f] }, 2 * TURN_LENGTH_DAYS + 3, 1);
  assert.equal(f.clock.turns, 2); // two whole turn-lengths fired
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
  advanceFactionTurn({ factions: [a, b] }, 1);
  assert.equal(a.clock.turns, 1); // both active factions ticked once
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
  advanceFactionTurn({ factions: [a, b, c] }, 1);
  assert.equal(a.clock.turns, 0);
  assert.equal(b.clock.turns, 0);
  assert.equal(c.clock.turns, 1); // only the active faction ticked
  advanceFactionDays({ factions: [a, b, c] }, TURN_LENGTH_DAYS, 1);
  assert.equal(c.clock.turns, 2); // only c fires again on the day clock
  assert.equal(a.clock.turns, 0);
  assert.equal(b.clock.turns, 0);
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

test("a spreading faction claims one adjacent hex per turn and keeps growing (no cap)", () => {
  const world = placedWorld({ seed: 2 });
  const f = factionAt(2, 0, 0, 0, "cult");
  world.factions.push(f);
  advanceFactionTurn(world, world.seed);
  assert.equal(f.holdings.length, 2, "grew by one on the first turn");
  const nb = neighbors(0, 0).some((n) => n.q === f.holdings[1].q && n.r === f.holdings[1].r);
  assert.ok(nb, "the new holding is adjacent to the first");
  // No HOLDING_CAP any more: a lone faction fills the reachable ground unbounded.
  for (let i = 0; i < 30; i++) advanceFactionTurn(world, world.seed);
  assert.ok(f.holdings.length > 6, `grew to ${f.holdings.length} holdings, past the old cap of 6`);
});

test("an unmapped-mobility archetype defaults to static (never changes holdings)", () => {
  const world = placedWorld({ seed: 3 });
  const f = factionAt(3, 0, 0, 0, "wandering scholars"); // not in ARCHETYPE_MOBILITY → static
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

// --- Expansion engine: contention, elimination, events (Phase 8.15) ------
// moveOrSpread is reached through advanceFactionTurn (its per-turn rng is
// subRng(seed,"factionturn",id,turns)), so these drive the turn and read the
// returned FactionEvent[] and the mutated holdings.

// A plain spreading faction with a chosen strength and single holding (full
// control over the contest, unlike the rolled generateFaction).
const spreader = (id, q, r, strength) => ({
  id, status: "active", archetype: "cult", strength, disposition: "neutral",
  goal: { kind: "seize the region", progress: 0, max: 8 }, holdings: [{ q, r }],
  clock: { turns: 0, sinceTurn: 0 },
});
// An ACTIVE holder that never acts (unmapped archetype → static): a fixed
// defender that stays put so we can isolate the attacker's contest.
const staticHolder = (id, q, r, strength) => ({
  id, status: "active", archetype: "wandering scholars", strength, disposition: "neutral",
  goal: { kind: "seize the region", progress: 0, max: 8 }, holdings: [{ q, r }],
  clock: { turns: 0, sinceTurn: 0 },
});
// A two-hex world: only (0,0) and (1,0) placed, so a faction at (0,0) has exactly
// one frontier hex — (1,0) — forcing a contest when a rival holds it.
const contestWorld = () => ({
  seed: 0, factions: [],
  hexes: {
    [axialKey(0, 0)]: { coords: { q: 0, r: 0 }, placed: true, terrain: "Plains" },
    [axialKey(1, 0)]: { coords: { q: 1, r: 0 }, placed: true, terrain: "Plains" },
  },
});

test("spreading onto empty ground returns a claim event and adds that hex", () => {
  const world = placedWorld({ seed: 2 });
  const f = factionAt(2, 0, 0, 0, "cult");
  world.factions.push(f);
  const events = advanceFactionTurn(world, world.seed);
  const claim = events.find((e) => e.kind === "claim" && e.factionId === f.id);
  assert.ok(claim, "emitted a claim event");
  assert.ok(f.holdings.some((h) => h.q === claim.q && h.r === claim.r), "the claimed hex was added");
});

test("a contest is strength-weighted and deterministic", () => {
  // Attacker at (0,0) has only the rival hex (1,0) to grow into → forced contest.
  const contest = (atkStrength, seed) => {
    const world = contestWorld();
    world.factions = [spreader("faction:0", 0, 0, atkStrength), staticHolder("faction:1", 1, 0, 1)];
    return advanceFactionTurn(world, seed).some((e) => e.kind === "takeover");
  };
  let strongWins = 0, weakWins = 0;
  for (let s = 0; s < 100; s++) {
    if (contest(4, s)) strongWins++; // 4 vs 1 → ~0.8
    if (contest(1, s)) weakWins++;   // 1 vs 1 → ~0.5
  }
  assert.ok(strongWins > weakWins, `strong ${strongWins} > weak ${weakWins}`);
  assert.ok(strongWins >= 60, `a much stronger attacker wins the majority (${strongWins}/100)`);
  // Same seed → same outcome.
  assert.equal(contest(4, 7), contest(4, 7));
});

test("a won contest moves the hex loser→winner; a lost one changes nothing", () => {
  // Find a 1-v-1 seed that the attacker wins, and one it loses (each ~50%).
  const won = (seed) => {
    const world = contestWorld();
    world.factions = [spreader("faction:0", 0, 0, 1), staticHolder("faction:1", 1, 0, 1)];
    return advanceFactionTurn(world, seed).some((e) => e.kind === "takeover");
  };
  let winSeed = -1, lossSeed = -1;
  for (let s = 0; s < 500 && (winSeed < 0 || lossSeed < 0); s++) {
    if (won(s)) { if (winSeed < 0) winSeed = s; } else if (lossSeed < 0) lossSeed = s;
  }
  assert.ok(winSeed >= 0 && lossSeed >= 0, "found both a winning and a losing seed");

  // Win: hex moves, event names the loser.
  {
    const world = contestWorld();
    const atk = spreader("faction:0", 0, 0, 1), def = staticHolder("faction:1", 1, 0, 1);
    world.factions = [atk, def];
    const events = advanceFactionTurn(world, winSeed);
    assert.ok(events.some((e) => e.kind === "takeover" && e.fromFactionId === "faction:1"));
    assert.ok(atk.holdings.some((h) => h.q === 1 && h.r === 0), "winner now holds it");
    assert.ok(!def.holdings.some((h) => h.q === 1 && h.r === 0), "loser no longer holds it");
  }
  // Loss: repelled, nothing moves.
  {
    const world = contestWorld();
    const atk = spreader("faction:0", 0, 0, 1), def = staticHolder("faction:1", 1, 0, 1);
    world.factions = [atk, def];
    const events = advanceFactionTurn(world, lossSeed);
    assert.ok(events.some((e) => e.kind === "repelled" && e.fromFactionId === "faction:1"));
    assert.equal(atk.holdings.length, 1, "attacker gained nothing");
    assert.ok(def.holdings.some((h) => h.q === 1 && h.r === 0), "defender kept it");
  }
});

test("a faction reduced to zero holdings is destroyed, emits eliminated, and stops acting", () => {
  // An overwhelming attacker (1000 vs 1 → win prob ~0.999) takes the defender's
  // only hex on the first seed that wins → the defender drops to 0 holdings.
  for (let seed = 0; seed < 20; seed++) {
    const w = contestWorld();
    const atk = spreader("faction:0", 0, 0, 1000), def = staticHolder("faction:1", 1, 0, 1);
    w.factions = [atk, def];
    const events = advanceFactionTurn(w, seed);
    if (!events.some((e) => e.kind === "eliminated")) continue;
    assert.equal(def.status, "destroyed", "loser at 0 holdings is destroyed");
    assert.equal(def.holdings.length, 0);
    assert.ok(events.some((e) => e.kind === "eliminated" && e.factionId === "faction:1" && e.byFactionId === "faction:0"));
    // A destroyed faction is skipped on the next turn (doesn't tick).
    const before = def.clock.turns;
    advanceFactionTurn(w, seed + 1);
    assert.equal(def.clock.turns, before, "a destroyed faction no longer acts");
    return;
  }
  assert.fail("expected an elimination within 20 seeds");
});

test("a roaming faction emits move (dropping poiId), avoids rival hexes, and stays when boxed in", () => {
  // Open ground: the roamer relocates and drops its poiId.
  const world = placedWorld({ seed: 1 });
  const f = factionAt(1, 0, 0, 0, "bandits");
  f.holdings[0].poiId = "poi:0"; // started at a named POI
  world.factions.push(f);
  const events = advanceFactionTurn(world, world.seed);
  const mv = events.find((e) => e.kind === "move" && e.factionId === f.id);
  assert.ok(mv, "emitted a move event");
  assert.ok(!("poiId" in f.holdings[0]), "poiId dropped now the camp roams the field");
  assert.deepEqual(f.holdings[0], { q: mv.q, r: mv.r });

  // Boxed in by a rival: the only neighbour is rival-held → the roamer stays put.
  const boxed = contestWorld();
  const roamer = {
    id: "faction:0", status: "active", archetype: "bandits", strength: 2, disposition: "hostile",
    goal: { kind: "raid the frontier", progress: 0, max: 8 }, holdings: [{ q: 0, r: 0 }], clock: { turns: 0, sinceTurn: 0 },
  };
  boxed.factions = [roamer, staticHolder("faction:1", 1, 0, 2)];
  const ev2 = advanceFactionTurn(boxed, boxed.seed);
  assert.ok(!ev2.some((e) => e.factionId === "faction:0"), "a boxed-in roamer emits nothing");
  assert.deepEqual(roamer.holdings[0], { q: 0, r: 0 }, "and does not move onto the rival hex");
});

test("advanceFactionTurn / advanceFactionDays return well-formed FactionEvent arrays", () => {
  const KINDS = new Set(["claim", "move", "takeover", "repelled", "eliminated"]);
  const world = placedWorld({ seed: 2 });
  world.factions.push(factionAt(2, 0, 0, 0, "cult"));
  const t = advanceFactionTurn(world, world.seed);
  assert.ok(Array.isArray(t));
  for (const e of t) { assert.ok(KINDS.has(e.kind)); assert.equal(typeof e.factionId, "string"); }
  const d = advanceFactionDays(world, TURN_LENGTH_DAYS, world.seed);
  assert.ok(Array.isArray(d));
  for (const e of d) { assert.ok(KINDS.has(e.kind)); assert.equal(typeof e.factionId, "string"); }
});

// --- Region "something is stirring" hooks (Phase 8.14) -------------------

const rf = (strength, progress, max = 8) => ({
  status: "active", strength, goal: { kind: "seize the region", progress, max },
});

test("regionHeat is 0 for an empty region", () => {
  assert.equal(regionHeat([]), 0);
  assert.equal(regionHeat(undefined), 0);
});

test("regionHeat rises with strength, goal progress, and faction count", () => {
  const base = regionHeat([rf(2, 0)]);
  assert.ok(regionHeat([rf(4, 0)]) > base, "stronger → hotter");
  assert.ok(regionHeat([rf(2, 8)]) > base, "further along the doom clock → hotter");
  assert.ok(regionHeat([rf(2, 0), rf(2, 0)]) > regionHeat([rf(2, 0)]), "more factions → hotter (contest)");
});

test("a near-complete doom clock contributes about 1.5x strength", () => {
  // full clock → (0.5 + 1.0) * strength = 1.5 * strength; single faction, no contest.
  assert.ok(Math.abs(regionHeat([rf(4, 8, 8)]) - 6) < 1e-9);
});

test("regionStirChance never exceeds the cap", () => {
  const many = Array.from({ length: 20 }, () => rf(4, 8));
  assert.ok(regionStirChance(many) <= 0.12 + 1e-9);
});

test("rollRegionStir is false with no factions or days < 1, true when every day hits", () => {
  assert.equal(rollRegionStir([], 30, () => 0), false);
  assert.equal(rollRegionStir([rf(4, 8)], 0, () => 0), false);
  assert.equal(rollRegionStir([rf(4, 8)], 20, () => 0), true);   // 0 < chance every day
  assert.equal(rollRegionStir([rf(4, 8)], 20, () => 0.999), false); // never beats the chance
});

test("rollRegionStir is deterministic for a given rng stream", () => {
  const fs = [rf(3, 4), rf(2, 6)];
  const a = rollRegionStir(fs, 25, subRng(3, "regionstir", "region:0", 0));
  const b = rollRegionStir(fs, 25, subRng(3, "regionstir", "region:0", 0));
  assert.equal(a, b);
});

test("a hot region stirs more often than a quiet one (statistical)", () => {
  const hot = [rf(4, 8), rf(3, 6)];   // two strong, advanced factions
  const quiet = [rf(2, 0)];            // one weak, fresh faction
  let hotN = 0, quietN = 0;
  for (let s = 0; s < 300; s++) {
    if (rollRegionStir(hot, 14, subRng(s, "regionstir", "hot", 0))) hotN++;
    if (rollRegionStir(quiet, 14, subRng(s, "regionstir", "quiet", 0))) quietN++;
  }
  assert.ok(hotN > quietN, `hot ${hotN} > quiet ${quietN}`);
});
