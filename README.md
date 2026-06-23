# solopg

A browser-based **World Oracle** for OSR solo and small-group play — a procedural
generation + record-keeping tool for hex-crawl worlds.

See **[PLAN.md](./PLAN.md)** for the master plan: architecture, phased build order, and the
catalog of oracle generators.

## Running (Phase 0)

The app is vanilla ES modules with **no build step**, but it must be served over HTTP — it
cannot run from `file://` (ES modules, `fetch`, and IndexedDB all need a real origin).

```sh
python3 -m http.server 8000   # or: npm run serve
# then open http://localhost:8000
```

From the app: **New World** (names + saves it), **Roll test table** (rolls the sample terrain
table), **Save**, **Export**/**Import** (JSON backup), **Delete**. Reload to confirm the world
persists in IndexedDB.

## Tests

Pure engine code (RNG, dice, tables, world model, import/export) is unit-tested with Node's
built-in runner — no dependencies:

```sh
npm test   # or: node --test
```

