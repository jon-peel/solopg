import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  generateHook,
  hookName,
  hookDescription,
  bearingTo,
  rollHookPattern,
  chooseDistantTarget,
  startChain,
  buildChainStep,
  buildLocalHook,
  buildEscortHook,
  HOOK_BUILD,
} from "../js/gen/hooks.js";
import { validateTable } from "../js/core/table.js";
import { mulberry32 } from "../js/core/rng.js";
import { axialDistance, axialLine } from "../js/core/hexgeo.js";

function tables() {
  const ids = [
    "hook-pattern", "hook-verb", "hook-source",
    "hook-explore", "hook-threat", "hook-rescue", "hook-warning",
    "hook-opportunity", "hook-commodity", "hook-event",
    "hook-cargo", "hook-recipient",
    "hook-clue", "hook-payoff",
    "hook-patron", "hook-reward", "hook-return", "creatures",
  ];
  return new Map(
    ids.map((id) => [id, validateTable(JSON.parse(readFileSync(`./data/${id}.json`, "utf8")))]),
  );
}

const valuesOf = (t) => new Set(t.entries.map((e) => e.value));

// A couple of subjects around an origin, at known offsets.
function subjects() {
  return [
    { poiId: "poi:0", name: "Ruin — Troll lair", type: "dungeon", q: 2, r: -1, occupant: { kind: "lair", creature: "Troll" } },
    { poiId: "poi:1", name: "Old shrine", type: "shrine", q: 0, r: 3, occupant: { kind: "none" } },
    { poiId: "poi:2", name: "Bandit camp", type: "camp", q: -2, r: 1, occupant: { kind: "occupied", by: "Bandits" } },
  ];
}
const ORIGIN = { q: 0, r: 0 };

test("generateHook returns a well-formed Known hook drawn from the tables", () => {
  const t = tables();
  const verbs = valuesOf(t.get("hook-verb"));
  const sources = valuesOf(t.get("hook-source"));
  const subs = subjects();
  const byId = new Map(subs.map((s) => [s.poiId, s]));
  for (let s = 0; s < 100; s++) {
    const h = generateHook(t, mulberry32(s), { subjects: subs, origin: ORIGIN, index: s });
    assert.equal(h.build, HOOK_BUILD);
    assert.equal(h.pattern, "known");
    assert.equal(h.id, `hook:${s}`);
    assert.equal(h.status, "open");
    assert.equal("accuracy" in h, false); // accuracy mechanic removed
    assert.equal("indicated" in h, false);
    assert.ok(verbs.has(h.verb));
    assert.ok(sources.has(h.source));
    // Subject is one of ours, and the target is that subject's hex.
    const subj = byId.get(h.subject.poiId);
    assert.ok(subj, "subject is a provided POI");
    assert.equal(h.target.q, subj.q);
    assert.equal(h.target.r, subj.r);
    assert.equal(h.target.poiId, subj.poiId);
    // The claim comes from the verb's table.
    assert.ok(valuesOf(t.get(`hook-${h.verb}`)).has(h.claim));
  }
});

test("generateHook is deterministic for a given seed + context", () => {
  const a = generateHook(tables(), mulberry32(13), { subjects: subjects(), origin: ORIGIN, index: 0 });
  const b = generateHook(tables(), mulberry32(13), { subjects: subjects(), origin: ORIGIN, index: 0 });
  assert.deepEqual(a, b);
});

test("a forced verb is honoured", () => {
  const t = tables();
  const h = generateHook(t, mulberry32(1), {
    subjects: subjects(), origin: ORIGIN, index: 0, verb: "threat",
  });
  assert.equal(h.verb, "threat");
  assert.ok(valuesOf(t.get("hook-threat")).has(h.claim));
});

test("generateHook returns null when there is nothing to point at", () => {
  assert.equal(generateHook(tables(), mulberry32(1), { subjects: [], origin: ORIGIN }), null);
});

test("proximity bias: a much nearer subject is chosen far more often", () => {
  const t = tables();
  const near = { poiId: "poi:near", name: "Near", type: "shrine", q: 1, r: 0, occupant: { kind: "none" } };
  const far = { poiId: "poi:far", name: "Far", type: "shrine", q: 20, r: 0, occupant: { kind: "none" } };
  let nearCount = 0;
  for (let s = 0; s < 300; s++) {
    const h = generateHook(t, mulberry32(s), { subjects: [near, far], origin: ORIGIN, index: s });
    if (h.subject.poiId === "poi:near") nearCount++;
  }
  assert.ok(nearCount > 250, `near subject dominates (got ${nearCount}/300)`);
});

test("bearingTo gives a sensible compass label (and null when coincident)", () => {
  assert.equal(bearingTo({ q: 0, r: 0 }, { q: 3, r: 0 }), "E");
  assert.equal(bearingTo({ q: 0, r: 0 }, { q: -3, r: 0 }), "W");
  assert.equal(bearingTo({ q: 0, r: 0 }, { q: 0, r: 0 }), null);
});

// --- 6.2: distant pattern ---------------------------------------------------

test("rollHookPattern never yields known without subjects (only known needs one)", () => {
  const t = tables();
  for (let s = 0; s < 100; s++) {
    // Distant and Map make their own target, so they're fine with no subjects;
    // only Known needs an existing POI, and it must fall back when there is none.
    assert.notEqual(rollHookPattern(t, mulberry32(s), false), "known");
  }
  // With subjects, all kinds appear over many seeds.
  const seen = new Set();
  for (let s = 0; s < 500; s++) seen.add(rollHookPattern(t, mulberry32(s), true));
  assert.deepEqual([...seen].sort(), ["chain", "distant", "escort", "event", "known", "map", "opportunity", "return"]);
  // Return needs an existing POI, so with none it falls back like known.
  for (let s = 0; s < 100; s++) assert.notEqual(rollHookPattern(t, mulberry32(s), false), "return");
});

test("chooseDistantTarget lands a free cell at the requested straight-line distance", () => {
  const origin = { q: 0, r: 0 };
  for (let s = 0; s < 200; s++) {
    const spot = chooseDistantTarget(mulberry32(s), origin, () => false, { minDistance: 2, maxDistance: 6 });
    assert.ok(spot, "found a spot on empty ground");
    assert.ok(spot.distance >= 2 && spot.distance <= 6);
    // Walking a straight axial direction, the hex distance equals the step count.
    assert.equal(axialDistance(origin.q, origin.r, spot.q, spot.r), spot.distance);
    // And a straight line yields a clean compass bearing.
    assert.ok(bearingTo(origin, spot));
  }
});

test("chooseDistantTarget avoids occupied cells, and gives up when boxed in", () => {
  const origin = { q: 0, r: 0 };
  // Everything occupied → null.
  assert.equal(chooseDistantTarget(mulberry32(1), origin, () => true), null);
  // Only one specific cell free: every returned spot must be unoccupied.
  const free = (q, r) => !(q === 0 && r === 0);
  for (let s = 0; s < 50; s++) {
    const spot = chooseDistantTarget(mulberry32(s), origin, (q, r) => !free(q, r));
    if (spot) assert.ok(free(spot.q, spot.r));
  }
});

test("a distant hook carries pattern + distance and points at its lone subject", () => {
  const t = tables();
  const subject = { poiId: "poi:0", name: "Tomb", type: "dungeon", q: 4, r: -4, occupant: { kind: "none" } };
  const h = generateHook(t, mulberry32(5), {
    subjects: [subject], origin: { q: 0, r: 0 }, index: 0, pattern: "distant", distance: 4,
  });
  assert.equal(h.pattern, "distant");
  assert.equal(h.distance, 4);
  assert.equal(h.subject.poiId, "poi:0");
  assert.equal(h.target.q, 4);
  assert.equal(h.target.r, -4);
  const lines = hookDescription(h); // default hexScale 6 → 4 hexes = 24 miles
  assert.match(lines[0], /Tomb, 24 miles to the /);
});

test("a known hook's distance is derived from the geometry", () => {
  const subject = { poiId: "poi:0", name: "Ruin", type: "dungeon", q: 0, r: 3, occupant: { kind: "none" } };
  const h = generateHook(tables(), mulberry32(2), { subjects: [subject], origin: { q: 0, r: 0 }, index: 0 });
  assert.equal(h.pattern, "known");
  assert.equal(h.distance, 3);
});

// --- 6.3: map pattern (treasure maps) --------------------------------------

test("axialLine returns a contiguous straight run inclusive of both ends", () => {
  const line = axialLine(0, 0, 4, -4);
  assert.equal(line.length, 5); // distance 4 → 5 cells
  assert.deepEqual(line[0], { q: 0, r: 0 });
  assert.deepEqual(line[line.length - 1], { q: 4, r: -4 });
  for (let i = 1; i < line.length; i++) {
    assert.equal(axialDistance(line[i - 1].q, line[i - 1].r, line[i].q, line[i].r), 1, "each step is adjacent");
  }
  // A zero-length line is just the single cell.
  assert.deepEqual(axialLine(2, 2, 2, 2), [{ q: 2, r: 2 }]);
});

test("a map hook carries pattern, a path, and a charted-route description", () => {
  const t = tables();
  const origin = { q: 0, r: 0 };
  const subject = { poiId: "poi:0", name: "Tomb", type: "dungeon", q: 0, r: 4, occupant: { kind: "none" } };
  const path = axialLine(origin.q, origin.r, subject.q, subject.r);
  const h = generateHook(t, mulberry32(8), {
    subjects: [subject], origin, index: 0, pattern: "map", distance: 4, verb: "explore", path,
    source: "A map found below",
  });
  assert.equal(h.pattern, "map");
  assert.equal(h.verb, "explore");
  assert.deepEqual(h.path, path);
  assert.equal(h.source, "A map found below"); // ctx.source override honoured
  const lines = hookDescription(h);
  assert.match(lines[0], /^A map found below: a map marks Tomb, 24 miles to the /);
});

test("a non-map hook has no path field", () => {
  const subject = { poiId: "poi:0", name: "Ruin", type: "dungeon", q: 0, r: 3, occupant: { kind: "none" } };
  const h = generateHook(tables(), mulberry32(2), { subjects: [subject], origin: { q: 0, r: 0 }, index: 0 });
  assert.equal("path" in h, false);
});

// --- 6.6: return pattern ----------------------------------------------------

test("a return hook reports a fresh development at an existing place", () => {
  const t = tables();
  const developments = valuesOf(t.get("hook-return"));
  const subj = { poiId: "poi:0", name: "Old mine", type: "dungeon", q: 0, r: 3, terrain: "Hills", occupant: { kind: "none" } };
  const h = generateHook(t, mulberry32(1), { subjects: [subj], origin: ORIGIN, index: 0, pattern: "return", verb: "return" });
  assert.equal(h.pattern, "return");
  assert.equal(h.subject.name, "Old mine"); // names the place, not a menace
  assert.equal(hookName(h), "Return: Old mine");
  assert.ok(developments.has(h.claim));
  assert.equal("reward" in h, false); // not a bounty
  assert.match(hookDescription(h)[0], /^.*: Old mine .+, \d+ miles to the /);
});

// --- 6.5: verb & flavour breadth --------------------------------------------

test("site verbs (explore/threat/rescue/warning) each draw a claim from their table", () => {
  const t = tables();
  const verbs = ["explore", "threat", "rescue", "warning"];
  const subs = subjects();
  for (const verb of verbs) {
    const claims = valuesOf(t.get(`hook-${verb}`));
    let saw = false;
    for (let s = 0; s < 20; s++) {
      const h = generateHook(t, mulberry32(s * 7 + 1), { subjects: subs, origin: ORIGIN, index: 0, verb });
      assert.equal(h.verb, verb);
      assert.ok(claims.has(h.claim), `${verb} claim ${h.claim} from its table`);
      saw = true;
    }
    assert.ok(saw);
  }
});

test("threats/warnings cluster on dangerous (occupied/lair) subjects", () => {
  const t = tables();
  const hostile = { poiId: "poi:h", name: "Den", type: "dungeon", q: 6, r: 0, occupant: { kind: "lair", creature: "Ogre" } };
  const calm = { poiId: "poi:c", name: "Well", type: "landmark", q: 1, r: 0, occupant: { kind: "none" } };
  // The hostile site is FARther, so without the bias proximity would favour `calm`.
  let hostileWarn = 0, hostileExplore = 0;
  for (let s = 0; s < 200; s++) {
    const w = generateHook(t, mulberry32(s), { subjects: [hostile, calm], origin: ORIGIN, index: 0, verb: "warning" });
    if (w.subject.poiId === "poi:h") hostileWarn++;
    const e = generateHook(t, mulberry32(s), { subjects: [hostile, calm], origin: ORIGIN, index: 0, verb: "explore" });
    if (e.subject.poiId === "poi:h") hostileExplore++;
  }
  assert.ok(hostileWarn > hostileExplore, `warnings favour the den (${hostileWarn} vs explore ${hostileExplore})`);
});

test("a threat names the menace (occupant), with its lair as the place to track", () => {
  const t = tables();
  const den = { poiId: "poi:0", name: "Cult shrine", type: "dungeon", q: 3, r: -1, terrain: "Hills",
    occupant: { kind: "occupied", by: "Bandits" } };
  const h = generateHook(t, mulberry32(0), { subjects: [den], origin: ORIGIN, index: 0, verb: "threat" });
  assert.equal(h.subject.name, "Bandits"); // the menace, not the place
  assert.equal(hookName(h), "Threat: Bandits");
  assert.equal(h.lair, "Cult shrine"); // the place it lairs
  assert.equal(h.target.poiId, "poi:0"); // → Target still goes to the site
  assert.match(hookDescription(h)[0], /^.*: Bandits .+\. Their lair: Cult shrine, \d+ miles to the /);
});

test("a threat with no occupant invents a creature as the menace", () => {
  const t = tables();
  const creatures = valuesOf(t.get("creatures"));
  const empty = { poiId: "poi:0", name: "Old ruin", type: "dungeon", q: 2, r: 0, terrain: "Plains",
    occupant: { kind: "none" } };
  const h = generateHook(t, mulberry32(4), { subjects: [empty], origin: ORIGIN, index: 0, verb: "threat" });
  assert.ok(creatures.has(h.subject.name), `menace ${h.subject.name} from the creatures table`);
  assert.equal(h.lair, "Old ruin");
});

test("threat & rescue hooks carry a reward (coin from a patron, or glory)", () => {
  const t = tables();
  const patrons = valuesOf(t.get("hook-patron"));
  const amounts = valuesOf(t.get("hook-reward"));
  const subj = { poiId: "poi:0", name: "Ruin", type: "dungeon", q: 3, r: 0, terrain: "Hills", occupant: { kind: "lair", creature: "Ogre" } };
  let sawCoin = false, sawGlory = false;
  for (const verb of ["threat", "rescue"]) {
    for (let s = 0; s < 60; s++) {
      const h = generateHook(t, mulberry32(s), { subjects: [subj], origin: ORIGIN, index: 0, verb });
      assert.ok(h.reward, `${verb} has a reward`);
      if (h.reward.glory) { sawGlory = true; assert.match(hookDescription(h).at(-1), /fame and glory only/); }
      else {
        sawCoin = true;
        assert.ok(patrons.has(h.reward.patron) && amounts.has(h.reward.amount));
        assert.match(hookDescription(h).at(-1), /^Reward: .+ from .+\.$/);
      }
    }
  }
  assert.ok(sawCoin && sawGlory, "both coin and glory rewards appear");
});

test("explore/warning hooks carry no reward", () => {
  const t = tables();
  const subj = { poiId: "poi:0", name: "Ruin", type: "dungeon", q: 3, r: 0, terrain: "Hills", occupant: { kind: "none" } };
  for (const verb of ["explore", "warning"]) {
    const h = generateHook(t, mulberry32(1), { subjects: [subj], origin: ORIGIN, index: 0, verb });
    assert.equal("reward" in h, false);
  }
});

test("buildLocalHook(opportunity) names a commodity at the origin", () => {
  const t = tables();
  const offers = valuesOf(t.get("hook-opportunity"));
  const goods = valuesOf(t.get("hook-commodity"));
  for (let s = 0; s < 50; s++) {
    const h = buildLocalHook(t, mulberry32(s), { kind: "opportunity", origin: { q: 2, r: -1 }, index: 0 });
    assert.equal(h.pattern, "opportunity");
    assert.equal(h.verb, "opportunity");
    assert.ok(offers.has(h.claim));
    assert.ok(goods.has(h.subject.name));
    // Local: target and origin coincide, no bearing.
    assert.deepEqual(h.target, { q: 2, r: -1 });
    assert.deepEqual(h.origin, { q: 2, r: -1 });
    assert.equal(h.bearing, null);
    assert.equal(h.source, null); // local hooks carry no "who said it"
    const lines = hookDescription(h);
    assert.deepEqual(lines, [`A buyer here ${h.claim} ${h.subject.name}.`]); // single line, no GM line
  }
});

test("buildLocalHook(event) reads as a happening here", () => {
  const t = tables();
  const events = valuesOf(t.get("hook-event"));
  const h = buildLocalHook(t, mulberry32(5), { kind: "event", origin: { q: 0, r: 0 }, index: 1 });
  assert.equal(h.pattern, "event");
  assert.ok(events.has(h.claim));
  assert.equal(hookName(h), `Event: ${h.subject.name}`);
  assert.match(hookDescription(h)[0], / here\.$/);
});

test("buildLocalHook is deterministic for a given seed", () => {
  const a = buildLocalHook(tables(), mulberry32(9), { kind: "opportunity", origin: { q: 0, r: 0 }, index: 0 });
  const b = buildLocalHook(tables(), mulberry32(9), { kind: "opportunity", origin: { q: 0, r: 0 }, index: 0 });
  assert.deepEqual(a, b);
});

test("buildEscortHook is a two-endpoint errand with cargo + recipient + a real target", () => {
  const t = tables();
  const cargos = valuesOf(t.get("hook-cargo"));
  const recipients = valuesOf(t.get("hook-recipient"));
  const origin = { q: 0, r: 0 };
  const destination = { q: 5, r: 0 };
  for (let s = 0; s < 80; s++) {
    const h = buildEscortHook(t, mulberry32(s), { origin, destination, index: 0 });
    assert.equal(h.pattern, "escort");
    assert.equal(h.verb, "escort");
    assert.ok(cargos.has(h.cargo));
    assert.ok(recipients.has(h.subject.name));
    assert.deepEqual(h.origin, origin);
    assert.equal(h.target.q, 5);
    assert.equal(h.distance, 5);
    assert.ok(h.bearing); // a real destination → a bearing
    assert.ok(h.reward); // a delivery is paid (coin or glory)
    const cargo = h.cargo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const recipient = h.subject.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      hookDescription(h)[0], // distance 5 hexes × 6 = 30 miles
      new RegExp(`^${h.source}: carry ${cargo} to ${recipient}, 30 miles to the [a-z-]+\\.$`),
    );
  }
});

test("buildEscortHook is deterministic for a given seed", () => {
  const args = { origin: { q: 0, r: 0 }, destination: { q: 3, r: -3 }, index: 0 };
  assert.deepEqual(buildEscortHook(tables(), mulberry32(2), args), buildEscortHook(tables(), mulberry32(2), args));
});

// --- 6.4: breadcrumb chains -------------------------------------------------

test("startChain builds a chain hook with a named prize and a first clue", () => {
  const t = tables();
  const clues = valuesOf(t.get("hook-clue"));
  const prizes = valuesOf(t.get("hook-payoff"));
  const origin = { q: 0, r: 0 };
  const target = { q: 3, r: 0, poiId: "poi:0" };
  const subject = { poiId: "poi:0", name: "Crypt", type: "dungeon" };
  for (let s = 0; s < 100; s++) {
    const h = startChain(t, mulberry32(s), { origin, target, subject, index: 0 });
    assert.equal(h.pattern, "chain");
    assert.equal(h.verb, "explore");
    assert.equal(h.chain.step, 1);
    assert.ok(h.chain.total >= 3 && h.chain.total <= 5);
    assert.ok(prizes.has(h.chain.prize), `prize ${h.chain.prize} from hook-payoff`);
    assert.deepEqual(h.target, target);
    assert.ok(clues.has(h.claim), `step-1 claim ${h.claim} is a clue`);
    assert.equal(h.distance, 3); // leg from origin to target
  }
});

test("buildChainStep carries an onward clue + this leg's bearing/distance", () => {
  const t = tables();
  const clues = valuesOf(t.get("hook-clue"));
  const legOrigin = { q: 0, r: 0 };
  const target = { q: 0, r: 4, poiId: "poi:1" };
  const step = buildChainStep(t, mulberry32(1), { legOrigin, target, terrain: "Swamp" });
  assert.ok(clues.has(step.claim));
  assert.equal(step.distance, 4);
  assert.equal(step.targetTerrain, "Swamp");
  assert.equal("indicated" in step, false); // accuracy mechanic removed
});

test("startChain is deterministic for a given seed", () => {
  const args = { origin: { q: 0, r: 0 }, target: { q: 2, r: 1, poiId: "poi:0" }, subject: { poiId: "poi:0", name: "Tomb", type: "dungeon" }, index: 0 };
  const a = startChain(tables(), mulberry32(4), args);
  const b = startChain(tables(), mulberry32(4), args);
  assert.deepEqual(a, b);
});

test("chain prose: a lure names the prize up front and the payoff names it again", () => {
  const t = tables();
  const start = startChain(t, mulberry32(3), {
    origin: { q: 0, r: 0 }, target: { q: 0, r: 3, poiId: "poi:0" },
    subject: { poiId: "poi:0", name: "Tomb", type: "dungeon" }, index: 0, source: "An old map-seller",
  });
  assert.equal(hookName(start), "Hunt → Tomb");
  const sl = hookDescription(start);
  // Step 1 is the lure: it states the prize and points at the first site.
  assert.match(sl[0], new RegExp(`^An old map-seller: word of ${start.chain.prize.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} sets a trail — the first clue lies at Tomb,`));
  // The prize is always shown explicitly, at every step.
  assert.equal(sl[1], `Prize: ${start.chain.prize}.`);
  assert.match(sl[2], /^Clue 1 of [345]\.$/);

  // A mid-trail step shows the onward clue and still names the prize.
  const mid = hookDescription({ ...start, chain: { ...start.chain, step: 2 }, claim: "a worn inscription points onward" });
  assert.match(mid[0], /A worn inscription points onward — the trail leads on to Tomb,/);
  assert.equal(mid[1], `Prize: ${start.chain.prize}.`);

  // The final step names the prize on its own line and marks arrival.
  const finalHook = {
    pattern: "chain", verb: "explore", subject: { name: "Vault" }, source: "An old map-seller",
    target: { q: 0, r: 5 }, bearing: "S", distance: 2,
    claim: "ignored at the end", chain: { total: 3, step: 3, prize: "a dragon's hoard" },
  };
  const fl = hookDescription(finalHook); // distance 2 × 6 = 12 miles
  assert.match(fl[0], /the trail ends at Vault, 12 miles to the south\./);
  assert.equal(fl[1], "Prize: a dragon's hoard.");
  assert.match(fl[2], /Clue 3 of 3 — you've reached it\./);

  // A pre-prize (legacy) chain degrades gracefully to "GM's choice".
  const legacy = hookDescription({ ...finalHook, chain: { total: 3, step: 3 } });
  assert.equal(legacy[1], "Prize: GM's choice.");
});

test("hookName + hookDescription compose prose from the picks (miles + terrain, no GM line)", () => {
  const base = {
    build: HOOK_BUILD, pattern: "known", verb: "explore",
    subject: { poiId: "poi:0", name: "Old shrine", type: "shrine" },
    origin: { q: 0, r: 0 }, target: { q: 0, r: 3, poiId: "poi:0" },
    bearing: "S", distance: 3, targetTerrain: "Hills",
    claim: "a lost relic is said to lie hidden", source: "Tavern talk", status: "open",
  };
  assert.equal(hookName(base), "Explore: Old shrine");
  // distance 3 × default hexScale 6 = 18 miles; terrain appended; single line.
  assert.deepEqual(hookDescription(base), [
    "Tavern talk: A lost relic is said to lie hidden at Old shrine, 18 miles to the south (Hills).",
  ]);
  // hexScale flows through to the mileage.
  assert.match(hookDescription(base, { hexScale: 10 })[0], /30 miles to the south \(Hills\)/);
});
