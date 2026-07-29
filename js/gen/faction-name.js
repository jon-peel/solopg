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
  "Ember", "Salt", "Winter", "Shrouded", "Emberwrought", "Sable", "Ivory",
  "Onyx", "Molten", "Withered", "Scorched", "Umbral", "Blighted", "Fell",
  "Gaunt", "Sunless", "Tarnished", "Riven", "Wrathful",
];
const BODY = [
  "Hand", "Circle", "Fang", "Crown", "Banner", "Chain", "Veil", "Coin",
  "Blade", "Eye", "Order", "Pack", "Host", "Compact", "Lantern", "Wardens",
  "Talon", "Gauntlet", "Sigil", "Wreath", "Mantle", "Spire", "Chalice",
  "Cowl", "Wheel", "Brand", "Sceptre", "Choir",
];

// "<Kin> of <Place>" — a wilder, tribal reading (Wolves of the Fen).
const KIN = [
  "Wolves", "Crows", "Ravens", "Serpents", "Jackals", "Boars", "Adders",
  "Kites", "Hounds", "Vultures", "Sons", "Daughters", "Reavers", "Shrikes",
  "Bears", "Wyverns", "Foxes", "Widows", "Orphans", "Exiles", "Cutthroats",
  "Marauders",
];
const OF_PLACE = [
  "the Fen", "the Reach", "the Waste", "the Deep", "the Mire", "the Hollow",
  "the Marches", "the Ash", "the Thorn", "the Barrows", "the Pale", "the Scar",
  "the Moor", "the Weald", "the Bog", "the Fells", "the Gloom", "the Murk",
  "the Blight", "the Crag",
];

// Dynasty surnames for a noble house (House Umber).
const HOUSE = [
  "Umber", "Corvin", "Vayle", "Mordane", "Blackwood", "Harrow", "Grael",
  "Ostrenne", "Falk", "Dree", "Wexford", "Ashcroft", "Ryker", "Valmont",
  "Ravenhurst", "Greymark", "Fenmore", "Mourne", "Vandrel", "Halvorne",
  "Thornbury", "Estaven", "Draymere",
];

// --- Lair-bound lords + rebellion (Phase 8.16) ---------------------------
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// A necromancer/lich reads as a crypt-cabal ("The Hollow Ossuary").
const UNDEAD_BODY = ["Cabal", "Ossuary", "Sepulchre", "Barrow", "Pall", "Coven", "Circle", "Hand", "Reliquary", "Requiem", "Mortuary", "Catacomb", "Dirge", "Necropolis"];
// A vampire is a titled individual or a "court".
const VAMP_TITLE = ["Count", "Countess", "Baron", "Baroness", "the Pale Lord", "the Crimson Lord", "Viscount", "Viscountess", "Margrave", "the Sable Lord", "the Grey Lady"];
// A hag / coven of the wilds.
const HAG_ADJ = ["Bog", "Fen", "Mire", "Bramble", "Withered", "Grinning", "Weeping", "Nettle", "Gnarled", "Muttering", "Peat"];
const HAG_BODY = ["Crone", "Hag", "Coven", "Sisters", "Grandmother", "Witch", "Beldame", "Matron", "Godmother", "Grimalkin"];
// A dragon is a NAMED individual wyrm ("Varethyx, the Ashen Wyrm").
const DRAGON_NAMES = [
  "Varethyx", "Sarnoth", "Vharzul", "Ignareth", "Cindraxus", "Aurgloth",
  "Malzureth", "Thraxion", "Ormraxis", "Zaltheryn", "Halvireth", "Morghaxus",
  "Velthyrion", "Skarloth", "Voxareth", "Kaeldrax",
];
const WYRM = ["Wyrm", "Drake", "Wyrm", "Great Wyrm", "Serpent", "Firedrake", "Linnorm", "Worm"];
// Rebellion — a peasant rising or a breakaway banner.
const REBEL_ADJ = ["Peasant", "Free", "Common", "Ragged", "Broken-Chain", "Barefoot", "Hungry", "Landless"];
const REBEL_BODY = ["Free Banners", "Free Companies", "Peasants' Banner", "Ragged Host", "Sworn Commons", "Bondbreakers", "Sickle Host", "Freeholders"];

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
  const kind = opts.kind || "";

  // Noble houses read as dynasties.
  if (archetype === "noble house") return `House ${pick(rng, HOUSE)}`;

  // Lair-bound lords (8.16) read distinctly from the rank-and-file powers.
  if (archetype === "dragon") return `${pick(rng, DRAGON_NAMES)}, the ${pick(rng, ADJ)} ${pick(rng, WYRM)}`;
  if (archetype === "necromancer" || archetype === "lich") return `The ${pick(rng, ADJ)} ${pick(rng, UNDEAD_BODY)}`;
  if (archetype === "vampire") return rng() < 0.5 ? `${pick(rng, VAMP_TITLE)} ${pick(rng, HOUSE)}` : `The ${pick(rng, ADJ)} Court`;
  if (archetype === "hag") return `The ${pick(rng, HAG_ADJ)} ${pick(rng, HAG_BODY)}`;

  // Rebellion (8.16) — a peasant rising or a breakaway house.
  if (archetype === "rebellion") {
    const r = rng();
    if (r < 0.34) return `House ${pick(rng, HOUSE)} in Revolt`;
    if (r < 0.67) return `The ${pick(rng, REBEL_ADJ)} Uprising`;
    return `The ${pick(rng, REBEL_BODY)}`;
  }

  // A monstrous tribe with a known kind reads by its creatures (The Gnolls of the Waste).
  if (archetype === "monstrous tribe" && kind) return `The ${cap(kind)} of ${pick(rng, OF_PLACE)}`;

  // Wilder powers lean tribal ("<Kin> of <Place>") half the time; everyone else
  // (and the other half) gets an order-name ("The <Adj> <Body>").
  const wild = archetype === "bandits" || archetype === "monstrous tribe" || archetype === "mercenary company";
  if (wild && rng() < 0.5) return `${pick(rng, KIN)} of ${pick(rng, OF_PLACE)}`;
  return `The ${pick(rng, ADJ)} ${pick(rng, BODY)}`;
}
