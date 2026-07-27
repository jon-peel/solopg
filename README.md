# solopg

A browser-based **World Oracle** for OSR solo and small-group play — a procedural
generation + record-keeping tool for hex-crawl worlds.

See **[PLAN.md](./PLAN.md)** for the master plan: architecture, phased build order, the data
model, and the per-step sub-plans in [`docs/plans/`](./docs/plans).

**Status:** Phases 0–9 + 11 complete (Phase 12 UX polish in planning). Seeded hex map with terrain/settlements/POIs, multi-level
**dungeons** (+ towers), terrain-aware **shrine/camp/landmark** detail, **adventure hooks**
(known/distant/treasure-map/breadcrumb-chain/opportunity/event/escort/return), and full **QoL & UX**
polish (right-click radial menu, dungeon-view UX, panel tabs, pinned hooks, map notes/labels, map
nav/onboarding, POI dot polish). **Phase 3R (world coherence)** is also feature-complete — coherent
terrain, rivers, roads, and settlement placement. **Phase 8 Arc A (Travel & Party Movement)** is
complete — a party marker + session day clock, a per-terrain **travel** model (pace, encumbrance,
getting lost), **day-at-a-time** travel (toward a hex, or an 8-point compass into the unknown that
generates terrain and reveals line-of-sight), and a "Progress N days" control. **Phase 8 Arc B
(Factions)** is also complete — factions with a **goal doom-clock**, **disposition**, **strength**,
and **holdings across the map**; **generate** or **promote** an occupied POI into one, set a hex's
owner from a **"Run by"** picker, delete a faction from its card, and **faction turns** (manual or
auto-fired as days pass) that advance goals and **expand** factions across the map. The **expansion
arc (8.13–8.19)** makes that contest the engine: every faction grows a **sphere of influence** around a
**seat** (its HQ) at a **per-archetype chance** — it claims open ground, fights for a rival's hex at the
border (strength-weighted), and a **seat is dug in** (much harder to take); a faction that loses its
seat **relocates and its reach falters**, or **dissolves** if it has nowhere to regroup. **Lair-bound
lords** (a lich, necromancer, vampire, dragon, or hag) **infuse their own dungeon/tower** — the lord's
kin fill the halls and the lord waits as the final boss. Every turn **narrates what each faction did**
(the map's coloured territory + a running log) — factions are played entirely as **subtext**, and emit
**no hooks**. **Phase 11 (Visual & UX Overhaul)** is also complete — a cohesive **cartographer's**
re-skin on a single-source token system (parchment palette, serif type, inked terrain art, restyled
dungeon view), **faction territory** shown as shaded + colour-blind-hatched hexes with a clickable
legend → detail, the **radial menu as the single hex-action surface** (keyboard + touch + ARIA), a
**responsive/touch** layout, and a **directional travel** overhaul (a 3-ring compass — one hex / half
day / full day — a fractional day-clock, roads that double pace and prevent getting lost, and a drawn
movement path). Presentation-only, no schema change. **Phase 9 (Small Oracles & the Living World)** is
also complete — an **Oracle** tab of on-demand referee's rolls (**Yes/No fate** with an odds ladder and
six-outcome …and/…but, **Meaning**, **Complication**, a faction-aware **Settlement situation**, and
**Tavern/shop**), plus **trigger-and-prompt** aids where the app decides *whether/what* and the GM
rolls their **own** tables: a **wilderness-encounter check** that stars the hexes on your travel route,
and dungeon/tower **treasure as a B/X Treasure Type letter** (no invented gp). And the living world
turns on its own — **factions emerge** by a pressure model (new powers on the open frontier, **rebellions**
inside a dominant power, and rare **lord awakenings** — a lich/dragon — at eligible lairs), narrated as
subtext. See [PLAN.md](./PLAN.md) for what's next — **Phase 12** surfaces that living world on-screen
(an event chronicle + ticker, a faction popup, hover/legend polish, persistent settlement taverns), then
the Phase 10 backlog. *Deferred:* travel modes (mounts/boats).

## Running

Vanilla ES modules, **no build step**, but it must be served over HTTP — it cannot run from
`file://` (ES modules, `fetch` of `/data/*.json`, and IndexedDB all need a real origin).

```sh
./run-local.sh                # fetches the branch, runs node --test, serves on :8000
# or, to just serve the working tree:
python3 -m http.server 8000   # or: npm run serve  → open http://localhost:8000
```

From the app: **New World**, then **right-click any tile** (or long-press on touch, or arrow-navigate
the ring by keyboard) for a radial menu of its actions (place terrain / generate, add settlements &
POIs, hooks, regenerate, delete) — or use the side panel. Left-click selects, left-drag pans, wheel or
pinch zooms. **Double-click the party** for the travel compass (pick a direction and a distance — one
hex, half a day, or a full day); double-click another hex to move toward it. Open a **dungeon/tower**
to explore its mapped interior, and
**Generate hook** / **Read map** / **Follow a trail** at a town to spin up adventure hooks
(shown in the always-visible Hooks list). **Export/Import** is JSON backup; reload confirms the
world persists in IndexedDB.

## Tests

Pure engine code (RNG, dice, tables, world model, import/export) is unit-tested with Node's
built-in runner — no dependencies:

```sh
npm test   # or: node --test
```

