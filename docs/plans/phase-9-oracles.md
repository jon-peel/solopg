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

### 9.4 Complication / twist — ✅ **built** (Group A complete)
A setback oracle for "yes, but…" / "no, and…" moments and for spicing a quiet scene: a single
`oracle-complication` table of **48** terse, system-agnostic twists (an ally's own agenda, a
shortage, the ground gives way, reinforcements for the other side). Reads as a GM prompt, never a
stat.

- **Engine:** `rollComplication(tables, rng)` → `{ kind:"complication", text }`; `oracleLine`
  returns the sentence. The table id joins `ORACLE_TABLE_IDS` (loaded with Meaning's two; cached).
  Pure, node-tested (in-table draw, deterministic, prose).
- **UI:** a "Complication" section with a **"Roll complication"** button and its own result block +
  9.1 flash, like the others.

**Manual test — 9.4 (run `./run-local.sh`):**
```
[ ] Oracle tab → below Meaning, a "Complication" section with a "Roll complication" button.
[ ] Press it a few times → its own result block shows a terse twist sentence, different
    most presses, flashing each time; the Yes/No and Meaning blocks stay put.
[ ] Console → each roll logs "🎲 Oracle (complication): <twist>".
```

**Group A (solo keystones) is now complete** — Yes/No · Meaning · Complication.

---

## Group D — settlements & places (generative, **no NPCs**)

### 9.5 Settlement situation — ✅ **built**
"What's going on in this town **right now**." A composed **mood × happening**, plus — when a faction
holds or borders the hex — a **faction-presence note** ("Recruiters for the … work the square."). The
first *context-aware* oracle: it reads the **selected** settlement.

- **Data:** `settlement-mood.json` (24 adjectival tempers) × `settlement-event.json` (30 size-neutral
  happenings) → *"Tense and watchful. A shortage has sharpened tempers."* Faction colour from
  `settlement-faction.json` (16 notes) with a `{faction}` placeholder the engine substitutes. Every
  faction template keeps `{faction}` as the **object of a preposition** ("for / of / under / against
  {faction}") so it's grammatical for any name form (*The Ashen Hand*, *Adders of the Reach*,
  *House Umber*) — no doubled article, no possessive.
- **Engine:** `rollSettlement(tables, rng, { factionName })` → `{ kind:"settlement", mood, event,
  factionNote }`; `oracleLine` composes *"{Mood}. {event}"*. Pure, node-tested.
- **Context (app):** `selectedSettlementContext()` reads the selected hex's settlement (name · size)
  and `factionNameAt(q,r)` — the faction holding the hex, else one bordering it. `refreshOracle` runs
  on selection change so the section tracks the current town.
- **UI:** a "Settlement" section; when a town is selected, a **"Roll situation"** button (tooltip
  names the town) + its result block (tag = town, the faction note as a `⚑` sub-note). When no town
  is selected, a hint points at the map. Strictly *situational* — never an NPC.
- *(The "What's stirring?" action on the selection card and per-terrain/size skins were **not**
  built — the Oracle-tab entry + size-neutral events cover it cleanly; both can be added later.)*

**Manual test — 9.5 (run `./run-local.sh`):**
```
[ ] Oracle tab with NO town selected → "Settlement" section shows a hint, no button.
[ ] Select a town (a hex with a settlement) → a "Roll situation" button appears
    (hover: "What's stirring in <Town> · <Size>?").
[ ] Press it → a "Mood. Happening." result, tagged with the town, flashing each press.
[ ] Select a town on/next to faction territory → rolls include a "⚑ …{faction}…" note,
    reading grammatically (no "The The …").
[ ] Select an empty hex → the button disappears, the hint returns.
[ ] Console → each roll logs "🎲 Oracle (settlement): …".
```

### 9.6 Tavern / shop — ✅ **built** (Group D complete)
A quick establishment with **no proprietor NPC**: a **sign** × a **specialty** × a **quirk** →
*"The Widow's Mite — known for spiced wine and worse company. There's a back room that's always
somehow booked."* Enough to make a stop memorable; the people in it are the GM's to voice.

- **Data:** `tavern-sign.json` (40 curated signs) · `tavern-specialty.json` (28) · `tavern-quirk.json`
  (30). Context-free like Meaning.
- **Engine:** `rollTavern(tables, rng)` → `{ kind:"tavern", sign, specialty, quirk }`; `oracleLine`
  returns the **sign** as the headline. Pure, node-tested.
- **UI + a new `body` slot:** the result block now supports normal-weight **body lines** under the
  headline — the tavern shows its sign big, then "Known for {specialty}." and the quirk beneath.
  (Also refactored the console log to print each result's real body/note, fixing a 9.5 line that
  mislabelled the faction note as "random event".)

**Manual test — 9.6 (run `./run-local.sh`):**
```
[ ] Oracle tab → a "Tavern / shop" section with a "Roll tavern / shop" button.
[ ] Press it → the sign shows big, with "Known for …." and a quirk line beneath;
    different most presses, flashing each time.
[ ] The other oracle blocks stay put; console logs the full "sign · known for … · quirk".
```

**Group D (settlements & places) is now complete** — Settlement situation · Tavern/shop. All the
**generative** oracles (Groups A + D) are done; what remains is the **trigger-and-prompt** pair (9.7
encounter, 9.8 treasure) and **9.9 auto-emergence**.

---

## Group B — wilderness encounter, as **trigger-and-prompt** (9.7) — ✅ **built**

The app does **not** roll the monster — it makes the **check** and tells the GM *when* and *on
which table* to roll.

- **The check.** `ENCOUNTER_CHANCE` per terrain (B/X "N-in-6": Plains 1/6, Forest/Hills/Mountains/
  Desert 2/6, Swamp 3/6, water 1/6) — tuning consts in `oracle.js`, like `TRAVEL_COST`.
  `rollEncounterCheck(terrain, rng)` → `{ kind:"encounter", terrain, encounter, chance }`. Pure,
  node-tested (thresholds, per-terrain coverage, hit-rate, prose).
- **Automatic, on the travel route (map stars).** When the party travels, every **hex entered** on
  that route gets a check (`travelEncounterHexes` over `result.log`, each hex's own terrain). Hexes
  that hit are **starred on the map** (`setEncounterMarks` → `drawEncounterMarks`, a wax-seal-red ★
  over the gold trail) — so the GM sees exactly *which hexes* need an encounter rolled. Settlement
  hexes are skipped (no wilderness encounter in a town). Each hit also logs a prompt to the console
  (*"⚔ Encounter in the Forest at (q, r) — roll on your encounter table."*). Marks clear on the next
  journey and on world switch (session-only, like the trail). *(Frequency is now **per hex entered**
  at the terrain's N-in-6 rate — retune `ENCOUNTER_CHANCE` if that's too many stars.)*
- **Map-only, no Oracle-tab section.** Encounters surface purely on the travel route — there is **no
  "Wilderness encounter" section on the Oracle page** (removed at the user's request). The engine
  (`rollEncounterCheck`) is driven by travel; the Oracle tab holds only the generative oracles.
- **The prompt, never the monster.** No hooks, no monster placement — the star flags *where*, the GM
  rolls *what* on their own tables, in keeping with factions-as-subtext.

**Manual test — 9.7 (run `./run-local.sh`):**
```
[ ] Double-click the party and travel across several wilderness hexes → the gold trail draws,
    and a red ★ appears on the hexes where an encounter came up (usually some, not all).
[ ] Console logs "⚔ Encounter in the <terrain> at (q, r) — roll on your table." for each star.
[ ] Travel again → the previous journey's stars clear; the new route's stars show.
[ ] A route hex that holds a town gets no star (no wilderness check in a settlement).
[ ] Oracle tab → no "Wilderness encounter" section (encounters are map-only now).
[ ] The app never names a monster — only flags WHERE and prompts you to roll your own.
```

---

## Group C — treasure, as **trigger-and-prompt** (9.8) — ✅ **built**

Dungeon (and tower) rooms used to carry a **rolled gp value** (`dungeon-treasure.json` →
`kind`/`gp`/`bulk`). Now a hoard reads as a **B/X lair Treasure Type letter** the GM rolls on their
own tables — the app invents no coins.

- **Scope — dungeons/towers only.** That's the only place the app rolled concrete treasure *values*.
  **Hooks were already prompt-shaped** — a bounty reward reads *"a heavy purse of gold from {patron}"*
  and a chain prize *"a dragon's scattered hoard"* (qualitative, never a gp roll), so they're
  unchanged.
- **The table.** `data/treasure-type.json` — B/X lair letters (A/B/C/D/E/F/G/H/I/J/K/L/M/N/O) each
  tagged `tier` 1–3, weighted by the level's treasure tier via the **same tier-affinity** the old
  value table used, so deeper hoards lean toward richer letters (test: type-tier rises with depth).
- **Shape + render.** A room's `treasure` is now `{ type, guard }` (was `{ kind, guard, gp?/dice?/
  weight? }`); the render reads *"Treasure Type D, hidden — roll on your tables."* `dungeon.js` and
  `tower.js` both roll a letter; `rollDice`/`BULK_FACTOR` and the gp/weight machinery are gone.
- **Golden-rule note.** Supersedes the gp/bulk half of the Phase-4 treasure work (4.9.5 / dungeon
  step 18). `dungeon-treasure.json` is **deleted** (no migration); `DUNGEON_BUILD 21→22` and
  `TOWER_BUILD 2→3` make existing interiors **regenerate on open** with the new shape. B/X letters
  are the assumed system (the app already uses B/X travel tiers); the table is data-swappable (OSE
  uses the same A–O).

**Manual test — 9.8 (run `./run-local.sh`):**
```
[ ] Open a dungeon (or tower) with treasure → a stocked room reads
    "Treasure Type <letter>, <guard> — roll on your tables." — no gp / cn numbers anywhere.
[ ] Deeper levels trend toward richer letters (A/F/G/H/M) vs shallow (C/J/K/L).
[ ] An OLD saved dungeon, opened after this update, regenerates to the new treasure shape
    (build stamp bump) — no crash, no "undefined gp".
[ ] The 💰 room marker still appears on rooms that hold treasure.
```

Engine: `treasureTypeFor(context, rng)` (pure); render shows the letter as a prompt line.

---

## Group E — automatic faction emergence (9.9) — ✅ **built**

Factions used to appear only by the GM's hand (Generate / Promote). Now a **new power emerges on its
own** as time passes — **day-driven with a floor** (the user's choice):

- **Where it fires.** In the day chokepoint (`advanceTime` → `maybeEmergeFactions`), right after the
  day-driven faction turns.
- **The pure gate.** `rollEmergences(world, days, seed)` in `factions.js` walks the days and returns
  how many powers should rise: a **per-day chance** — `EMERGE_FLOOR_CHANCE 0.10` **below**
  `FACTION_FLOOR (2)` active, `EMERGE_BASE_CHANCE 0.03` above — **zero at/above** `FACTION_CAP (6)`,
  spaced by `EMERGE_COOLDOWN_DAYS (10)`. It advances two **reload-safe** world accumulators
  (`emergeTicks`, a monotonic rng cursor; `emergeSince`, the cooldown counter) — added to
  `createWorld`, no migration (golden rule). All tunable. Node-tested (cap, cooldown window, floor
  boost, determinism, junk input).
- **Where it emerges (app).** `pickEmergenceSite` prefers **promoting an unaffiliated occupied POI**
  on open ground (a bandit camp → a bandit power), else seats a **fresh faction on a bare, passable,
  unsettled land hex** kept ≥3 hexes from an existing seat. `emergeOneFaction` reuses
  `promoteFaction` / `generateFaction` + `isValidSeat` exactly like the manual Generate path.
- **Narrated as subtext.** A new **`"emerge"` FactionEvent** through the existing `logFactionEvents`
  path — *"A new power stirs — The Ashen Hand rises at (…)."* — then drawn on the map like any
  faction. **No hooks.** Lords never auto-emerge (they're not in `faction-archetype.json` — a
  deliberate Promote-only choice, 8.16).

**Manual test — 9.9 (run `./run-local.sh`):**
```
[ ] New World, generate a region, place the party. With 0-1 factions, use "Progress N days"
    (e.g. 30-60) a few times → after the cooldown, a new faction appears on the map
    (coloured territory + a seat), and the console logs "A new power stirs — <name> rises at …".
[ ] It tends to take over an existing occupied POI (bandit camp / cult shrine) when one is free,
    else seats on open wilderness a few hexes off any existing seat.
[ ] Keep progressing → emergences slow as the count climbs and stop around the soft cap (6);
    they don't flood.
[ ] A lich/dragon/etc. never auto-emerges (still Promote-only).
[ ] Reload → the emerged factions persist (they're real world.factions).
```

**Phase 9 is complete** — all generative oracles (A + D), both trigger-and-prompt oracles (9.7
encounter, 9.8 treasure), and the living-world auto-emergence (9.9).

---

## Build order & sub-steps

Foundation first, then the generative oracles (fast, self-contained), then the two
trigger-and-prompt integrations (they touch travel/dungeons/hooks), then the living-world piece:

| Step | Item | Class | Notes |
|---|---|---|---|
| **9.1** | Oracle tab + `oracle.js` + on-screen results | plumbing | ✅ **done** — unblocks 9.2–9.6 |
| **9.2** | Yes/No fate oracle | generative | ✅ **done** — odds ladder + six-outcome (…and/…but) + event flag |
| **9.3** | Meaning / inspiration | generative | ✅ **done** — action × subject (52 × 50) |
| **9.4** | Complication / twist | generative | ✅ **done** — single table (48) · Group A complete |
| **9.5** | Settlement situation | generative | ✅ **done** — mood × happening + faction note; context-aware; **no NPC** |
| **9.6** | Tavern / shop | generative | ✅ **done** — sign × specialty × quirk; **no NPC** · Group D complete |
| **9.7** | Wilderness-encounter **check + prompt** | trigger | ✅ **done** — per-travel-day + manual; GM rolls the table |
| **9.8** | **Treasure-type** tags on dungeons/towers | trigger | ✅ **done** — replaces rolled gp with a B/X letter; GM rolls contents |
| **9.9** | Automatic faction **emergence** | living world | ✅ **done** — day-driven, floored, capped, cooldown |

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
