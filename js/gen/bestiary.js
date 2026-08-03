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
 * A name -> danger-tier index from the monster-families table. A member keeps its
 * own tier (1-4); a family's ELITE ranks above every member as 5 (the apex boss),
 * so a level's/dungeon's most dangerous reads correctly. A name in two families
 * takes its highest tier.
 * @param {{ entries?: { value: { members?: {value:string,tier?:number}[], elite?: string } }[] }} familiesTable
 * @returns {Map<string, number>}
 */
export function buildTierIndex(familiesTable) {
  const idx = new Map();
  for (const e of (familiesTable && familiesTable.entries) || []) {
    const fam = e.value || {};
    for (const m of fam.members || []) {
      const t = m.tier || 1;
      if (!idx.has(m.value) || idx.get(m.value) < t) idx.set(m.value, t);
    }
    if (fam.elite) idx.set(fam.elite, 5); // the boss outranks every rank-and-file member
  }
  return idx;
}

/**
 * Rank a bestiary by danger: annotate each entry with its `tier` (from the tier
 * index; 0 when unknown), sort deadliest-first (tier, then deepest floor, then
 * name), and flag the single apex with `deadliest: true`. Returns a NEW array;
 * any existing fields (e.g. `telegraph`) are preserved.
 * @param {{name:string,floors:number[]}[]} bestiary
 * @param {Map<string,number>} tierIndex
 */
export function rankBestiary(bestiary, tierIndex) {
  const tierOf = (name) => (tierIndex && tierIndex.get(name)) || 0;
  const ranked = (bestiary || []).map((m) => ({ ...m, tier: tierOf(m.name) }));
  ranked.sort((a, b) =>
    b.tier - a.tier ||
    Math.max(0, ...b.floors) - Math.max(0, ...a.floors) ||
    a.name.localeCompare(b.name));
  if (ranked.length) ranked[0].deadliest = true;
  return ranked;
}

/**
 * The most dangerous monster stocked on each level (for a per-level "foreshadow
 * this" cue). Returns { [depth]: { name, tier } } — the highest-tier room monster
 * on that floor (ties broken by name for determinism).
 * @param {{ levels?: { depth:number, rooms?: { monster?: { name:string } }[] }[] }} dungeon
 * @param {Map<string,number>} tierIndex
 */
export function levelApex(dungeon, tierIndex) {
  const tierOf = (name) => (tierIndex && tierIndex.get(name)) || 0;
  const apex = {};
  for (const level of dungeon.levels || []) {
    let best = null;
    for (const room of level.rooms || []) {
      if (!room.monster) continue;
      const t = tierOf(room.monster.name);
      if (!best || t > best.tier || (t === best.tier && room.monster.name < best.name)) {
        best = { name: room.monster.name, tier: t };
      }
    }
    if (best) apex[level.depth] = best;
  }
  return apex;
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
