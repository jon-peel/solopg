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
