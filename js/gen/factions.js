// Faction generator (Phase 8.7, Arc B) — the faction object + its create-time
// generator, plus composed-at-render prose.
//
// Pure: given preloaded tables + an rng stream + context (where the holding sits),
// returns one STRUCTURED faction. As with hooks/feature-detail, prose is composed
// FROM the picks at render time (factionLabel / factionDescription) — the picks are
// stored, the sentence is not.
//
// 8.7 fills the create-time subset of the master-plan shape: origin is null until
// Promote (8.8); clock / goal.progress / strength are INITIALISED here and only
// ticked from faction turns (8.10). No schema bump — v16 already reserved
// world.factions[]; the shape self-heals on a later change via FACTION_BUILD, the
// same way HOOK_BUILD / DUNGEON_BUILD do.

import { rollTable } from "../core/table.js";
import { subRng } from "../core/rng.js";
import { neighbors, axialKey, axialDistance } from "../core/hexgeo.js";
import { TRAVEL_COST } from "./travel.js";
import { factionName } from "./faction-name.js";

// Faction-shape version, stamped on every generated faction. Bump on shape change.
export const FACTION_BUILD = 1;

// TUNING, not content (per the rules-as-JS-consts convention): the goal's
// doom-clock length and a faction's starting strength are retunable numbers, not
// flavour a GM rolls — so they live here, not in the JSON tables. Ranges echo how
// startChain rolls its trail length. Flagged for real-play retune like every
// other generation constant.
const GOAL_MIN = 5, GOAL_MAX = 8;       // clock segments to complete a goal (4 + d4)
const STRENGTH_MIN = 2, STRENGTH_MAX = 4; // starting power/resource level (1 + d3)

const inRange = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

/**
 * Generate one faction with a single starting holding.
 * @param {Map<string,object>} tables incl. faction-archetype / faction-goal / faction-disposition
 * @param {() => number} rng dedicated sub-stream for this faction
 * @param {{ q:number, r:number, index?:number, seed?:number|string, poiId?:string,
 *   archetype?:string, disposition?:string, name?:string,
 *   origin?:{fromPOI:{q,r,poiId?}}|null }} ctx
 *   q,r: the holding's coords. index: nextFactionId (also seeds the name). seed:
 *   world seed (for the derived name). archetype/disposition/name may be supplied
 *   (Promote in 8.8 seeds them from an occupier label); otherwise rolled.
 * @returns {object} the structured faction
 */
export function generateFaction(tables, rng, ctx) {
  const n = ctx.index ?? 0;
  const archetype = ctx.archetype || rollTable(tables.get("faction-archetype"), rng).value;
  const disposition = ctx.disposition || rollTable(tables.get("faction-disposition"), rng).value;
  const goalKind = rollTable(tables.get("faction-goal"), rng).value;
  const max = inRange(rng, GOAL_MIN, GOAL_MAX);
  const strength = inRange(rng, STRENGTH_MIN, STRENGTH_MAX);
  const name = ctx.name || factionName(ctx.seed, n, { archetype });

  const holding = { q: ctx.q, r: ctx.r };
  if (ctx.poiId) holding.poiId = ctx.poiId;

  return {
    id: `faction:${n}`,
    build: FACTION_BUILD,
    name,
    archetype,
    disposition,
    goal: { kind: goalKind, progress: 0, max },
    strength,
    holdings: [holding],
    // turns: total faction turns taken; sinceTurn: days banked toward the next
    // day-driven turn (a RELATIVE accumulator, reload-safe — see 8.10).
    clock: { turns: 0, sinceTurn: 0 },
    origin: ctx.origin || null,
    status: ctx.status || "active",
  };
}

// Occupier label -> faction seed (Phase 8.8). A RULE (which occupier reads as
// which kind of power), so it's a JS const here, not a table. A mapped label pins
// the archetype so a promoted threat reads as the SAME one (Bandits stay
// bandit-like); an unmapped/partial entry (Refugees) leaves archetype undefined
// so generateFaction rolls it, but still seeds a coherent disposition.
const OCCUPIER_SEED = {
  "Bandits": { archetype: "bandits", disposition: "hostile" },
  "Cutthroats": { archetype: "bandits", disposition: "hostile" },
  "Smugglers": { archetype: "thieves' guild", disposition: "wary" },
  "Cultists": { archetype: "cult", disposition: "hostile" },
  "Pilgrims": { archetype: "cult", disposition: "neutral" },
  "Deserters": { archetype: "mercenary company", disposition: "wary" },
  "A hermit": { archetype: "hermit order", disposition: "neutral" },
  "Refugees": { disposition: "friendly" }, // no clean archetype → rolled
};

/**
 * Promote an existing occupied POI into a faction (Phase 8.8) — a thin wrapper
 * over generateFaction that seeds archetype/disposition from the occupier label
 * (so it reads as the same threat) and records the source POI as its origin.
 * @param {Map<string,object>} tables
 * @param {() => number} rng
 * @param {{ q:number, r:number, poiId?:string, index?:number, seed?:number|string,
 *   occupant?:{ by?:string } }} ctx
 * @returns {object} the structured faction
 */
export function promoteFaction(tables, rng, ctx) {
  const label = ctx.occupant && ctx.occupant.by;
  const seed = OCCUPIER_SEED[label] || {};
  return generateFaction(tables, rng, {
    q: ctx.q, r: ctx.r, poiId: ctx.poiId, index: ctx.index, seed: ctx.seed,
    archetype: seed.archetype,       // undefined → generateFaction rolls it
    disposition: seed.disposition,   // undefined → generateFaction rolls it
    origin: { fromPOI: { q: ctx.q, r: ctx.r, ...(ctx.poiId ? { poiId: ctx.poiId } : {}) } },
  });
}

/**
 * Attach a holding to an existing faction (Phase 8.9) — the "reuse one faction
 * across the map" seam (a gang with several camps). Dedupes by (q,r): the same
 * hex can't be claimed twice by the SAME faction (two different factions
 * contesting a hex is allowed). Mutates the faction.
 * @param {object} faction
 * @param {{ q:number, r:number, poiId?:string }} holding
 * @returns {boolean} true if added, false if the faction already held that hex
 */
export function addHolding(faction, holding) {
  if (!Array.isArray(faction.holdings)) faction.holdings = [];
  const dup = faction.holdings.some((h) => h.q === holding.q && h.r === holding.r);
  if (dup) return false;
  const h = { q: holding.q, r: holding.r };
  if (holding.poiId) h.poiId = holding.poiId;
  faction.holdings.push(h);
  return true;
}

// --- Faction turns (Phase 8.10) ------------------------------------------
// TUNING (JS consts, retunable like every generation number): how many days make
// one faction turn, and how often disposition/strength drift on a turn.
export const TURN_LENGTH_DAYS = 7;
const DRIFT_CHANCE = 0.34;
// Disposition scale — drift steps one place along it (clamped at the ends).
const DISPOSITIONS = ["hostile", "wary", "neutral", "friendly"];

// Archetype -> how a faction acts on the map each turn (Phase 8.13): a roaming
// warband MOVES its camp; a rooted power SPREADS its footprint; a hermit STAYS.
// Unknown archetypes default to static (safe).
const ARCHETYPE_MOBILITY = {
  bandits: "roaming", "monstrous tribe": "roaming", "mercenary company": "roaming",
  cult: "spreading", "thieves' guild": "spreading", "merchant guild": "spreading", "noble house": "spreading",
  "hermit order": "static",
};
export const HOLDING_CAP = 6; // a spreading faction stops growing here (tunable)

const isActive = (f) => (f.status || "active") === "active";
const ensureClock = (f) => (f.clock || (f.clock = { turns: 0, sinceTurn: 0 }));

// A hex is a movement/expansion candidate only if it is PLACED and passable on
// foot — reusing travel's single source of truth (TRAVEL_COST 0 = Sea/Lake, so
// factions never step onto water; naval travel stays out of scope). Movement
// therefore stays within the revealed map (no lazy tile generation here).
function passableNeighborsOf(world, q, r) {
  const hexes = (world && world.hexes) || {};
  return neighbors(q, r)
    .filter((n) => {
      const h = hexes[axialKey(n.q, n.r)];
      return h && h.placed && (TRAVEL_COST[h.terrain] || 0) > 0;
    })
    .sort((a, b) => a.q - b.q || a.r - b.r); // stable order before the rng pick
}

// The faction's spatial act for one turn (Phase 8.13), by archetype mobility.
// Deterministic: consumes the turn's rng only when there's a candidate hex.
function moveOrSpread(world, faction, rng) {
  const mobility = ARCHETYPE_MOBILITY[faction.archetype] || "static";
  if (mobility === "static") return;
  const holdings = faction.holdings || (faction.holdings = []);
  const held = new Set(holdings.map((h) => axialKey(h.q, h.r)));

  if (mobility === "roaming") {
    const primary = holdings[0];
    if (!primary) return;
    const cands = passableNeighborsOf(world, primary.q, primary.r)
      .filter((n) => !held.has(axialKey(n.q, n.r)));
    if (!cands.length) return;
    const pick = cands[Math.floor(rng() * cands.length)];
    holdings[0] = { q: pick.q, r: pick.r }; // camp is now in the field — poiId dropped
    return;
  }

  // spreading — claim one passable placed hex adjacent to the blob, up to the cap.
  if (holdings.length >= HOLDING_CAP) return;
  const seen = new Set();
  const frontier = [];
  for (const h of holdings) {
    for (const n of passableNeighborsOf(world, h.q, h.r)) {
      const k = axialKey(n.q, n.r);
      if (held.has(k) || seen.has(k)) continue;
      seen.add(k);
      frontier.push(n);
    }
  }
  if (!frontier.length) return;
  frontier.sort((a, b) => a.q - b.q || a.r - b.r);
  const pick = frontier[Math.floor(rng() * frontier.length)];
  holdings.push({ q: pick.q, r: pick.r });
}

/**
 * Advance ONE turn for one faction (pure; mutates the faction). The goal
 * doom-clock ticks a segment, disposition occasionally drifts, and the faction
 * acts on the map by its archetype (move/spread/stay, 8.13). Strength is left
 * alone — a stable inherent value reserved for 8.12 hook loudness. rng calls
 * happen in a fixed order so the outcome is deterministic for a given stream.
 * Not exported — reached via advanceFactionTurn / advanceFactionDays.
 */
function tickFaction(world, faction, rng) {
  const g = faction.goal || (faction.goal = { progress: 0, max: 0 });
  g.progress = Math.min((g.progress ?? 0) + 1, g.max ?? 0); // doom clock, capped
  if (rng() < DRIFT_CHANCE) {
    const i = DISPOSITIONS.indexOf(faction.disposition);
    if (i >= 0) {
      const j = Math.max(0, Math.min(DISPOSITIONS.length - 1, i + (rng() < 0.5 ? -1 : 1)));
      faction.disposition = DISPOSITIONS[j];
    }
  }
  moveOrSpread(world, faction, rng);
  const clock = ensureClock(faction);
  clock.turns = (clock.turns ?? 0) + 1;
  return faction;
}

// Deterministic per-turn stream: keyed on the faction id + its turn ordinal, so
// consecutive turns differ and any turn is reproducible from the world seed.
const turnRng = (seed, faction) => subRng(seed, "factionturn", faction.id, ensureClock(faction).turns);

/**
 * MANUAL turn (Phase 8.10) — advance exactly one turn for every ACTIVE faction,
 * independent of the day clock (leaves `clock.sinceTurn` untouched). Mutates the
 * world. Returns how many factions ticked.
 * @param {object} world
 * @param {number|string} seed world seed
 * @returns {number}
 */
export function advanceFactionTurn(world, seed) {
  let n = 0;
  for (const f of world.factions || []) {
    if (!isActive(f)) continue;
    tickFaction(world, f, turnRng(seed, f));
    n++;
  }
  return n;
}

/**
 * DAY-DRIVEN turns (Phase 8.10) — accumulate `days` per active faction and fire a
 * turn for each whole TURN_LENGTH_DAYS, carrying the remainder in
 * `clock.sinceTurn`. `sinceTurn` is a RELATIVE accumulator (days since the last
 * turn), so it is reload-safe even though the day counter is session-only, and a
 * faction created late only counts days from its creation. Mutates the world.
 * @param {object} world
 * @param {number} days days elapsed
 * @param {number|string} seed world seed
 * @returns {number} total turns fired across all factions
 */
export function advanceFactionDays(world, days, seed) {
  if (!Number.isFinite(days) || days < 1) return 0;
  let fired = 0;
  for (const f of world.factions || []) {
    if (!isActive(f)) continue;
    const clock = ensureClock(f);
    clock.sinceTurn = (clock.sinceTurn || 0) + days;
    while (clock.sinceTurn >= TURN_LENGTH_DAYS) {
      tickFaction(world, f, turnRng(seed, f));
      clock.sinceTurn -= TURN_LENGTH_DAYS;
      fired++;
    }
  }
  return fired;
}

// --- Faction-emitted hooks (Phase 8.11, Arc C) ---------------------------
// A faction "stirs up trouble": it emits a NORMAL hook through the unchanged
// hooks.js engine, but a faction hook is NOT a generic one — it NAMES the faction,
// describes what it did, and points the party AT the faction's lair. That last
// part is why it's always a `threat`: `threat` is the only engine verb whose prose
// prints the menace name (→ the faction) AND carries a `lair` (→ the holding to go
// to). The app builds a synthetic lair-subject and hands the engine verb + source;
// factions.js just supplies those strings (no hooks.js import).

// Goal -> the "word on the wind" that reaches town, used as the hook's `source`.
// A rule (which goal reads as which rumour), so a JS const, tunable like the rest.
const GOAL_RUMOUR = {
  "seize the region":        "Word of a gathering power",
  "hoard wealth":            "Talk of coin changing hands",
  "drive out rivals":        "Rumour of a turf war",
  "spread the faith":        "Whispers of new converts",
  "awaken something buried": "Uneasy talk from the diggings",
  "restore a fallen house":  "Old banners seen again",
  "control the trade roads": "Merchants grumbling on the road",
  "raid the frontier":       "Smoke on the frontier",
};

// How often a stir opens with the faction's goal rumour vs a rolled witness — so
// consecutive stirs don't all start the same way (the "every hook reads the same"
// fix). Tunable.
const RUMOUR_CHANCE = 0.5;

/**
 * The hook-engine context a faction contributes when it stirs up trouble
 * (Phase 8.11). Always a `threat` (so the faction is named and the hook points at
 * its lair). The `claim` is a rolled faction-deed (vivid, varied — the party hears
 * a *different* crime each time), and the `source` alternates between the goal
 * rumour and a rolled witness so the opening varies too. Pure given tables + rng;
 * deterministic (fixed roll order: deed, then the source coin-flip/roll).
 * @param {object} faction
 * @param {() => number} rng dedicated per-stir stream
 * @param {Map<string,object>} tables incl. faction-deed + hook-source
 * @returns {{ verb:string, claim:string, source?:string }}
 */
export function factionHookContext(faction, rng, tables) {
  const claim = rollTable(tables.get("faction-deed"), rng).value;
  const rumour = (faction && faction.goal && GOAL_RUMOUR[faction.goal.kind]) || null;
  // Goal rumour part of the time (ties the opening to the faction's aim); else a
  // rolled witness ("A frightened merchant") so openings don't repeat.
  const source = rumour && rng() < RUMOUR_CHANCE
    ? rumour
    : rollTable(tables.get("hook-source"), rng).value;
  return { verb: "threat", claim, source };
}

// --- Auto-fire faction hooks (Phase 8.12) --------------------------------
// As days pass, a faction's deeds reach the party on their own — likelier when the
// faction is LOUD (strength) and NEAR (party → its lair): "news by distance". This
// is where strength (stable since 8.13) is finally read. Rules-as-JS-consts.
const AUTO_HOOK_BASE = 0.02; // per strength-point per day, at the party's doorstep
const AUTO_HOOK_MAX = 0.2;   // cap — even a strong neighbour isn't a firehose
export const AUTO_HOOK_CAP = 2; // most auto-hooks one advance spawns per faction

/**
 * Per-day chance an active faction's deeds reach the party. 0 for an inactive
 * faction, or with no party / no holding. Rises with strength, falls with the
 * party→lair distance, capped at AUTO_HOOK_MAX. Pure.
 * @param {object} faction
 * @param {{q:number,r:number}} party party marker position
 * @returns {number} probability in [0, AUTO_HOOK_MAX]
 */
export function autoHookChance(faction, party) {
  if (!faction || (faction.status || "active") !== "active") return 0;
  const lair = (faction.holdings || [])[0];
  if (!lair || !party) return 0;
  const dist = axialDistance(party.q, party.r, lair.q, lair.r);
  return Math.min((AUTO_HOOK_BASE * (faction.strength || 1)) / (1 + dist), AUTO_HOOK_MAX);
}

/**
 * How many hooks a faction auto-emits over `days` elapsed — one roll per day at
 * autoHookChance, capped at AUTO_HOOK_CAP so a long march doesn't flood. Pure and
 * deterministic for a given rng stream (the app seeds it on the session day).
 * @param {object} faction
 * @param {{q:number,r:number}} party
 * @param {number} days elapsed days
 * @param {() => number} rng
 * @returns {number}
 */
export function rollAutoHookCount(faction, party, days, rng) {
  const chance = autoHookChance(faction, party);
  if (chance <= 0 || !(days >= 1)) return 0;
  let count = 0;
  for (let i = 0; i < days; i++) if (rng() < chance) count++;
  return Math.min(count, AUTO_HOOK_CAP);
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Short label for the factions list (just the name). */
export function factionLabel(faction) {
  return faction ? faction.name : null;
}

/**
 * Composed description lines for the Factions panel (prose built from the picks).
 * Never stored — the compose-at-render rule from feature-detail.js/hooks.
 * @param {object} faction
 * @returns {string[]}
 */
export function factionDescription(faction) {
  if (!faction) return [];
  const g = faction.goal || {};
  const holdings = Array.isArray(faction.holdings) ? faction.holdings.length : 0;
  const clock = faction.clock || {};
  const lines = [
    `${cap(faction.archetype)} · ${faction.disposition}`,
    `Goal: ${g.kind} (${g.progress ?? 0} / ${g.max ?? 0})`,
    `${holdings} holding${holdings === 1 ? "" : "s"} · strength ${faction.strength}`,
    `Turn ${clock.turns ?? 0} · ${clock.sinceTurn ?? 0}/${TURN_LENGTH_DAYS} d to next`,
  ];
  if (faction.status && faction.status !== "active") lines.push(`Status: ${faction.status}`);
  return lines;
}
