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
import { axialToPixel, axialDistance, neighbors } from "../core/hexgeo.js";

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
 * @param {{ subjects: object[], origin: {q,r}, index?: number, verb?: string, accuracy?: string }} ctx
 *   subjects: { poiId, name, type, q, r, occupant }[] — candidate POIs on the map.
 * @returns {object|null} the structured hook, or null when there is nothing to point at.
 */
export function generateHook(tables, rng, ctx) {
  const subjects = ctx.subjects || [];
  if (!subjects.length) return null;
  const origin = { q: ctx.origin.q, r: ctx.origin.r };

  const subject = pickSubject(rng, subjects, origin);
  const target = { q: subject.q, r: subject.r, poiId: subject.poiId };

  const verb = ctx.verb || rollTable(tables.get("hook-verb"), rng).value;
  const claim = rollTable(tables.get(`hook-${verb}`), rng).value;
  const source = rollTable(tables.get("hook-source"), rng).value;
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
    pattern: "known",
    verb,
    subject: { poiId: subject.poiId, name: subject.name, type: subject.type },
    origin,
    indicated,
    target,
    bearing: bearingTo(origin, target),
    accuracy,
    claim,
    source,
    status: "open",
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
  const dir = hook.bearing ? ` to the ${BEARING_WORDS[hook.bearing]}` : "";
  const lines = [`${hook.source}: ${cap(hook.claim)} at ${hook.subject.name}${dir}.`];
  if (hook.accuracy === "off-by-one") {
    lines.push(`GM: the directions are a hex off — the real site is at (${hook.target.q}, ${hook.target.r}).`);
  } else if (hook.accuracy === "false") {
    lines.push("GM: a false lead — there is nothing in it.");
  } else {
    lines.push("GM: the directions hold true.");
  }
  return lines;
}
