// Single source of truth for the app's colour + type tokens (Phase 11.1).
//
// The parchment/"cartographer" palette is defined ONCE here and mirrored in
// css/app.css `:root`. Canvas renderers (map.js, dungeon-map.js) import their
// colours from here so the DOM chrome and the painted map can never drift — and
// so a future dark "grimoire" variant is a single swap. Keep JS values in sync
// with the CSS custom properties.

/** Parchment palette — semantic tokens shared with css/app.css `:root`. */
export const PALETTE = {
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
};

// --- Canvas terrain fills -------------------------------------------------
// Re-homed here from terrain-style.js (which now re-exports these) so the map
// renderer and the CSS palette share one origin. Terrain hues are unchanged in
// 11.1 — the parchment re-tune of the map SURFACE lands with the terrain-art
// step (11.2). Only the "no terrain yet" fill shifts to blank vellum now, so an
// unknown hex doesn't read as a dark sticker on paper.
export const TERRAIN_COLORS = {
  Forest: "#2f6b3a",
  Plains: "#9bbd5a",
  Hills: "#8c9e71",
  Mountains: "#7d7f88",
  Swamp: "#4b5f49",
  Desert: "#d9c27a",
  Lake: "#4a8fc2",
  Sea: "#2c5a8c",
};

export const UNKNOWN_COLOR = "#cdba8c"; // blank vellum (a placed hex with no terrain)
export const SELECTED_STROKE = "#ffd166"; // selection ring (re-tuned with the map surface in 11.2)

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
