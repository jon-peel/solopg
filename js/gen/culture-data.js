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
    "Sil", "Ael", "Cael", "Ith", "Luth", "Faen", "Syl", "Aela", "Eryn", "Thal", "Mira", "Quel", "Isil",
    "Vael", "Lira", "Naeth", "Selen", "Oren", "Ythil", "Sian", "Elar", "Fael", "Loth", "Miri", "Ysar",
    "Aeril", "Nimr", "Calae", "Aer", "Elu", "Gala", "Cel", "Anor", "Ele", "Fin", "Nael", "Serae", "Tia",
    "Vanya", "Aewen", "Cirae", "Daeth", "Faela", "Gwae", "Ilya", "Laur", "Meliel", "Yllae", "Arian",
    "Belwe", "Ythra", "Saelin", "Ilwen", "Maelor", "Nydris", "Orael", "Vaenya", "Lethis", "Aenor",
    "Cyrael", "Thessa", "Ilyth", "Sirael", "Ilmara",
  ],
  suffixes: [
    "aal", "oth", "iel", "wyn", "eth", "ara", "orin", "asse", "ien", "ora", "ithe", "ande", "eal",
    "ynne", "esse", "adar", "oril", "aeth", "oren", "ael", "wen", "las", "dor", "aval", "uil", "enna",
    "ariel", "oria", "ithil", "aeria", "olas", "wyth", "arae", "iri", "uine", "andil", "orwen", "elle",
    "amar", "ova", "ythien", "orael", "ilwen", "avonne", "ythra", "enwen", "oswyn", "ariath", "elenna",
    "avaris", "orindel", "ythwen",
  ],
  nouns: [
    "Vale", "Glade", "Spire", "Bough", "Star", "Leaf", "Moon", "Song", "Dream", "Light", "Bloom",
    "Grove", "Whisper", "Veil", "Mist", "Petal", "Dawn", "Twilight", "Hollow", "Rill", "Willow", "Fern",
    "Dew", "Silver", "Lily", "Reed", "Fountain", "Arbor", "Blossom", "Harp", "Feather", "Crescent",
    "Aurora", "Gossamer", "Thorn", "Brook", "Shimmer", "Lantern", "Echo", "Chorus", "Melody", "Zephyr",
    "Breeze", "Cascade", "Halo", "Radiance", "Nightfall", "Daybreak", "Sunbeam", "Moonbeam",
    "Starlight", "Glimmer",
  ],
  regionNouns: [
    "Vale", "Wood", "Glade", "Reach", "Spires", "Wilds", "Bowers", "Grove", "Hollow", "Mere", "Dell",
    "Bloom", "Sward", "Coppice", "Thicket", "Glimmer", "Canopy", "Boughs", "Woodlands", "Eaves",
    "Weald", "Fastness", "Marches", "Wilderland", "Combe", "Vales", "Groves", "Glades", "Reaches",
    "Verge", "Fen", "Glen", "Wildwood", "Thornwood", "Duskwood", "Starwood", "Greenwood", "Silverwood",
    "Elderwood", "Underwood", "Timberland", "Understory", "Bracken", "Sanctuary",
  ],
  tavernWords: [
    "Silver", "Moon", "Star", "Leaf", "Song", "Willow", "Dew", "Twilight", "Harp", "Feather", "Bough",
    "Glimmer", "Petal", "Dream", "Wren", "Lark", "Nightingale", "Fawn", "Bell", "Grove", "Ivy", "Fern",
    "Lily", "Rose", "Owl", "Stag", "Hart", "Doe", "Acorn", "Oak", "Elm", "Reed", "Mistletoe", "Amber",
    "Emerald", "Goblet", "Vine", "Thistle", "Aspen", "Birch", "Laurel", "Jasmine", "Lavender",
    "Foxglove", "Primrose", "Falcon", "Swan", "Heron", "Violet", "Sapphire", "Chalice", "Lute",
  ],
  heritage: [
    "elf-wrought", "elf-carved", "elven-built", "star-blessed", "moon-touched", "elf-sung",
    "elf-warded", "grove-kept", "leaf-shaped", "elf-hewn", "song-bound", "starlit", "elf-woven",
    "fae-touched", "elf-blessed", "elf-raised", "elf-shaped", "elf-graven", "elf-tended",
    "elf-sculpted", "moon-carved", "star-wrought", "silver-veined", "elf-dreamed", "dawn-blessed",
    "leaf-woven", "elf-etched", "elf-planted", "twilight-touched", "elf-crowned", "elf-forged",
    "elf-spun", "elf-inscribed", "elf-veiled", "elven-carved", "elven-hewn", "elf-anointed",
    "elf-hallowed", "elf-rooted", "star-graven", "moon-blessed", "leaf-veined", "song-woven",
    "dew-kissed",
  ],
};

const DWARF = {
  prefixes: [
    "Karr", "Dur", "Thrak", "Grim", "Bal", "Thor", "Grun", "Dor", "Brak", "Khaz", "Ung", "Morg", "Thok",
    "Grud", "Bok", "Drak", "Hurn", "Kraz", "Borg", "Grond", "Skarn", "Dreng", "Volgr", "Ottok", "Harn",
    "Brokk", "Baraz", "Kazad", "Thund", "Norgg", "Durak", "Grimm", "Brund", "Dwal", "Nain", "Gorm",
    "Thrain", "Kron", "Vragg", "Uzgar", "Dolgan", "Hruth", "Kargh", "Grumm", "Bathr", "Dunn", "Grokk",
    "Durgan", "Bazrok", "Thrundr", "Karvok", "Molgor", "Ungrud", "Hrogar", "Kazgur", "Borgun",
    "Drammok", "Vokrag", "Threnn", "Gormund", "Bruntok", "Skavrok", "Dolbur", "Krathok",
  ],
  suffixes: [
    "grim", "dûr", "hold", "forge", "gard", "hammer", "anvil", "stone", "deep", "dun", "rock", "vault",
    "gate", "helm", "axe", "brew", "kettle", "ember", "hearth", "barrow", "delve", "ward", "mund",
    "din", "gorge", "grin", "fast", "hall", "cleft", "fold", "span", "kar", "dram", "stok", "gunn",
    "hild", "mor", "krag", "thane", "brand", "oath", "bound", "sworn", "wright", "smith", "beard",
    "tusk", "bane", "mark", "shard", "flame", "grip",
  ],
  nouns: [
    "Forge", "Hold", "Anvil", "Vault", "Hall", "Deep", "Crag", "Bastion", "Rampart", "Foundry", "Mine",
    "Cairn", "Bulwark", "Hearth", "Helm", "Axe", "Shield", "Hammer", "Gate", "Rune", "Delve", "Keg",
    "Tunnel", "Shaft", "Pillar", "Column", "Buttress", "Grotto", "Vein", "Lode", "Ingot", "Beard",
    "Oath", "Grudge", "Tankard", "Brazier", "Quarry", "Ridge", "Boulder", "Chisel", "Smithy", "Furnace",
    "Cinder", "Redoubt", "Citadel", "Buckler", "Gauntlet", "Rivet", "Seam", "Ore", "Coffer", "Barbican",
  ],
  regionNouns: [
    "Hold", "Deep", "Vault", "Reach", "Crags", "Halls", "Mines", "Delve", "Bastion", "Underhold",
    "Forge", "Barrows", "Cairns", "Roots", "Depths", "Anvils", "Gates", "Stonefast", "Deeps", "Holds",
    "Delvings", "Undercrags", "Peaks", "Tunnels", "Vaults", "Lodes", "Foundries", "Ramparts",
    "Stronghold", "Underdeep", "Bulwarks", "Undercroft", "Bedrock", "Underhalls", "Deephold",
    "Ironhold", "Stonehold", "Underforge", "Cragholds", "Ironhalls", "Firedeep", "Emberhold",
    "Underrealm", "Rockholds",
  ],
  tavernWords: [
    "Anvil", "Forge", "Stone", "Iron", "Hammer", "Keg", "Barrel", "Beard", "Axe", "Helm", "Ember",
    "Hearth", "Ore", "Vault", "Grudge", "Oath", "Rune", "Ale", "Mug", "Coal", "Tankard", "Pick", "Gold",
    "Gem", "Ruby", "Flagon", "Stout", "Coin", "Chisel", "Bellows", "Furnace", "Boulder", "Granite",
    "Cask", "Foehammer", "Flask", "Steel", "Copper", "Bronze", "Marble", "Quartz", "Obsidian", "Basalt",
    "Slate", "Mallet", "Cauldron", "Brazier", "Boar", "Ram", "Bull", "Wolf", "Drum",
  ],
  heritage: [
    "dwarf-delved", "dwarf-forged", "dwarf-hewn", "dwarf-carved", "dwarf-wrought", "stone-cut",
    "forge-blessed", "dwarf-built", "deep-delved", "rune-warded", "dwarf-mined", "anvil-marked",
    "dwarf-quarried", "hammer-shaped", "dwarf-raised", "oath-bound", "dwarf-graven", "dwarf-cut",
    "dwarf-founded", "rune-carved", "stone-wrought", "deep-mined", "dwarf-shaped", "forge-marked",
    "dwarf-walled", "iron-bound", "dwarf-tunneled", "granite-hewn", "dwarf-masoned", "oath-forged",
    "dwarf-riven", "dwarf-warded", "dwarf-hammered", "dwarf-chiseled", "dwarf-vaulted", "dwarf-bound",
    "dwarf-inscribed", "dwarf-cairned", "dwarf-tempered", "stone-graven", "forge-wrought",
    "rune-etched", "anvil-forged", "vault-sealed",
  ],
};

const HALFLING = {
  prefixes: [
    "Tuck", "Green", "Bramble", "Apple", "Honey", "Clover", "Berry", "Hazel", "Rose", "Merry",
    "Bracken", "Barley", "Butter", "Cherry", "Clay", "Cobble", "Fern", "Gorse", "Harvest", "Meadow",
    "Nutkin", "Pippin", "Plum", "Sunny", "Thistle", "Wheat", "Bilberry", "Maple", "Willow", "Elder",
    "Hawthorn", "Oaken", "Puddle", "Bumble", "Snug", "Mossy", "Dimple", "Longbottom", "Underhill",
    "Millstone", "Hayward", "Buckle", "Chestnut", "Sorrel", "Pumpkin", "Marrow", "Fennel", "Parsley",
    "Marigold", "Buttercup", "Poppy", "Foxglove", "Primrose", "Turnip", "Radish", "Beetroot", "Currant",
    "Gooseberry", "Heather", "Hollyhock", "Cornflower", "Woodbine", "Rosemary", "Treacle",
  ],
  suffixes: [
    "borough", "hollow", "wick", "bottom", "burrow", "dell", "meadow", "field", "brook", "hedge",
    "glen", "croft", "dale", "stead", "hill", "patch", "warren", "nook", "cot", "fair", "berry", "bury",
    "ton", "ham", "combe", "garth", "holt", "by", "thorpe", "side", "gate", "ford", "haven", "green",
    "barrow", "leigh", "worth", "mead", "furlong", "copse", "don", "ley", "wood", "moor", "marsh",
    "fen", "wold", "shaw", "stow", "bridge", "ridge", "grange",
  ],
  nouns: [
    "Hollow", "Burrow", "Bottom", "Green", "Meadow", "Orchard", "Bridge", "Mill", "Garden", "Hedge",
    "Patch", "Nook", "Cot", "Fair", "Common", "Brook", "Dell", "Croft", "Warren", "Pantry", "Barn",
    "Well", "Lane", "Pond", "Field", "Furrow", "Larder", "Hearth", "Stile", "Gate", "Bench", "Kettle",
    "Loaf", "Roost", "Paddock", "Copse", "Thatch", "Cottage", "Cellar", "Trough", "Byre", "Coop",
    "Stable", "Granary", "Silo", "Vineyard", "Cranny", "Dovecote", "Bakehouse", "Hamper", "Beehive",
    "Homestead",
  ],
  regionNouns: [
    "Downs", "Shire", "Meadows", "Hollows", "Fields", "Burrows", "Vale", "Dale", "Commons", "Glens",
    "Bottoms", "Furrows", "Orchards", "Hedgerows", "Brookside", "Pastures", "Marches", "Weald",
    "Greens", "Dells", "Warrens", "Meads", "Uplands", "Lowlands", "Vales", "Combe", "Heath", "Wolds",
    "Paddocks", "Byways", "Glebe", "Tillage", "Sheepwalks", "Furlongs", "Greenswards", "Grazings",
    "Homesteads", "Farmsteads", "Hamlets", "Grasslands", "Farmlands", "Wheatlands", "Cornfields",
    "Knolls",
  ],
  tavernWords: [
    "Hearth", "Pie", "Ale", "Butter", "Honey", "Berry", "Apple", "Pipe", "Kettle", "Loaf", "Jam",
    "Cheese", "Garden", "Meadow", "Bramble", "Clover", "Harvest", "Cider", "Biscuit", "Teapot",
    "Barrel", "Hen", "Pig", "Pony", "Badger", "Mushroom", "Turnip", "Dumpling", "Toadstool",
    "Bumblebee", "Acorn", "Fiddle", "Lantern", "Hedgehog", "Bell", "Sixpence", "Cottage", "Orchard",
    "Scone", "Muffin", "Marmalade", "Cricket", "Sparrow", "Duck", "Goose", "Rabbit", "Squirrel",
    "Otter", "Fox", "Thimble", "Bonnet", "Basket",
  ],
  heritage: [
    "halfling-tended", "halfling-built", "hearth-blessed", "halfling-planted", "burrow-dug",
    "halfling-kept", "orchard-grown", "halfling-raised", "pantry-stocked", "halfling-warm",
    "hedge-grown", "halfling-snug", "garden-tended", "halfling-thatched", "halfling-cozy",
    "meadow-blessed", "halfling-dug", "halfling-farmed", "halfling-hewn", "field-blessed",
    "halfling-sown", "burrow-built", "halfling-nestled", "harvest-blessed", "halfling-tilled",
    "halfling-homed", "hollow-dug", "halfling-mended", "orchard-kept", "halfling-walled",
    "halfling-worn", "halfling-loved", "halfling-shaped", "halfling-blessed", "halfling-grown",
    "halfling-rooted", "halfling-woven", "burrow-carved", "orchard-blessed", "hedge-bound",
    "garden-grown", "meadow-grown", "hearth-warm", "vine-grown",
  ],
};

const GNOME = {
  prefixes: [
    "Fizz", "Copper", "Glimmer", "Nack", "Sprock", "Cog", "Tink", "Whizz", "Puff", "Gear", "Bubble",
    "Spark", "Whistle", "Clank", "Fidget", "Giggle", "Snap", "Ratchet", "Bolt", "Widget", "Twinkle",
    "Zap", "Pip", "Nimble", "Chime", "Rivet", "Whirl", "Ticker", "Fumble", "Wobble", "Cinder", "Sizzle",
    "Flick", "Boggle", "Quill", "Dazzle", "Jangle", "Kobble", "Trundle", "Piston", "Gyro", "Sprig",
    "Fettle", "Whim", "Doodle", "Zibble", "Blink", "Flutter", "Toggle", "Zing", "Ping", "Fribble",
    "Whirr", "Snick", "Wiggle", "Joggle", "Niffle", "Frizzle", "Blip", "Bloop", "Squeak", "Twiddle",
    "Grindle", "Sputter",
  ],
  suffixes: [
    "wick", "cog", "dell", "spark", "gear", "fizz", "bolt", "glim", "nook", "whistle", "chime", "twist",
    "spring", "widget", "tinker", "bubble", "glow", "snap", "tock", "fidget", "gizmo", "flicker",
    "sprocket", "valve", "gasket", "whirl", "clank", "piston", "coil", "crank", "knob", "latch",
    "spindle", "spinner", "turn", "fuse", "spanner", "dial", "whir", "tick", "clatter", "rattle",
    "screw", "socket", "vent", "toggle", "switch", "gauge", "hinge", "wrench", "nozzle", "axle",
  ],
  nouns: [
    "Cog", "Gear", "Spark", "Bolt", "Gizmo", "Widget", "Bubble", "Chime", "Spring", "Flask", "Lens",
    "Valve", "Coil", "Puff", "Lantern", "Gadget", "Bellows", "Cogwheel", "Sprocket", "Contraption",
    "Piston", "Crank", "Gasket", "Dial", "Fuse", "Spindle", "Whistle", "Turbine", "Cistern", "Flywheel",
    "Pulley", "Ratchet", "Beaker", "Nozzle", "Clockwork", "Doohickey", "Screw", "Wrench", "Socket",
    "Escapement", "Governor", "Boiler", "Cylinder", "Bracket", "Lever", "Hinge", "Gauge", "Switch",
    "Trinket", "Mechanism", "Motor", "Automaton",
  ],
  regionNouns: [
    "Dell", "Workshops", "Gearworks", "Warrens", "Springs", "Hollows", "Foundries", "Burrows", "Glades",
    "Tunnels", "Vaults", "Grottoes", "Cogworks", "Sparkworks", "Tinkerings", "Bellows", "Dells",
    "Workyards", "Clockworks", "Windings", "Boltworks", "Steamworks", "Gizmoworks", "Undertunnels",
    "Delves", "Contraptions", "Whirligigs", "Forges", "Coilworks", "Mazeworks", "Springworks",
    "Boltholes", "Sprocketworks", "Valveworks", "Chimeworks", "Gearyards", "Tinkerdens", "Underworks",
    "Gadgetry", "Contrivances", "Machinations", "Widgetworks", "Sparksmithies", "Clockyards",
  ],
  tavernWords: [
    "Cog", "Spark", "Gear", "Bolt", "Fizz", "Bubble", "Whistle", "Clank", "Brass", "Copper", "Steam",
    "Gadget", "Flask", "Lantern", "Spring", "Puff", "Chime", "Widget", "Glow", "Tinker", "Piston",
    "Valve", "Crank", "Sprocket", "Gizmo", "Bellows", "Kettle", "Cider", "Fuse", "Dial", "Ratchet",
    "Boiler", "Whirl", "Spanner", "Beaker", "Clockwork", "Pendulum", "Compass", "Telescope", "Vapor",
    "Goggles", "Wrench", "Rivet", "Screw", "Cylinder", "Turbine", "Weathervane", "Cuckoo", "Beetle",
    "Firefly", "Nozzle", "Toolbox",
  ],
  heritage: [
    "gnome-built", "gnome-tinkered", "gnome-rigged", "clockwork-fitted", "gnome-wired", "gnome-sparked",
    "gnome-crafted", "tinker-touched", "gnome-bolted", "gnome-geared", "gnome-devised", "spark-forged",
    "gnome-wound", "gnome-cranked", "gnome-patched", "gnome-fitted", "gnome-cogged", "gnome-welded",
    "clockwork-driven", "gnome-riveted", "gear-fitted", "gnome-hammered", "gnome-tuned",
    "spring-loaded", "gnome-assembled", "gnome-machined", "gnome-soldered", "gnome-contrived",
    "gnome-jointed", "brass-fitted", "gnome-forged", "gnome-brazed", "gnome-calibrated",
    "gnome-inscribed", "gnome-oiled", "gnome-spun", "cog-fitted", "gear-driven", "brass-forged",
    "copper-fitted", "steam-fitted", "clockwork-bound", "piston-fitted", "spark-driven",
  ],
};

// Race -> pool bundle. Only RACES keys exist here — there is deliberately no
// "human" entry (Human is the null case): callers key off RACE_NAME_POOLS[race]
// and treat a missing/undefined lookup as "use the Human pools instead".
export const RACE_NAME_POOLS = {
  elf: ELF,
  dwarf: DWARF,
  halfling: HALFLING,
  gnome: GNOME,
};

// --- Cultural detail pools ----------------------------------------------------
// Flavour keyed by race, baked onto settlements/POIs in the culture stamp passes
// (js/gen/culture.js) or read lazily (shrine dedication). Human = null.

// How a demihuman settlement physically looks (a tree-city, a mountain hold, a
// burrow-town) — shown in the selection panel under the town's name.
export const RACE_APPEARANCE = {
  elf: [
    "grown into the living boughs", "slender spires among the great trunks",
    "walkways strung high between the trees", "terraces of pale carved wood",
    "half-hidden but for its lantern-light", "wound about a sacred glade",
    "airy galleries open to the canopy", "roots and archways woven together",
    "spiral stairways coiled around an ancient oak", "chambers hollowed from a single vast trunk",
    "domes of living leaf grown over silver frames", "bridges of braided vine swaying overhead",
    "balconies perched above a hidden waterfall", "a ring of elder trees fused into one hall",
    "moss-softened steps climbing toward starlight", "platforms cradled where the great limbs fork",
    "threaded through a stand of moon-pale birches",
    "towers of living wood twined like reaching fingers", "veiled behind curtains of hanging willow",
    "a canopy settlement lit by drifting fireflies", "carved from heartwood still warm with sap",
    "nestled beneath boughs heavy with blossom", "reached only by paths its own folk remember",
    "a glade where the elder trees stand sentinel",
    "eaves strung with silver bells that chime in the wind",
    "roofed over with bark that thickens with each passing year",
    "built around a spring no axe has ever touched", "crowns of interwoven branches lost in the mist",
  ],
  dwarf: [
    "carved deep into the mountain's flank", "a great gated hall in the living rock",
    "smoke rising from cliff-face forges", "stone bastions astride the pass",
    "tiered galleries above a lamplit chasm", "delved beneath the roots of the peak",
    "ringed by dressed-stone ramparts", "its doors sealed with graven adamant",
    "a fortress-door carved with the runes of old kings", "halls lit by veins of glowing ore",
    "terraces hewn from solid granite", "a warren of tunnels beneath a frowning cliff",
    "towers of dark stone rising from the scree", "anvils ringing within a hollowed peak",
    "galleries strung with chains of hammered iron", "a stronghold quarried from the mountain's heart",
    "bridges of stone spanning a black abyss", "vaults sunk far beneath the frost-line",
    "walls thick enough to shrug off a siege", "statues of ancestor-kings flanking the gate",
    "forges banked deep where the rock still glows warm", "a hold ringed by watch-towers of grey stone",
    "stairways cut in a spiral down into the dark", "chambers braced with pillars thick as trees",
    "a mine-town sprawling along a played-out seam", "echoing halls hung with iron lanterns",
    "a keep of black basalt above a frozen tarn", "its gates barred with beams of solid iron",
  ],
  halfling: [
    "snug burrows dug into a green hillside", "round doors and neat garden rows",
    "thatched cottages along a winding lane", "smoke from a hundred cook-fires",
    "holes tucked comfortably into the banks", "a rambling sprawl of farmsteads",
    "hedgerows and orchards on every side", "a market green ringed with stalls",
    "round windows glowing warm at dusk", "a patchwork of vegetable plots and flower beds",
    "chimney-smoke curling over a sleepy dell", "cellars stocked deep with pickles and preserves",
    "a village green worn smooth by dancing feet", "lanes lined with roses and low white fences",
    "barrels of ale rolled out for a harvest fair", "cosy parlors dug beneath a grassy knoll",
    "a mill-wheel turning beside a quiet stream", "pantries fat with jam and honeycomb",
    "a footbridge over a lazy brook", "hollyhocks nodding beside every round door",
    "a scatter of hayricks dotting the fields", "benches set out for an evening pipe",
    "burrows linked by tunnels no taller than a pony", "a bakehouse smell drifting over the lanes",
    "picket fences hung with drying laundry", "beehives humming along the garden wall",
    "a duck pond ringed by willows", "porches strung with lanterns for a summer feast",
  ],
  gnome: [
    "a warren of round doors and crooked chimneys", "brass pipes and turning cogs everywhere",
    "burrows lit by softly glowing globes", "workshops venting coloured steam",
    "a hillside honeycombed with tinkers' hollows", "clockwork gates and whirring vanes",
    "lantern-strung tunnels full of clatter", "half machine and half burrow",
    "chimneys sprouting at every impossible angle", "gears grinding somewhere beneath the streets",
    "a rooftop tangle of pipes and weathervanes", "workshops that hum long after dark",
    "bronze contraptions clicking on every corner", "tunnels wired with strings of sputtering lights",
    "a burrow-town bristling with brass antennae", "steam hissing from a dozen hidden vents",
    "cogs the size of cartwheels turning slowly", "a maze of trapdoors and hidden levers",
    "windows shaped like ship's portholes", "towers of riveted copper catching the sun",
    "a workshop-warren that never quite stops rattling", "tinkers' stalls piled with curious devices",
    "pistons sighing beneath a cobbled square", "a clocktower ticking over a burrow of tunnels",
    "wires strung between chimney-pots like washing lines",
    "vents glowing faintly with captured lightning", "a gate that counts your steps before it opens",
    "burrows stacked three deep behind a brass door",
  ],
};

// Shrine dedications ("to …" phrases, matching data/shrine-dedication.json) for a
// race-appropriate god where a culture holds the shrine.
export const RACE_DEITIES = {
  elf: [
    "to the Moon-Mother", "to the Star-Kindler", "to a god of the deep wood", "to the Dawn-Singer",
    "to an elf-lord of old", "to the Keeper of Ages", "to a spirit of the grove",
    "to the Twilight Queen", "to the Starweaver", "to a goddess of the silver boughs",
    "to the Lady of Long Twilight", "to a spirit of the elder oak", "to the First Dawn-Singer",
    "to a god of starlight and shadow", "to the Warden of the Silver Wood", "to an elf-queen of legend",
    "to a moon-goddess of the hunt", "to the Warden of the Deep Grove", "to a fallen star given form",
    "to the Twilight Warden", "to a god of the wandering stars", "to the Lady of Autumn Leaves",
    "to an elf-king lost to song", "to the Weaver of Dusk and Dream", "to a spirit of the wildwood",
    "to the Bright Lady of the Grove", "to a god of ageless memory", "to the Herald of the New Moon",
  ],
  dwarf: [
    "to the Forge-Father", "to a god of stone and delving", "to the Oathkeeper", "to an ancestor-lord",
    "to the Maker Under the Mountain", "to a war-god of the holds", "to the Hammer-Lord",
    "to the Deep Wardens", "to the Stone-Mother", "to a god of the deep vaults", "to the Anvil-Queen",
    "to an ancestor-king of old", "to the Keeper of the Deep Roads", "to a war-god of the shield-wall",
    "to the Iron Warden", "to a spirit of the living rock", "to the Oath-Mother",
    "to a god of buried gold", "to the First Delver", "to an ancestor-smith of legend",
    "to the Warden of the Deep Halls", "to a god of tunnels and stone", "to the Stonebinder",
    "to a war-goddess of the axe", "to the Keeper of Old Oaths", "to a god of the mountain's heart",
    "to the Grim Warden of the Depths", "to an ancestor-queen beneath the peak",
  ],
  halfling: [
    "to the Hearth-Mother", "to a god of the harvest", "to the Green Grandmother",
    "to a saint of the open road", "to the keeper of home and larder", "to a luck-spirit",
    "to the Well-Wisher", "to the Old Gaffer of legend", "to a goddess of the full larder",
    "to the Keeper of the Hearth-Fire", "to a saint of wayfarers and wanderers",
    "to the Harvest Grandfather", "to a spirit of the garden row", "to the Good Neighbour",
    "to a luck-saint of the crossroads", "to the Pie-Maker of legend",
    "to a god of fat harvests and full bellies", "to the Lantern-Keeper of the lane",
    "to a saint of lost and found things", "to the Old Auntie of the hedgerow",
    "to a spirit of the smoking chimney", "to the Well-Warden", "to a god of small kindnesses",
    "to the Grandmother of the Green Hill", "to a saint of safe returns",
    "to the Keeper of the Long Table", "to a luck-spirit of dice and doorsteps", "to the Gaffer's Wife",
  ],
  gnome: [
    "to the Great Tinker", "to a god of cogs and springs", "to the Spark-Bringer",
    "to a keeper of hidden things", "to the Deep Delver", "to the Clockwork Maker",
    "to a trickster of the warrens", "to the Lantern-Lighter", "to a god of gears and grease",
    "to the Spark-Mother", "to a keeper of secrets and schematics", "to the First Tinker",
    "to a spirit of the workshop", "to the Clockwork Queen", "to a trickster of brass and steam",
    "to the Gear-Turner", "to a god of buried machines", "to the Riddle-Keeper",
    "to a spark-spirit of the forge-fire", "to the Deep Tinkerer", "to a keeper of clockwork secrets",
    "to the Whirring Maker", "to a trickster-spirit of the tunnels", "to the Lantern-Warden",
    "to a god of springs and small wonders", "to the Cog-Mother", "to a keeper of the hidden gears",
    "to the Steam-Singer",
  ],
};

// A line of racial script/language on a POI or heritage ruin.
export const RACE_INSCRIPTIONS = {
  elf: [
    "flowing Elvish script curls across the arch", "a verse in a fair tongue, half worn away",
    "silver letters catch what light there is", "graceful runes naming the long-dead",
    "a song rendered in looping glyphs", "silver-thread letters wind about the pillar",
    "an elegy in the old fair tongue", "looping script like ivy climbing the stone",
    "a lullaby carved in a delicate hand", "faded silver ink traces a half-remembered line",
    "elvish verse spirals inward toward a single word", "a love-song rendered in slender glyphs",
    "the script bends and sways like reeds in the wind",
    "an epitaph in flowing hand, its ending lost to wear", "a stanza praising some forgotten grove",
    "fine silver tracery names a house long fallen", "a fragment of an old ballad, half erased",
    "graceful glyphs that seem to breathe with the stone", "an elven blessing worn thin by centuries",
    "a riddle in verse, the answer long since crumbled",
    "delicate script curling like a vine round the frame",
    "silver letters spelling out a name none now remember",
    "a hymn to starlight, traced in careful hand", "an elven maker's signature, elegant and small",
  ],
  dwarf: [
    "angular dwarf-runes cut deep and sure", "a graven oath in the dwarvish tongue",
    "rune-rows tally names and old grievances", "hammer-struck glyphs ring the lintel",
    "a maker's mark stamped into the stone", "a boast of some ancient delving, chiseled deep",
    "squared-off runes marching in stern rows", "a tally of debts owed and debts repaid",
    "an oath of vengeance graven into the header stone", "blunt runes recording a clan's founding",
    "a maker's stamp beside a worker's initials", "a ledger of ore weighed and ore owed",
    "runes cut so deep the shadow never leaves them", "a boundary-mark claiming the vein below",
    "a warning graven in blunt, angular hand", "a roll-call of the dead, rune by rune",
    "a hammer-mark beside a guild's sigil", "an oath-stone naming who swore and who witnessed",
    "tally-strokes counting seasons of digging", "a curse laid on any who breaks the seal",
    "runes recording a feud between two clans", "a dedication to the forge that shaped this hall",
    "an inventory of tools left for the next crew", "a tally of kills notched beside a champion's name",
  ],
  halfling: [
    "a homely rhyme scratched beside the door", "names and harvest-dates in a round hand",
    "a proverb about pies and patience", "chalk-marks of some long-settled account",
    "a child's alphabet worn nearly smooth", "a recipe scrawled in a cheerful round hand",
    "a tally of turnips owed to a neighbour", "a rhyme about supper warming on the hearth",
    "chalk-marks counting jars put up for winter", "a proverb about full larders and fuller hearts",
    "names of children measured against a doorframe", "a homely verse about the best road home",
    "a harvest tally scratched beside a hearth-stone", "a note reminding someone to mind the pie",
    "a round, careful hand listing wedding guests", "a proverb about sharing what little there is",
    "chalk sums for a game long since forgotten", "a rhyme about second breakfast, half-erased",
    "a tally of good years and lean ones", "a homely blessing for hearth and larder",
    "a child's practice letters, wobbly and proud", "a note about who borrowed what, and when",
    "a proverb comparing a good friend to good bread", "a tally of apples picked and apples eaten",
  ],
  gnome: [
    "tiny cramped glyphs packed with footnotes", "a schematic more than a script",
    "cipher-runes that seem to shift as you read", "labels in a busy tinker's shorthand",
    "a diagram annotated in three colours of ink", "a parts-list crammed into the margin",
    "cipher-glyphs that resolve differently by lamplight",
    "a diagram with seventeen numbered footnotes", "tinker's shorthand abbreviating words to symbols",
    "a schematic of some device, half the labels smudged",
    "cramped notes arguing with an earlier draft of themselves",
    "a colour-coded key with half the colours faded",
    "a cipher that seems to solve itself if you squint",
    "an equation scrawled beside a small crude drawing",
    "footnotes to footnotes, spiraling into the corner",
    "a shorthand tally of gears, springs, and screws",
    "annotations in red ink correcting annotations in blue",
    "a schematic labeled 'do not attempt' in tiny script",
    "cipher-runes that hum faintly if you trace them",
    "a diagram with an arrow pointing to another diagram",
    "tinker's marks noting tolerances and measurements",
    "a footnote longer than the inscription it explains",
    "glyphs crammed sideways where the space ran out",
    "a cramped signature followed by three revision dates",
  ],
};

// Dungeon-theme preference by builder race — a weight MULTIPLIER applied to the
// terrain's theme table (js/gen/terrain-profile.js DUNGEON_THEME_BIAS). Only
// themes the terrain already offers are affected, so a race just leans the mix
// toward its own works (dwarves -> mines/vaults, elves -> tombs/sanctums).
export const RACE_DUNGEON_THEMES = {
  dwarf: { "Abandoned mine": 5, "Prison vaults": 4, "Ruined fort": 3, "Cave complex": 2, Mausoleum: 2 },
  elf: { "Forgotten tomb": 4, Ruin: 3, "Wizard's sanctum": 3, "Cult shrine": 2, Mausoleum: 2, "Beast den": 2 },
  gnome: { "Abandoned mine": 4, "Cave complex": 3, "Wizard's sanctum": 3, "Prison vaults": 2, "Flooded cistern": 2 },
  halfling: { Ruin: 2, "Forgotten tomb": 2, "Flooded cistern": 2 },
};

// Product preference by builder race — a weight MULTIPLIER applied to the
// monastery-product roll (parallels RACE_DUNGEON_THEMES). Keys MUST be exact
// values from data/monastery-product.json (test-enforced). Only products the
// table already offers are affected, so a race just leans its output mix.
export const RACE_MONASTERY_PRODUCTS = {
  dwarf:    { "iron tools": 4, "stonework": 4, "strong ale": 3 },
  elf:      { "wine": 4, "fine woodwork": 3, "illuminated manuscripts": 3 },
  halfling: { "cheese": 4, "beer": 3, "preserves": 3 },
  gnome:    { "beeswax candles": 3, "inks": 3, "clockwork trinkets": 4 },
};
