// Culture data (Phase 14.1) — the demihuman race registry, terrain weights, and
// per-race name-flavour pools. Pure data/consts, no DOM, no rng calls: every
// generator that wants racial flavour imports from here and rolls its own
// deterministic pick against these arrays (see settlement-name.js, regions.js,
// oracle.js). See docs/plans/phase-14-cultures.md for the model this feeds.
//
// Human is the NULL case (§5 non-negotiable): it is never a race value, never in
// RACES, never keyed in any pool below. "No race" (undefined/absent) means
// Human, everywhere in this codebase — there is no "human" entry to look up.

// --- Race registry ---------------------------------------------------------

// The four BX/OSE demihuman peoples this app draws on the map. Order is used
// as the canonical iteration/display order elsewhere (legends, tests).
export const RACES = ["elf", "dwarf", "halfling", "gnome"];

// Fast membership check (`RACE_SET.has(x)`) without re-building an array Set at
// every call site.
export const RACE_SET = new Set(RACES);

// Display label per race — capitalized for UI text (legends, panel rows).
export const RACE_LABELS = {
  elf: "Elf",
  dwarf: "Dwarf",
  halfling: "Halfling",
  gnome: "Gnome",
};

// --- Density & terrain weights (§3) -----------------------------------------

// Master dial: per candidate-core chance of being demihuman AT ALL, by terrain.
// Deliberately low so cultural borders stay rare (a Huge world should read as
// "mostly Human, with a few demihuman pockets"), not a patchwork. Water bodies
// never seed a culture core.
export const CULTURE_DENSITY = {
  Forest: 0.25,
  Hills: 0.20,
  Mountains: 0.22,
  Plains: 0.10,
  Swamp: 0.05,
  Desert: 0.05,
  Water: 0,
};

// Epsilon added to every race's weight in every land terrain below, so no race
// is ever exactly zero anywhere — a race can always surface (e.g. deep elves in
// the mountains at long odds), it just usually won't (§1.1's "epsilon floor").
export const CULTURE_EPSILON = 0.05;

// Raw per-terrain race weights (§3), BEFORE the epsilon floor is added. Kept
// around (and exported) so the design intent is legible/testable on its own —
// generation code should use TERRAIN_RACE_WEIGHTS (below), not this.
export const TERRAIN_RACE_WEIGHTS_BASE = {
  Forest: { elf: 60, gnome: 8, halfling: 6, dwarf: 3 },
  Mountains: { dwarf: 55, gnome: 20, elf: 1, halfling: 1 },
  Hills: { gnome: 30, halfling: 30, dwarf: 15, elf: 3 },
  Plains: { halfling: 40, gnome: 5, elf: 3, dwarf: 2 },
  Swamp: { elf: 3, gnome: 3, dwarf: 2, halfling: 2 },
  Desert: { dwarf: 3, gnome: 2, halfling: 2, elf: 1 },
};

/** Build an epsilon-floored copy of a base terrain->race weight map. */
function withEpsilonFloor(base) {
  const out = {};
  for (const [terrain, weights] of Object.entries(base)) {
    out[terrain] = {};
    for (const race of RACES) out[terrain][race] = (weights[race] || 0) + CULTURE_EPSILON;
  }
  return out;
}

// Per-terrain race weights WITH the epsilon floor applied — every race has a
// nonzero weight in every land terrain. This is what generation code (Step 2+)
// should roll a weightedPick against.
export const TERRAIN_RACE_WEIGHTS = withEpsilonFloor(TERRAIN_RACE_WEIGHTS_BASE);

// --- Colours (§3) ------------------------------------------------------------

// Map/legend tint per race. Chosen to stay clear of the reserved marker colours
// (selection oxblood, hook-target red, party magenta — see poi-style.js) and
// distinct from the faction palette's hues.
export const CULTURE_COLORS = {
  elf: "#1f6f5c", // deep green/teal
  dwarf: "#5b6b7a", // slate blue-grey
  halfling: "#c98a2c", // warm gold/amber
  gnome: "#a1552b", // ochre/rust
};

// --- Name-flavour joiners (§4) -----------------------------------------------

// Occasional punctuation dropped into a fused prefix+suffix settlement name, per
// race flavour: elves soften with an apostrophe now and then (Cael'thas), dwarves
// harden with a hyphen (Karr-dûr). Halflings and gnomes always fuse clean into
// one plain word. `chance` is the per-roll probability the glyph is used instead
// of a clean fuse.
export const RACE_JOIN = {
  elf: { chance: 0.2, glyph: "'" },
  dwarf: { chance: 0.3, glyph: "-" },
  halfling: { chance: 0, glyph: "" },
  gnome: { chance: 0, glyph: "" },
};

// --- Name pools (§4) ----------------------------------------------------------
//
// Per-race pools, each shaped to slot into an existing Human generator:
//   prefixes    — settlement name first element (parallels PREFIX)
//   suffixes    — settlement name ending, fused onto the prefix (parallels
//                 COMMON_SUFFIX / TERRAIN_SUFFIX)
//   nouns       — settlement two-word second element (parallels NOUN)
//   regionNouns — region/realm collective noun (parallels REGION_NOUN)
//   tavernWords — composed "The <word> <word>" tavern signs (parallels the
//                 curated tavern-sign.json table)
//   heritage    — heritage/POI descriptors for ancient/ruined builder flavour
//                 (wired up in a later step; e.g. "an elf-wrought tower")
//
// Flavour per §4: Elf flowing/vowel-heavy/soft with an occasional apostrophe;
// Dwarf hard/guttural with doubled consonants and -grim/-dûr/-hold/-forge;
// Halfling homely/pastoral English; Gnome tinkery/whimsical.

const ELF = {
  prefixes: [
    "Sil", "Ael", "Cael", "Ith", "Luth", "Faen", "Syl", "Aela", "Eryn", "Thal",
    "Mira", "Quel", "Isil", "Vael", "Lira", "Naeth", "Selen", "Oren", "Ythil", "Sian",
    "Elar", "Fael", "Loth", "Miri", "Ysar", "Aeril", "Nimr", "Calae",
  ],
  suffixes: [
    "aal", "oth", "iel", "wyn", "eth", "ara", "orin", "asse", "ien", "ora",
    "ithe", "ande", "eal", "ynne", "esse", "adar", "oril", "aeth", "oren", "ael",
    "wen", "las", "dor",
  ],
  nouns: [
    "Vale", "Glade", "Spire", "Bough", "Star", "Leaf", "Moon", "Song", "Dream", "Light",
    "Bloom", "Grove", "Whisper", "Veil", "Mist", "Petal", "Dawn", "Twilight", "Hollow", "Rill",
  ],
  regionNouns: [
    "Vale", "Wood", "Glade", "Reach", "Spires", "Wilds", "Bowers", "Grove", "Hollow", "Mere",
    "Dell", "Bloom", "Sward", "Coppice", "Thicket", "Glimmer", "Canopy", "Boughs",
  ],
  tavernWords: [
    "Silver", "Moon", "Star", "Leaf", "Song", "Willow", "Dew", "Twilight", "Harp", "Feather",
    "Bough", "Glimmer", "Petal", "Dream", "Wren", "Lark", "Nightingale", "Fawn", "Bell", "Grove",
  ],
  heritage: [
    "elf-wrought", "elf-carved", "elven-built", "star-blessed", "moon-touched", "elf-sung",
    "elf-warded", "grove-kept", "leaf-shaped", "elf-hewn", "song-bound", "starlit",
    "elf-woven", "fae-touched", "elf-blessed", "elf-raised",
  ],
};

const DWARF = {
  prefixes: [
    "Karr", "Dur", "Thrak", "Grim", "Bal", "Thor", "Grun", "Dor", "Brak", "Khaz",
    "Ung", "Morg", "Thok", "Grud", "Bok", "Drak", "Hurn", "Kraz", "Borg", "Grond",
    "Skarn", "Dreng", "Volgr", "Ottok", "Harn", "Brokk",
  ],
  suffixes: [
    "grim", "dûr", "hold", "forge", "gard", "hammer", "anvil", "stone", "deep", "dun",
    "rock", "vault", "gate", "helm", "axe", "brew", "kettle", "ember", "hearth", "barrow",
    "delve", "ward",
  ],
  nouns: [
    "Forge", "Hold", "Anvil", "Vault", "Hall", "Deep", "Crag", "Bastion", "Rampart", "Foundry",
    "Mine", "Cairn", "Bulwark", "Hearth", "Helm", "Axe", "Shield", "Hammer", "Gate", "Rune",
  ],
  regionNouns: [
    "Hold", "Deep", "Vault", "Reach", "Crags", "Halls", "Mines", "Delve", "Bastion", "Underhold",
    "Forge", "Barrows", "Cairns", "Roots", "Depths", "Anvils", "Gates", "Stonefast",
  ],
  tavernWords: [
    "Anvil", "Forge", "Stone", "Iron", "Hammer", "Keg", "Barrel", "Beard", "Axe", "Helm",
    "Ember", "Hearth", "Ore", "Vault", "Grudge", "Oath", "Rune", "Ale", "Mug", "Coal",
  ],
  heritage: [
    "dwarf-delved", "dwarf-forged", "dwarf-hewn", "dwarf-carved", "dwarf-wrought", "stone-cut",
    "forge-blessed", "dwarf-built", "deep-delved", "rune-warded", "dwarf-mined", "anvil-marked",
    "dwarf-quarried", "hammer-shaped", "dwarf-raised", "oath-bound",
  ],
};

const HALFLING = {
  prefixes: [
    "Tuck", "Green", "Bramble", "Apple", "Honey", "Clover", "Berry", "Hazel", "Rose", "Merry",
    "Bracken", "Barley", "Butter", "Cherry", "Clay", "Cobble", "Fern", "Gorse", "Harvest", "Meadow",
    "Nutkin", "Pippin", "Plum", "Sunny", "Thistle", "Wheat",
  ],
  suffixes: [
    "borough", "hollow", "wick", "bottom", "burrow", "dell", "meadow", "field", "brook", "hedge",
    "glen", "croft", "dale", "stead", "hill", "patch", "warren", "nook", "cot", "fair",
    "berry", "bury",
  ],
  nouns: [
    "Hollow", "Burrow", "Bottom", "Green", "Meadow", "Orchard", "Bridge", "Mill", "Garden", "Hedge",
    "Patch", "Nook", "Cot", "Fair", "Common", "Brook", "Dell", "Croft", "Warren", "Pantry",
  ],
  regionNouns: [
    "Downs", "Shire", "Meadows", "Hollows", "Fields", "Burrows", "Vale", "Dale", "Commons", "Glens",
    "Bottoms", "Furrows", "Orchards", "Hedgerows", "Brookside", "Pastures",
  ],
  tavernWords: [
    "Hearth", "Pie", "Ale", "Butter", "Honey", "Berry", "Apple", "Pipe", "Kettle", "Loaf",
    "Jam", "Cheese", "Garden", "Meadow", "Bramble", "Clover", "Harvest", "Cider", "Biscuit", "Teapot",
  ],
  heritage: [
    "halfling-tended", "halfling-built", "hearth-blessed", "halfling-planted", "burrow-dug",
    "halfling-kept", "orchard-grown", "halfling-raised", "pantry-stocked", "halfling-warm",
    "hedge-grown", "halfling-snug", "garden-tended", "halfling-thatched", "halfling-cozy", "meadow-blessed",
  ],
};

const GNOME = {
  prefixes: [
    "Fizz", "Copper", "Glimmer", "Nack", "Sprock", "Cog", "Tink", "Whizz", "Puff", "Gear",
    "Bubble", "Spark", "Whistle", "Clank", "Fidget", "Giggle", "Snap", "Ratchet", "Bolt", "Widget",
    "Twinkle", "Zap", "Pip", "Nimble", "Chime", "Rivet",
  ],
  suffixes: [
    "wick", "cog", "dell", "spark", "gear", "fizz", "bolt", "glim", "nook", "whistle",
    "chime", "twist", "spring", "widget", "tinker", "bubble", "glow", "snap", "tock", "fidget",
    "gizmo", "flicker",
  ],
  nouns: [
    "Cog", "Gear", "Spark", "Bolt", "Gizmo", "Widget", "Bubble", "Chime", "Spring", "Flask",
    "Lens", "Valve", "Coil", "Puff", "Lantern", "Gadget", "Bellows", "Cogwheel", "Sprocket", "Contraption",
  ],
  regionNouns: [
    "Dell", "Workshops", "Gearworks", "Warrens", "Springs", "Hollows", "Foundries", "Burrows", "Glades", "Tunnels",
    "Vaults", "Grottoes", "Cogworks", "Sparkworks", "Tinkerings", "Bellows",
  ],
  tavernWords: [
    "Cog", "Spark", "Gear", "Bolt", "Fizz", "Bubble", "Whistle", "Clank", "Brass", "Copper",
    "Steam", "Gadget", "Flask", "Lantern", "Spring", "Puff", "Chime", "Widget", "Glow", "Tinker",
  ],
  heritage: [
    "gnome-built", "gnome-tinkered", "gnome-rigged", "clockwork-fitted", "gnome-wired", "gnome-sparked",
    "gnome-crafted", "tinker-touched", "gnome-bolted", "gnome-geared", "gnome-devised", "spark-forged",
    "gnome-wound", "gnome-cranked", "gnome-patched", "gnome-fitted",
  ],
};

// Race -> pool bundle. Only RACES keys exist here — there is deliberately no
// "human" entry (see the header note): callers key off `RACE_NAME_POOLS[race]`
// and treat a missing/undefined lookup as "use the Human pools instead".
export const RACE_NAME_POOLS = {
  elf: ELF,
  dwarf: DWARF,
  halfling: HALFLING,
  gnome: GNOME,
};
