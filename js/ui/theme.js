// Single source of truth for the app's colour + type tokens (Phase 11.1).
//
// The parchment/"cartographer" palette is defined ONCE here and mirrored in
// css/app.css `:root`. Canvas renderers (map.js, dungeon-map.js) import their
// colours from here so the DOM chrome and the painted map can never drift.
//
// Phase 12.8 adds an automatic DARK ("grimoire") variant: the OS
// `prefers-color-scheme` picks LIGHT or DARK at load, and the exported tokens are
// LIVE BINDINGS — `applyTheme()` re-points them and `watchTheme(cb)` fires when
// the OS setting flips, so a canvas can repaint without a reload. Keep the JS
// values in sync with the CSS custom properties (the `@media (prefers-color-
// scheme: dark)` block in css/app.css mirrors DARK.palette).

// --- Light + dark palettes -------------------------------------------------

const LIGHT = {
  palette: {
    paper: "#e8dabb", // app / map base
    paperPanel: "#e4d4b0", // side panel, cards
    paperBar: "#dcc9a0", // top command bar (deeper, aged)
    paperRaised: "#efe3c8", // raised buttons / menu nodes (catch the light)
    paperSunk: "#d3bd90", // pressed / active wash
    ink: "#33291a", // primary text
    inkSoft: "#6d5c3e", // muted / secondary text
    inkFaint: "#937d55", // faint hints
    edge: "#b39a67", // hairline borders
    edgeStrong: "#8a7043", // inked borders
    accent: "#8a3324", // oxblood / wax-seal red — interactive + brand
    accent2: "#2f6a63", // verdigris teal — links / info
    gold: "#b0842b", // highlight / "lit" / selection
    danger: "#9c2b1e",
    onAccent: "#f4ead2", // text/glyph on an accent- or ink-filled control
  },
  terrain: {
    Forest: "#6d8a52", // muted sage
    Plains: "#c6cf92", // pale wheat-olive
    Hills: "#c2a765", // tan
    Mountains: "#9b93a2", // grey-mauve
    Swamp: "#6f7c58", // grey-olive
    Desert: "#e3cd82", // sand
    Lake: "#8fb8d6", // soft fresh-water blue
    Sea: "#6f9ec4", // deeper coastal blue
  },
  unknown: "#cdba8c", // blank vellum (a placed hex with no terrain)
  selected: "#8a2418", // oxblood selection ring
  map: {
    hexBorder: "rgba(74,58,31,0.5)", // inked hex grid line
    hoverStroke: "rgba(60,44,18,0.6)", // hover outline
    labelBg: "rgba(240,229,203,0.92)", // parchment label pill
    labelInk: "#33291a",
    labelEdge: "rgba(138,112,67,0.7)",
  },
  dungeon: {
    contentFill: { Monster: "#e4c1a9", Trap: "#e8d59e", Empty: "#efe4c6", Special: "#d2cadf" },
    corridorFill: "#e3d4ac",
    doorFill: { door: "#c9a45f", locked: "#b3402f", stuck: "#c07a2a", secret: "#7a5aa6" },
    roomStroke: "#5b4a2a", // inked walls (sepia)
    wallInk: "#4a3a1e",
    selected: "#8a2418",
    inkText: "#3a2c14", // room numbers, door symbols
    gridInk: "rgba(90,74,42,0.14)",
    litGlow: "rgba(255,190,90,0.33)",
    clearedDim: "rgba(110,92,55,0.32)",
    badgeShadow: "rgba(40,28,10,0.4)",
  },
};

const DARK = {
  palette: {
    paper: "#241d14", // dark vellum / leather base
    paperPanel: "#2b2318",
    paperBar: "#1e1710",
    paperRaised: "#372d1f",
    paperSunk: "#16100a",
    ink: "#ece0c6", // warm cream text
    inkSoft: "#b6a483",
    inkFaint: "#8c7a5c",
    edge: "#56472f",
    edgeStrong: "#7a6238",
    accent: "#d97a61", // brighter oxblood — legible on the dark ground
    accent2: "#63b3a6", // lighter verdigris
    gold: "#d8a648",
    danger: "#db6551",
    onAccent: "#241d14", // dark text on the (now lighter) accent fills
  },
  terrain: {
    Forest: "#45583a",
    Plains: "#6f7548",
    Hills: "#726039",
    Mountains: "#5a5560",
    Swamp: "#434b36",
    Desert: "#7e6f42",
    Lake: "#40607a",
    Sea: "#395d78",
  },
  unknown: "#352c1f",
  selected: "#e8805f",
  map: {
    hexBorder: "rgba(225,210,175,0.20)",
    hoverStroke: "rgba(235,220,185,0.5)",
    labelBg: "rgba(32,26,18,0.92)",
    labelInk: "#ece0c6",
    labelEdge: "rgba(150,128,88,0.6)",
  },
  dungeon: {
    contentFill: { Monster: "#4a3428", Trap: "#4d4326", Empty: "#38301f", Special: "#3b3648" },
    corridorFill: "#2e2718",
    doorFill: { door: "#b8923f", locked: "#cf5a48", stuck: "#cf9440", secret: "#9a7ec8" },
    roomStroke: "#b09a6a", // inked walls, now light on the dark page
    wallInk: "#cab795",
    selected: "#e8805f",
    inkText: "#ece0c6",
    gridInk: "rgba(225,210,175,0.10)",
    litGlow: "rgba(255,200,110,0.22)",
    clearedDim: "rgba(10,7,4,0.45)",
    badgeShadow: "rgba(0,0,0,0.5)",
  },
};

/** True when the OS asks for a dark colour scheme (false in node / older UAs). */
export function prefersDark() {
  return typeof globalThis !== "undefined"
    && typeof globalThis.matchMedia === "function"
    && globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
}

let THEME = prefersDark() ? DARK : LIGHT;

// Live-binding exports: importers that read these at RENDER time see the updated
// values after applyTheme() re-points them (no consumer changes needed).
export let PALETTE = THEME.palette;
export let TERRAIN_COLORS = THEME.terrain;
export let UNKNOWN_COLOR = THEME.unknown;
export let SELECTED_STROKE = THEME.selected;
export let MAP = THEME.map;
export let DUNGEON = THEME.dungeon;

/** Re-point the exported tokens at the current OS theme. Returns true on change. */
export function applyTheme() {
  const next = prefersDark() ? DARK : LIGHT;
  if (next === THEME) return false;
  THEME = next;
  PALETTE = THEME.palette;
  TERRAIN_COLORS = THEME.terrain;
  UNKNOWN_COLOR = THEME.unknown;
  SELECTED_STROKE = THEME.selected;
  MAP = THEME.map;
  DUNGEON = THEME.dungeon;
  return true;
}

/** Call `cb` whenever the OS light/dark preference flips (after re-pointing). */
export function watchTheme(cb) {
  if (typeof globalThis === "undefined" || typeof globalThis.matchMedia !== "function") return;
  globalThis.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    applyTheme();
    if (cb) cb();
  });
}

/** Raw light/dark sets (for tests + tooling). */
export const THEMES = { light: LIGHT, dark: DARK };

// --- WCAG contrast (pure; node-tested) ------------------------------------

/** Parse "#rgb" / "#rrggbb" to [r,g,b] 0–255. Throws on anything else. */
export function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Relative luminance per WCAG 2.1 (0 = black, 1 = white). */
export function relativeLuminance(hex) {
  const lin = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Contrast ratio between two colours (1–21). Symmetric. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA pass? 4.5:1 for body text, 3:1 for large text / UI. */
export function meetsAA(fg, bg, large = false) {
  return contrastRatio(fg, bg) >= (large ? 3 : 4.5);
}
