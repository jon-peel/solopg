// Dungeon bestiary (Phase 12 overview) — a per-dungeon "who's down there"
// summary for the side panel: every monster actually stocked in the dungeon's
// rooms, grouped by name with the floors it appears on, plus (for monsters
// with an AUTHORED telegraph in data/monster-telegraph.json) a seed-stable
// foreshadowing hint line. Pure — no DOM/fetch — so it's node-testable.

import { rollTable } from "../core/table.js";

/**
 * Aggregate the monsters actually stocked in a dungeon's rooms, grouped by
 * name with the (sorted, deduped) floor depths they appear on. Dungeon-wide
 * (spans every level), independent of exploration state.
 * @param {{ levels?: { depth: number, rooms?: { monster?: { name: string } }[] }[] }} dungeon
 * @returns {{ name: string, floors: number[] }[]} sorted by name
 */
export function buildBestiary(dungeon) {
  const byName = new Map();
  for (const level of dungeon.levels || []) {
    for (const room of level.rooms || []) {
      if (!room.monster) continue;
      if (!byName.has(room.monster.name)) byName.set(room.monster.name, new Set());
      byName.get(room.monster.name).add(level.depth);
    }
  }
  return [...byName]
    .map(([name, depths]) => ({ name, floors: [...depths].sort((a, b) => a - b) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The authored telegraph for a monster (a seeded pick among its phrases), or
 * null when there's no SPECIFIC entry for it. Does NOT fall back to a generic
 * bucket — only authored monsters get an inline hint.
 * @param {string} monsterName
 * @param {object} table the loaded "monster-telegraph" table
 * @param {() => number} rng
 * @returns {string|null}
 */
export function telegraphFor(monsterName, table, rng) {
  const entry = (table.entries || []).find((e) => e.value.monster === monsterName);
  if (!entry || !entry.value.telegraphs || !entry.value.telegraphs.length) return null;
  return rollTable({ id: `telegraph:${monsterName}`, entries: entry.value.telegraphs.map((v) => ({ value: v })) }, rng).value;
}
