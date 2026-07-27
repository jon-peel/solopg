// Dungeon-interior generator (Phase 4 arc).
//
// Pure: given preloaded tables + an rng stream, returns a dungeon's full
// interior — a size, a stack of levels, and per level a theme, a monster
// family, a generated random-monster table, and stocked room contents. No DOM /
// fetch / persistence, so it's node-testable.
//
// Ecology: each level leans toward one theme-appropriate monster FAMILY
// (data/dungeon-family.json maps theme -> family weights; data/monster-families
// .json holds each family's members + elite). A level's wandering table is built
// mostly from that family, with an occasional interloper from another family and
// a family elite on the deepest level — so a level reads as "an undead level" /
// "a goblinoid level." Counts/sequencing live here; weighted picks live in JSON.

import { rollTable } from "../core/table.js";
import { randInt, pick } from "../core/rng.js";
import { layoutLevel, deriveDoors } from "./dungeon-layout.js";

// Number appearing (a dice expression, book-style) by monster tier: weak swarm,
// tough few. Used so a room reads "2d4 Goblins" rather than a fixed count.
const NA_BY_TIER = { 1: "2d4", 2: "1d6", 3: "1d4", 4: "1d2" };

const MIN_ENCOUNTERS = 2; // smallest wandering list (tiny levels)
const MAX_ENCOUNTERS = 6; // largest wandering list (big levels)
const INTERLOPER_CHANCE = 0.34; // a level sometimes hosts one outsider species

// Interior-shape version. Stamped on every generated dungeon; the UI regenerates
// any persisted dungeon whose `build` differs (or is missing), so changing the
// interior shape (e.g. adding per-level layout) self-heals old saves without a
// world-schema migration. Bump this whenever the dungeon object shape changes.
// 1: per-level rooms + tree corridors. 2: room graph with loop edges (4.9.2).
// 3: typed edges (doors/locked/stuck/secret) + door markers (4.9.3).
// 4: doors more common + bolder markers (4.9.3 follow-up).
// 5: doors carry orientation (dx,dy) for wall-straddling rectangles + symbols.
// 6: secret doors shown on the GM map (carved + marked), not hidden.
// 7: inter-level stairs + surface entrances/exits (4.9.4).
// 8: stairs vertically aligned + spread; entrances scale (any size) (4.9.4 follow-up).
// 9: more multi-stairs (scale w/ size), level-skipping shafts, more entrances.
// 10: rich room contents — trap/special/dressing detail, monster number+status,
//     treasure kind+guard (4.9.5).
// 11: true vertical stairs — stair-up rooms pinned over their down-room (4.9.8).
// 12: per-room lighting, decaying with distance/depth from an entrance (4.9.10).
// 13: theme-aware doors (caves open-heavy) + rare Vast (5-6 level) size (4.9.9).
// 14: occupied frontier — held+lit entrance cluster, locked boundary (4.9.11).
// 15: bigger tiered monster roster + new den themes (4.9.12).
// 16: wandering-monster list scales with level size (4.9.12 follow-up).
// 17: depth/difficulty scaling — monster + treasure tier rise with depth (4.9.13).
// 18: treasure carries rolled gp value + weight (cn) by bulk.
// 20: a lair-bound lord infuses the interior (family + boss) (8.18).
// 21: a rank-and-file faction GARRISONS a held dungeon — its people hold the
//     entrance frontier and patrol as wandering monsters (8.19 follow-up).
// 22: treasure is a B/X Treasure Type LETTER the GM rolls, not invented gp (9.8).
export const DUNGEON_BUILD = 22;

// Index families by name -> { family, elite, members }.
function familyIndex(tables) {
  const map = new Map();
  for (const e of tables.get("monster-families").entries) {
    map.set(e.value.family, e.value);
  }
  return map;
}

// Theme -> weighted family table (falls back to a generic spread).
function familyTableForTheme(tables, theme) {
  const row = tables
    .get("dungeon-family")
    .entries.find((e) => e.value.theme === theme);
  const families = (row && row.value.families) || [
    { weight: 3, value: "Beasts" },
    { weight: 2, value: "Vermin" },
    { weight: 2, value: "Bandits" },
    { weight: 1, value: "Undead" },
  ];
  return { id: `dungeon-family:${theme}`, entries: families };
}

// A named den's signature creature (e.g. Kobold tunnels -> "Kobolds"), or null.
// Only eponymous themes carry one; generic themes stay purely emergent.
function signatureForTheme(tables, theme) {
  const row = tables
    .get("dungeon-family")
    .entries.find((e) => e.value.theme === theme);
  return (row && row.value.signature) || null;
}

// Sample up to `want` DISTINCT members from a weighted list, keeping weights.
function sampleDistinct(memberList, want, rng, seen = new Map()) {
  const table = { id: "members", entries: memberList };
  for (let attempt = 0; attempt < want * 8 && seen.size < want; attempt++) {
    const roll = rollTable(table, rng);
    if (!seen.has(roll.value)) {
      seen.set(roll.value, "weight" in roll.entry ? roll.entry.weight : 1);
    }
  }
  return seen;
}

// Weight multiplier favouring members/treasure whose tier is near the level's
// target tier (1 at the target, halving per step away). Drives depth scaling.
function tierAffinity(tier, target) {
  return 2 ** -Math.abs((tier || 1) - target);
}

/**
 * Build one level's monster set: mostly the chosen family (re-weighted toward
 * `targetTier` so deeper/deadlier levels skew tough), plus a chance of an
 * interloper and (on the deepest level) the family's elite.
 * @returns {{ family: string, encounters: {weight:number,value:string}[] }}
 */
function buildLevelMonsters(families, theme, isDeepest, rng, roomCount, targetTier = 1, depth = 1, overlord = null, garrison = null) {
  // Roll the theme's family first, then let a lord (8.18) OVERRIDE which family fills
  // the level — rolling either way keeps that draw consistent, so a lord mostly swaps
  // the monsters over the same shape rather than reshaping the dungeon wholesale.
  const themeFamily = rollTable(familyTableForTheme(families, theme), rng).value;
  const familyName = overlord ? overlord.family : themeFamily;
  const index = familyIndex(families);
  const family = index.get(familyName) || { members: [{ weight: 1, value: "Vermin", tier: 1 }] };

  // Re-weight members toward the level's target tier (depth + difficulty).
  const members = family.members.map((m) => ({
    value: m.value,
    weight: (("weight" in m ? m.weight : 1)) * tierAffinity(m.tier, targetTier),
  }));

  // Named-den signature bias: on shallow levels, a den named after a creature
  // skews strongly toward that creature — so "Kobold tunnels" opens with kobolds.
  // The boost decays with depth. A lord's dungeon ignores the theme's signature —
  // its own family fills the level.
  const signature = overlord ? null : signatureForTheme(families, theme);
  const sigBoost = depth === 1 ? 4 : depth === 2 ? 2 : 1;
  if (signature && sigBoost > 1) {
    const m = members.find((x) => x.value === signature);
    if (m) m.weight *= sigBoost;
  }

  // Wandering list scales with the level's size: a tiny tunnel has few wanderers,
  // a sprawling level has the full spread.
  const want = Math.max(
    MIN_ENCOUNTERS,
    Math.min(MAX_ENCOUNTERS, randInt(rng, Math.floor(roomCount / 3), Math.ceil(roomCount / 2))),
  );
  const seen = sampleDistinct(members, want, rng);

  // Occasional interloper from a different family.
  if (rng() < INTERLOPER_CHANCE) {
    const otherName = pick(rng, [...index.keys()]);
    const other = index.get(otherName);
    if (otherName !== familyName && other) {
      const roll = rollTable({ id: "m", entries: other.members }, rng);
      if (!seen.has(roll.value)) seen.set(roll.value, 1); // outsider: low weight
    }
  }

  const encounters = Array.from(seen, ([value, weight]) => ({ weight, value }));
  // A boss waits at the bottom — the LORD itself when one holds the dungeon (8.18),
  // otherwise the family's elite.
  const boss = overlord ? overlord.boss : family.elite;
  if (isDeepest && boss && !seen.has(boss)) {
    encounters.push({ weight: 1, value: boss });
  }
  // A rank-and-file faction that holds the dungeon (8.19) doesn't re-theme it — its
  // people PATROL as a strong presence in the wandering list on every level, while
  // the native ecology stays underneath (some original occupants remain). rng-free
  // (a fixed push) so it never perturbs the level's other draws.
  if (garrison && !overlord && !seen.has(garrison.label)) {
    encounters.push({ weight: 3, value: garrison.label });
  }
  return { family: familyName, encounters };
}

/**
 * Generate one dungeon interior.
 * @param {Map<string,object>} tables incl. dungeon-size, dungeon-theme,
 *   dungeon-room, monster-families, dungeon-family.
 * @param {() => number} rng a dedicated sub-stream for this dungeon.
 * @param {{ theme?: string, size?: string, terrain?: string }} [ctx] the
 *   dungeon's theme + size (both chosen at POI creation) drive generation;
 *   each falls back to a roll when absent/unknown.
 * @returns {{ build: number, size: string, theme: string, levels: object[],
 *   stairs: object[], entrances: object[], exits: object[] }}
 */
export function generateDungeon(tables, rng, ctx = {}) {
  const roomTable = tables.get("dungeon-room");
  const sizeTable = tables.get("dungeon-size");
  const trapTable = tables.get("dungeon-trap");
  const specialTable = tables.get("dungeon-special");
  const dressingTable = tables.get("dungeon-dressing");
  const treasureTable = tables.get("treasure-type");
  const guardTable = tables.get("dungeon-treasure-guard");
  const statusTable = tables.get("dungeon-monster-status");
  const lightTable = tables.get("dungeon-light");

  // Number-appearing (dice) per creature name, from each member's tier.
  const naByName = new Map();
  for (const e of tables.get("monster-families").entries) {
    for (const m of e.value.members) naByName.set(m.value, NA_BY_TIER[m.tier] || "1d6");
    naByName.set(e.value.elite, "1");
  }
  // A lair-bound lord (8.18): its family fills the interior, and the lord itself is
  // the singular final boss. { family, boss, id } — supplied by the app from the POI.
  const overlord = ctx.overlord || null;
  if (overlord && overlord.boss) naByName.set(overlord.boss, "1");
  // A rank-and-file faction (8.19) GARRISONS the dungeon instead: { id, label } — its
  // people hold the entrance frontier (assignOccupation) and patrol as wandering
  // monsters (buildLevelMonsters), a mob 2d6 strong. Ignored when a lord is present.
  const garrison = !overlord && ctx.garrison ? ctx.garrison : null;
  if (garrison) naByName.set(garrison.label, "2d6");
  const naFor = (name) => naByName.get(name) || "1d6";

  // One theme + size per dungeon (from the POI); every level inherits the theme.
  const theme = ctx.theme || rollTable(tables.get("dungeon-theme"), rng).value;
  const forcedSize =
    ctx.size && sizeTable.entries.find((e) => e.value.size === ctx.size);
  const size = forcedSize ? forcedSize.value : rollTable(sizeTable, rng).value;
  const levelCount = randInt(rng, size.levels[0], size.levels[1]);

  const sizeName = size.size;
  const big = sizeName === "Sizable" || sizeName === "Sprawling";
  const stairChance = sizeName === "Sprawling" ? 0.6 : big ? 0.45 : 0.3;
  // Per-dungeon difficulty shifts the depth tier curve (some dungeons just nastier).
  const difficulty = rollTable(
    { id: "difficulty", entries: [
      { weight: 1, value: "soft" }, { weight: 2, value: "standard" }, { weight: 1, value: "deadly" },
    ] },
    rng,
  ).value;
  const shift = difficulty === "soft" ? -1 : difficulty === "deadly" ? 1 : 0;
  // Decide up-front which level (if any) sources a level-skipping shaft.
  let shaftSource = -1;
  if (levelCount >= 3 && rng() < (big ? 0.5 : 0.25)) shaftSource = randInt(rng, 0, levelCount - 3);

  const levels = [];
  const stairs = [];
  const pinsByLevel = new Map(); // target level index -> [{ x,y,w,h, rec }]

  // Generate top-down so each level's stair rooms can be PINNED directly above
  // their down-stair partner from the level(s) above (true vertical stairs).
  for (let i = 0; i < levelCount; i++) {
    const depth = i + 1;
    const isDeepest = depth === levelCount;
    const monsterTier = Math.max(1, Math.min(4, depth + shift));
    const treasureTier = Math.max(1, Math.min(3, depth + shift)); // tracks monster difficulty
    const roomCount = randInt(rng, size.rooms[0], size.rooms[1]);
    const { family, encounters } = buildLevelMonsters(tables, theme, isDeepest, rng, roomCount, monsterTier, depth, overlord, garrison);
    const encounterTable = { id: "dungeon-encounters", entries: encounters };
    // Treasure-type letters for this level, re-weighted toward its target tier
    // (depth scaling) — deeper levels lean toward richer B/X letters.
    const levelTreasure = {
      id: "treasure-type",
      entries: treasureTable.entries.map((e) => ({
        value: e.value,
        weight: (("weight" in e ? e.weight : 1)) * tierAffinity(e.value.tier, treasureTier),
      })),
    };

    const rooms = [];
    for (let n = 1; n <= roomCount; n++) {
      const { content, treasureChance } = rollTable(roomTable, rng).value;
      // Content-specific detail (a stocked-key entry).
      let monster = null;
      let trap = null;
      let special = null;
      let dressing = null;
      if (content === "Monster") {
        const name = rollTable(encounterTable, rng).value;
        monster = { name, na: naFor(name), status: rollTable(statusTable, rng).value };
      } else if (content === "Trap") {
        trap = rollTable(trapTable, rng).value;
      } else if (content === "Special") {
        special = rollTable(specialTable, rng).value;
      } else {
        dressing = rollTable(dressingTable, rng).value;
      }
      // Treasure (not in Special rooms — the feature is the point there). The app
      // is a referee's oracle, not a rulebook (Phase 9.8): a hoard is tagged with a
      // B/X lair Treasure Type LETTER + how it's guarded, and the GM rolls the
      // actual contents on their own tables — no invented gp. The letter's richness
      // scales with depth via the level's tier-weighted treasure-type table.
      let treasure = null;
      if (content !== "Special" && rng() < treasureChance) {
        const type = rollTable(levelTreasure, rng).value.type;
        const guard = rollTable(guardTable, rng).value;
        treasure = { type, guard };
      }
      rooms.push({ n, content, monster, trap, special, dressing, treasure });
    }

    const incoming = pinsByLevel.get(i) || [];
    const layout = layoutLevel(rooms, rng, {
      pins: incoming.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
      doorStyle: theme === "Cave complex" ? "natural" : "built",
    });
    levels.push({ depth: i + 1, theme, family, encounters, rooms, layout });

    // Resolve incoming pins: the room laid out at pin k is this stair's UP end.
    const pinnedCount = Math.min(incoming.length, rooms.length);
    incoming.forEach((p, k) => {
      const up = k < pinnedCount ? rooms[k].n : nearestRoom(p, layout.rooms, new Set()).n;
      p.rec.up = { level: i, room: up };
      stairs.push(p.rec);
    });

    // Register this level's outgoing stairs/shaft as pins for the deeper level,
    // using its positioned rooms so the up rooms land exactly above them.
    if (i < levelCount - 1) {
      const cap = Math.min(layout.rooms.length, 3);
      let count = 1;
      while (count < cap && rng() < stairChance) count++;
      for (const dr of spreadRooms(layout.rooms, count, rng)) {
        registerPin(pinsByLevel, i + 1, dr, { down: { level: i, room: dr.n }, kind: "stairs" });
      }
    }
    if (i === shaftSource) {
      const dr = pick(rng, layout.rooms);
      registerPin(pinsByLevel, i + 2, dr, { down: { level: i, room: dr.n }, kind: "shaft" });
    }
  }

  const { entrances, exits } = surfaceConnections(levels, sizeName, ctx.terrain, rng);
  const occupation = assignOccupation(levels, entrances, tables.get("occupiers"), rng, theme, garrison);
  assignLighting(levels, stairs, entrances, lightTable, rng);
  return { build: DUNGEON_BUILD, size: sizeName, theme, difficulty, levels, stairs, entrances, exits, occupation,
    ...(overlord ? { overlordId: overlord.id } : {}),
    ...(garrison ? { garrisonId: garrison.id } : {}) };
}

// Occupied frontier: a chance interlopers hold the rooms by an entrance — lit,
// with a locked door sealing the dark depths they never explored. Themes that
// are abandoned/empty attract squatters; native-occupant themes rarely do.
const OCCUPATION_CHANCE = {
  "Smugglers' tunnels": 0.6,
  "Ruined fort": 0.45,
  "Cult shrine": 0.45,
  Ruin: 0.4,
  "Abandoned mine": 0.35,
  "Cave complex": 0.35,
  "Prison vaults": 0.3,
  "Forgotten tomb": 0.3,
  "Flooded cistern": 0.2,
  Mausoleum: 0.2,
  "Wizard's sanctum": 0.15,
  "Goblin warren": 0.1,
  "Beast den": 0.05,
};

function assignOccupation(levels, entrances, occupiers, rng, theme, garrison = null) {
  // A faction that holds the POI ALWAYS garrisons the frontier (8.19); otherwise
  // squatters hold it by theme chance. The chance draw is skipped when forced.
  if (!garrison && rng() >= (OCCUPATION_CHANCE[theme] ?? 0.25)) return null;
  const ents = entrances.filter((e) => e.level === 0);
  const level0 = levels[0];
  const rooms = level0.layout.rooms;
  if (!ents.length || rooms.length < 2) return null; // need an entry + a frontier

  // BFS a contiguous cluster from an entrance over level-0 edges.
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const e of level0.layout.edges) {
    link(e.a, e.b);
    link(e.b, e.a);
  }
  const want = Math.min(rooms.length - 1, randInt(rng, 2, 4));
  const heldSet = new Set();
  const order = [];
  const queue = [pick(rng, ents).room];
  while (queue.length && heldSet.size < want) {
    const n = queue.shift();
    if (heldSet.has(n)) continue;
    heldSet.add(n);
    order.push(n);
    for (const m of adj.get(n) || []) if (!heldSet.has(m)) queue.push(m);
  }

  // The frontier holders: the POI's faction when it garrisons this dungeon (8.19),
  // else a rolled squatter group.
  const group = garrison ? garrison.label : rollTable(occupiers, rng).value;
  for (const room of level0.rooms) {
    if (!heldSet.has(room.n)) continue;
    room.held = group;
    room.light = { source: `Lit — held by ${group}` };
    if (room.content === "Monster") {
      room.monster = { name: group, na: "2d6", status: "alert" };
    }
  }
  // Boundary: lock every level-0 edge crossing held<->unheld (sealed but openable).
  for (const e of level0.layout.edges) {
    if (heldSet.has(e.a) !== heldSet.has(e.b)) e.type = "locked";
  }
  level0.layout.doors = deriveDoors(level0.layout.edges);

  return { by: group, level: 0, rooms: order };
}

// Lighting: dark by default; chance-to-be-lit decays with distance from the
// nearest surface entrance through the dungeon graph (a staircase costs more, so
// depth thins lighting fast). p = BASE * DECAY^dist, never quite zero.
const LIGHT_BASE = 0.25;
const LIGHT_DECAY = 0.75;
const LIGHT_STAIR_COST = 6; // hops a staircase/shaft adds (depth penalty)
const LIGHT_MIN = 0.0004;

function assignLighting(levels, stairs, entrances, lightTable, rng) {
  const key = (l, n) => `${l}:${n}`;
  const adj = new Map();
  const link = (a, b, cost) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, cost });
  };
  for (let l = 0; l < levels.length; l++) {
    for (const e of levels[l].layout.edges) {
      link(key(l, e.a), key(l, e.b), 1);
      link(key(l, e.b), key(l, e.a), 1);
    }
  }
  for (const st of stairs) {
    const a = key(st.down.level, st.down.room);
    const b = key(st.up.level, st.up.room);
    link(a, b, LIGHT_STAIR_COST);
    link(b, a, LIGHT_STAIR_COST);
  }

  // Dijkstra from every entrance room (small graphs — naive min-extract is fine).
  const dist = new Map();
  const frontier = [];
  for (const en of entrances) {
    const k = key(en.level, en.room);
    if (!dist.has(k)) {
      dist.set(k, 0);
      frontier.push(k);
    }
  }
  const done = new Set();
  while (frontier.length) {
    let mi = 0;
    for (let i = 1; i < frontier.length; i++) {
      if ((dist.get(frontier[i]) ?? Infinity) < (dist.get(frontier[mi]) ?? Infinity)) mi = i;
    }
    const u = frontier.splice(mi, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    for (const { to, cost } of adj.get(u) || []) {
      const nd = dist.get(u) + cost;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        frontier.push(to);
      }
    }
  }

  for (let l = 0; l < levels.length; l++) {
    for (const room of levels[l].rooms) {
      if (room.held) continue; // occupied rooms are already lit by their holders
      const d = dist.get(key(l, room.n)) ?? Infinity;
      const p = Math.min(LIGHT_BASE, Math.max(LIGHT_MIN, LIGHT_BASE * LIGHT_DECAY ** d));
      room.light = rng() < p ? { source: rollTable(lightTable, rng).value } : null;
    }
  }
}

// Queue a pin (a positioned room's rect) for the UP end of a stair on `target`.
function registerPin(map, target, room, rec) {
  if (!map.has(target)) map.set(target, []);
  map.get(target).push({ x: room.x, y: room.y, w: room.w, h: room.h, rec });
}

// Pick up to `count` distinct rooms from a level (deterministic, no replacement).
function sampleRooms(rooms, count, rng) {
  const pool = rooms.slice();
  const out = [];
  const k = Math.min(count, pool.length);
  for (let i = 0; i < k; i++) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

// Centre of a positioned layout room.
const roomCenter = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// Pick `count` positioned rooms that are spread out (first random, each next is
// the one farthest from those already chosen). Keeps multiple stairs apart.
function spreadRooms(rooms, count, rng) {
  const pool = rooms.slice();
  const chosen = [pool.splice(Math.floor(rng() * pool.length), 1)[0]];
  while (chosen.length < count && pool.length) {
    let bestIdx = 0;
    let bestD = -1;
    for (let k = 0; k < pool.length; k++) {
      let mind = Infinity;
      for (const ch of chosen) mind = Math.min(mind, dist2(roomCenter(pool[k]), roomCenter(ch)));
      if (mind > bestD) {
        bestD = mind;
        bestIdx = k;
      }
    }
    chosen.push(pool.splice(bestIdx, 1)[0]);
  }
  return chosen;
}

// Nearest unused room (by centre distance) on the target level to `downRoom`.
function nearestRoom(downRoom, targetRooms, used) {
  const dc = roomCenter(downRoom);
  let best = null;
  let bestD = Infinity;
  for (const r of targetRooms) {
    if (used.has(r.n)) continue;
    const d = dist2(dc, roomCenter(r));
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

// Surface connections (stairs are built top-down in generateDungeon). Entrances:
// always >=1 on level 0; each extra gets likelier with size (so even a Cramped
// dungeon can be a tunnel-through / all-rooms-open ruin, just rarely). Exits:
// terrain-gated, can surface on a deeper level for Hills/Mountains.
function surfaceConnections(levels, sizeName, terrain, rng) {
  const entranceChance =
    { Cramped: 0.22, Modest: 0.32, Sizable: 0.48, Sprawling: 0.62 }[sizeName] ?? 0.3;
  let entranceCount = 1;
  const cap = levels[0].rooms.length;
  while (entranceCount < cap && rng() < entranceChance) entranceCount++;
  const entrances = sampleRooms(levels[0].rooms, entranceCount, rng).map((r) => ({
    level: 0,
    room: r.n,
  }));

  const exits = [];
  if (/Hills|Mountains/.test(terrain || "") && levels.length >= 2 && rng() < 0.6) {
    const exitCount = rng() < 0.3 ? 2 : 1;
    for (let k = 0; k < exitCount; k++) {
      const level = randInt(rng, 1, levels.length - 1);
      exits.push({ level, room: pick(rng, levels[level].rooms).n });
    }
  }

  return { entrances, exits };
}
