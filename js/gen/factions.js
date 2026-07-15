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
// v2 (8.19) added `seat` (the HQ; null = seatless). Old factions have no seat field
// and are backfilled lazily on their first turn (see tickFaction).
export const FACTION_BUILD = 2;

// TUNING, not content (per the rules-as-JS-consts convention): the goal's
// doom-clock length and a faction's starting strength are retunable numbers, not
// flavour a GM rolls — so they live here, not in the JSON tables. Ranges echo how
// startChain rolls its trail length. Flagged for real-play retune like every
// other generation constant.
const GOAL_MIN = 5, GOAL_MAX = 8;       // clock segments to complete a goal (4 + d4)
const STRENGTH_MIN = 2, STRENGTH_MAX = 4; // starting power/resource level (1 + d3)

// Boss/rare archetypes (8.16) hit harder than the rolled 2..4 baseline; unlisted
// archetypes fall back to STRENGTH_MIN..STRENGTH_MAX. Retunable, like every gen const.
const ARCHETYPE_STRENGTH = {
  necromancer: [3, 4], lich: [4, 5], vampire: [4, 5], dragon: [5, 6], hag: [3, 4],
};

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
  const [sMin, sMax] = ARCHETYPE_STRENGTH[archetype] || [STRENGTH_MIN, STRENGTH_MAX];
  const strength = inRange(rng, sMin, sMax);
  // A monstrous tribe carries a KIND (goblins/gnolls/…) that flavours its name and
  // card (8.16). Rolled LAST so it never perturbs the other fields' draws, and only
  // when the optional table is loaded (so generateFaction still works with a minimal
  // table set). The name stream is separate (subRng "fname"), so order is safe.
  let kind;
  if (archetype === "monstrous tribe" && tables.get && tables.get("faction-monster-kind")) {
    kind = rollTable(tables.get("faction-monster-kind"), rng).value;
  }
  const name = ctx.name || factionName(ctx.seed, n, { archetype, kind });

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
    // The faction's HQ (Phase 8.19): one of its holdings, or null = "seatless" (a
    // young faction with raw influence but no base yet). The caller decides: a
    // bare-hex birth is seatless; a birth on a valid site passes ctx.seat. A
    // seatless faction seats itself on the first valid site its SOI reaches.
    seat: ctx.seat ?? null,
    // turns: total faction turns taken; sinceTurn: days banked toward the next
    // day-driven turn (a RELATIVE accumulator, reload-safe — see 8.10).
    clock: { turns: 0, sinceTurn: 0 },
    origin: ctx.origin || null,
    status: ctx.status || "active",
    ...(kind ? { kind } : {}),
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
  "Refugees": { disposition: "friendly" }, // no clean archetype → rolled
  // "A hermit" is a POI occupant, not a power — it has no faction archetype, so
  // promoting one just rolls an archetype like any other unmapped occupier.
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
  // A promoted LORD (8.16) is chosen explicitly by its site (ctx.archetype) and is
  // always hostile; otherwise seed archetype/disposition from the occupier label (8.8).
  const archetype = ctx.archetype || seed.archetype; // undefined → generateFaction rolls it
  const disposition = ctx.archetype ? "hostile" : seed.disposition;
  return generateFaction(tables, rng, {
    q: ctx.q, r: ctx.r, poiId: ctx.poiId, index: ctx.index, seed: ctx.seed,
    archetype, disposition,
    // A promote always happens on the occupied POI, so the faction is SEATED there
    // from birth (its lair/base is that site) — never seatless (8.19).
    seat: { q: ctx.q, r: ctx.r, ...(ctx.poiId ? { poiId: ctx.poiId } : {}) },
    origin: { fromPOI: { q: ctx.q, r: ctx.r, ...(ctx.poiId ? { poiId: ctx.poiId } : {}) } },
  });
}

// --- Lair-bound lords (Phase 8.16) ---------------------------------------
// Spreading powers seated at a specific SITE, created ONLY by Promote (never in the
// random archetype roll). Which lord a site can raise is a RULE (POI type + terrain),
// so a JS const. A `unique` lord (the dragon) exists at most once per world.
const LORD_SITES = {
  necromancer: { poi: ["tower"], label: "Raise a necromancer" },
  lich:        { poi: ["dungeon"], label: "Raise a lich" },
  vampire:     { poi: ["dungeon", "shrine"], label: "Wake a vampire" },
  dragon:      { poi: ["dungeon"], terrain: ["Mountains", "Hills"], unique: true, label: "Awaken a dragon" },
  hag:         { terrain: ["Swamp"], label: "A hag claims it" },
};

/** Lord archetypes — never randomly rolled; only reached via Promote. */
export const LORD_ARCHETYPES = Object.keys(LORD_SITES);

/**
 * Which lord(s) an occupied site can be promoted into (Phase 8.16), by POI type +
 * terrain, minus a singular lord that already exists. Pure.
 * @param {string} poiType e.g. "tower" | "dungeon" | "shrine"
 * @param {string} terrain e.g. "Mountains" | "Swamp"
 * @param {object[]} [factions] existing factions (for the singular check)
 * @returns {{ archetype:string, label:string }[]}
 */
export function eligibleLords(poiType, terrain, factions = []) {
  const exists = (a) => (factions || []).some((f) => f.archetype === a && (f.status || "active") === "active");
  const out = [];
  for (const archetype of LORD_ARCHETYPES) {
    const site = LORD_SITES[archetype];
    const poiOk = site.poi ? site.poi.includes(poiType) : true;
    const terrOk = site.terrain ? site.terrain.includes(terrain) : true;
    if (!(poiOk && terrOk)) continue;
    if (site.unique && exists(archetype)) continue;
    out.push({ archetype, label: site.label });
  }
  return out;
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

// --- Seats & sphere-of-influence expansion (Phase 8.19) ------------------
// Roam/spread is retired: EVERY faction grows a sphere of influence (SOI =
// holdings[]); archetype only sets HOW OFTEN it pushes (expansionChance). A
// faction also has a formal SEAT (its HQ, one of its holdings, or null when
// "seatless"). Seat vs SOI, the seat's stiffer defence, and relocate-or-dissolve
// all live below. Numbers are TUNING (retunable consts), not content.

// Per-turn chance a faction expands (draws the expansion gate in tickFaction).
// Aggressive powers (cults, tribes, bandits) push most turns; lair-bound lords
// creep. Unlisted archetypes fall back to EXPANSION_FALLBACK.
const EXPANSION_CHANCE = {
  cult: 0.7, "monstrous tribe": 0.65, bandits: 0.6, "thieves' guild": 0.55,
  "mercenary company": 0.55, "merchant guild": 0.5, "noble house": 0.4, rebellion: 0.5,
  necromancer: 0.3, lich: 0.3, vampire: 0.3, hag: 0.35, dragon: 0.25,
};
const EXPANSION_FALLBACK = 0.4;
const expansionChance = (faction) => EXPANSION_CHANCE[faction.archetype] ?? EXPANSION_FALLBACK;

// A defender's SEAT is much harder to take than a plain SOI hex: its strength is
// multiplied by this in the contest (still a small, non-zero chance to fall).
const SEAT_DEFENSE = 6;
// When a seat falls the faction relocates and its reach falters — it keeps this
// fraction of its (non-seat) SOI, the nearest half, and loses the rest.
const SOI_DISRUPTION = 0.5;

// What kind of site an archetype may SEAT on (a rule, so a JS const). "any" =
// any settlement OR POI (bandits set up in a town or a ruin alike); "poi" = a POI
// only, never a town (a monstrous tribe lairs, it doesn't hold a settlement).
// Lair-bound lords are NOT listed here — they seat only on their bound site from
// LORD_SITES (a lich in its dungeon, a hag in a swamp POI, …).
const SEAT_SITES = {
  bandits: "any", cult: "any", "thieves' guild": "any", "merchant guild": "any",
  "noble house": "any", "mercenary company": "any", rebellion: "any",
  "monstrous tribe": "poi",
};

/**
 * Can `archetype` seat on the hex at (q,r)? True when the hex carries a
 * settlement/POI of a kind the archetype is allowed to base itself on (Phase
 * 8.19). A lair-bound lord uses its bound site (LORD_SITES); everyone else uses
 * SEAT_SITES. Unknown archetypes never seat (safe). Pure.
 * @param {object} world
 * @param {string} archetype
 * @param {number} q @param {number} r
 * @returns {boolean}
 */
export function isValidSeat(world, archetype, q, r) {
  const hex = world && world.hexes && world.hexes[axialKey(q, r)];
  if (!hex || !hex.placed) return false;
  const pois = Array.isArray(hex.pois) ? hex.pois : [];
  // A lair-bound lord seats only on its bound POI type + terrain (mirrors eligibleLords).
  const lair = LORD_SITES[archetype];
  if (lair) {
    return pois.some((p) => {
      const poiOk = lair.poi ? lair.poi.includes(p.type) : true;
      const terrOk = lair.terrain ? lair.terrain.includes(hex.terrain) : true;
      return poiOk && terrOk;
    });
  }
  const rule = SEAT_SITES[archetype];
  const hasSettlement = !!(hex.settlement && hex.settlement.present);
  if (rule === "poi") return pois.length > 0;
  if (rule === "any") return pois.length > 0 || hasSettlement;
  return false;
}

// Is (q,r) this faction's seat hex? A pointer check on faction.seat (independent
// of isValidSeat — a seat once taken stays the seat even on odd ground).
const isSeatHex = (faction, q, r) => !!(faction.seat && faction.seat.q === q && faction.seat.r === r);

// Seat a seatless faction on the site it just took, if that site is a valid seat
// for its archetype (Phase 8.19 — the first base wins). Returns true if it seated.
function maybeSeat(world, faction, q, r) {
  if (faction.seat) return false;
  if (!isValidSeat(world, faction.archetype, q, r)) return false;
  const h = (faction.holdings || []).find((x) => x.q === q && x.r === r);
  faction.seat = h ? { ...h } : { q, r };
  return true;
}

// Relocate a faction whose SEAT just fell (Phase 8.19): move it to the nearest
// remaining holding that is a valid seat site, then HALVE the SOI (keep the new
// seat + the nearest SOI_DISRUPTION of the other holdings). Mutates the faction.
// Returns the new seat, or null when no holding can host one (→ caller dissolves).
function relocateSeat(world, faction, lost) {
  const holdings = faction.holdings || [];
  const cands = holdings.filter((h) => isValidSeat(world, faction.archetype, h.q, h.r));
  if (!cands.length) return null;
  cands.sort((a, b) =>
    axialDistance(a.q, a.r, lost.q, lost.r) - axialDistance(b.q, b.r, lost.q, lost.r) || a.q - b.q || a.r - b.r);
  const seat = { ...cands[0] };
  const others = holdings.filter((h) => !(h.q === seat.q && h.r === seat.r));
  others.sort((a, b) =>
    axialDistance(a.q, a.r, seat.q, seat.r) - axialDistance(b.q, b.r, seat.q, seat.r) || a.q - b.q || a.r - b.r);
  const keep = Math.floor(others.length * SOI_DISRUPTION);
  faction.holdings = [seat, ...others.slice(0, keep).map((h) => ({ ...h }))];
  faction.seat = { ...seat };
  return seat;
}

// Destroy a faction (Phase 8.19) — the single dissolution route (0 holdings, or a
// seat that fell with nowhere to relocate). Appends the `eliminated` event.
function dissolve(faction, events, byFactionId) {
  faction.status = "destroyed";
  faction.seat = null;
  events.push({ kind: "eliminated", factionId: faction.id, ...(byFactionId ? { byFactionId } : {}) });
}

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

/**
 * @typedef {{
 *   kind: "claim"|"takeover"|"repelled"|"eliminated"|"relocate",
 *   factionId: string,        // the acting faction (for "eliminated"/"relocate": the faction itself)
 *   q?: number, r?: number,   // the hex acted on (absent on "eliminated"; "relocate": the new seat)
 *   fromFactionId?: string,   // "takeover"/"repelled": the rival that held/holds the hex
 *   byFactionId?: string,     // "eliminated": the faction that finished it off
 *   from?: { q:number, r:number }, // "relocate": the seat hex just lost
 *   seated?: boolean,         // "claim"/"takeover": this claim became the faction's seat
 * }} FactionEvent
 */

// The first ACTIVE faction other than exceptId whose holdings include (q,r), or
// null. The "who holds this hex" read that makes the frontier contestable. Pure.
function holderOf(world, q, r, exceptId) {
  for (const f of (world && world.factions) || []) {
    if (!isActive(f) || f.id === exceptId) continue;
    if ((f.holdings || []).some((h) => h.q === q && h.r === r)) return f;
  }
  return null;
}

/**
 * The faction's spatial act for one turn (Phase 8.19) — pure SOI growth. Every
 * faction spreads (roam/spread retired); the per-turn CHANCE is what varies by
 * archetype, gated in tickFaction. Grows into open ground first; only contests a
 * rival at the border, and there prefers the rival's SOI edges over its stiffer
 * SEAT. A seatless faction seats on the first valid site it takes. A defender who
 * loses its SEAT relocates-or-dissolves; one reduced to no holdings dissolves.
 * Returns 0+ events. Exported so a single faction's turn can be unit-tested
 * directly (the gate + turn loop live in tickFaction / advanceFaction*).
 * Deterministic: the frontier is q,r-sorted; rng is drawn only to pick a hex and
 * (when contesting) to resolve the contest, in that fixed order.
 * @param {object} world
 * @param {object} faction
 * @param {() => number} rng
 * @returns {FactionEvent[]}
 */
export function expand(world, faction, rng) {
  const holdings = faction.holdings || (faction.holdings = []);
  const held = new Set(holdings.map((h) => axialKey(h.q, h.r)));

  // The frontier: every passable placed hex adjacent to the SOI that this faction
  // doesn't already hold, deduped and q,r-sorted (stable before the rng pick).
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
  if (!frontier.length) return [];
  frontier.sort((a, b) => a.q - b.q || a.r - b.r);

  const empty = [], rival = [];
  for (const n of frontier) (holderOf(world, n.q, n.r, faction.id) ? rival : empty).push(n);

  // Open ground first: claim it (and seat on it if seatless + it's a valid site).
  if (empty.length) {
    const pick = empty[Math.floor(rng() * empty.length)];
    holdings.push({ q: pick.q, r: pick.r });
    const seated = maybeSeat(world, faction, pick.q, pick.r);
    return [{ kind: "claim", factionId: faction.id, q: pick.q, r: pick.r, ...(seated ? { seated: true } : {}) }];
  }
  if (!rival.length) return [];

  // Contest a rival border hex — attack the edges before the capital: prefer the
  // rival's plain SOI hexes; only strike a seat when nothing else is on the border.
  const seatRivalOf = (n) => { const d = holderOf(world, n.q, n.r, faction.id); return d && isSeatHex(d, n.q, n.r); };
  const soi = rival.filter((n) => !seatRivalOf(n));
  const pool = soi.length ? soi : rival;
  const pick = pool[Math.floor(rng() * pool.length)];
  const def = holderOf(world, pick.q, pick.r, faction.id);
  const atk = faction.strength || 1;
  const guard = isSeatHex(def, pick.q, pick.r) ? SEAT_DEFENSE : 1; // a seat is dug in
  const dfn = ((def && def.strength) || 1) * guard;

  if (rng() < atk / (atk + dfn)) {
    // win: the hex moves from loser to winner.
    const lostSeat = isSeatHex(def, pick.q, pick.r);
    def.holdings = (def.holdings || []).filter((h) => !(h.q === pick.q && h.r === pick.r));
    holdings.push({ q: pick.q, r: pick.r });
    const events = [{ kind: "takeover", factionId: faction.id, q: pick.q, r: pick.r, fromFactionId: def.id }];
    if (maybeSeat(world, faction, pick.q, pick.r)) events[0].seated = true;
    // The loser reacts: a lost SEAT relocates-or-dissolves; a lost SOI hex only
    // ends the faction when it was its very last holding.
    if (lostSeat) {
      const moved = relocateSeat(world, def, { q: pick.q, r: pick.r });
      if (moved) events.push({ kind: "relocate", factionId: def.id, q: moved.q, r: moved.r, from: { q: pick.q, r: pick.r } });
      else dissolve(def, events, faction.id);
    } else if ((def.holdings || []).length === 0) {
      dissolve(def, events, faction.id);
    }
    return events;
  }
  // loss: nothing changes.
  return [{ kind: "repelled", factionId: faction.id, q: pick.q, r: pick.r, fromFactionId: def.id }];
}

/**
 * Advance ONE turn for one faction (pure; mutates the faction). The goal
 * doom-clock ticks a segment, disposition occasionally drifts, and — GATED on a
 * per-archetype expansion roll (8.19) — the faction grows its SOI (claim/contest,
 * with seat rules). rng calls happen in a fixed order (drift → expansion gate →
 * pick → contest) so the outcome is deterministic for a given stream. Not
 * exported — reached via advanceFactionTurn / advanceFactionDays.
 * @returns {FactionEvent[]} what the faction did on the map this turn
 */
function tickFaction(world, faction, rng) {
  // Lazy seat backfill (8.19): pre-8.19 factions have no `seat` field. Seat their
  // first holding if it's a valid site for their archetype, else mark them
  // seatless. Runs once (rng-free), keyed on `seat === undefined`.
  if (faction.seat === undefined) {
    const h0 = (faction.holdings || [])[0];
    faction.seat = h0 && isValidSeat(world, faction.archetype, h0.q, h0.r) ? { ...h0 } : null;
  }
  const g = faction.goal || (faction.goal = { progress: 0, max: 0 });
  g.progress = Math.min((g.progress ?? 0) + 1, g.max ?? 0); // doom clock, capped
  if (rng() < DRIFT_CHANCE) {
    const i = DISPOSITIONS.indexOf(faction.disposition);
    if (i >= 0) {
      const j = Math.max(0, Math.min(DISPOSITIONS.length - 1, i + (rng() < 0.5 ? -1 : 1)));
      faction.disposition = DISPOSITIONS[j];
    }
  }
  let events = [];
  if (rng() < expansionChance(faction)) events = expand(world, faction, rng);
  const clock = ensureClock(faction);
  clock.turns = (clock.turns ?? 0) + 1;
  return events;
}

// Deterministic per-turn stream: keyed on the faction id + its turn ordinal, so
// consecutive turns differ and any turn is reproducible from the world seed.
const turnRng = (seed, faction) => subRng(seed, "factionturn", faction.id, ensureClock(faction).turns);

/**
 * MANUAL turn (Phase 8.10) — advance exactly one turn for every ACTIVE faction,
 * independent of the day clock (leaves `clock.sinceTurn` untouched). Mutates the
 * world. A faction destroyed earlier in the loop is skipped by the isActive guard.
 * @param {object} world
 * @param {number|string} seed world seed
 * @returns {FactionEvent[]} every event across the factions ticked, in turn order
 */
export function advanceFactionTurn(world, seed) {
  const events = [];
  for (const f of world.factions || []) {
    if (!isActive(f)) continue;
    events.push(...tickFaction(world, f, turnRng(seed, f)));
  }
  return events;
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
 * @returns {FactionEvent[]} every event across every turn fired, in turn order
 */
export function advanceFactionDays(world, days, seed) {
  if (!Number.isFinite(days) || days < 1) return [];
  const events = [];
  for (const f of world.factions || []) {
    if (!isActive(f)) continue;
    const clock = ensureClock(f);
    clock.sinceTurn = (clock.sinceTurn || 0) + days;
    while (clock.sinceTurn >= TURN_LENGTH_DAYS) {
      events.push(...tickFaction(world, f, turnRng(seed, f)));
      clock.sinceTurn -= TURN_LENGTH_DAYS;
    }
  }
  return events;
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
  // Seat vs SOI (8.19): the HQ, then the reach. A seatless faction shows it plainly.
  const seat = faction.seat ? `Seat: (${faction.seat.q}, ${faction.seat.r})` : "Seatless (raw influence)";
  const lines = [
    `${cap(faction.archetype)}${faction.kind ? ` (${faction.kind})` : ""} · ${faction.disposition}`,
    `Goal: ${g.kind} (${g.progress ?? 0} / ${g.max ?? 0})`,
    seat,
    `${holdings} holding${holdings === 1 ? "" : "s"} · strength ${faction.strength}`,
    `Turn ${clock.turns ?? 0} · ${clock.sinceTurn ?? 0}/${TURN_LENGTH_DAYS} d to next`,
  ];
  if (faction.status && faction.status !== "active") lines.push(`Status: ${faction.status}`);
  return lines;
}
