// Wandering-encounter roller (referee aid) — draws one monster off a dungeon
// level's own weighted encounter table and reports the standard OSE/B/X
// trimmings: 1d6 surprise per side, 2d6 reaction, 2d6×10ft distance. Transient
// like the Oracle rolls in js/gen/oracle.js — the app never persists the
// result, only mirrors it to the panel + log.

import { rollTable } from "../core/table.js";
import { rollDice } from "../core/dice.js";

// OSE reaction table bands (2d6): the roll's total maps to a lower bound on
// party disposition, boundaries inclusive on the high end.
const REACTION_BANDS = [
  { max: 2, outcome: "Hostile" },
  { max: 5, outcome: "Unfriendly" },
  { max: 8, outcome: "Neutral" },
  { max: 11, outcome: "Indifferent" },
  { max: 12, outcome: "Friendly" },
];

/**
 * Map a 2d6 reaction roll to its OSE outcome band.
 * @param {number} total 2..12
 * @returns {string}
 */
export function reactionForRoll(total) {
  return REACTION_BANDS.find((b) => total <= b.max).outcome;
}

/**
 * Roll a wandering encounter (OSE/B/X): a monster off the level's own
 * weighted table, 1d6 surprise per side, 2d6 reaction, 2d6×10ft distance.
 * Pure — the caller supplies the rng — and the draw order is fixed so a given
 * seed always reproduces the same encounter.
 * @param {{ encounters: {weight?:number, value:string}[] }} level
 * @param {() => number} rng
 * @returns {{ kind: "wandering", monster: string, surpriseMonster: number,
 *   surpriseParty: number, reaction: { roll: number, outcome: string }, distanceFt: number }}
 */
export function rollWanderingEncounter(level, rng) {
  const monster = rollTable({ id: "wandering", entries: level.encounters }, rng).value;
  const surpriseMonster = rollDice("1d6", rng).total;
  const surpriseParty = rollDice("1d6", rng).total;
  const reactionRoll = rollDice("2d6", rng).total;
  const distanceFt = rollDice("2d6*10", rng).total;
  return {
    kind: "wandering",
    monster,
    surpriseMonster,
    surpriseParty,
    reaction: { roll: reactionRoll, outcome: reactionForRoll(reactionRoll) },
    distanceFt,
  };
}
