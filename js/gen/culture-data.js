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
  Forest: 0.13,
  Hills: 0.10,
  Mountains: 0.11,
  Plains: 0.05,
  Swamp: 0.025,
  Desert: 0.025,
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
    "Elar", "Fael", "Loth", "Miri", "Ysar", "Aeril", "Nimr", "Calae", "Aer", "Elu",
    "Gala", "Cel", "Anor", "Ele", "Fin", "Nael", "Serae", "Tia", "Vanya", "Aewen",
    "Cirae", "Daeth", "Faela", "Gwae", "Ilya", "Laur", "Meliel", "Yllae", "Arian", "Belwe",
  ],
  suffixes: [
    "aal", "oth", "iel", "wyn", "eth", "ara", "orin", "asse", "ien", "ora",
    "ithe", "ande", "eal", "ynne", "esse", "adar", "oril", "aeth", "oren", "ael",
    "wen", "las", "dor", "aval", "uil", "enna", "ariel", "oria", "ithil", "aeria",
    "olas", "wyth", "arae", "iri", "uine", "andil", "orwen", "elle", "amar", "ova",
  ],
  nouns: [
    "Vale", "Glade", "Spire", "Bough", "Star", "Leaf", "Moon", "Song", "Dream", "Light",
    "Bloom", "Grove", "Whisper", "Veil", "Mist", "Petal", "Dawn", "Twilight", "Hollow", "Rill",
    "Willow", "Fern", "Dew", "Silver", "Lily", "Reed", "Fountain", "Arbor", "Blossom", "Harp",
    "Feather", "Crescent", "Aurora", "Gossamer", "Thorn", "Brook", "Shimmer", "Lantern",
  ],
  regionNouns: [
    "Vale", "Wood", "Glade", "Reach", "Spires", "Wilds", "Bowers", "Grove", "Hollow", "Mere",
    "Dell", "Bloom", "Sward", "Coppice", "Thicket", "Glimmer", "Canopy", "Boughs", "Woodlands", "Eaves",
    "Weald", "Fastness", "Marches", "Wilderland", "Combe", "Vales", "Groves", "Glades", "Reaches", "Verge",
  ],
  tavernWords: [
    "Silver", "Moon", "Star", "Leaf", "Song", "Willow", "Dew", "Twilight", "Harp", "Feather",
    "Bough", "Glimmer", "Petal", "Dream", "Wren", "Lark", "Nightingale", "Fawn", "Bell", "Grove",
    "Ivy", "Fern", "Lily", "Rose", "Owl", "Stag", "Hart", "Doe", "Acorn", "Oak",
    "Elm", "Reed", "Mistletoe", "Amber", "Emerald", "Goblet", "Vine", "Thistle",
  ],
  heritage: [
    "elf-wrought", "elf-carved", "elven-built", "star-blessed", "moon-touched", "elf-sung",
    "elf-warded", "grove-kept", "leaf-shaped", "elf-hewn", "song-bound", "starlit",
    "elf-woven", "fae-touched", "elf-blessed", "elf-raised", "elf-shaped", "elf-graven",
    "elf-tended", "elf-sculpted", "moon-carved", "star-wrought", "silver-veined", "elf-dreamed",
    "dawn-blessed", "leaf-woven", "elf-etched", "elf-planted", "twilight-touched", "elf-crowned",
  ],
};

const DWARF = {
  prefixes: [
    "Karr", "Dur", "Thrak", "Grim", "Bal", "Thor", "Grun", "Dor", "Brak", "Khaz",
    "Ung", "Morg", "Thok", "Grud", "Bok", "Drak", "Hurn", "Kraz", "Borg", "Grond",
    "Skarn", "Dreng", "Volgr", "Ottok", "Harn", "Brokk", "Baraz", "Kazad", "Thund", "Norgg",
    "Durak", "Grimm", "Brund", "Dwal", "Nain", "Gorm", "Thrain", "Kron", "Vragg", "Uzgar",
    "Dolgan", "Hruth", "Kargh", "Grumm", "Bathr", "Dunn",
  ],
  suffixes: [
    "grim", "dûr", "hold", "forge", "gard", "hammer", "anvil", "stone", "deep", "dun",
    "rock", "vault", "gate", "helm", "axe", "brew", "kettle", "ember", "hearth", "barrow",
    "delve", "ward", "mund", "din", "gorge", "grin", "fast", "hall", "cleft", "fold",
    "span", "kar", "dram", "stok", "gunn", "hild", "mor", "krag", "thane", "brand",
  ],
  nouns: [
    "Forge", "Hold", "Anvil", "Vault", "Hall", "Deep", "Crag", "Bastion", "Rampart", "Foundry",
    "Mine", "Cairn", "Bulwark", "Hearth", "Helm", "Axe", "Shield", "Hammer", "Gate", "Rune",
    "Delve", "Keg", "Tunnel", "Shaft", "Pillar", "Column", "Buttress", "Grotto", "Vein", "Lode",
    "Ingot", "Beard", "Oath", "Grudge", "Tankard", "Brazier",
  ],
  regionNouns: [
    "Hold", "Deep", "Vault", "Reach", "Crags", "Halls", "Mines", "Delve", "Bastion", "Underhold",
    "Forge", "Barrows", "Cairns", "Roots", "Depths", "Anvils", "Gates", "Stonefast", "Deeps", "Holds",
    "Delvings", "Undercrags", "Peaks", "Tunnels", "Vaults", "Lodes", "Foundries", "Ramparts", "Stronghold", "Underdeep",
  ],
  tavernWords: [
    "Anvil", "Forge", "Stone", "Iron", "Hammer", "Keg", "Barrel", "Beard", "Axe", "Helm",
    "Ember", "Hearth", "Ore", "Vault", "Grudge", "Oath", "Rune", "Ale", "Mug", "Coal",
    "Tankard", "Pick", "Gold", "Gem", "Ruby", "Flagon", "Stout", "Coin", "Chisel", "Bellows",
    "Furnace", "Boulder", "Granite", "Cask", "Foehammer", "Flask",
  ],
  heritage: [
    "dwarf-delved", "dwarf-forged", "dwarf-hewn", "dwarf-carved", "dwarf-wrought", "stone-cut",
    "forge-blessed", "dwarf-built", "deep-delved", "rune-warded", "dwarf-mined", "anvil-marked",
    "dwarf-quarried", "hammer-shaped", "dwarf-raised", "oath-bound", "dwarf-graven", "dwarf-cut",
    "dwarf-founded", "rune-carved", "stone-wrought", "deep-mined", "dwarf-shaped", "forge-marked",
    "dwarf-walled", "iron-bound", "dwarf-tunneled", "granite-hewn", "dwarf-masoned", "oath-forged",
  ],
};

const HALFLING = {
  prefixes: [
    "Tuck", "Green", "Bramble", "Apple", "Honey", "Clover", "Berry", "Hazel", "Rose", "Merry",
    "Bracken", "Barley", "Butter", "Cherry", "Clay", "Cobble", "Fern", "Gorse", "Harvest", "Meadow",
    "Nutkin", "Pippin", "Plum", "Sunny", "Thistle", "Wheat", "Bilberry", "Maple", "Willow", "Elder",
    "Hawthorn", "Oaken", "Puddle", "Bumble", "Snug", "Mossy", "Dimple", "Longbottom", "Underhill", "Millstone",
    "Hayward", "Buckle", "Chestnut", "Sorrel", "Pumpkin", "Marrow",
  ],
  suffixes: [
    "borough", "hollow", "wick", "bottom", "burrow", "dell", "meadow", "field", "brook", "hedge",
    "glen", "croft", "dale", "stead", "hill", "patch", "warren", "nook", "cot", "fair",
    "berry", "bury", "ton", "ham", "combe", "garth", "holt", "by", "thorpe", "side",
    "gate", "ford", "haven", "green", "barrow", "leigh", "worth", "mead", "furlong", "copse",
  ],
  nouns: [
    "Hollow", "Burrow", "Bottom", "Green", "Meadow", "Orchard", "Bridge", "Mill", "Garden", "Hedge",
    "Patch", "Nook", "Cot", "Fair", "Common", "Brook", "Dell", "Croft", "Warren", "Pantry",
    "Barn", "Well", "Lane", "Pond", "Field", "Furrow", "Larder", "Hearth", "Stile", "Gate",
    "Bench", "Kettle", "Loaf", "Roost", "Paddock", "Copse",
  ],
  regionNouns: [
    "Downs", "Shire", "Meadows", "Hollows", "Fields", "Burrows", "Vale", "Dale", "Commons", "Glens",
    "Bottoms", "Furrows", "Orchards", "Hedgerows", "Brookside", "Pastures", "Marches", "Weald", "Greens", "Dells",
    "Warrens", "Meads", "Uplands", "Lowlands", "Vales", "Combe", "Heath", "Wolds", "Paddocks", "Byways",
  ],
  tavernWords: [
    "Hearth", "Pie", "Ale", "Butter", "Honey", "Berry", "Apple", "Pipe", "Kettle", "Loaf",
    "Jam", "Cheese", "Garden", "Meadow", "Bramble", "Clover", "Harvest", "Cider", "Biscuit", "Teapot",
    "Barrel", "Hen", "Pig", "Pony", "Badger", "Mushroom", "Turnip", "Dumpling", "Toadstool", "Bumblebee",
    "Acorn", "Fiddle", "Lantern", "Hedgehog", "Bell", "Sixpence",
  ],
  heritage: [
    "halfling-tended", "halfling-built", "hearth-blessed", "halfling-planted", "burrow-dug",
    "halfling-kept", "orchard-grown", "halfling-raised", "pantry-stocked", "halfling-warm",
    "hedge-grown", "halfling-snug", "garden-tended", "halfling-thatched", "halfling-cozy", "meadow-blessed",
    "halfling-dug", "halfling-farmed", "halfling-hewn", "field-blessed", "halfling-sown", "burrow-built",
    "halfling-nestled", "harvest-blessed", "halfling-tilled", "halfling-homed", "hollow-dug", "halfling-mended",
    "orchard-kept", "halfling-walled",
  ],
};

const GNOME = {
  prefixes: [
    "Fizz", "Copper", "Glimmer", "Nack", "Sprock", "Cog", "Tink", "Whizz", "Puff", "Gear",
    "Bubble", "Spark", "Whistle", "Clank", "Fidget", "Giggle", "Snap", "Ratchet", "Bolt", "Widget",
    "Twinkle", "Zap", "Pip", "Nimble", "Chime", "Rivet", "Whirl", "Ticker", "Fumble", "Wobble",
    "Cinder", "Sizzle", "Flick", "Boggle", "Quill", "Dazzle", "Jangle", "Kobble", "Trundle", "Piston",
    "Gyro", "Sprig", "Fettle", "Whim", "Doodle", "Zibble",
  ],
  suffixes: [
    "wick", "cog", "dell", "spark", "gear", "fizz", "bolt", "glim", "nook", "whistle",
    "chime", "twist", "spring", "widget", "tinker", "bubble", "glow", "snap", "tock", "fidget",
    "gizmo", "flicker", "sprocket", "valve", "gasket", "whirl", "clank", "piston", "coil", "crank",
    "knob", "latch", "spindle", "spinner", "turn", "fuse", "spanner", "dial", "whir", "tick",
  ],
  nouns: [
    "Cog", "Gear", "Spark", "Bolt", "Gizmo", "Widget", "Bubble", "Chime", "Spring", "Flask",
    "Lens", "Valve", "Coil", "Puff", "Lantern", "Gadget", "Bellows", "Cogwheel", "Sprocket", "Contraption",
    "Piston", "Crank", "Gasket", "Dial", "Fuse", "Spindle", "Whistle", "Turbine", "Cistern", "Flywheel",
    "Pulley", "Ratchet", "Beaker", "Nozzle", "Clockwork", "Doohickey",
  ],
  regionNouns: [
    "Dell", "Workshops", "Gearworks", "Warrens", "Springs", "Hollows", "Foundries", "Burrows", "Glades", "Tunnels",
    "Vaults", "Grottoes", "Cogworks", "Sparkworks", "Tinkerings", "Bellows", "Dells", "Workyards", "Clockworks", "Windings",
    "Boltworks", "Steamworks", "Gizmoworks", "Undertunnels", "Delves", "Contraptions", "Whirligigs", "Forges", "Coilworks", "Mazeworks",
  ],
  tavernWords: [
    "Cog", "Spark", "Gear", "Bolt", "Fizz", "Bubble", "Whistle", "Clank", "Brass", "Copper",
    "Steam", "Gadget", "Flask", "Lantern", "Spring", "Puff", "Chime", "Widget", "Glow", "Tinker",
    "Piston", "Valve", "Crank", "Sprocket", "Gizmo", "Bellows", "Kettle", "Cider", "Fuse", "Dial",
    "Ratchet", "Boiler", "Whirl", "Spanner", "Beaker", "Clockwork",
  ],
  heritage: [
    "gnome-built", "gnome-tinkered", "gnome-rigged", "clockwork-fitted", "gnome-wired", "gnome-sparked",
    "gnome-crafted", "tinker-touched", "gnome-bolted", "gnome-geared", "gnome-devised", "spark-forged",
    "gnome-wound", "gnome-cranked", "gnome-patched", "gnome-fitted", "gnome-cogged", "gnome-welded",
    "clockwork-driven", "gnome-riveted", "gear-fitted", "gnome-hammered", "gnome-tuned", "spring-loaded",
    "gnome-assembled", "gnome-machined", "gnome-soldered", "gnome-contrived", "gnome-jointed", "brass-fitted",
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
