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
// renderer and the CSS palette share one origin. Phase 11.2 re-tunes these to
// softer, printed-map tints that sit on the parchment surface as coloured
// regions; the inked tile motifs (assets/terrain) are the real terrain cue, so
// hues can stay muted + colour-blind-tolerant.
export const TERRAIN_COLORS = {
  Forest: "#6d8a52", // muted sage
  Plains: "#c6cf92", // pale wheat-olive
  Hills: "#c2a765", // tan
  Mountains: "#9b93a2", // grey-mauve
  Swamp: "#6f7c58", // grey-olive
  Desert: "#e3cd82", // sand
  Lake: "#8fb8d6", // soft fresh-water blue
  Sea: "#6f9ec4", // deeper coastal blue
};

export const UNKNOWN_COLOR = "#cdba8c"; // blank vellum (a placed hex with no terrain)
export const SELECTED_STROKE = "#8a2418"; // oxblood selection ring — reads on every tint + parchment

// Canvas-only ink tokens (the map's drawn lines + label pill) — kept here with
// the rest of the palette so the painted map and the DOM chrome stay in step.
export const MAP = {
  hexBorder: "rgba(74,58,31,0.5)", // inked hex grid line
  hoverStroke: "rgba(60,44,18,0.6)", // hover outline
  labelBg: "rgba(240,229,203,0.92)", // parchment label pill
  labelInk: "#33291a",
  labelEdge: "rgba(138,112,67,0.7)",
};

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
