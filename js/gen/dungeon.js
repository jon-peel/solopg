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
import { layoutLevel } from "./dungeon-layout.js";

const MIN_ENCOUNTERS = 4;
const MAX_ENCOUNTERS = 6;
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
export const DUNGEON_BUILD = 10;

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

/**
 * Build one level's monster set: mostly the chosen family, plus a chance of an
 * interloper and (on the deepest level) the family's elite.
 * @returns {{ family: string, encounters: {weight:number,value:string}[] }}
 */
function buildLevelMonsters(families, theme, isDeepest, rng) {
  const familyName = rollTable(familyTableForTheme(families, theme), rng).value;
  const index = familyIndex(families);
  const family = index.get(familyName) || { members: [{ weight: 1, value: "Vermin" }] };

  const want = randInt(rng, MIN_ENCOUNTERS, MAX_ENCOUNTERS);
  const seen = sampleDistinct(family.members, want, rng);

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
  // A boss waits at the bottom.
  if (isDeepest && family.elite && !seen.has(family.elite)) {
    encounters.push({ weight: 1, value: family.elite });
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
  const treasureTable = tables.get("dungeon-treasure");
  const guardTable = tables.get("dungeon-treasure-guard");
  const statusTable = tables.get("dungeon-monster-status");

  // One theme + size per dungeon (from the POI); every level inherits the theme.
  const theme = ctx.theme || rollTable(tables.get("dungeon-theme"), rng).value;
  const forcedSize =
    ctx.size && sizeTable.entries.find((e) => e.value.size === ctx.size);
  const size = forcedSize ? forcedSize.value : rollTable(sizeTable, rng).value;
  const levelCount = randInt(rng, size.levels[0], size.levels[1]);

  const levels = [];
  for (let depth = 1; depth <= levelCount; depth++) {
    const isDeepest = depth === levelCount;
    const { family, encounters } = buildLevelMonsters(tables, theme, isDeepest, rng);
    const encounterTable = { id: "dungeon-encounters", entries: encounters };

    const roomCount = randInt(rng, size.rooms[0], size.rooms[1]);
    const rooms = [];
    for (let n = 1; n <= roomCount; n++) {
      const { content, treasureChance } = rollTable(roomTable, rng).value;
      // Content-specific detail (a stocked-key entry).
      let monster = null;
      let trap = null;
      let special = null;
      let dressing = null;
      if (content === "Monster") {
        monster = {
          name: rollTable(encounterTable, rng).value,
          number: randInt(rng, 1, 6),
          status: rollTable(statusTable, rng).value,
        };
      } else if (content === "Trap") {
        trap = rollTable(trapTable, rng).value;
      } else if (content === "Special") {
        special = rollTable(specialTable, rng).value;
      } else {
        dressing = rollTable(dressingTable, rng).value;
      }
      // Treasure (not in Special rooms — the feature is the point there).
      let treasure = null;
      if (content !== "Special" && rng() < treasureChance) {
        treasure = {
          kind: rollTable(treasureTable, rng).value,
          guard: rollTable(guardTable, rng).value,
        };
      }
      rooms.push({ n, content, monster, trap, special, dressing, treasure });
    }

    const layout = layoutLevel(rooms, rng);
    levels.push({ depth, theme, family, encounters, rooms, layout });
  }

  const { stairs, entrances, exits } = connectLevels(levels, size.size, ctx.terrain, rng);
  return { build: DUNGEON_BUILD, size: size.size, theme, levels, stairs, entrances, exits };
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

// Connect levels. Stairs join adjacent levels (>=1, count scales with size up to
// 3) with each up-stair at the room NEAREST below its down-stair (vertical
// alignment) and multiple down-stairs spread apart. Deep dungeons may also get a
// level-skipping "shaft" (a long drop). Plus surface entrances on level 0 (count
// scales with size, any size can have several) and terrain-gated deeper exits.
function connectLevels(levels, sizeName, terrain, rng) {
  const stairs = [];
  const big = sizeName === "Sizable" || sizeName === "Sprawling";
  const stairChance = sizeName === "Sprawling" ? 0.6 : big ? 0.45 : 0.3;

  for (let i = 0; i < levels.length - 1; i++) {
    const upper = levels[i].layout.rooms; // positioned rooms (n,x,y,w,h)
    const lower = levels[i + 1].layout.rooms;
    const cap = Math.min(upper.length, lower.length, 3);
    let count = 1;
    while (count < cap && rng() < stairChance) count++;

    const downRooms = spreadRooms(upper, count, rng);
    const usedLower = new Set();
    for (const dr of downRooms) {
      const up = nearestRoom(dr, lower, usedLower);
      usedLower.add(up.n);
      stairs.push({ down: { level: i, room: dr.n }, up: { level: i + 1, room: up.n }, kind: "stairs" });
    }
  }

  // Occasional level-skipping shaft (links level i -> i+2) in deeper dungeons.
  if (levels.length >= 3 && rng() < (big ? 0.5 : 0.25)) {
    const i = randInt(rng, 0, levels.length - 3);
    const dr = pick(rng, levels[i].layout.rooms);
    const up = nearestRoom(dr, levels[i + 2].layout.rooms, new Set());
    stairs.push({ down: { level: i, room: dr.n }, up: { level: i + 2, room: up.n }, kind: "shaft" });
  }

  // Entrances: always >=1; each extra entrance gets likelier with size (so even
  // a Cramped dungeon can be a tunnel-through / all-rooms-open ruin, just rarely).
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

  return { stairs, entrances, exits };
}
