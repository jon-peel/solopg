// Dice-notation roller.
//
// Phase 0 supports the lean core: `NdM`, `dM` (N=1), an optional `±K` modifier,
// and bare integer constants. Keep-highest/lowest and exploding dice are
// deliberately deferred — extend the parser here when a phase needs them.

import { randInt } from "./rng.js";

// Whole-string match: optional count, `d`, sides, optional signed modifier.
const DICE_RE = /^\s*(\d+)?\s*[dD]\s*(\d+)\s*([+-]\s*\d+)?\s*$/;
const CONST_RE = /^\s*([+-]?\d+)\s*$/;

/**
 * Roll a dice expression.
 * @param {string} notation e.g. "3d6", "d20", "2d8+1", "-2"
 * @param {() => number} [rng] defaults to Math.random
 * @returns {{ total: number, rolls: number[], notation: string }}
 */
export function rollDice(notation, rng = Math.random) {
  const raw = String(notation);

  const constMatch = raw.match(CONST_RE);
  if (constMatch) {
    const total = Number(constMatch[1]);
    return { total, rolls: [], notation: raw };
  }

  const m = raw.match(DICE_RE);
  if (!m) {
    throw new Error(`Invalid dice notation: "${notation}"`);
  }

  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  const modifier = m[3] ? parseInt(m[3].replace(/\s+/g, ""), 10) : 0;

  if (count < 1) throw new Error(`Invalid dice count in "${notation}"`);
  if (sides < 1) throw new Error(`Invalid die size in "${notation}"`);

  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(randInt(rng, 1, sides));
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;

  return { total, rolls, notation: raw };
}
