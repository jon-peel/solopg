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
// 1/(1+distance)), but distant ones stay possible. Threats/warnings additionally
// cluster on dangerous (occupied/lair) sites. Consumes exactly one rng().
function pickSubject(rng, subjects, origin, verb) {
  const wantsHostile = verb === "warning" || verb === "threat";
  let total = 0;
  const weights = subjects.map((s) => {
    let w = 1 / (1 + axialDistance(origin.q, origin.r, s.q, s.r));
    const hostile = s.occupant && (s.occupant.kind === "lair" || s.occupant.kind === "occupied");
    if (wantsHostile && hostile) w *= 4;
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

  // Verb first, so a threat/warning can bias which subject it lands on.
  const verb = ctx.verb || rollTable(tables.get("hook-verb"), rng).value;
  const subject = pickSubject(rng, subjects, origin, verb);
  const target = { q: subject.q, r: subject.r, poiId: subject.poiId };

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

/**
 * Build a LOCAL hook — one that happens at the origin itself, with no separate
 * target tile: an `opportunity` (a buyer in town wants goods) or an `event` (a
 * festival/market here). target/indicated = origin, so → Target and ↩ Origin both
 * land in town.
 * @param {{ kind:"opportunity"|"event", origin:{q,r}, index?:number, source?:string, accuracy?:string }} ctx
 */
export function buildLocalHook(tables, rng, ctx) {
  const origin = { q: ctx.origin.q, r: ctx.origin.r };
  // Local hooks are facts about the town, not something heard from a person, so
  // they carry no source — the prose omits the "Who said it" prefix.
  const source = ctx.source || null;
  let subjectName;
  let claim;
  if (ctx.kind === "opportunity") {
    claim = rollTable(tables.get("hook-opportunity"), rng).value;
    subjectName = rollTable(tables.get("hook-commodity"), rng).value;
  } else {
    claim = rollTable(tables.get("hook-event"), rng).value;
    subjectName = claim;
  }
  const accuracy = ctx.accuracy || rollTable(tables.get("hook-accuracy"), rng).value;
  return {
    id: ctx.index != null ? `hook:${ctx.index}` : undefined,
    build: HOOK_BUILD,
    pattern: ctx.kind,
    verb: ctx.kind,
    subject: { name: subjectName, type: ctx.kind },
    origin,
    indicated: { q: origin.q, r: origin.r },
    target: { q: origin.q, r: origin.r },
    bearing: null,
    distance: 0,
    accuracy,
    claim,
    source,
    status: "open",
  };
}

/**
 * Build an ESCORT hook — a two-endpoint errand: carry `cargo` from the origin to
 * a recipient at `ctx.destination` (a place generated by the app). Like a Distant
 * hook it has a real target + positional accuracy, but it's framed as a delivery;
 * ↩ Origin is the pickup, → Target the drop-off.
 * @param {{ origin:{q,r}, destination:{q,r,poiId?}, index?:number, source?:string, accuracy?:string }} ctx
 */
export function buildEscortHook(tables, rng, ctx) {
  const origin = { q: ctx.origin.q, r: ctx.origin.r };
  const cargo = rollTable(tables.get("hook-cargo"), rng).value;
  const recipient = rollTable(tables.get("hook-recipient"), rng).value;
  const source = ctx.source || rollTable(tables.get("hook-source"), rng).value;
  const accuracy = ctx.accuracy || rollTable(tables.get("hook-accuracy"), rng).value;
  const target = { q: ctx.destination.q, r: ctx.destination.r, poiId: ctx.destination.poiId };
  let indicated = { q: target.q, r: target.r };
  if (accuracy === "off-by-one") indicated = pick(rng, neighbors(target.q, target.r));
  return {
    id: ctx.index != null ? `hook:${ctx.index}` : undefined,
    build: HOOK_BUILD,
    pattern: "escort",
    verb: "escort",
    subject: { name: recipient, type: "escort" },
    origin,
    indicated,
    target,
    bearing: bearingTo(origin, target),
    distance: axialDistance(origin.q, origin.r, target.q, target.r),
    accuracy,
    cargo,
    claim: cargo,
    source,
    status: "open",
  };
}

/**
 * Build the per-leg fields of a chain step: where this clue points, how far, and
 * the onward-clue text (hook-clue). bearing/distance are for THIS leg (from where
 * the last clue was found), not the chain's start. The prize itself lives on the
 * chain (rolled once in startChain), so steps just carry the trail.
 * @param {{ legOrigin:{q,r}, target:{q,r,poiId}, accuracy?:string }} ctx
 */
export function buildChainStep(tables, rng, ctx) {
  const claim = rollTable(tables.get("hook-clue"), rng).value;
  const accuracy = ctx.accuracy || rollTable(tables.get("hook-accuracy"), rng).value;
  const target = ctx.target;
  let indicated = { q: target.q, r: target.r };
  if (accuracy === "off-by-one") indicated = pick(rng, neighbors(target.q, target.r));
  return {
    target,
    indicated,
    bearing: bearingTo(ctx.legOrigin, target),
    distance: axialDistance(ctx.legOrigin.q, ctx.legOrigin.r, target.q, target.r),
    accuracy,
    claim,
  };
}

/**
 * Start a breadcrumb chain — a multi-step treasure hunt for a named `prize`
 * (rolled once, up front, so the opening lure and the final payoff name the same
 * goal). The first clue points at `ctx.target`; later steps are generated lazily
 * as each clue is followed (buildChainStep). The returned hook's current fields
 * mirror step 1; `chain` tracks { total, step, prize }. Origin stays the chain's
 * start (where you report in).
 * @param {{ origin:{q,r}, target:{q,r,poiId}, subject:object, index?:number, source?:string }} ctx
 */
export function startChain(tables, rng, ctx) {
  const total = 3 + Math.floor(rng() * 3); // 3–5 sites
  const source = ctx.source || rollTable(tables.get("hook-source"), rng).value;
  const prize = rollTable(tables.get("hook-payoff"), rng).value;
  const step = buildChainStep(tables, rng, { legOrigin: ctx.origin, target: ctx.target });
  return {
    id: ctx.index != null ? `hook:${ctx.index}` : undefined,
    build: HOOK_BUILD,
    pattern: "chain",
    verb: "explore",
    subject: ctx.subject,
    origin: { q: ctx.origin.q, r: ctx.origin.r },
    source,
    status: "open",
    chain: { total, step: 1, prize },
    ...step,
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Short label for the hook list (e.g. "Threat: Ruin — Troll lair"). */
export function hookName(hook) {
  if (!hook) return null;
  if (hook.pattern === "chain") return `Hunt → ${hook.subject.name}`;
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
  // Each pattern phrases the destination differently: Chain tracks a trail of
  // clues, Map names a charted route, Distant a travel distance, Known a bearing.
  let line0;
  let progress = null;
  let prizeLine = null;
  if (hook.pattern === "chain") {
    const { step, total } = hook.chain;
    const prize = hook.chain.prize; // absent on pre-6.5 chains → "GM's choice"
    const final = step >= total;
    if (final) {
      line0 = `${hook.source}: the trail ends at ${hook.subject.name}, ${whither}.`;
    } else if (step === 1) {
      line0 = prize
        ? `${hook.source}: word of ${prize} sets a trail — the first clue lies at ${hook.subject.name}, ${whither}.`
        : `${hook.source}: the first clue lies at ${hook.subject.name}, ${whither}.`;
    } else {
      line0 = `${hook.source}: ${cap(hook.claim)} — the trail leads on to ${hook.subject.name}, ${whither}.`;
    }
    // Always show the goal explicitly, at every step, so the prize is never a guess.
    prizeLine = `Prize: ${prize || "GM's choice"}.`;
    progress = `Clue ${step} of ${total}${final ? " — you've reached it" : ""}.`;
  } else if (hook.pattern === "opportunity") {
    line0 = `A buyer here ${hook.claim} ${hook.subject.name}.`;
  } else if (hook.pattern === "event") {
    line0 = `${cap(hook.claim)} here.`;
  } else if (hook.pattern === "escort") {
    line0 = `${hook.source}: carry ${hook.cargo} to ${hook.subject.name}, ${whither}.`;
  } else if (hook.pattern === "map") {
    line0 = `${hook.source}: a map marks ${hook.subject.name}, ${whither}.`;
  } else if (hook.pattern === "distant") {
    line0 = `${hook.source}: ${cap(hook.claim)} at ${hook.subject.name}, ${whither}.`;
  } else {
    const dir = dirWord ? ` to the ${dirWord}` : "";
    line0 = `${hook.source}: ${cap(hook.claim)} at ${hook.subject.name}${dir}.`;
  }
  const lines = [line0];
  if (prizeLine) lines.push(prizeLine);
  if (progress) lines.push(progress);
  // Local hooks (opportunity/event) have no directions, so their GM line is just
  // genuine-vs-false; the rest report positional accuracy.
  const isLocal = hook.pattern === "opportunity" || hook.pattern === "event";
  if (isLocal) {
    lines.push(hook.accuracy === "false" ? "GM: a false lead — it comes to nothing." : "GM: genuine.");
  } else if (hook.accuracy === "off-by-one") {
    lines.push(`GM: the directions are a hex off — the real site is at (${hook.target.q}, ${hook.target.r}).`);
  } else if (hook.accuracy === "false") {
    lines.push("GM: a false lead — there is nothing in it.");
  } else {
    lines.push("GM: the directions hold true.");
  }
  return lines;
}
