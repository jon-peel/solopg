// Tower-interior generator (Phase 5.4) — a Tier-2 mapped interior.
//
// Pure + node-testable. A tower reuses the dungeon's interior SHAPE (so the
// Dungeon View renders it unchanged) and the layout engine (layoutLevel +
// vertical-stair pinning), but is its own, smaller thing: a vertical stack of
// narrow floors that go UP from the ground, a single staircase between floors,
// the garrison drawn from the POI's occupant, and the master waiting on the top
// floor. The interior carries `orientation: "up"` so the view flips the ▲/▼ stair
// direction and the "up/down" labels (js/ui/app.js).
//
// Index 0 = ground floor (the entrance); higher index = higher floor. Built
// bottom-up so each floor's stair room can be pinned directly above the floor
// below (true vertical stairs), exactly as the dungeon pins them downward.

import { rollTable } from "../core/table.js";
import { randInt, pick } from "../core/rng.js";
import { rollDice } from "../core/dice.js";
import { layoutLevel } from "./dungeon-layout.js";

// Interior-shape version for the tower (parallels DUNGEON_BUILD). The UI rebuilds
// a tower whose interior `build` differs, so old saves self-heal without a
// world-schema migration. Bump whenever this object's shape changes.
export const TOWER_BUILD = 1;

const FLOORS_MIN = 2;
const FLOORS_MAX = 4;
const ROOMS_PER_FLOOR_MIN = 1;
const ROOMS_PER_FLOOR_MAX = 3;
const GARRISON_NA = "1d4"; // defenders in a manned room

// Weight (cn) per gp by bulk — mirrors js/gen/dungeon.js (gems/magic are light;
// statues/plate are heavy). Coins show their dice, not a weight.
const BULK_FACTOR = { light: 0.05, heavy: 1.5 };

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stripArticle = (s) => (s ? s.replace(/^(a |an |the )/i, "") : s);

// One room's treasure (or null), same convention as the dungeon.
function rollTreasure(treasureTable, guardTable, rng) {
  const kind = rollTable(treasureTable, rng).value;
  const guard = rollTable(guardTable, rng).value;
  if (kind.bulk === "coin") return { kind: kind.kind, guard, dice: kind.gp.replace("*", "×") };
  if (kind.gp === "0") return { kind: kind.kind, guard };
  const gp = rollDice(kind.gp, rng).total;
  return { kind: kind.kind, guard, gp, weight: Math.max(1, Math.round(gp * BULK_FACTOR[kind.bulk])) };
}

// Register a pin (a positioned room's rect) for the stair room on `target` floor.
function registerPin(map, target, room, rec) {
  if (!map.has(target)) map.set(target, []);
  map.get(target).push({ x: room.x, y: room.y, w: room.w, h: room.h, rec });
}

/**
 * Generate one tower interior.
 * @param {Map<string,object>} tables incl. dungeon-room/-trap/-special/-dressing/
 *   -treasure/-treasure-guard/-monster-status, creatures, tower-kind, tower-master.
 * @param {() => number} rng a dedicated sub-stream for this tower.
 * @param {{ occupant?: object, terrain?: string }} [ctx] the POI's occupant is the
 *   tower's garrison ("occupied" → manned; otherwise an empty, dark tower).
 * @returns {object} a dungeon-shaped interior with orientation:"up".
 */
export function generateTower(tables, rng, ctx = {}) {
  const roomTable = tables.get("dungeon-room");
  const trapTable = tables.get("dungeon-trap");
  const specialTable = tables.get("dungeon-special");
  const dressingTable = tables.get("dungeon-dressing");
  const treasureTable = tables.get("dungeon-treasure");
  const guardTable = tables.get("dungeon-treasure-guard");
  const statusTable = tables.get("dungeon-monster-status");
  const creatures = tables.get("creatures");

  const occupant = ctx.occupant || { kind: "none" };
  const occupied = occupant.kind === "occupied";
  const garrison = occupied ? occupant.by : null;
  const kind = rollTable(tables.get("tower-kind"), rng).value; // "a watchtower"
  const master = occupied ? rollTable(tables.get("tower-master"), rng).value : null;

  const floorCount = randInt(rng, FLOORS_MIN, FLOORS_MAX);
  const levels = [];
  const stairs = [];
  const pinsByFloor = new Map(); // floor index -> [{ x,y,w,h, rec }]

  for (let f = 0; f < floorCount; f++) {
    const isTop = f === floorCount - 1;
    const roomCount = randInt(rng, ROOMS_PER_FLOOR_MIN, ROOMS_PER_FLOOR_MAX);

    const rooms = [];
    for (let n = 1; n <= roomCount; n++) {
      const { content, treasureChance } = rollTable(roomTable, rng).value;
      let monster = null, trap = null, special = null, dressing = null;
      if (content === "Monster") {
        const name = garrison || rollTable(creatures, rng).value;
        monster = { name, na: occupied ? GARRISON_NA : "1d4", status: rollTable(statusTable, rng).value };
      } else if (content === "Trap") {
        trap = rollTable(trapTable, rng).value;
      } else if (content === "Special") {
        special = rollTable(specialTable, rng).value;
      } else {
        dressing = rollTable(dressingTable, rng).value;
      }
      const treasure =
        content !== "Special" && rng() < treasureChance
          ? rollTreasure(treasureTable, guardTable, rng)
          : null;
      // A held tower is lit throughout; an empty one is dark.
      const light = occupied ? { source: `Lit — held by ${garrison}` } : null;
      rooms.push({ n, content, monster, trap, special, dressing, treasure, light });
    }

    // The climb ends at the master's chamber — the last room of the top floor.
    if (isTop) {
      const lord = rooms[rooms.length - 1];
      lord.content = "Monster";
      lord.monster = { name: master || "a lone watcher", na: "1", status: "alert" };
      lord.trap = lord.special = lord.dressing = null;
      lord.light = { source: "Lit — the master's chamber" };
      if (!lord.treasure) lord.treasure = rollTreasure(treasureTable, guardTable, rng);
    }

    const incoming = pinsByFloor.get(f) || [];
    const layout = layoutLevel(rooms, rng, {
      pins: incoming.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    });
    levels.push({ depth: f + 1, theme: cap(stripArticle(kind)), family: garrison, encounters: [], rooms, layout });

    // Resolve the incoming pin: the pinned room (laid out first) is this floor's
    // UPPER stair end (the higher-index end of the stair from the floor below).
    const pinnedCount = Math.min(incoming.length, rooms.length);
    incoming.forEach((p, k) => {
      const up = k < pinnedCount ? rooms[k].n : layout.rooms[0].n;
      p.rec.up = { level: f, room: up };
      stairs.push(p.rec);
    });

    // Register the staircase up to the next floor (pinned above this floor's room).
    if (!isTop) {
      const dr = pick(rng, layout.rooms);
      registerPin(pinsByFloor, f + 1, dr, { down: { level: f, room: dr.n }, kind: "stairs" });
    }
  }

  return {
    build: TOWER_BUILD,
    kind,
    master,
    theme: cap(stripArticle(kind)),
    size: `${floorCount} storeys`,
    orientation: "up",
    levels,
    stairs,
    entrances: [{ level: 0, room: levels[0].layout.entrance }],
    exits: [],
  };
}
