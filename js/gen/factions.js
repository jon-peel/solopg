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
  const lines = [
    `${cap(faction.archetype)} · ${faction.disposition}`,
    `Goal: ${g.kind} (${g.progress ?? 0} / ${g.max ?? 0})`,
    `${holdings} holding${holdings === 1 ? "" : "s"} · strength ${faction.strength}`,
  ];
  if (faction.status && faction.status !== "active") lines.push(`Status: ${faction.status}`);
  return lines;
}
