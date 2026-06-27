// Adventure-hook generator (Phase 6) — Type-1 local hooks.
//
// Pure: given preloaded tables + an rng stream + context (the candidate subjects
// gathered from the world + the origin coords), returns one STRUCTURED hook. As
// with feature-detail, prose is composed FROM the picks at render time
// (hookName / hookDescription) — the picks are stored, the sentence is not.
//
// 6.1 implements the KNOWN pattern only: the hook points at a POI that already
// exists on the map. `accuracy` models how reliable the directions are — weighted
// reliable, "wrong" usually a positional error (off by one hex), rarely a flat
// false lead. Everything is GM-visible (this is a GM tool); there is no hidden
// truth. Distant / Map / Chain / Return patterns and more verbs arrive in 6.2+.

import { rollTable } from "../core/table.js";
import { pick } from "../core/rng.js";
import { axialToPixel, axialDistance, neighbors, NEIGHBOR_DIRS } from "../core/hexgeo.js";

// Hook-shape version, stamped on every generated hook. Lets a later shape change
// self-heal old saves on open, mirroring FEATURE_BUILD / DUNGEON_BUILD. Bump on
// shape change.
export const HOOK_BUILD = 1;

// Verbs that carry a claim sub-table (hook-<verb>). Grows in 6.5.
export const HOOK_VERBS = new Set(["explore", "threat"]);

const COMPASS = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
const BEARING_WORDS = {
  N: "north", S: "south", E: "east", W: "west",
  NE: "north-east", NW: "north-west", SE: "south-east", SW: "south-west",
};

// Compass label from origin -> target. Uses pixel geometry; screen y grows down,
// so negate dy for a north-up bearing. null when the two cells coincide.
export function bearingTo(from, to) {
  const a = axialToPixel(from.q, from.r, 1);
  const b = axialToPixel(to.q, to.r, 1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return null;
  const ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return COMPASS[((Math.round(ang / 45) % 8) + 8) % 8];
}

/**
 * Roll a resolution pattern. KNOWN needs an existing POI to point at, so with no
 * candidate subjects we fall back to DISTANT (which generates its own target).
 * @param {Map<string,object>} tables incl. hook-pattern
 * @param {() => number} rng
 * @param {boolean} hasSubjects whether any on-map POI exists to be a Known subject
 * @returns {"known"|"distant"}
 */
export function rollHookPattern(tables, rng, hasSubjects) {
  const pattern = rollTable(tables.get("hook-pattern"), rng).value;
  return pattern === "known" && !hasSubjects ? "distant" : pattern;
}

/**
 * Choose a target cell for a DISTANT hook: walk a random axial direction a random
 * distance from the origin, landing on an UNOCCUPIED cell (so we never clobber an
 * existing hex). Walking straight keeps the bearing a clean compass point. Pure —
 * the occupancy test is injected. Returns { q, r, distance } or null if no free
 * cell is found in a handful of attempts.
 * @param {() => number} rng
 * @param {{q:number,r:number}} origin
 * @param {(q:number,r:number)=>boolean} isOccupied
 * @param {{ minDistance?:number, maxDistance?:number }} [opts]
 */
export function chooseDistantTarget(rng, origin, isOccupied, opts = {}) {
  const min = opts.minDistance ?? 2;
  const max = opts.maxDistance ?? 6;
  for (let attempt = 0; attempt < 24; attempt++) {
    const dist = min + Math.floor(rng() * (max - min + 1));
    const [dq, dr] = NEIGHBOR_DIRS[Math.floor(rng() * NEIGHBOR_DIRS.length)];
    const q = origin.q + dq * dist;
    const r = origin.r + dr * dist;
    if (!isOccupied(q, r)) return { q, r, distance: dist };
  }
  return null;
}

// Proximity-weighted subject pick: nearer POIs are likelier gossip (weight
// 1/(1+distance)), but distant ones stay possible. Consumes exactly one rng().
function pickSubject(rng, subjects, origin) {
  let total = 0;
  const weights = subjects.map((s) => {
    const w = 1 / (1 + axialDistance(origin.q, origin.r, s.q, s.r));
    total += w;
    return w;
  });
  let target = rng() * total;
  for (let i = 0; i < subjects.length; i++) {
    target -= weights[i];
    if (target < 0) return subjects[i];
  }
  return subjects[subjects.length - 1];
}

/**
 * Generate one KNOWN-pattern hook about an existing POI.
 * @param {Map<string,object>} tables incl. hook-verb, hook-source, hook-accuracy, hook-<verb>
 * @param {() => number} rng dedicated sub-stream for this hook
 * @param {{ subjects: object[], origin: {q,r}, index?: number, pattern?: string,
 *   distance?: number, verb?: string, accuracy?: string }} ctx
 *   subjects: { poiId, name, type, q, r, occupant }[] — candidate POIs. For a
 *   DISTANT hook the app generates the target tile first and passes its POI as the
 *   sole subject (with ctx.pattern "distant" + the chosen distance).
 * @returns {object|null} the structured hook, or null when there is nothing to point at.
 */
export function generateHook(tables, rng, ctx) {
  const subjects = ctx.subjects || [];
  if (!subjects.length) return null;
  const origin = { q: ctx.origin.q, r: ctx.origin.r };
  const pattern = ctx.pattern || "known";

  const subject = pickSubject(rng, subjects, origin);
  const target = { q: subject.q, r: subject.r, poiId: subject.poiId };

  const verb = ctx.verb || rollTable(tables.get("hook-verb"), rng).value;
  const claim = rollTable(tables.get(`hook-${verb}`), rng).value;
  const source = ctx.source || rollTable(tables.get("hook-source"), rng).value;
  const accuracy = ctx.accuracy || rollTable(tables.get("hook-accuracy"), rng).value;

  // `indicated` = where the party is told to look. Accurate/false point at the
  // true hex; off-by-one nudges them to a neighbour — the GM still sees `target`.
  let indicated = { q: target.q, r: target.r };
  if (accuracy === "off-by-one") {
    indicated = pick(rng, neighbors(target.q, target.r));
  }

  return {
    id: ctx.index != null ? `hook:${ctx.index}` : undefined,
    build: HOOK_BUILD,
    pattern,
    verb,
    subject: { poiId: subject.poiId, name: subject.name, type: subject.type },
    origin,
    indicated,
    target,
    bearing: bearingTo(origin, target),
    distance: ctx.distance != null ? ctx.distance : axialDistance(origin.q, origin.r, target.q, target.r),
    accuracy,
    claim,
    source,
    status: "open",
    // The revealed corridor (Map pattern) — the run of hexes from origin to target.
    ...(ctx.path ? { path: ctx.path } : {}),
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Short label for the hook list (e.g. "Threat: Ruin — Troll lair"). */
export function hookName(hook) {
  if (!hook) return null;
  return `${cap(hook.verb)}: ${hook.subject.name}`;
}

/**
 * Composed description lines for the panel (prose built from the picks). The
 * first line is the rumour as the party hears it; the second is the GM-visible
 * accuracy (no hidden truth — this is a GM tool).
 */
export function hookDescription(hook) {
  if (!hook) return [];
  const dirWord = hook.bearing ? BEARING_WORDS[hook.bearing] : null;
  const d = hook.distance;
  const whither = dirWord ? `${d} hex${d === 1 ? "" : "es"} to the ${dirWord}` : `${d} hexes off`;
  // Each pattern phrases the destination differently: Map names a charted route,
  // Distant a travel distance, Known (nearby) just a bearing.
  let line0;
  if (hook.pattern === "map") {
    line0 = `${hook.source}: a map marks ${hook.subject.name}, ${whither}.`;
  } else if (hook.pattern === "distant") {
    line0 = `${hook.source}: ${cap(hook.claim)} at ${hook.subject.name}, ${whither}.`;
  } else {
    const dir = dirWord ? ` to the ${dirWord}` : "";
    line0 = `${hook.source}: ${cap(hook.claim)} at ${hook.subject.name}${dir}.`;
  }
  const lines = [line0];
  if (hook.accuracy === "off-by-one") {
    lines.push(`GM: the directions are a hex off — the real site is at (${hook.target.q}, ${hook.target.r}).`);
  } else if (hook.accuracy === "false") {
    lines.push("GM: a false lead — there is nothing in it.");
  } else {
    lines.push("GM: the directions hold true.");
  }
  return lines;
}
