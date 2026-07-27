import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateFaction,
  promoteFaction,
  addHolding,
  advanceFactionTurn,
  advanceFactionDays,
  expand,
  isValidSeat,
  reseatFaction,
  TURN_LENGTH_DAYS,
  factionLabel,
  factionDescription,
  eligibleLords,
  FACTION_BUILD,
  rollEmergences,
  EMERGE_COOLDOWN_DAYS,
  HEXES_PER_FACTION,
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

// --- SOI expansion (Phase 8.19) -------------------------------------------
// Roam/spread retired: every faction grows an SOI; the per-turn CHANCE varies by
// archetype (gated in tickFaction). Expansion stays deterministic for a seed.

// A patch of placed Plains over q,r in [-R,R]; `sea` hexes are impassable, `skip`
// hexes are left unplaced (a hole in the map). `pois`/`towns` mark seat sites.
function placedWorld({ seed = 1, sea = [], skip = [], pois = [], towns = [], R = 2 } = {}) {
  const seaSet = new Set(sea.map(([q, r]) => axialKey(q, r)));
  const skipSet = new Set(skip.map(([q, r]) => axialKey(q, r)));
  const poiMap = new Map(pois.map(([q, r, type = "dungeon"]) => [axialKey(q, r), type]));
  const townSet = new Set(towns.map(([q, r]) => axialKey(q, r)));
  const hexes = {};
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    const k = axialKey(q, r);
    if (skipSet.has(k)) continue;
    const hex = { coords: { q, r }, placed: true, terrain: seaSet.has(k) ? "Sea" : "Plains" };
    if (poiMap.has(k)) hex.pois = [{ id: `poi:${k}`, type: poiMap.get(k) }];
    if (townSet.has(k)) hex.settlement = { present: true, kind: "town", size: "Village" };
    hexes[k] = hex;
  }
  return { seed, hexes, factions: [] };
}

function factionAt(seed, q, r, n, archetype) {
  const rng = subRng(seed, "faction", q, r, n);
  return generateFaction(tables(), rng, { q, r, index: n, seed, archetype });
}

test("a lone faction grows its SOI over turns and keeps going (no cap)", () => {
  const world = placedWorld({ seed: 2, R: 3 });
  const f = factionAt(2, 0, 0, 0, "cult"); // cult = high expansion chance
  world.factions.push(f);
  for (let i = 0; i < 40; i++) advanceFactionTurn(world, world.seed);
  assert.ok(f.holdings.length > 6, `grew to ${f.holdings.length} holdings, past the old cap of 6`);
  // Every new holding is contiguous with the blob (adjacent to some earlier one).
  for (let i = 1; i < f.holdings.length; i++) {
    const h = f.holdings[i];
    const touches = f.holdings.some((o, j) => j !== i && neighbors(o.q, o.r).some((nb) => nb.q === h.q && nb.r === h.r));
    assert.ok(touches, `holding (${h.q},${h.r}) is adjacent to the SOI`);
  }
});

test("a high-chance archetype outgrows a low-chance one over many turns", () => {
  const grow = (archetype) => {
    const world = placedWorld({ seed: 9, R: 4 }); // room to grow without saturating
    const f = factionAt(9, 0, 0, 0, archetype);
    world.factions.push(f);
    for (let i = 0; i < 25; i++) advanceFactionTurn(world, world.seed);
    return f.holdings.length;
  };
  assert.ok(grow("cult") > grow("dragon"), "cult (.7) spreads faster than dragon (.25)");
});

test("a failed expansion gate produces no spatial event but still ticks the goal", () => {
  // Find a seed whose FIRST turn fails the gate for a low-chance archetype.
  for (let seed = 0; seed < 100; seed++) {
    const world = placedWorld({ seed, R: 2 });
    const f = factionAt(seed, 0, 0, 0, "dragon"); // .25 → often fails
    world.factions.push(f);
    const events = advanceFactionTurn(world, seed);
    if (events.length) continue; // gate passed this seed; try another
    assert.equal(f.holdings.length, 1, "no hex claimed when the gate fails");
    assert.equal(f.goal.progress, 1, "but the goal clock still ticked");
    assert.equal(f.clock.turns, 1, "and the turn counter still advanced");
    return;
  }
  assert.fail("expected a gate failure within 100 seeds");
});

test("expansion never lands on water or an unplaced hex", () => {
  const world = placedWorld({ seed: 4, sea: [[1, 0], [0, 1], [-1, 1]], skip: [[-1, 0]] });
  const f = factionAt(4, 0, 0, 0, "cult");
  world.factions.push(f);
  for (let i = 0; i < 40; i++) advanceFactionTurn(world, world.seed);
  for (const h of f.holdings) {
    const hex = world.hexes[axialKey(h.q, h.r)];
    assert.ok(hex && hex.placed && hex.terrain !== "Sea", `holding (${h.q},${h.r}) is placed & passable`);
  }
});

test("expansion is deterministic for a given world + seed", () => {
  const run = () => {
    const world = placedWorld({ seed: 5 });
    const f = factionAt(5, 0, 0, 0, "cult");
    world.factions.push(f);
    for (let i = 0; i < 8; i++) advanceFactionTurn(world, world.seed);
    return f.holdings;
  };
  assert.deepEqual(run(), run());
});

test("day-driven turns expand too, not just the manual button", () => {
  const world = placedWorld({ seed: 6, R: 3 });
  const f = factionAt(6, 0, 0, 0, "cult");
  world.factions.push(f);
  advanceFactionDays(world, 10 * TURN_LENGTH_DAYS, world.seed); // 10 turns of a .7 spreader
  assert.ok(f.holdings.length > 1, `day clock drove expansion (grew to ${f.holdings.length})`);
});

// --- Seats & sphere of influence (Phase 8.19) -----------------------------

test("isValidSeat respects the archetype rule (settlement vs POI-only vs lair)", () => {
  const world = placedWorld({ pois: [[1, 0, "dungeon"], [2, 0, "tower"]], towns: [[0, 1]] });
  // "any" archetypes seat on a settlement OR a POI.
  assert.ok(isValidSeat(world, "bandits", 0, 1), "bandits seat in a town");
  assert.ok(isValidSeat(world, "thieves' guild", 0, 1), "thieves seat in a town");
  assert.ok(isValidSeat(world, "bandits", 1, 0), "bandits seat on a POI");
  assert.ok(!isValidSeat(world, "bandits", 0, 0), "no site on a bare hex");
  // A monstrous tribe lairs on a POI, never a settlement.
  assert.ok(!isValidSeat(world, "monstrous tribe", 0, 1), "a tribe won't seat in a town");
  assert.ok(isValidSeat(world, "monstrous tribe", 1, 0), "a tribe lairs on a POI");
  // Lair-bound lords: only their bound POI type.
  assert.ok(isValidSeat(world, "necromancer", 2, 0), "a necromancer seats on a tower");
  assert.ok(!isValidSeat(world, "necromancer", 1, 0), "not on a dungeon");
  assert.ok(isValidSeat(world, "lich", 1, 0), "a lich seats on a dungeon");
});

test("a faction generated on a bare hex is seatless; a promote is seated at its POI", () => {
  const bare = factionAt(1, 0, 0, 0, "cult");
  assert.equal(bare.seat, null, "bare-hex birth → seatless");
  const promoted = promoteFaction(tables(), subRng(1, "faction", 2, 3, 0), {
    q: 2, r: 3, poiId: "poi:0", index: 0, seed: 1, occupant: { by: "Bandits" },
  });
  assert.deepEqual(promoted.seat, { q: 2, r: 3, poiId: "poi:0" }, "promote seats on its POI");
});

test("generateFaction seats when the caller supplies a seat (the app's site birth)", () => {
  const f = generateFaction(tables(), subRng(1, "faction", 0, 0, 0), {
    q: 0, r: 0, index: 0, seed: 1, archetype: "bandits", poiId: "poi:9",
    seat: { q: 0, r: 0, poiId: "poi:9" },
  });
  assert.deepEqual(f.seat, { q: 0, r: 0, poiId: "poi:9" });
});

test("a seatless faction seats on the first valid site its SOI reaches", () => {
  // A cult born on a bare hex, with a dungeon two hexes away → seats when it claims it.
  const world = placedWorld({ seed: 11, R: 3, pois: [[2, 0, "dungeon"]] });
  const f = factionAt(11, 0, 0, 0, "cult");
  world.factions.push(f);
  assert.equal(f.seat, null, "starts seatless");
  let seatedEvent = false;
  for (let i = 0; i < 60 && !f.seat; i++) {
    const events = advanceFactionTurn(world, world.seed);
    if (events.some((e) => e.seated)) seatedEvent = true;
  }
  assert.ok(f.seat, "gained a seat by spreading onto a site");
  assert.deepEqual(f.seat, { q: 2, r: 0 }, "the seat is the site it reached");
  assert.ok(seatedEvent, "a claim/takeover reported it seated");
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
    "Seatless (raw influence)", // no seat field → seatless (8.19)
    "1 holding · strength 3",
    `Turn 1 · 3/${TURN_LENGTH_DAYS} d to next`,
  ]);
  // Plural + a non-active status surface too.
  const f2 = { ...f, holdings: [{ q: 0, r: 0 }, { q: 1, r: 1 }], status: "dormant" };
  const lines2 = factionDescription(f2);
  assert.ok(lines2.includes("2 holdings · strength 3"));
  assert.ok(lines2.includes("Status: dormant"));
  // A seated faction shows its HQ hex instead of "Seatless" (8.19).
  const f3 = { ...f, seat: { q: 4, r: -1 } };
  assert.ok(factionDescription(f3).includes("Seat: (4, -1)"));
});

// --- Expansion engine: contention, seats, elimination (Phase 8.15 + 8.19) -
// These drive `expand` DIRECTLY (exported for this) with a controlled rng stream,
// so the outcome is exact — no gate noise, no rival counter-turn. The gate + turn
// loop are exercised separately (advanceFactionTurn, above).

// A plain attacker: a chosen strength + single holding, seatless unless told.
const spreader = (id, q, r, strength, extra = {}) => ({
  id, status: "active", archetype: "cult", strength, disposition: "neutral",
  goal: { kind: "seize the region", progress: 0, max: 8 }, holdings: [{ q, r }],
  seat: null, clock: { turns: 0, sinceTurn: 0 }, ...extra,
});
// A passive defender: a real holder in world.factions we never tick (only the
// attacker's expand runs), so it just sits and defends. `seat` marks its HQ hex.
const holder = (id, holdings, strength, seat = null) => ({
  id, status: "active", archetype: "bandits", strength, disposition: "neutral",
  goal: { kind: "hold the ground", progress: 0, max: 8 },
  holdings: holdings.map((h) => ({ ...h })), seat, clock: { turns: 0, sinceTurn: 0 },
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

test("expanding onto empty ground returns a claim event and adds that hex", () => {
  const world = placedWorld({ seed: 2 });
  const f = spreader("faction:0", 0, 0, 3);
  world.factions.push(f);
  const events = expand(world, f, subRng(2, "claim"));
  const claim = events.find((e) => e.kind === "claim" && e.factionId === f.id);
  assert.ok(claim, "emitted a claim event");
  assert.ok(f.holdings.some((h) => h.q === claim.q && h.r === claim.r), "the claimed hex was added");
});

test("a contest is strength-weighted and deterministic", () => {
  const contest = (atkStrength, seed) => {
    const world = contestWorld();
    const atk = spreader("faction:0", 0, 0, atkStrength);
    world.factions = [atk, holder("faction:1", [{ q: 1, r: 0 }], 1)];
    return expand(world, atk, subRng(seed, "contest")).some((e) => e.kind === "takeover");
  };
  let strongWins = 0, weakWins = 0;
  for (let s = 0; s < 100; s++) {
    if (contest(4, s)) strongWins++; // 4 vs 1 → ~0.8
    if (contest(1, s)) weakWins++;   // 1 vs 1 → ~0.5
  }
  assert.ok(strongWins > weakWins, `strong ${strongWins} > weak ${weakWins}`);
  assert.ok(strongWins >= 60, `a much stronger attacker wins the majority (${strongWins}/100)`);
  assert.equal(contest(4, 7), contest(4, 7)); // same seed → same outcome
});

test("a won contest moves the hex loser→winner; a lost one changes nothing", () => {
  const run = (seed) => {
    const world = contestWorld();
    const atk = spreader("faction:0", 0, 0, 1);
    const def = holder("faction:1", [{ q: 1, r: 0 }, { q: 1, r: 1 }], 1, { q: 1, r: 1 });
    world.factions = [atk, def];
    const events = expand(world, atk, subRng(seed, "wl"));
    return { atk, def, events, won: events.some((e) => e.kind === "takeover") };
  };
  let winSeed = -1, lossSeed = -1;
  for (let s = 0; s < 500 && (winSeed < 0 || lossSeed < 0); s++) {
    if (run(s).won) { if (winSeed < 0) winSeed = s; } else if (lossSeed < 0) lossSeed = s;
  }
  assert.ok(winSeed >= 0 && lossSeed >= 0, "found both a winning and a losing seed");

  { // Win: the SOI hex (1,0) moves, event names the loser (its seat (1,1) is safe).
    const { atk, def, events } = run(winSeed);
    assert.ok(events.some((e) => e.kind === "takeover" && e.fromFactionId === "faction:1"));
    assert.ok(atk.holdings.some((h) => h.q === 1 && h.r === 0), "winner now holds it");
    assert.ok(!def.holdings.some((h) => h.q === 1 && h.r === 0), "loser no longer holds it");
    assert.equal(def.status, "active", "the loser keeps its seat and survives");
  }
  { // Loss: repelled, nothing moves.
    const { atk, def, events } = run(lossSeed);
    assert.ok(events.some((e) => e.kind === "repelled" && e.fromFactionId === "faction:1"));
    assert.equal(atk.holdings.length, 1, "attacker gained nothing");
    assert.ok(def.holdings.some((h) => h.q === 1 && h.r === 0), "defender kept it");
  }
});

test("a faction reduced to zero holdings is destroyed, emits eliminated, and stops acting", () => {
  // An overwhelming attacker (1000 vs 1) takes the defender's only (seatless) hex.
  for (let seed = 0; seed < 20; seed++) {
    const w = contestWorld();
    const atk = spreader("faction:0", 0, 0, 1000);
    const def = holder("faction:1", [{ q: 1, r: 0 }], 1); // seatless, single holding
    w.factions = [atk, def];
    const events = expand(w, atk, subRng(seed, "elim"));
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

// --- Seat defence, relocation & dissolution (Phase 8.19) ------------------

test("a rival's SEAT falls far less often than an equally-defended SOI hex", () => {
  // The attacker is forced to strike the one rival hex (1,0). In the seat case it
  // IS the defender's seat (×SEAT_DEFENSE); in the SOI case it's a plain hex (the
  // defender's seat is a far, unreachable holding) — same strengths + seeds.
  const fell = (targetIsSeat, seed) => {
    const world = contestWorld();
    const atk = spreader("faction:0", 0, 0, 3);
    const def = targetIsSeat
      ? holder("faction:1", [{ q: 1, r: 0 }], 3, { q: 1, r: 0 })
      : holder("faction:1", [{ q: 1, r: 0 }, { q: 9, r: 9 }], 3, { q: 9, r: 9 });
    world.factions = [atk, def];
    return expand(world, atk, subRng(seed, "seat-vs-soi")).some((e) => e.kind === "takeover");
  };
  let seatFalls = 0, soiFalls = 0;
  for (let s = 0; s < 300; s++) {
    if (fell(true, s)) seatFalls++;  // 3 vs 3×6 → ~0.14
    if (fell(false, s)) soiFalls++;  // 3 vs 3 → ~0.5
  }
  assert.ok(soiFalls > seatFalls * 2, `SOI (${soiFalls}) falls far more than the seat (${seatFalls})`);
  assert.ok(seatFalls > 0, "but a seat still falls occasionally");
  assert.equal(fell(true, 5), fell(true, 5)); // deterministic for a seed
});

// A world where (0,0)'s ONLY placed passable neighbour is (1,0), so an attacker at
// (0,0) is forced to strike (1,0). Extra placed hexes carry POIs (seat sites).
const seatTakeWorld = (sites = []) => {
  const hexes = {
    [axialKey(0, 0)]: { coords: { q: 0, r: 0 }, placed: true, terrain: "Plains" },
    [axialKey(1, 0)]: { coords: { q: 1, r: 0 }, placed: true, terrain: "Plains", pois: [{ id: "poi:1,0", type: "dungeon" }] },
  };
  for (const [q, r] of sites) {
    hexes[axialKey(q, r)] = { coords: { q, r }, placed: true, terrain: "Plains", pois: [{ id: `poi:${q},${r}`, type: "dungeon" }] };
  }
  return { seed: 1, factions: [], hexes };
};

test("losing a SEAT relocates to the nearest valid site and halves the SOI", () => {
  const build = () => {
    const world = seatTakeWorld([[2, 0]]); // (2,0) is a second dungeon = a valid fallback
    const atk = spreader("faction:0", 0, 0, 1000);
    const def = holder("faction:1",
      [{ q: 1, r: 0, poiId: "poi:1,0" }, { q: 2, r: 0, poiId: "poi:2,0" }, { q: 3, r: 0 }, { q: 3, r: 1 }, { q: 3, r: 2 }],
      2, { q: 1, r: 0, poiId: "poi:1,0" });
    world.factions = [atk, def];
    return { world, atk, def };
  };
  for (let seed = 0; seed < 20; seed++) {
    const { world, atk, def } = build();
    const events = expand(world, atk, subRng(seed, "reloc"));
    if (!events.some((e) => e.kind === "takeover" && e.q === 1 && e.r === 0)) continue;
    assert.ok(events.some((e) => e.kind === "relocate" && e.factionId === "faction:1"), "the loser relocated");
    assert.equal(def.status, "active", "the faction survives the relocation");
    assert.deepEqual({ q: def.seat.q, r: def.seat.r }, { q: 2, r: 0 }, "regrouped at the nearest valid site");
    assert.ok(def.holdings.some((h) => h.q === 2 && h.r === 0), "the new seat is a holding");
    assert.ok(!def.holdings.some((h) => h.q === 1 && h.r === 0), "lost the old seat hex");
    assert.ok(def.holdings.length < 5 && def.holdings.length >= 2, `SOI roughly halved (${def.holdings.length})`);
    assert.equal(def.strength, 1, "and strength falters too (2 → 1)");
    return;
  }
  assert.fail("expected the seat to fall within 20 seeds");
});

test("losing a SEAT with no valid fallback dissolves the faction", () => {
  const build = () => {
    const world = seatTakeWorld(); // no second site → nowhere to relocate
    const atk = spreader("faction:0", 0, 0, 1000);
    const def = holder("faction:1",
      [{ q: 1, r: 0, poiId: "poi:1,0" }, { q: 3, r: 0 }, { q: 3, r: 1 }], // other holdings are bare
      2, { q: 1, r: 0, poiId: "poi:1,0" });
    world.factions = [atk, def];
    return { world, atk, def };
  };
  for (let seed = 0; seed < 20; seed++) {
    const { world, atk, def } = build();
    const events = expand(world, atk, subRng(seed, "dissolve"));
    if (!events.some((e) => e.kind === "takeover" && e.q === 1 && e.r === 0)) continue;
    assert.ok(!events.some((e) => e.kind === "relocate"), "no relocation was possible");
    assert.ok(events.some((e) => e.kind === "eliminated" && e.factionId === "faction:1" && e.byFactionId === "faction:0"));
    assert.equal(def.status, "destroyed", "the seatless-again faction dissolves");
    return;
  }
  assert.fail("expected the seat to fall within 20 seeds");
});

test("reseatFaction (GM override) moves the seat and applies the same disruption", () => {
  const world = seatTakeWorld([[2, 0]]); // (1,0) + (2,0) are valid seat sites
  const f = holder("faction:1",
    [{ q: 1, r: 0, poiId: "poi:1,0" }, { q: 2, r: 0, poiId: "poi:2,0" }, { q: 3, r: 0 }, { q: 3, r: 1 }, { q: 3, r: 2 }],
    4, { q: 1, r: 0, poiId: "poi:1,0" });
  const seat = reseatFaction(world, f, 2, 0);
  assert.deepEqual(seat, { q: 2, r: 0, poiId: "poi:2,0" }, "seat moved to the chosen site (with its POI)");
  assert.deepEqual(f.seat, { q: 2, r: 0, poiId: "poi:2,0" });
  assert.ok(f.holdings.some((h) => h.q === 2 && h.r === 0), "new seat is a holding");
  assert.ok(f.holdings.length < 5, `SOI halved (${f.holdings.length} < 5)`);
  assert.equal(f.strength, 2, "strength halved too (4 → 2)");
});

test("reseatFaction adds the hex as a holding if the faction doesn't hold it yet", () => {
  const world = seatTakeWorld([[2, 0]]);
  const f = holder("faction:1", [{ q: 1, r: 0, poiId: "poi:1,0" }], 3, { q: 1, r: 0, poiId: "poi:1,0" });
  // (2,0) is a valid site the faction does NOT hold — a GM decree seats it there.
  const seat = reseatFaction(world, f, 2, 0);
  assert.deepEqual({ q: seat.q, r: seat.r }, { q: 2, r: 0 });
  assert.ok(f.holdings.some((h) => h.q === 2 && h.r === 0), "the decreed hex is now a holding + the seat");
});

test("reseatFaction refuses a hex that is not a valid seat site", () => {
  const world = seatTakeWorld([[2, 0]]);
  const f = holder("faction:1", [{ q: 1, r: 0, poiId: "poi:1,0" }], 3, { q: 1, r: 0, poiId: "poi:1,0" });
  assert.equal(reseatFaction(world, f, 3, 0), null, "(3,0) is a bare hex → refused");
  assert.deepEqual(f.seat, { q: 1, r: 0, poiId: "poi:1,0" }, "seat unchanged on refusal");
  assert.equal(f.strength, 3, "strength unchanged on refusal");
});

test("a monstrous tribe can't be reseated into a settlement (archetype seat rule holds)", () => {
  const world = { seed: 1, factions: [], hexes: {
    [axialKey(1, 0)]: { coords: { q: 1, r: 0 }, placed: true, terrain: "Plains", pois: [{ id: "poi:a", type: "dungeon" }] },
    [axialKey(2, 0)]: { coords: { q: 2, r: 0 }, placed: true, terrain: "Plains", settlement: { present: true, kind: "town", size: "Village" } },
  } };
  const f = { id: "faction:1", status: "active", archetype: "monstrous tribe", kind: "goblins", strength: 3,
    disposition: "hostile", goal: { kind: "raid", progress: 0, max: 8 },
    holdings: [{ q: 1, r: 0, poiId: "poi:a" }, { q: 2, r: 0 }], seat: { q: 1, r: 0, poiId: "poi:a" }, clock: { turns: 0, sinceTurn: 0 } };
  assert.equal(reseatFaction(world, f, 2, 0), null, "a tribe won't seat in a town");
  assert.deepEqual(f.seat, { q: 1, r: 0, poiId: "poi:a" }, "seat unchanged; a settlement is not a valid tribe seat");
});

// --- Natural decline (Phase 8.20) -----------------------------------------
// A boxed-in world: the faction wholly owns a small closed strip, so it never has
// a frontier to grow into — every turn its expansion yields nothing, exposing it to
// the natural-decline roll (recede → disband).
const boxedStrip = (seed = 1, len = 3) => {
  const hexes = {};
  for (let q = 0; q < len; q++) hexes[axialKey(q, 0)] = { coords: { q, r: 0 }, placed: true, terrain: "Plains" };
  return { seed, factions: [], hexes };
};

test("a boxed-in faction's frontier recedes at least once (it can't only grow)", () => {
  const world = boxedStrip(1, 3);
  const f = holder("faction:1", [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], 3, { q: 0, r: 0 }); // archetype "bandits"
  world.factions.push(f);
  let receded = false;
  for (let i = 0; i < 400 && !receded; i++) {
    const ev = advanceFactionTurn(world, world.seed);
    if (ev.some((e) => e.kind === "recede" && e.factionId === "faction:1")) receded = true;
  }
  assert.ok(receded, "the frontier receded (a wholly-owned strip can't just keep growing)");
});

test("a stuck single-hex faction disbands on its own (natural death, no finisher)", () => {
  // One isolated placed hex, no passable neighbours → never any room to grow → the
  // faction is worn down to nothing over time and fades of its own accord.
  const world = { seed: 1, factions: [], hexes: {
    [axialKey(0, 0)]: { coords: { q: 0, r: 0 }, placed: true, terrain: "Plains" },
  } };
  const f = holder("faction:1", [{ q: 0, r: 0 }], 3, { q: 0, r: 0 }); // archetype "bandits"
  world.factions.push(f);
  let disbanded = false;
  for (let i = 0; i < 400 && f.status === "active"; i++) {
    const ev = advanceFactionTurn(world, world.seed);
    if (ev.some((e) => e.kind === "eliminated" && e.factionId === "faction:1" && !e.byFactionId)) disbanded = true;
  }
  assert.ok(disbanded, "it disbanded naturally (eliminated with no byFactionId)");
  assert.equal(f.status, "destroyed");
});

test("decline sheds the OUTERMOST hex first and never the seat", () => {
  const world = boxedStrip(1, 3);
  const f = holder("faction:1", [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], 3, { q: 0, r: 0 });
  world.factions.push(f);
  // Run until the first recede, then check WHICH hex went.
  for (let i = 0; i < 400; i++) {
    const ev = advanceFactionTurn(world, world.seed);
    const rec = ev.find((e) => e.kind === "recede");
    if (rec) {
      assert.deepEqual({ q: rec.q, r: rec.r }, { q: 2, r: 0 }, "the farthest hex from the seat recedes first");
      assert.ok(f.holdings.some((h) => h.q === 0 && h.r === 0), "the seat is untouched");
      return;
    }
  }
  assert.fail("expected a recede within 400 turns");
});

test("a lair-bound lord never recedes or disbands on its own", () => {
  const world = boxedStrip(1, 2); // fully owned, no room to grow
  const lord = holder("faction:1", [{ q: 0, r: 0 }, { q: 1, r: 0 }], 5, { q: 0, r: 0 });
  lord.archetype = "lich"; // a lair-bound lord — exempt from natural decline
  world.factions.push(lord);
  for (let i = 0; i < 400; i++) advanceFactionTurn(world, world.seed);
  assert.equal(lord.status, "active", "the lich endures");
  assert.equal(lord.holdings.length, 2, "and holds all its ground — no natural decline");
});

test("with room to grow, a faction trends upward despite natural decline", () => {
  const world = placedWorld({ seed: 2, R: 4 }); // plenty of open ground
  const f = factionAt(2, 0, 0, 0, "cult");
  world.factions.push(f);
  for (let i = 0; i < 30; i++) advanceFactionTurn(world, world.seed);
  assert.ok(f.holdings.length > 3, `net growth despite the odd recede (${f.holdings.length})`);
  assert.equal(f.status, "active");
});

test("natural decline is deterministic for a seed", () => {
  const run = () => {
    const world = boxedStrip(3, 3);
    const f = holder("faction:1", [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], 3, { q: 0, r: 0 });
    world.factions.push(f);
    for (let i = 0; i < 12; i++) advanceFactionTurn(world, world.seed);
    return { holdings: f.holdings, status: f.status };
  };
  assert.deepEqual(run(), run());
});

test("advanceFactionTurn / advanceFactionDays return well-formed FactionEvent arrays", () => {
  const KINDS = new Set(["claim", "takeover", "repelled", "eliminated", "relocate", "recede"]);
  const world = placedWorld({ seed: 2, R: 3 });
  world.factions.push(factionAt(2, 0, 0, 0, "cult"));
  const t = [];
  for (let i = 0; i < 20; i++) t.push(...advanceFactionTurn(world, world.seed));
  assert.ok(t.length, "several turns produced some events");
  for (const e of t) { assert.ok(KINDS.has(e.kind), `kind ${e.kind}`); assert.equal(typeof e.factionId, "string"); }
  const d = advanceFactionDays(world, TURN_LENGTH_DAYS, world.seed);
  assert.ok(Array.isArray(d));
  for (const e of d) { assert.ok(KINDS.has(e.kind)); assert.equal(typeof e.factionId, "string"); }
});

// --- More faction types (Phase 8.16) -------------------------------------
// Tables incl. the monster-kind table (the shared tables() omits it, matching the
// app-minimal set used elsewhere).
const tablesK = () => new Map(
  ["faction-archetype", "faction-goal", "faction-disposition", "faction-monster-kind"]
    .map((id) => [id, validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8")))]),
);

test("a monstrous tribe rolls a KIND that flavours its name + card", () => {
  const t = tablesK();
  const kinds = valuesOf("faction-monster-kind", t);
  const f = generateFaction(t, subRng(7, "faction", 0, 0, 0), { q: 0, r: 0, index: 0, seed: 7, archetype: "monstrous tribe" });
  assert.ok(kinds.has(f.kind), `kind ${f.kind} from the table`);
  const Kind = f.kind[0].toUpperCase() + f.kind.slice(1);
  assert.match(f.name, new RegExp(`\\b${Kind}\\b`), "name folds in the kind");
  assert.ok(factionDescription(f).some((l) => l.includes(f.kind)), "card shows the kind");
});

test("a non-tribe faction carries no kind", () => {
  const f = generateFaction(tablesK(), subRng(7, "faction", 0, 0, 0), { q: 0, r: 0, index: 0, seed: 7, archetype: "cult" });
  assert.ok(!("kind" in f));
});

test("boss archetypes get boss-tier strength; others keep the 2..4 baseline", () => {
  const t = tablesK();
  const range = (archetype, min, max) => {
    for (let s = 0; s < 30; s++) {
      const f = generateFaction(t, subRng(s, "z", 0, 0, 0), { q: 0, r: 0, index: 0, seed: s, archetype });
      assert.ok(f.strength >= min && f.strength <= max, `${archetype} strength ${f.strength} in ${min}..${max}`);
    }
  };
  range("dragon", 5, 6);
  range("lich", 4, 5);
  range("vampire", 4, 5);
  range("necromancer", 3, 4);
  range("hag", 3, 4);
  range("bandits", 2, 4); // unlisted → default baseline
});

test("eligibleLords maps sites → lords, and the dragon is singular", () => {
  const arche = (poi, terr, factions) => eligibleLords(poi, terr, factions).map((l) => l.archetype);
  assert.deepEqual(arche("tower", "Plains"), ["necromancer"]);
  assert.deepEqual(arche("dungeon", "Plains"), ["lich", "vampire"]);
  assert.deepEqual(arche("dungeon", "Mountains"), ["lich", "vampire", "dragon"]);
  assert.deepEqual(arche("shrine", "Plains"), ["vampire"]);
  assert.deepEqual(arche("camp", "Swamp"), ["hag"]);
  assert.deepEqual(arche("landmark", "Plains"), []);
  // Each eligible option carries a label for the button.
  assert.ok(eligibleLords("tower", "Plains").every((l) => typeof l.label === "string" && l.label));
  // Singular: with a dragon already active, a mountain dungeon no longer offers it.
  const withDragon = [{ archetype: "dragon", status: "active" }];
  assert.ok(!arche("dungeon", "Mountains", withDragon).includes("dragon"));
});

test("promoteFaction raises a hostile lord of the chosen archetype", () => {
  const f = promoteFaction(tablesK(), subRng(1, "faction", 2, 3, 0), {
    q: 2, r: 3, poiId: "poi:0", index: 0, seed: 1, occupant: { by: "A hermit" }, archetype: "lich",
  });
  assert.equal(f.archetype, "lich");
  assert.equal(f.disposition, "hostile");
  assert.ok(f.strength >= 4 && f.strength <= 5, `lich strength ${f.strength}`);
  assert.deepEqual(f.origin, { fromPOI: { q: 2, r: 3, poiId: "poi:0" } });
});

test("a lair-bound lord keeps its lair while its influence spreads", () => {
  const world = placedWorld({ seed: 3, R: 3 });
  const f = generateFaction(tablesK(), subRng(3, "faction", 0, 0, 0), { q: 0, r: 0, index: 0, seed: 3, archetype: "necromancer" });
  world.factions.push(f);
  const lair = { ...f.holdings[0] };
  // Necromancer expands at only .3/turn — run plenty of turns so growth is certain.
  for (let i = 0; i < 40; i++) advanceFactionTurn(world, world.seed);
  assert.deepEqual(f.holdings[0], lair, "the lair (holding #0) never moves");
  assert.ok(f.holdings.length > 1, "influence spread to new hexes");
});

test("rebellion is a rare rollable archetype in the table", () => {
  const t = tables();
  assert.ok(valuesOf("faction-archetype", t).has("rebellion"));
  const reb = t.get("faction-archetype").entries.find((e) => e.value === "rebellion");
  assert.ok(reb.weight <= 1, "low weight → rare");
});

// --- Automatic emergence gate (Phase 9.9, pressure model) ---

// A world with `land` placed passable (Plains) hexes and optional preset factions.
function landWorld(land, over = {}) {
  const hexes = {};
  for (let i = 0; i < land; i++) hexes[axialKey(i, 0)] = { placed: true, coords: { q: i, r: 0 }, terrain: "Plains" };
  return { hexes, factions: [], emergeTicks: 0, emergeSince: EMERGE_COOLDOWN_DAYS, ...over };
}
// A faction holding a run of hexes [x0..x0+size) on row 0 (so they count as claimed).
const heldRun = (id, size, x0 = 0) => ({
  id, status: "active", seat: { q: x0, r: 0 },
  holdings: Array.from({ length: size }, (_, k) => ({ q: x0 + k, r: 0 })),
});

test("rollEmergences: advances emergeTicks by the days walked", () => {
  const w = landWorld(30);
  rollEmergences(w, 4, 1);
  assert.equal(w.emergeTicks, 4);
});

test("rollEmergences: no explored land → nothing emerges", () => {
  const w = landWorld(0);
  assert.deepEqual(rollEmergences(w, 500, 7), []);
});

test("rollEmergences: the cooldown blocks any emergence in its window", () => {
  const w = landWorld(30, { emergeSince: 0 }); // fresh off an emergence
  assert.deepEqual(rollEmergences(w, EMERGE_COOLDOWN_DAYS - 1, 12345), []);
});

test("rollEmergences: an open explored world spawns EXTERNAL powers over time", () => {
  const w = landWorld(30);
  const ems = rollEmergences(w, 400, 3);
  assert.ok(ems.length >= 1, "at least one power rises over a long span");
  assert.ok(ems.every((e) => e.type === "external"), "all external on open ground");
});

test("rollEmergences: a size-scaled ceiling caps the count", () => {
  // 30 land → ceiling = max(3, round(30/6)) = 5. Over a huge span it must not exceed it.
  const ceiling = Math.max(3, Math.round(30 / HEXES_PER_FACTION));
  const ems = rollEmergences(landWorld(30), 20000, 5);
  assert.ok(ems.length <= ceiling, `<= ceiling ${ceiling}, got ${ems.length}`);
  // ...and a smaller map allows fewer than a bigger one.
  const big = rollEmergences(landWorld(90), 20000, 5).length;
  assert.ok(big > ceiling, `a bigger world supports more powers (${big} > ${ceiling})`);
});

test("rollEmergences: a claimed map ruled by one power breeds INTERNAL rebellions", () => {
  // 40 land, one faction holds 38 (dominant, no open ground → external ~0).
  const w = landWorld(40, { factions: [heldRun("faction:big", 38), heldRun("faction:small", 2, 38)] });
  const ems = rollEmergences(w, 600, 4);
  assert.ok(ems.length >= 1, "a rebellion eventually rises");
  assert.ok(ems.every((e) => e.type === "internal" && e.targetId === "faction:big"),
    "all internal, targeting the hegemon");
});

test("rollEmergences: a modest, non-dominant map breeds no rebellion", () => {
  // Two even powers, plenty of open ground → no internal pressure.
  const w = landWorld(40, { factions: [heldRun("faction:a", 4), heldRun("faction:b", 4, 20)] });
  const ems = rollEmergences(w, 600, 4);
  assert.ok(ems.every((e) => e.type === "external"), "no internal rebellion without a hegemon");
});

test("rollEmergences: no eligible lair → a lord never awakens", () => {
  for (let s = 0; s < 40; s++) {
    const ems = rollEmergences(landWorld(40), 5000, s); // bare hexes, no POIs
    assert.ok(ems.every((e) => e.type !== "lord"), "no lair, no lord");
  }
});

test("rollEmergences: a lord can awaken when an eligible lair exists", () => {
  // A Mountains dungeon (dragon/lich/vampire-eligible) among open land.
  const lairWorld = (over = {}) => {
    const w = landWorld(30, over);
    w.hexes[axialKey(-1, 0)] = { placed: true, coords: { q: -1, r: 0 }, terrain: "Mountains", pois: [{ id: "poi:lair", type: "dungeon", occupant: { kind: "none" } }] };
    return w;
  };
  let sawLord = false;
  for (let s = 0; s < 60 && !sawLord; s++) {
    if (rollEmergences(lairWorld(), 4000, s).some((e) => e.type === "lord")) sawLord = true;
  }
  assert.ok(sawLord, "over many long spans a lord eventually wakes in its lair");
});

test("rollEmergences: deterministic for the same world state + seed", () => {
  const a = landWorld(30), b = landWorld(30);
  assert.deepEqual(rollEmergences(a, 300, 42), rollEmergences(b, 300, 42));
  assert.equal(a.emergeTicks, b.emergeTicks);
});

test("rollEmergences: no-ops on junk input", () => {
  assert.deepEqual(rollEmergences(null, 5, 1), []);
  assert.deepEqual(rollEmergences(landWorld(30), 0, 1), []);
  assert.deepEqual(rollEmergences(landWorld(30), -3, 1), []);
});
