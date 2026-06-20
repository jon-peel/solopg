// Dungeon-interior generator (Phase 4).
//
// Pure: given preloaded tables + an rng stream, returns a dungeon's full
// interior — a size, a stack of levels, and per level a theme, a generated
// random-monster table, and stocked room contents. No DOM / fetch / persistence,
// so it's node-testable. Expands the Phase-3 dungeon stub.
//
// Split (mirrors hex.js): weighted picks live in JSON tables (dungeon-size,
// dungeon-theme, dungeon-room, creatures); the counts/sequencing live here.

import { rollTable } from "../core/table.js";
import { randInt } from "../core/rng.js";

const MIN_ENCOUNTERS = 4;
const MAX_ENCOUNTERS = 6;

/**
 * Build a level's random-monster table by sampling distinct creatures from the
 * shared `creatures` table, keeping each creature's base weight. Returns a
 * canonical weighted table of { weight, value } the level can be rolled on.
 */
function buildEncounterTable(creatures, rng) {
  const want = randInt(rng, MIN_ENCOUNTERS, MAX_ENCOUNTERS);
  const seen = new Map(); // value -> weight (dedupe; first weight wins)
  // Cap attempts so a small source table can never loop forever.
  for (let attempt = 0; attempt < want * 8 && seen.size < want; attempt++) {
    const roll = rollTable(creatures, rng);
    if (!seen.has(roll.value)) {
      seen.set(roll.value, "weight" in roll.entry ? roll.entry.weight : 1);
    }
  }
  return Array.from(seen, ([value, weight]) => ({ weight, value }));
}

/**
 * Generate one dungeon interior.
 * @param {Map<string,object>} tables incl. dungeon-size, dungeon-theme,
 *   dungeon-room, creatures.
 * @param {() => number} rng a dedicated sub-stream for this dungeon.
 * @param {object} [ctx] reserved (e.g. terrain) for future biasing.
 * @returns {{ size: string, levels: object[] }}
 */
export function generateDungeon(tables, rng, ctx = {}) {
  const sizeTables = tables.get("dungeon-size");
  const themeTable = tables.get("dungeon-theme");
  const roomTable = tables.get("dungeon-room");
  const creatures = tables.get("creatures");

  const size = rollTable(sizeTables, rng).value;
  const levelCount = randInt(rng, size.levels[0], size.levels[1]);

  const levels = [];
  for (let depth = 1; depth <= levelCount; depth++) {
    const theme = rollTable(themeTable, rng).value;
    const encounters = buildEncounterTable(creatures, rng);
    const encounterTable = { id: "dungeon-encounters", entries: encounters };

    const roomCount = randInt(rng, size.rooms[0], size.rooms[1]);
    const rooms = [];
    for (let n = 1; n <= roomCount; n++) {
      const room = rollTable(roomTable, rng).value;
      const monster =
        room.content === "Monster" ? rollTable(encounterTable, rng).value : null;
      const treasure = rng() < room.treasureChance;
      rooms.push({ n, content: room.content, monster, treasure });
    }

    levels.push({ depth, theme, encounters, rooms });
  }

  return { size: size.size, levels };
}
