// Seeded random number generation.
//
// The whole app is deterministic from a world seed: the same seed reproduces the
// same generation choices, which is what makes a world shareable. Persisted
// results are still the canonical history — the seed just lets us re-derive.

/**
 * mulberry32 — a tiny, fast, well-distributed 32-bit PRNG.
 * @param {number} seed unsigned 32-bit integer seed
 * @returns {() => number} function returning a float in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string to an unsigned 32-bit integer (FNV-1a). Used to turn textual
 * seeds and composite keys (e.g. axial coordinates) into numeric seeds.
 * @param {string} str
 * @returns {number} uint32
 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build an RNG from a number or string seed.
 * @param {number|string} seed
 * @returns {() => number}
 */
export function makeRng(seed) {
  const n = typeof seed === "number" ? seed >>> 0 : hashString(String(seed));
  return mulberry32(n);
}

/**
 * Derive a deterministic sub-stream from a world seed plus arbitrary parts
 * (e.g. axial coordinates, an element id). Because the seed is derived from the
 * parts — not from call order — a given hex rolls identically no matter when it
 * is generated relative to its neighbours.
 * @param {number|string} worldSeed
 * @param {...(string|number)} parts
 * @returns {() => number}
 */
export function subRng(worldSeed, ...parts) {
  const key = [worldSeed, ...parts].join(":");
  return mulberry32(hashString(key));
}

/**
 * Inclusive integer in [min, max].
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Pick a uniformly random element from a non-empty array.
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T}
 */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}
