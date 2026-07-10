// Faction names (Phase 8.7) — a seeded, evocative name for a faction.
//
// Reuses settlement-name.js's CONSTRUCTION technique (seeded prefix/suffix picks
// from const word-lists), but UNLIKE a settlement name it is written into the
// faction object ONCE at creation, not re-derived every render. A settlement name
// re-derives from its coordinate (seed,q,r,gen); a faction is a first-class object
// in world.factions[] with its own identity that can outlive/move its holdings, so
// there is no stable coordinate to re-derive from — the name is stored. (Flagged
// in phase-8.7-generate-faction.md as a deliberate divergence from the
// derived-not-stored rule.)
//
// Element lists live here as consts (like settlement-name.js / terrain-profile.js
// flavour arrays), not JSON tables — the create path needs them synchronously and
// there is no in-app table editing.

import { subRng, pick } from "../core/rng.js";

// "The <Adjective> <Body>" — the default order-name (The Ashen Hand, The Iron Circle).
const ADJ = [
  "Ashen", "Iron", "Crimson", "Black", "Silent", "Broken", "Hollow", "Grey",
  "Gilded", "Pale", "Thorned", "Ninefold", "Wandering", "Sunken", "Bitter",
  "Ember", "Salt", "Winter", "Shrouded", "Emberwrought",
];
const BODY = [
  "Hand", "Circle", "Fang", "Crown", "Banner", "Chain", "Veil", "Coin",
  "Blade", "Eye", "Order", "Pack", "Host", "Compact", "Lantern", "Wardens",
];

// "<Kin> of <Place>" — a wilder, tribal reading (Wolves of the Fen).
const KIN = [
  "Wolves", "Crows", "Ravens", "Serpents", "Jackals", "Boars", "Adders",
  "Kites", "Hounds", "Vultures", "Sons", "Daughters", "Reavers",
];
const OF_PLACE = [
  "the Fen", "the Reach", "the Waste", "the Deep", "the Mire", "the Hollow",
  "the Marches", "the Ash", "the Thorn", "the Barrows", "the Pale", "the Scar",
];

// Dynasty surnames for a noble house (House Umber).
const HOUSE = [
  "Umber", "Corvin", "Vayle", "Mordane", "Blackwood", "Harrow", "Grael",
  "Ostrenne", "Falk", "Dree", "Wexford", "Ashcroft", "Ryker", "Valmont",
];

/**
 * A seeded faction name.
 * @param {number|string} seed world seed
 * @param {number} n the faction's index (nextFactionId) — varies the name per faction
 * @param {{ archetype?: string }} [opts] archetype lightly biases the pattern
 * @returns {string}
 */
export function factionName(seed, n, opts = {}) {
  const rng = subRng(seed, "fname", n);
  const archetype = opts.archetype || "";

  // Noble houses read as dynasties.
  if (archetype === "noble house") return `House ${pick(rng, HOUSE)}`;

  // Wilder powers lean tribal ("<Kin> of <Place>") half the time; everyone else
  // (and the other half) gets an order-name ("The <Adj> <Body>").
  const wild = archetype === "bandits" || archetype === "monstrous tribe" || archetype === "mercenary company";
  if (wild && rng() < 0.5) return `${pick(rng, KIN)} of ${pick(rng, OF_PLACE)}`;
  return `The ${pick(rng, ADJ)} ${pick(rng, BODY)}`;
}
