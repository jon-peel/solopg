// Deterministic 2D value noise (Phase 3R.3 — elevation/moisture fields).
//
// Pure module (no DOM): a coordinate-hashed noise field, built only from
// subRng/hashString (no external noise library, no npm runtime deps). Given
// the same (seed, layer, x, y), always returns the same value — a pure
// function of position, so sampling order never matters (unlike the retired
// neighbour-affinity mechanism it replaces).

import { subRng } from "./rng.js";

// Smoothstep easing (C1-continuous) for interpolating between lattice corners.
// Exported since callers outside this module use it too (e.g. biome.js's
// origin-land-bias falloff).
export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// Deterministic pseudo-random value in [0,1) for an integer lattice point.
function latticeValue(seed, layer, ix, iy) {
  return subRng(seed, layer, ix, iy)();
}

/**
 * Single-octave 2D value noise: hash the 4 integer lattice corners around
 * (x, y), bilinearly interpolate with smoothstep easing on the fractional
 * part. Continuous (no seams at lattice boundaries) and deterministic.
 * @param {number|string} seed world seed
 * @param {string} layer namespaces independent fields (e.g. "elevation")
 * @param {number} x
 * @param {number} y
 * @returns {number} float in [0,1)
 */
export function valueNoise2D(seed, layer, x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const h00 = latticeValue(seed, layer, ix, iy);
  const h10 = latticeValue(seed, layer, ix + 1, iy);
  const h01 = latticeValue(seed, layer, ix, iy + 1);
  const h11 = latticeValue(seed, layer, ix + 1, iy + 1);

  const sx = smoothstep(fx);
  const sy = smoothstep(fy);
  const top = h00 + (h10 - h00) * sx;
  const bot = h01 + (h11 - h01) * sx;
  return top + (bot - top) * sy;
}

/**
 * Fractal sum (FBM) of `octaves` value-noise layers at increasing frequency
 * and decreasing amplitude, normalized by total amplitude so the result stays
 * in [0,1) without clamping. Each octave samples its own sub-layer
 * (`${layer}:${o}`) — a decorrelated lattice, not a rescaled read of the same
 * one — so octaves add texture rather than just resampling one field.
 * @param {number|string} seed
 * @param {string} layer
 * @param {number} x
 * @param {number} y
 * @param {{ octaves?: number, frequency?: number, lacunarity?: number, persistence?: number }} [opts]
 * @returns {number} float in [0,1)
 */
export function fbm2D(seed, layer, x, y, opts = {}) {
  const { octaves = 3, frequency = 0.2, lacunarity = 2, persistence = 0.5 } = opts;
  let sum = 0;
  let amplitude = 1;
  let freq = frequency;
  let amplitudeSum = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise2D(seed, `${layer}:${o}`, x * freq, y * freq);
    amplitudeSum += amplitude;
    amplitude *= persistence;
    freq *= lacunarity;
  }
  return sum / amplitudeSum;
}
