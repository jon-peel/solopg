# Phase 9 — Small Oracles & the Living World

On-demand **referee's oracles**: quick rolls a solo GM makes *during* play — is the door
locked, what does this omen mean, what's stirring in town — plus the living-world touch of
**factions that emerge on their own**. Where the earlier phases build the *world*, Phase 9 gives
the GM the small tools to *run a session inside it*.

> Follows the project design loop: this doc is the **plan** → **approve** → build per sub-step →
> `node --test` → commit/push → manual checklist. One coherent sub-step per commit.

> **Golden rule for this phase (confirmed with the user):** *no backward compatibility, no data
> migration.* Old saves may be thrown away between tests. So where Phase 9 changes an existing
> shape (notably treasure, 9.8), we change it outright — no `*_BUILD` self-heal, no migration path.

---

## The through-line: an oracle, not a rulebook

The single design decision that shapes this whole phase (the user's steer): **solopg is a
referee's oracle, not a replacement for the GM's own game system.** That splits every oracle into
two classes, and *which class* a thing falls into is a deliberate call, not an accident:

- **Generative oracles — the app rolls and shows the answer.** These are the *setting- and
  fiction-level* prompts that don't live in any game's rulebook: a yes/no fate answer, an
  evocative word-pair to interpret, a twist, what's brewing in a town, a tavern's sign. Nobody
  owns a "canonical" table for these, so the app owning them adds value and steps on nothing.

- **Trigger-and-prompt oracles — the app decides *whether / what*, the GM rolls the rest on their
  own tables.** These are the *system-level* rolls every OSR ruleset already tables in its own way:
  a **wilderness encounter** (the app makes the *check* and names the terrain → the GM rolls their
  encounter table) and **treasure** (the app tags a hoard **"Treasure Type D"** → the GM rolls the
  contents). The app never invents monster stat blocks or coin counts — that's the GM's system.
  This keeps solopg system-agnostic (see PLAN.md *Out of scope* — "system-specific stat blocks").

Everything below is one of those two classes, plus the living-world piece (auto-emergence).

**In scope (confirmed):** Group **A** (solo keystones) · Group **D** (settlements & places) ·
Group **B** as a *trigger-and-prompt* (wilderness-encounter check) · Group **C** as a
*trigger-and-prompt* (treasure-type tags on dungeons/hooks) · Group **E** (auto-faction
emergence).

**Out of scope (confirmed):** weather; NPC generator; reaction & morale — the GM's system owns
these. **Dropped as redundant:** a standalone *plot/quest hook* oracle (Phase 6 already delivers
map-anchored adventure hooks) and a *region/realm* generator (regions already exist as map labels).

---

## Surface & shared plumbing (9.1) — ✅ **built**

All the *generative* oracles share one home and one output channel:

- **A new "Oracle" side-panel tab** (`js/ui/panel.js` `renderOraclePanel`), sitting alongside
  Detail / Hooks / Pinned / Travel / Factions — same `TAB_REGIONS` pattern. It holds a compact
  stack of **roll buttons** (9.1: the Yes/No coin; 9.2+ add an odds picker, Meaning, Complication,
  Settlement, Tavern) above an **on-screen results list**.
- **Each oracle shows its OWN latest result** in a block under its section — not a shared box and not
  a history (`oracleResults` keyed by kind in `app.js`). (The app's old growing event log was
  retired — `logLine` in `panel.js` now writes to the browser **console** only — so a GM needs the
  answer visible in the panel.) Each roll is also **mirrored to the console** via `logLine` with a
  `🎲` prefix for debugging.
- **Nothing is persisted or exported.** An oracle roll is a transient play aid, not world data — a
  history of yes/nos isn't worth saving. The latest result lives **only in memory** (`oracleLast` in
  `app.js`); a **page reload starts the tab blank** (acceptable — it's ephemeral). No world fields,
  no `saveWorld` on a roll. (A one-line strip in `setCurrent` drops any `oracleLog`/`oracleSeq` left
  on a world from the first 9.1 cut, so nothing stale ever exports.)
- **Pure engine per oracle** in `js/gen/oracle.js` (a single module — these are small): `askYesNo`
  returns a **structured pick**; `oracleLine(pick)` composes the display string, the same
  compose-at-render rule as `feature-detail.js` / `hooks.js`. Tables arrive from 9.2 on.
- **Determinism.** An oracle roll is an explicit GM action, so — unlike world generation — it should
  feel *fresh* each press. Each roll draws `subRng(seed, "oracle", kind, n)` where `n` is an
  **in-memory cursor** `oracleSeq` that only ever increments; it resets on reload/world-switch, so a
  reload replays from the top (unnoticeable for a coin flip). The pure engine keeps tests
  deterministic regardless.

Node-testable: the pick logic + prose composition are pure (`test/oracle.test.js`). The tab wiring
is UI (manual checklist).

**Manual test — 9.1 (run `./run-local.sh`, open http://localhost:8000):**
```
[ ] New World → the side panel shows a new "Oracle" tab (tab bar: Selection · Hooks ·
    Pinned · Factions · Oracle, all fitting without overflow).
[ ] Open the Oracle tab → a "Yes / No" button + "No roll yet…" hint.
[ ] Press "Yes / No" a few times → the result box shows ONLY the latest answer
    (Yes or No), replaced on each press; over ~20 presses you see both come up.
[ ] Press it repeatedly → each press flashes the result (box brightens, answer
    fades red→ink) EVEN when the answer is the same, so you know the roll landed.
[ ] Open the browser console → each roll also logged as "🎲 Oracle (yesno): Yes/No".
[ ] Export the world → the JSON has NO oracle data (no oracleLog / oracleSeq).
[ ] Reload the page → the Oracle tab is blank again (result is not persisted — expected).
[ ] Switch to another tab and back (no page reload) → the last result still shows.
[ ] Create a second New World → its Oracle tab starts blank.
```

---

## Group A — solo-play keystones (generative)

### 9.2 Yes/No fate oracle — ✅ **built**
The single most-used solo tool. The GM picks the **odds** (Certain · Likely · Even · Unlikely ·
Impossible → yes-probabilities 0.9 / 0.7 / 0.5 / 0.3 / 0.1) and rolls.

> **As built — the two refinements collapsed into one roll.** The plan listed "exceptional" and the
> "and/but" modifier as two separate layers; in practice they're the same axis (how far into the
> yes/no zone the roll landed), so one roll yields the standard **six-outcome spectrum**:
> **Yes, and · Yes · Yes, but · No, but · No · No, and**. The emphatic **"…and"** sits at the far
> end of each zone — that *is* the exceptional result — and the marginal **"…but"** sits next to the
> 50/50 boundary (outer/inner fifths, `EMPHATIC`/`MARGINAL` = 0.2). Cleaner and it's the modern
> solo-oracle convention.

- **Random-event flag:** a **doubles** roll (d100 00/11/…/99 ≈ 10%) sets `event`, shown as a
  separate note — *"⚡ A random event intrudes"* — a nudge to roll **9.3 Meaning** (no auto-chaining;
  the GM chooses to follow it).
- **UI:** a one-click **odds button row** (each button both sets the likelihood and rolls) under a
  "Yes / No" section; the result shows the odds as a tag + the six-outcome answer, with the flash
  from 9.1 replaying each press.
- **Data as consts, not a table:** the odds ladder is `ORACLE_ODDS` in `js/gen/oracle.js` — you
  *pick* from it, you don't *roll* on it, so it isn't a weighted JSON table. Engine:
  `askYesNo(rng, { odds })` (pure, node-tested: thresholds, the six zones, the event flag,
  distributions).

**Manual test — 9.2 (run `./run-local.sh`):**
```
[ ] Oracle tab → a "Yes / No" section with five odds buttons:
    Certain · Likely · Even · Unlikely · Impossible.
[ ] Press "Even" ~20× → answers span Yes, and / Yes / Yes, but / No, but / No, No, and;
    the tag reads "Even"; each press flashes.
[ ] Press "Certain" several times → almost always Yes (rarely a surprise No).
[ ] Press "Impossible" several times → almost always No (rarely a surprise Yes).
[ ] Keep rolling → occasionally a "⚡ A random event intrudes" note appears under the answer.
[ ] Browser console → each roll logs the odds + answer (+ "random event" when flagged).
[ ] Reload → tab blank (still not persisted); export JSON → still no oracle data.
```

### 9.3 Meaning / inspiration tables — ✅ **built**
The oracle's companion — when a result is open-ended (or a Yes/No flags a random event), roll an
evocative pair to interpret. Two flat JSON tables: **`oracle-action` (a verb, 52 entries)** ×
**`oracle-subject` (a noun/theme, 50 entries)** → *"Pursue · Secrets"*, *"Defy · A rising tide"* —
~2,600 combos. Deliberately abstract so it reads onto any situation.

- **Engine:** `rollMeaning(tables, rng)` → `{ kind:"meaning", action, subject }`; `oracleLine`
  composes `"Action · Subject"`. `ORACLE_TABLE_IDS` names the two tables; the app `loadTables`-es
  them on demand (cached after the first roll). Pure, node-tested (tables valid + non-trivial,
  draws are in-table, deterministic, prose).
- **UI:** a "Meaning" section with a single **"Roll meaning"** button, sharing the same result box
  as Yes/No (the tag reads "Meaning"), with the 9.1 flash.
- *(The optional third "focus" table was **not** built — the action×subject pair reads richly enough
  on its own; can be added later if it earns its keep.)*

**Manual test — 9.3 (run `./run-local.sh`):**
```
[ ] Oracle tab → below Yes/No, a "Meaning" section with a "Roll meaning" button.
[ ] Press it a few times → the result shows an "Action · Subject" pair (tag "Meaning"),
    different most presses, flashing each time.
[ ] Roll Yes/No until a "⚡ random event" note appears → press "Roll meaning" to
    interpret it → a fresh pair replaces the result.
[ ] Console → each meaning roll logs "🎲 Oracle (meaning): Action · Subject".
```

### 9.4 Complication / twist
A setback oracle for "yes, but…" / "no, and…" moments and for spicing a quiet scene: a single
`oracle-complication` table of terse, system-agnostic twists (a betrayal, a shortage, the ground
gives way, reinforcements arrive). Reads as a prompt, never a stat.

---

## Group D — settlements & places (generative, **no NPCs**)

### 9.5 Settlement situation
"What's going on in this town **right now**." A terrain- **and faction-aware** composable prompt
(same axes-×-skin approach as `feature-detail.js`): a **mood** × a **current event / notable
feature**, skinned by the settlement's size and its hex terrain, and — when a faction holds or
borders the hex — coloured by that faction's presence ("recruiters in the square", "a curfew after
dark"). Strictly *situational* — it never names or stats an NPC. Rolled from the settlement's
selection card (a "What's stirring?" action) and/or the Oracle tab against the selected hex.

Data: `data/settlement-mood.json`, `data/settlement-event.json` (+ light terrain/size skins).

### 9.6 Tavern / shop
A quick establishment prompt with **no proprietor NPC**: a **sign / name** × a **specialty** × a
**quirk** (a warped floor, a resident cat, watered ale, a back room that's always booked). Enough
to make a stop memorable; the people in it are the GM's to voice.

Data: `data/tavern-sign.json`, `data/tavern-specialty.json`, `data/tavern-quirk.json`.

---

## Group B — wilderness encounter, as **trigger-and-prompt** (9.7)

The app does **not** roll the monster — it makes the **check** and tells the GM *when* and *on
which table* to roll.

- **The check.** A per-**travel-day** encounter check (OSR-standard: a small per-terrain chance,
  e.g. 1-in-6 open ground rising in wilder terrain). Per-terrain frequency lives as tuning
  (`ENCOUNTER_CHANCE` by terrain in a const map, echoing `TRAVEL_COST` in `travel.js`, or a small
  JSON table). It fires at the **whole-day boundary** in the `advanceTime` chokepoint — right where
  faction turns already fire — using the terrain of the hex the party occupies/enters.
- **The prompt.** On a hit, `logLine` emits a **prompt, not a result**:
  *"🎲 A wilderness encounter in the Forest — roll on your encounter table."* The GM rolls it on
  their own game's tables. The app may name the terrain and (later, optional) suggest a *distance /
  surprise* only if it stays system-neutral.
- **Manual roll too.** An Oracle-tab / radial "Check for encounter" button runs the same check on
  demand (a watch, a noisy camp), independent of travel.
- **No hooks, no monster placement** — this is a table pointer, in keeping with factions-as-subtext.

Engine: `rollEncounterCheck(terrain, rng)` (pure, node-tested) → `{ encounter: boolean, terrain }`;
the prose ("roll on your …") is composed at render.

---

## Group C — treasure, as **trigger-and-prompt** (9.8)

Today dungeon rooms (and, lightly, hook payoffs) carry a **rolled gp value** (`dungeon-treasure.json`
→ `kind`/`gp`/`bulk`). Per the user's steer, treasure should instead read as a **system prompt**:
a **Treasure Type letter** (B/X-style **A–O** lair types + individual types) that the GM rolls on
their own tables — *not* a coin count the app invents.

- **Assign a type from context.** A `treasure-type` mapping keyed on the *guardian / site* — a
  monster den, a lord's hoard, an incidental cache — yields a **letter** (its lair type) plus, for
  a room's occupants, an **individual** type where the system uses one. This is a rule-ish table
  (`data/treasure-type.json`) mapping context → letter, defaulting sensibly by dungeon depth/tier.
- **Surface it as a prompt.** A stocked room / a threat's payoff / a lair reads
  *"Hoard — **Treasure Type D** (roll on your tables)"*, optionally keeping a one-line evocative
  descriptor (a gilded idol, a damp strongbox) for colour. The rolled **gp/bulk numbers are
  dropped** — the app stops inventing values.
- **Golden-rule note.** This **supersedes** the gp/bulk half of the Phase-4 treasure work
  (4.9.5 / dungeon step 18). Because we keep no back-compat, `dungeon-treasure.json`'s `gp`/`bulk`
  fields are removed rather than migrated, and `dungeon.js` / `hooks.js` / the room-render code are
  updated to carry + show a `treasureType` letter instead. (B/X treasure types are the assumed
  system — the app already uses B/X travel tiers; the table is data-swappable for another ruleset.)

Engine: `treasureTypeFor(context, rng)` (pure); render shows the letter as a prompt line.

---

## Group E — automatic faction emergence (9.9)

Factions currently only appear by the GM's hand (Generate / Promote). Phase 9 lets a **new power
emerge on its own** as time passes — **day-driven with a floor** (the user's choice):

- **Where it fires.** In the day chokepoint, alongside the existing day-driven faction turns
  (`advanceFactionDays` / the `advanceTime` path in `app.js`). A new pure entry point
  `maybeEmergeFaction(world, days, seed)` runs per whole-day boundary.
- **Day-driven, floored, capped.** A **base per-day chance** (`EMERGE_CHANCE_PER_DAY`, small — a
  new power should be an event, on the order of one every several weeks). The chance is **boosted
  while the active-faction count is below a `FACTION_FLOOR`** (the world should never feel empty)
  and **suppressed to ~0 at/above a `FACTION_CAP`** (soft max, so the map never floods). A
  **cooldown** (`EMERGE_COOLDOWN_DAYS`, tracked on the world) spaces emergences out. All tunable
  consts, flagged for real-play retune like every other generation constant.
- **Where it emerges.** Reusing the existing seat/promote machinery: prefer **promoting a suitable
  occupied POI** in the revealed map (an unaffiliated bandit camp, cult shrine, monster lair →
  `promoteFaction`), else **seat a fresh faction on a valid bare site** (`isValidSeat`) far enough
  from existing seats. Deterministic per `(seed, day)`.
- **Narrated as subtext.** A new **`"emerge"` FactionEvent**, logged through the existing
  `logFactionEvents` path — *"A new power stirs in the east: the Ashen Hand."* — and drawn on the
  map like any faction. **No hooks** (factions stay subtext). Lords (necromancer/lich/…) are **not**
  auto-emerged — those stay a deliberate Promote-only choice (8.16).

Pure and node-testable: the gate (chance/floor/cap/cooldown) and site selection are functions over
`(world, seed, day)`; only the persist/render is UI.

---

## Build order & sub-steps

Foundation first, then the generative oracles (fast, self-contained), then the two
trigger-and-prompt integrations (they touch travel/dungeons/hooks), then the living-world piece:

| Step | Item | Class | Notes |
|---|---|---|---|
| **9.1** | Oracle tab + `oracle.js` + on-screen results | plumbing | ✅ **done** — unblocks 9.2–9.6 |
| **9.2** | Yes/No fate oracle | generative | ✅ **done** — odds ladder + six-outcome (…and/…but) + event flag |
| **9.3** | Meaning / inspiration | generative | ✅ **done** — action × subject (52 × 50) |
| **9.4** | Complication / twist | generative | single table |
| **9.5** | Settlement situation | generative | terrain- & faction-aware; **no NPC** |
| **9.6** | Tavern / shop | generative | sign × specialty × quirk; **no NPC** |
| **9.7** | Wilderness-encounter **check + prompt** | trigger | per-travel-day + manual; GM rolls the table |
| **9.8** | **Treasure-type** tags on dungeons/hooks | trigger | replaces rolled gp; GM rolls contents |
| **9.9** | Automatic faction **emergence** | living world | day-driven, floored, capped, cooldown |

Each step: pure engine + tables → `node --test` green → commit → a short manual browser checklist
(roll the oracle → expected log line; travel a day → encounter prompt fires at the right rate;
open a stocked dungeon → Treasure Type letter shows; progress days → a faction emerges within the
expected window). One coherent sub-step per commit.

## Open questions (resolve as each step is picked up)
- **9.2** exact odds ladder (how many rungs) and the yes-thresholds — tune against feel.
- **9.7** per-terrain encounter frequencies — start from B/X (1-in-6 → 3-in-6) and retune.
- **9.8** confirm the B/X treasure-type letter set (A–O + individual types) and the context→letter
  mapping; this is the one step that rewrites existing output, so it lands after the additive ones.
- **9.9** the floor/cap/base-chance/cooldown numbers — set defaults, retune in play.
