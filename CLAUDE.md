# ASV Simulator — project guide (CLAUDE.md)

Browser-only command-and-control (C2) shore station **and simulator** for a
small-class **survey ASV** (autonomous surface vehicle, ~2 m × 0.75 m, battery,
short surveys in constrained water). Single-file stdlib-Python server
(`asv_console.py`) + one vanilla-JS page (`static/asv.html`), plus a read-only
`static/playback.html` session-review page. No pip, no build step, Python 3
standard library only.

This project is a **sanitized, generic derivative** — it carries no vendor,
model, or proprietary-protocol identity. Keep it that way: do **not** reintroduce
brand names, model numbers, vendor manual citations, or a specific wire-protocol
format. The onboard controller is the generic **VCU (Vehicle Control Unit)**; the
shore link is a generic serial-over-IP control link.

**Where the line falls** (settled 2026-08-01, see the sanitization section): the **sibling
console's identity never appears in code** — it is the thing this derivative is sanitized
from, so refer to it as "the sibling console". A **modeled vessel's name is DATA** and
belongs in `vessels/*.json`; the core may name a profile *id* (`DEFAULT_VESSEL_ID`) because
that is a data key, not branding. Standing check:
`grep -rniE "z-?boat|teledyne" --include=*.py --include=*.html --include=*.js . | grep -v vessels/`

**The rule is scoped to CODE.** THIS FILE deliberately names the sibling and its path — a
maintainer has to be able to find it — which is why the check above filters by source
extension. Don't "finish the job" by scrubbing the maintainer notes.

## ⇒ START HERE (handoff 2026-08-04 — written for "ASV console refinement 1")

**Repo:** local git only (no GitHub remote), tree clean. `git log --oneline -5` for the tip —
**this handoff no longer quotes a HEAD hash, because it is now refreshed IN the work commit
and a commit cannot name itself** (see "Keep docs current"). Run:
`python asv_console.py --sim` — **it now comes up as the DriX at Lewes** (`drix08` is
`DEFAULT_VESSEL_ID`; no `--vessel` needed). Web port **8791**; the branded sibling at
`D:\Claude\Zboat` uses 8781, so both run side by side. **Keep this console brand-free**
— the sanitization rules below are locked decisions, not preferences.
**⛔ THE SIBLING IS PARKED (Andy's standing directive, 2026-08-05): all future effort
resides HERE. Do not port fixes back to the Z-Boat console or touch its repo until he
redirects** — every "flows both ways" / "port to the sibling" note below predates this.

**⚠ A FEATURE WAS BUILT AND REVERTED THE SAME DAY (2026-08-06) — READ BEFORE TOUCHING
THE RECORDER OR PLAYBACK.** `d473b5b` shipped full-picture recording (a `LOG.aux`
change-only/throttled mechanism feeding env/water/ais/vessel/mission streams) + a
CHART|CONTROLS two-tab playback. Hours later, live mid-mission, Andy called it back —
"too many things that worked are now broken" — and `1a1e8dc` reverts it whole; the tree
is PROVEN byte-identical to `734ec90` (`git diff 734ec90 1a1e8dc` is empty). **Do not
rebuild it unasked.** The design, both suites (13 mutations earned) and the docs live
intact in `d473b5b` if he ever asks. Four things survive the event:
- **The fault that triggered the call was NEVER root-caused**: his LINES card froze in
  the controls window. The controls window is a DOM MIRROR of the chart window's hidden
  panels over a **BroadcastChannel — which is ORIGIN-SCOPED: a chart window on
  `localhost:8791` and a controls window on `127.0.0.1:8791` can never sync, silently,
  while commanding still works.** Works-after-revert carries a restart confound (the
  restart is also the cure for both mirror suspects), so the feature stands unconvicted.
  If the card freezes again on THIS code: F5 the controls window, compare the two
  address bars, then F12 on the chart window.
- **A real gap found during diagnosis, parked**: a SECOND full client (a laptop beside
  the console) never learns of plan edits — each window loads `mission` once at boot.
  The built-and-tested-live fix is 4 lines of design: server bumps `MISSION_REV` in
  `save_mission` + publishes it on the state + the POST returns it; client adopts its
  own echo, guards in-flight edits with `savePending`, refetches on a foreign rev.
- Sessions recorded during the feature window carry extra record kinds (`env`, `water`,
  `ais`, `vessel`, `mission`); this playback ignores unknown kinds — they replay fine.
- The revert-day conversation also closed: aisstream's empty feed was THEIR outage
  (fresh key installed and equally silent — the discriminator ran); `02bacb9` means an
  upstream error frame now SHOWS instead of reading as a quiet sea.

**THIRTY-ONE REGRESSION SUITES (441 assertions), all run by the pre-commit hook** (`.githooks/pre-commit`;
enable once per clone with `git config core.hooksPath .githooks`). **The hook now DERIVES its
run list from `tests/`** — a new suite runs from the day it is written; only the per-suite
failure ADVICE is still hand-kept (a missing advice line is cosmetic, a missing run was a
hole). Run them after any change to what they cover, and treat "harness crashed" as loudly
as "check failed".
**The counts below are hand-maintained and DO drift** — twice now an edit has targeted a
number that had already changed, leaving the total wrong. Re-derive rather than trust:

```
for f in tests/*.js; do printf "%-24s " $(basename $f); node  $f | grep -cE '^ *(ok|FAIL) '; done
for f in tests/*.py; do printf "%-24s " $(basename $f); python $f | grep -cE '^ *(ok|FAIL) '; done
```


| | guards |
|---|---|
| `node tests/buoy_lane.js` | Rule 9 channel lane + the lane fact travels with its route (14) |
| `node tests/wreck_clearance.js` | charted point-hazard extent (12) |
| `node tests/water_trust.js` | water-level trust + depth gating (15) |
| `node tests/turn_geometry.js` | survey turn geometry (21) |
| `node tests/end_action.js` | what the card says a run ends as (16) |
| `node tests/nogo_readout.js` | the Nogo row's state, incl. the stuck-on-loading bug (15) |
| `node tests/pattern_move_grip.js` | the survey move grip is reachable AND visible (7) |
| `node tests/survey_card.js` | the survey card still describes a COMMITTED plan (11) |
| `node tests/speed_recalc.js` | plan speed is an INPUT — it recalculates (10) |
| `python tests/roc_tracks.py` | ROC / moving HOME + NMEA ingest robustness; gps_sim round-trip (23) |
| `python tests/live_speed.py` | a speed change REACHES the boat — SOG follows (11, real console) |
| `python tests/ais_range.py` | AIS range filters a wide subscription; never on a lake; nm + empty state (20) |
| `node tests/ui_split.js` | split-window lists resolve; card placement, shared resize + height cap (17) |
| `node tests/panel_drag.js` | ONE drag + ONE show mechanism; no pop-out forgets its position OR goes off-screen (23) |
| `node tests/ais_table.js` | the AIS traffic list is PATCHED, never rebuilt (9) |
| `node tests/stored_settings.js` | guarded localStorage; legacy `"1"`/`"0"` toggles still read (11) |
| `node tests/units_toggle.js` | the km↔nm DIST pill: value converts BOTH ways, short stays metric, one formatter (12) |
| `python tests/completion_modes.py` | end-of-plan setting vs run (11, drives a real console) |
| `python tests/estop_chain.py` | E-STOP reaches the VESSEL, latches, refuses, releases cleanly (17, real console) |
| `python tests/run_link_control.py` | transit/pause/reset/connect/disconnect: pause is NOT stop; reset refuses on real; no zombie link (21, real console) |
| `python tests/home_spawn.py` | sethome trusts only the LIVE fix (the stale-status fix); RTH closes on home; spawn = power-cycle AT the point (14, real console) |
| `python tests/energy_chartinfo.py` | energy override: sim layer + engine layer earned separately; chartinfo served from its exact-key cache, 400 on bad bbox (13, real console) |
| `python tests/enc_extract.py` | /api/enc: 400 usage, the cache answers, per-request shallow retag (exclusive boundary, disk untouched); shared bbox helpers guarded from BOTH suites (10, real console) |
| `python tests/env_water.py` | env override REACHES the running boat + disable returns calm; waterlevel manual set/clear; bad input is a 400, never a dropped connection (11, real console) |
| `python tests/log_routes.py` | logevent survives colliding data keys (renamed, flat record); /api/logs lists the live session; safe_log_path serves ONLY bare asv_*.jsonl (9, real console, logging ON) |
| `python tests/data_routes.py` | vessel switch SAFE gate + energy-gauge flip; the comms password's THREE never-leak paths; tide answers; ROC HTTP error mapping (15, real console, logging ON) |
| `python tests/ais_error_frames.py` | an aisstream error frame SURFACES (state error, note names it), survives the quiet-box re-stamp, clears on real data (10, hermetic, scripted fake websocket) |
| `python tests/ais_sources.py` | many AIS feeds, ONE merged picture: per-vessel provenance, the stale-position guard, AISHub fault-as-data + per-response format detection, endpoint specs, a real AIVDM sentence over TCP and UDP (26, hermetic) |
| `python tests/tide_note.py` | the tide card names ONE cause ONCE (8) |
| `python tests/docs_valid.py` | the generated documents are packages a reader will OPEN (7) |
| `python tests/http_contract.py` | BOTH servers: POST returns `(code, obj)`, GET commits its own response; nothing raises (22) |

**FOUR GENERATED DOCUMENTS in `docs/`** — quick start · operations · technical · development.
`cd tools && node build_docs.js` rebuilds all four; **never hand-edit a docx**. Shared
formatting in `tools/docx_kit.js`. Full table in "Keep docs current" below.

**THE LATEST WORK (this commit, 2026-08-05): MULTI-SOURCE AIS — many feeds, one merged
picture** (aishub + multi-endpoint nmea + opencpn sources, merge provenance, the
stale-position guard, and the collect-radius ordering fix). New suite
`tests/ais_sources.py` (26, 6/6 mutations). **See "MULTI-SOURCE AIS" below before
touching the AIS layer.** One new parked credential: AISHub membership (OPEN/NEXT).

**DOCS-ONLY COMMITS, 2026-08-05 (after the coverage thread) — THE PRESENTATION. No code
touched; the suites owe nothing here.**
- `528ab59` — **`docs/ASV-Console-Programming-by-Conversation.pptx` added** (graduate-level
  deck: this project + the DES schema from Andy's case-study series). **NOT generated** —
  see the exception note in "Keep docs current" before assuming `tools/` builds it. README's
  Documentation section updated in the same commit.
- `8370618` — `.gitignore` gains `~$*` (Office drops a lock file beside an open deck; with a
  pptx in `docs/` those would recur as untracked noise).
- `548d1eb` — **the deck gains an ASV effort-economics estimate** (now 14 slides):
  unaided professional ≈200 person-hours by the papers' own PERT method (10 components,
  tabled on its own slide; UI and test infrastructure dominate, not discovery) vs ≈30 h
  measured from the repo itself — 109 commits clustered into 27 bursts at a ≤60-min gap.
  ≈7×, smaller than the small tools' 10–16×, exactly the series' scaling caveat. The slide
  names the new bias plainly: the estimate was produced by the development agent grading
  its own work.
- (this commit) — **the deck generator moved INTO the repo: `tools/build_deck.js`**
  (Andy's call, reversing the scratchpad note `548d1eb` carried). `npm install` in
  `tools/` now covers it (pptxgenjs added); icons pre-rendered in `tools/deck_icons.json`
  with `build_deck_icons.js` to regenerate them. **Rebuild verified byte-identical** on
  `ppt/slides/*.xml` against the committed deck, so the rebuilt pptx was NOT committed —
  zip-timestamp noise, the same rule as the docx set. Full notes in "Keep docs current".

**THE SESSION JUST FINISHED ("ASV console refinement", 2026-08-02 → 08-04) — SEVENTEEN
commits.** Andy's scope was a POLISH pass: no new features; tighten, delete special cases,
verify by pixels, refresh docs. It ran well past that, because five faults he reported live
and four audits he asked for turned up real defects. **Read the first six entries below
before touching anything** — they are the ones a fresh context is most likely to undo.

**IF YOU READ ONLY ONE THING:** four of this session's bugs were things that LOOKED verified.
A green suite hid a server crashing on every request; a byte-identical hash hid four Word
documents that had never opened; a passing check compared two responses that were identical
because the registry was empty; another asserted a field was NAMED for km while it held nm.
**Verify against something entitled to refuse you** — a reader, a real Word, the server's own
stderr — not against the previous output.
- **the retired keep-right is deleted** — 595 lines, 10 % of `static/asv.html`.
  `keepRight`, `channelEndExtend`, `gateProject`, the colour system (`buoyageDir`,
  `buoyLaneAt`, `crossToLine`) and the write-only `lastBuoyage` had been left in place
  after the 2026-07-31 lane port as a recorded "lower risk" divergence; that divergence is
  now CLOSED and this matches the sibling. **No behaviour change** — nothing referenced
  them but each other, so no doc rebuild was owed. See "CHANNEL LANE".
  **Two things the cut exposed that the dead code had been hiding:** `planNogoRoute`'s
  descriptive comment had drifted 46 lines up onto `pairGates` (the gate-projection
  paragraph in between was what separated them), and `pairGates` — which is LIVE, for
  `channelSpanKeepouts` — had no comment of its own describing what it actually does.
  **Deleting dead code is not only tidying: it re-joins things the corpse was holding apart.**
- **one drag mechanism for the pop-out panels** — SIX panels (vessel card, SURV, LINES, AIS
  table, SRC, ROC) each carried a hand-copied drag: restore block, mousedown, a window
  mousemove and a window mouseup. Six copies meant **six handlers ran on every pointer
  move** so five could discover they were not dragging. Now one
  `makeDraggablePanel(el, head, {key, unanchor, ignore, persist})` + one `panelDrag` +
  ONE pair of window listeners. **The drift the copies had already produced: the SRC card
  never persisted its position** — its mouseup cleared the drag and saved nothing, so it
  was the one pop-out that forgot where you put it, while the ops manual had been
  promising since `3080e6a` that the console "remembers your card positions". Fixing the
  mechanism fixed the claim. New suite `tests/panel_drag.js` (11), **9 mutations verified**.
  Ops manual updated + rebuilt (the only docx that changed).
- **NONE OF THE FOUR WORD DOCUMENTS HAD EVER OPENED** (Andy tried to; Word refused all four).
  **Not a regression — broken since `2a28a59`, the day the first one was generated,** across
  eighteen commits. `CODE()` returns an ARRAY of paragraphs while every other helper returns
  one object, and every builder wrote `c.push(CODE([...]))`, pushing the array as ONE child.
  The serializer emitted it as the literal element **`<0/>`** — an element name cannot start
  with a digit — so `word/document.xml` was **not well-formed** and Word refused the file.
  **Worse than the validity error: the array's CONTENTS were dropped**, so every code block in
  every document was missing — the Quick Start did not contain `python asv_console.py --sim`,
  which is most of why it exists. Fixed by **flattening in `write()`** (`children.flat(Infinity)`),
  which repairs all six call sites at once and makes the next list-returning helper safe.
  **HOW IT SURVIVED, and this is mine to own:** the build printed `written: <name> N bytes`
  for every file; rebuilds never errored (a malformed child is still a valid ZIP entry); and
  **I repeatedly checked `word/document.xml` was BYTE-IDENTICAL across rebuilds and reported
  that as safety.** It was byte-identical. It was identically broken. **A hash proves
  STABILITY, never CORRECTNESS — compare against a READER, something entitled to refuse it.**
  New suite **`tests/docs_valid.py`** (7): every part well-formed, every part declared in
  `[Content_Types].xml`, every relationship target present, every `r:id` resolvable, **plus a
  CONTENT check** — filtering the arrays away instead of flattening yields four VALID
  documents with every code block still missing, and only the content check separates those.
  The expected code lines are **parsed out of the builders**, so a new block is covered the
  day it is written. **2 mutations verified.** Confirmed against real Word at both ends: the
  committed files were refused with "Word experienced an error trying to open the file"; the
  rebuilt ones open at 16 / 15 / 10 / 3 pages. **The hook's path filter did not cover `tools/`
  or `docs/`** — editing a builder ran nothing — now widened.
- **DOCUMENT CONTENT BROUGHT CURRENT** in the same pass (Andy's request). Ops manual: card
  height cap + lists patched in place (scroll and selection survive) + a new **7.3 on the two
  kinds of tide failure**, with 7.3 renumbered to 7.4. Technical manual: the **stale
  `AIS display radius` row claiming the display radius "also scales the upstream subscription;
  the two must move together"** — an invariant DELETED in `1166068` — replaced with the real
  `AIS_SHOW_RADIUS_KM` / `AIS_COLLECT_RADIUS_KM` pair; and **13.1's harness table is now
  DERIVED from `tests/`** (it said "Fourteen" when there were twenty — same list-beside-a-
  directory drift as the hook). Development guide: case study **8.6 "the deliverable nobody
  opened"**, and a fourth recurring defect shape, **6.4 "a check that cannot tell the bug from
  the fix"**, which this session hit three times (hash-vs-correctness, a filter test with
  nothing to filter, asserting a field's NAME instead of its VALUE).
- **AIS AT LEWES: "many vessels west, none in Delaware Bay" — THE CONFIG WAS FINE.** Andy
  asked for the aisstream configuration to be checked. **It is correct**, verified end to
  end: the subscription box is built as `[[lat_min,lon_min],[lat_max,lon_max]]` (what
  aisstream wants) and computes to `-77.24,37.17,-73.09,40.41` — covering the bay AND the
  Chesapeake; `_ingest` reads MetaData lat/lon with a body fallback, no swap or sign error;
  `Registry.snapshot`'s bbox test is right. **Then measured with his key against that exact
  box: 94 vessels, 101 reports in 90 s, no errors — and the NEAREST of all 94 was 81.6 km
  (44 nm).** Sector split W 59 / N 15 / NW 14 / NE 4 / SW 2, matching his report exactly;
  only 3 in the bay at all, 90–102 km up near the C&D canal. **aisstream simply has no
  receiver inside ~44 nm of Lewes** — not even the Cape May–Lewes ferry. Volunteer network,
  so coverage is where the volunteers are. **`--source` takes a COMMA-SEPARATED list and
  `nmea` already exists**, so `--source aisstream,nmea` + a local receiver is the answer if
  local traffic ever matters.
  **WHAT THAT EXPOSED, and what was fixed:** the card said `no vessels in 27 nm yet`, which
  **reads like a dead feed when the feed is healthy**. The client CANNOT tell the difference —
  the range filter runs on the SERVER, so the browser never sees what was excluded. The area
  block now carries **`nearest_km`** (nearest COLLECTED, from the loop that already measures
  every vessel — free), and the empty card reads `none within 27 nm · nearest 44 nm of 94
  tracked`. Still says `no vessels in … yet` when nothing is tracked anywhere, and a LAKE
  reports no nearest at all — there is no filter to widen, so offering one would be a lie.
  `ais_range.py` 15 → 20, **3 mutations verified**. Ops manual updated + rebuilt.
- **THE TIDE NOTE SAID ONE CAUSE TWICE** (Andy, live, on the ENV card): `no observed data
  (fetch failed: HTTP Error 502: Bad Gateway) · fetch failed: HTTP Error 502: Bad Gateway`.
  **The 502 was NOT ours** — every request shape the console sends was replayed against NOAA
  CO-OPS by hand and all four answered **200**, including the exact Lewes calls; a transient
  outage at their end. The console already degraded correctly (never raises, shows a note,
  and `drawTide()`'s success path resets both the text AND the colour, so it self-clears on
  the next good fetch — checked). **What was wrong was only what the operator had to read.**
  Observed and predicted are two independent calls to the SAME upstream, so one outage fails
  both identically and the note joined them verbatim. The repetition added nothing and
  **HID the fact that BOTH series were gone**, not just the observed one. Now
  `no observed data and no predictions (…)` — one sentence naming both losses and the single
  cause; two DIFFERENT failures are still reported separately. Split out as a pure
  `tide_note(past, pred)` so it runs with no network. New suite `tests/tide_note.py` (8),
  **5 mutations verified**.
  **A MUTATION-TESTING TRAP LEARNT HERE, and it applies to every Python suite:
  `__pycache__` can serve a STALE `.pyc`.** Rewriting `asv_console.py` repeatedly in a loop
  puts several versions inside the mtime granularity Python uses to validate its cache, so a
  run imports the PREVIOUS mutation's bytecode. Nothing crashes and nothing looks wrong —
  one mutation was graded against the wrong code and reported check 2 instead of check 1,
  and the same mechanism could report a live mutation as CAUGHT when the test never ran
  against it. **Set `PYTHONDONTWRITEBYTECODE=1` (or delete `__pycache__`) when mutating a
  Python source.** Confirmed by re-running with the cache disabled: the numbers then matched
  the isolated runs exactly. The JS suites are immune — Node has no equivalent on-disk cache.
- **THE AIS TRAFFIC LIST IS PATCHED, NOT REBUILT** (Andy: "blanks and rewrites every
  cycle"). `renderAisTable()` assigned `el.innerHTML` on every poll, so **every 8 s the whole
  body was destroyed and re-created**. Three costs at once, and the first is the one that
  actually hurts: the card is `.rsz` (`resize:both; overflow:auto`) so the list SCROLLS —
  rebuilding **reset the scroll position while you were reading it**; it **dropped any text
  selection** mid-copy of an MMSI; and it flashed. Rows are now keyed by **MMSI** and reused,
  only cells whose text CHANGED are written, re-sorting **moves** the node with `insertBefore`,
  and contacts that leave are removed. The row map is **derived from the DOM each cycle**, not
  kept alongside it — a parallel map would go stale the moment the card is closed and reopened.
  **`setCellText`'s guard is not an optimisation:** writing an identical string still collapses
  a selection inside that node, which is why a selection survives a poll where nothing changed.
  New suite `tests/ais_table.js` (9), **8 mutations verified**; live-verified in a browser for
  the parts source-shape cannot see (same node across a poll, `scrollTop` held at 90, the
  selection "VESSEL 5" intact, values still updating 1.5 → 6.9 nm, add/drop/re-sort, empty and
  refill). No doc change owed — the manual never described the flashing.
  **AND THE CARD HEIGHT IS NOW CAPPED** (Andy's call, same session). `max-width:96vw` had
  always said a card may not grow past the screen; **height had no cap at all**, so a card
  sized by its CONTENT ran off the bottom — those 40 contacts made it **797 px in a 720 px
  viewport** with the rest of the list unreachable. `max-height:82vh` on `.rsz` AND on the
  controls window's `.uicard` wrapper (the resizable element there, uncapped for the same
  reason). 82vh leaves room for the ~100 px cards sit down from the top, so a card at its
  normal place is fully visible **without `clampPanelPos` having to haul it upwards**.
  **THE TRAP IT WOULD HAVE FALLEN INTO:** `makeCardsResizable` wrote `el.style.maxHeight =
  "none"` on restore AND on mousedown, to release "the default height cap". **No card has ever
  carried a card-level max-height** — those live on the BODIES, which `.rszbody` already
  overrides — so it released nothing and was DEAD. It was harmless only while `.rsz` had no
  cap: inline beats a stylesheet rule, so **the first mousedown on any card would have uncapped
  it for good.** Both writes deleted; check 17 asserts no inline `maxHeight` write returns.
  Display-only, like the position clamp: a stored 900 px height renders at 590 and **stays
  900 px in storage**, so a taller monitor still honours it. `ui_split.js` 14 → 17.
- **THE AIS RANGE CONTROL READS IN NAUTICAL MILES** (Andy's call). The contact list had
  always reported range in nm via `fmtNm`, so a selector in km meant **filtering in one unit
  and reading distances in another**. Converted at the DISPLAY EDGE: `M_PER_NM = 1852` +
  `nmFromKm`/`kmFromNm`/`nmRound`; **the wire is untouched** — `/api/ais/radius` still takes
  `km`, `AIS_SHOW_RADIUS_KM` and the `--ais-radius-km` / `--ais-collect-km` flags are
  unchanged, and every wire field is still named `_km`. That is this console's standing units
  rule (chart tiles print feet, all data and maths are metric), and it is why the flags keep
  their names. Default is unchanged behaviour: 50 km opens the control at **27 nm**.
  **A SECOND FIELD SERVING TWO MASTERS, found on the way:** `area.name` was a real place name
  on a lake (`"Lake Erie"`) and the string `"%g km"` at sea — so the SERVER was choosing the
  client's display unit. The sea branch no longer sends `name` at all; `aisAreaLabel()`
  derives it from `show_km`, and the lake keeps the one name the client cannot derive.
  `tests/ais_range.py` 9 → 15, **6 mutations verified**. **The one that nearly got through:
  asserting only that the request body is KEYED `km` still passes when the raw nm value is
  posted** — type 27, the server stores 27 km, the field redraws as 15 nm. Silently wrong by
  1.852 with a plausible number on screen. Check 8e now asserts the conversion in BOTH
  directions. Ops manual updated + rebuilt (the only docx that changed); it also now records
  that the CLI flags stay in km.
- **one guarded way into `localStorage`** — sixteen hand-written `try`/`catch` blocks around
  `JSON.parse`/`stringify` across eight keys, now `lsGet`/`lsSet`/`lsDel`/`lsBool`. **The
  guard is not decoration:** `localStorage` throws on ACCESS where site data is blocked and
  `setItem` throws on quota, so one bare call takes out start-up — sixteen copies is sixteen
  chances to omit it. **The migration is the risk, and it is tested:** the three display
  toggles were stored as raw `"1"`/`"0"` predating the JSON store, so `lsBool` reads both
  (`JSON.parse` turns `"1"` into `1`). Nobody's saved toggles reset; verified in a browser
  seeded with legacy values, all three non-default. `lsGet` tests `== null`, NOT falsiness —
  the old `JSON.parse(...) || {}` could not tell a stored `false` from a missing key.
  New suite `tests/stored_settings.js` (11), **7 mutations verified**.
  **`panel_drag.js` check 10 failed on this change and was right to** — it named the raw
  `localStorage.setItem` shape; re-pointed at `lsSet` and re-mutated to confirm it still bites.
- **`/api/ais/radius` RAISED ON EVERY CALL** — Andy pasted the traceback from his running
  console. `_dispatch_post`'s contract is `(code, obj)`; that one handler was written in the
  `do_POST` style and did `return self._send(...)`, which returns **None** → `code, obj = None`.
  **`_send` had ALREADY written a correct 200 to the socket**, so the client saw a healthy
  response and the raise happened after — killing the handler thread and, quietly, skipping
  `LOG.command()`, so the session recorder has been missing every AIS radius change since
  `1166068`. Only site: the other ten `return self._send(...)` are in GET handlers, where
  returning None is right.
  **WHY THE SUITE WAS GREEN: `tests/ais_range.py` sent the console's stdout AND stderr to
  `DEVNULL`.** Check 7 asserted the clamp and got a correct answer, from a request that then
  crashed its thread. All three real-console harnesses did this. They now capture the server's
  output to a temp file (not a PIPE — nothing drains it, so a full buffer would hang the test)
  and assert **the console logged no exception**: `ais_range` 9, `live_speed` 10,
  `completion_modes` 11. Mutation-verified in all three, including restoring the exact
  shipped bug. **THE RULE: a client-side assertion cannot see a server that answers correctly
  and then dies. If a test drives a real process, read that process's output.**
- **AUDITED THE OTHER POST HANDLERS** (Andy asked; the answer is that `/api/ais/radius` was
  the only one). Done three ways, because a grep only finds the shape you already know:
  **AST** — all 29 returns in `_dispatch_post` are 2-tuples, it is the only function whose
  result is unpacked into two names, and no GET handler returns a tuple nobody sends (the
  mirror bug); **reachability** — the function cannot fall off the end and return `None`
  implicitly; **live** — all 26 endpoints plus 11 ROC ops POSTed against a real console, all
  answered, server log clean. Kept as `tests/post_contract.py` (10) — **renamed to
  `tests/http_contract.py` in the very next commit** when the GET side joined it, so that is
  the file on disk — which **parses the endpoint list out of the source**, so a new POST
  route is covered the day it is added.
  **Checks 7 and 10 do not subsume each other:** a raise BEFORE the response leaves the
  client with nothing (7 sees it); a raise AFTER `_send` has already answered — the bug that
  shipped — is invisible to every client-side check and only the server log shows it (10).
  **Mutation-writing gotcha recorded there:** the handlers are an `if path == …: return`
  chain, so a raise injected before the branch that already handles that path is unreachable
  and the mutation silently does nothing — my first attempt looked like a surviving mutant.
- **AUDITED THE GET HANDLERS TOO** (Andy asked; also clean — no source change). **The GET
  contract is the MIRROR of the POST one:** `do_GET` and its `_serve_*` helpers are VOID and
  each must commit its OWN response. On the POST side *sending* is the mistake; on the GET
  side *not sending* is. Suite renamed `post_contract.py` → **`tests/http_contract.py`** (16),
  covering both — the question is the same and both halves share one console.
  Checked: every path of all 7 GET handlers commits a response; the dispatch chain ends in an
  `else` (an unmatched GET would otherwise commit nothing); all 25 routes incl. the
  400/404 branches answered live; the SSE stream commits headers + a first frame.
  **FALSE POSITIVE WORTH NOT RE-DERIVING:** the first analysis flagged `_serve_tile` and
  `_serve_events` as non-responding. They are fine — a **binary PNG** and an **endless SSE
  body** cannot go through `_send`, so they use raw `send_response`/`end_headers`/`wfile.write`.
  **`end_headers` is the moment a response is committed** and must be in the sender set.
  **Three PAIRS of checks that look redundant and are not** (each half verified by its own
  mutation): **10 vs 16** — a raise BEFORE the response leaves the client with nothing; a raise
  AFTER `_send` is invisible to any client check. **13 vs 14** — a handler that RETURNS without
  sending closes the connection (no response); one that BLOCKS looks like a slow request; only
  a `sleep` produces 14. **6 vs 13** — static reads paths no request reaches, live catches what
  the analysis is too coarse to see.
- **`ais_service.py` AUDITED TOO — and it produced the one real FINDING of the three audits.**
  A SECOND HTTP server, own process, own port, so nothing in the console's checks covered it.
  Structurally clean (GET-only, every path sends, unconditional 404 fall-through; `bbox`/`max`
  guards hold against nan/inf/bad arity). **But its query parser never percent-decoded**, so
  `?bbox=1%2C2%2C3%2C4` — a legal spelling — was silently dropped and the caller got the
  **WHOLE registry instead of the box**. Not a live bug (the console sends plain commas) but
  the wrong way to fail. Fixed with `urllib.parse.unquote`, strictly more permissive; the
  explicit `import urllib.parse` matters because it was only arriving via `urllib.request`.
  Suite 16 → 22, now covering both servers.
  **THE TEST LESSON, the sharpest of the session:** my first check 20 compared the two
  responses over the wire and **PASSED with the fix reverted** — with no AIS source the
  registry is EMPTY, so a dropped box and an honoured one both return zero vessels,
  byte-identical. It now runs the real parsing code on both spellings. **When a fix changes a
  FILTER, a test with nothing to filter cannot see it.**
  **AND A MUTATION TRAP:** `asv_console.py` is **LF**, `ais_service.py` is **CRLF** — a
  multi-line anchor written with `\n` matches one and not the other. Two mutations reported
  SKIP; only because the runner scores a missing anchor as SKIP rather than "caught" did that
  surface instead of reading as clean passes.
- **`roc_tracks.py` + `gps_sim.py` AUDITED — a second real finding, and a worse one.**
  Not HTTP, so the contract differs: **a background thread must survive bad input.**
  `gps_sim.py` is CLEAN (`TcpServer` reaps dead clients under its lock, `_accept` handles
  `OSError`; its fixes round-trip through `parse_nmea` to <4 cm at the poles, the dateline and
  a negative course). **`parse_nmea` was NOT:** speed and course used a bare `float()` while
  the position fields beside them used `_nmea_deg`'s guard — **one function, two standards.**
  A **checksum-VALID** sentence can still carry rubbish (8-bit XOR, ~1 corruption in 256
  passes; a flaky receiver can checksum an already-mangled buffer), so `float("abc")` raised,
  unwound `GpsFeed`'s read loop, closed the socket, and was swallowed by `run()`'s catch-all —
  **THE GPS LINK DROPPED and reconnected 3 s later.** Measured before: **2 TCP connections,
  6 of 8 fixes**; after: **1, all of them.** Fixed with `_nmea_float` (garbage → `None`,
  exactly as an empty field already behaved — a bad speed is no reason to bin a good
  position), plus a `try` in `_emit` as a **blast-radius limit at the thread boundary** (not a
  duplicate guard: that feed can be driving a moving HOME for a boat recovering to a
  mothership, so one malformed line must cost one line).
  **THE TWO LAYERS WERE EARNED SEPARATELY — the technique worth reusing:** revert the parser
  fix with the `_emit` guard PRESENT and 18/19 fail but **21 still passes** (the guard held the
  link); remove BOTH and 21 fails too. Removing the guard ALONE survives, and that is correct —
  with the parser honouring its contract there is nothing left to catch.
  **A GAP THE ROUND-TRIP COULD NOT SEE:** dropping `%07.4f`'s zero-pad survived every check,
  because `parse_nmea` splits at a fixed offset and still reads it — malformed on the wire,
  fine for its sibling. Check 23 asserts NMEA's fixed widths directly. 17 → 23 assertions.
- **THE VESSEL CARD WAS ABSENT FROM THE CHART** (Andy, live). **Not hidden and not broken —
  `display:block`, fully live, at a position saved when the window was bigger, sitting
  outside the viewport.** The DRAG had always clamped to the chart; **RESTORE never did**, so
  a position from a larger window or a second monitor came back verbatim. Pre-existing, not
  from the drag consolidation — `git show e0e3e8c^` has the same unclamped restore — but the
  consolidation is why there was one place to fix it for all six pop-outs. **The vessel card
  was the cruel case: `placeVcard()` puts its VESSEL reopen pill at the SAME coordinates, so
  the one control that brings the card back went off-screen with it.** Now `clampPanelPos` +
  `placePanel`, shared by restore, drag and a new `resize` listener.
  **Three properties worth keeping:** the clamp is **DISPLAY-ONLY** (a card parked at a big
  monitor's edge returns there when the window is big again); the resize re-clamp re-derives
  from **STORAGE, not the DOM**, or it would RATCHET; and `placeVcard` **sets visibility
  BEFORE measuring**, because a `display:none` card measures 0×0 and would be clamped by the
  sliver rule on the very reveal meant to rescue it — I shipped that bug and caught it by
  measuring in the browser, and check 20 now guards the ordering.
  `tests/panel_drag.js` 11 → 20, **8 mutations verified**. Ops manual updated + rebuilt (the
  other three docs' `word/document.xml` are byte-identical, so only that one is committed).
- **`showPanel()` — ONE way to show a floating panel** (closes the residual above, Andy's
  call). The pop-outs were shown from **SEVEN** bare `style.display = …` sites — I found five
  on the first sweep and the grep caught two more ROC auto-opens — so a panel restored while
  hidden kept the 0×0 sliver clamp and revealed with only a corner on the chart. `showPanel`
  shows AND re-clamps, **in that order**. It does **not** persist: a reveal only tightens what
  is on screen now, so the operator's stored position still governs the next restore.
  `clampPanelPos` + `PANEL_MIN_VIS` **moved up beside `mapEl`** — `showPanel` is called from
  `setMode` and toolbar handlers that can run before the pop-out section executes, and a
  `const` read before its declaration is a **ReferenceError, not `undefined`**. Note
  `#v_mission` is a SECTION of the vessel card, not a pop-out — it keeps its own
  `style.display`. `tests/panel_drag.js` 20 → 23, **5 more mutations verified**; check 21
  derives the panel list from the registrations, so a seventh pop-out is covered the day it
  is registered. Live: every keyed pop-out seeded at `{4000,3000}` while hidden now reveals
  FULLY inside the chart.
- **the lane fact travels WITH its route** — `channelLaneRoute` now returns `{route, lane}`
  and `buoyageNote(lane)` takes it as an argument; the module flag `lastChannelLane` is gone.
  I raised the stale flag as *inert* (a refusal returns before any reader) — **it was not.**
  Looking properly found a SECOND, live fault in the same flag: `routePlan` calls
  `channelLaneRoute` ONCE PER LEG, and the reset at the top of that function meant only the
  **last leg counted**. Proven at Lewes on the real ENC — a transit out of the canal into
  Delaware Bay rides the lane on leg 0 and open water on legs 1–2; the plan now reports
  `true`, **the old flag would have said `false`** and dropped the Rule 9 note from a
  transit that genuinely rode the lane. `routePlan` accumulates (`lane ||= kr.lane`) and
  returns it; the two search/survey call sites that only ever wanted the array take
  `.route`. `laneUsed` remains as scratch that `channelLaneRoute` resets and consumes on the
  same tick — **nothing outside it may read that variable**, which is what makes the
  staleness structurally impossible. `tests/buoy_lane.js` +3 (14): the lane is reported,
  is not reported in open water, and **a lane plan followed by an open-water plan does not
  inherit the lane** — mutation-verified by restoring the old no-reset design, which fails
  exactly that check. The ops manual already promised the banner reports "whether it rode a
  channel lane", so **again the doc was right and the code was wrong** — no rebuild owed.
  **Lesson: "inert today" is a claim about every reader, present and future. Check it by
  looking at the producer, not the reader** — the producer had a second bug the reader
  audit would never have found.
- **the pre-commit path filter named its suites individually and had drifted** — five
  (`wreck_clearance`, `water_trust`, `ais_range`, `live_speed`, `completion_modes`) were
  never listed, so editing one of them ALONE ran nothing. Replaced with `*tests/*`. Same
  shape as the panels and the suite counts: **a hand-maintained list beside a directory
  that already answers the question.**

**A TEST-DESIGN LESSON FROM THIS SESSION, and it applies to all twenty suites.** The first
`stored_settings.js` called the helpers directly. Stripping `lsGet`'s `try`/`catch` — the
exact fault check 4 exists for — made check **3** throw and killed the process before check 4
ran, so **no `FAIL` line was printed at all and the mutation runner scored it as SURVIVED**.
The suite now evaluates every condition as a thunk and reports a throw as a failed check.
Two rules fall out, both cheap:
- **A HARNESS THAT CANNOT SURVIVE THE FAULT IT TESTS FOR CANNOT REPORT IT.** If a check
  proves a function does not throw, calling that function unguarded elsewhere in the same
  file makes the proof unreachable.
- **A MUTATION RUNNER MUST SCORE A CRASH SEPARATELY FROM A PASS.** "No FAIL lines" and "the
  process died" look identical if you only parse stdout. This is the same rule the hook
  already states for suites — treat a crash as loudly as a failure — applied to the thing
  that grades the suites.
- **TESTING A PURE HELPER DOES NOT TEST THAT ANYTHING CALLS IT.** Six assertions exercised
  `clampPanelPos` directly and all six stayed green when the clamp was ripped out of
  `placePanel` — the reported fault restored, undetected. Checks 18–19 assert the CALLER.
  Same family as the `completion_modes` lesson: preserving a value and honouring it are two
  assertions. **And prefer naming the paths to counting them** — check 9 counted
  "`>= 2` unanchor call sites" and stayed green when the restore path lost its one, because
  a third site elsewhere covered the count. **An ORDERING check has the same failure mode:**
  comparing `indexOf("style.display")` against the clamp passed a mutation that moved the
  real write after it, because an earlier write in a guard clause satisfied the first index.
  Compare the **LAST** occurrence.

**Previous session (2026-08-01 → 08-02), fifteen commits, all with sections below:**
- **vessel card off the controls window** — it was bridged, so one card rendered in BOTH
  windows. Now chart-window only; top bar untouched by request. New suite
  `tests/ui_split.js` (9), which also turns "every bridged selector resolves" from a
  sentence into a test.
- **AIS range control** — a live range control on the AIS card. **Andy's design: collect
  wide (150 km), filter narrow (50 km default), never on a lake.** That DELETES the old
  "subscription and query must move together" invariant instead of working around it. New
  suite `tests/ais_range.py` (8).
- **live speed** — SOG did not follow a speed change because the commanded speed reached the
  boat ONLY via `upload_plan`. There was no speed command AT ALL: no seam method, no Engine
  method, no endpoint. Added `set_speed` through the whole seam (+ honest `RealVcu` refusal),
  `/api/cmd/speed`, and `speed_key`/`speed_target_kn` on the state. New suite
  `tests/live_speed.py` (10, drives a real console). **First commit under the folded-handoff
  rule.**
- `f382b85` **plan speed is an INPUT to the plan, not a label on it** — Punch Out already
  advises "widen the lines or slow down"; acting on that advice recomputed **nothing**.
  `recalcForSpeed()` re-punches a drawn pattern (live: 7 teardrops → 7 semicircles, routed
  length 0.63 → 0.44 → 1.27 km across survey → low → high); a COMMITTED plan can't be
  re-punched, so durations are recomputed and the spacing re-checked against the new turn
  radius. **Asymmetric on purpose: slowing down is always safe, speeding up can make a
  committed reversal untrackable while the chart looks identical.** End-of-plan's "applies
  on the next Upload" was half true in the dangerous direction — the SETTING is live.
  New suite `tests/speed_recalc.js` (10). **Two gaps the live run found:** durations blanked
  at `Add to plan`, and the warning never cleared when you slowed back down.
- `d832456` **the survey card keeps describing a committed plan** — Andy reported it going
  blank "after uploading"; the blanking is actually at **`Add to plan`**, one step earlier,
  because `resetPattern()` drops the anchors every figure was derived from. **Reproduce the
  operator's CASE, not their diagnosis.** `committedPatternInfo()` now DERIVES the figures
  from `mission.lines` instead of snapshotting them — which forced out two bugs a snapshot
  would have hidden: `planKind` is unreliable after a refresh, and the line direction came
  back as the RECIPROCAL (typed 327, card read 147). New suite `tests/survey_card.js` (11).
- `3080e6a` **documentation set** — there was one generated document, for engineers; Andy
  asked for three more readers to be served. **Quick Start** (976 w, ~20 min to a running
  survey, deliberately ruthless — don't grow it), **Operations Manual** (5,487 w, 17 ch, the
  person at the console with a vessel in the water), **Development Guide** (3,523 w, 10 ch,
  how the project is BUILT AND VERIFIED, since the tech manual covers what it is — including
  five case studies kept because each is a CLASS). Helpers extracted to `tools/docx_kit.js`;
  **the tech manual's `word/document.xml` is byte-identical across that extraction**, which
  is the only reason the refactor was safe — re-verify the same way if you touch the kit.
- `3c8fd9e` **sanitization — the sibling console's identity is out of the core.** Andy's call
  on the long-standing flag; **the line is now written down** (top of this file) instead of
  being re-argued. Five core sites cleared, not the four the old note claimed, and it had
  stale line numbers too — hence the standing `grep`. The sweep also found `buoy_lane.js`
  naming two source files **that do not exist in this repo**, and `turn_geometry.js`'s
  `const ZBOAT` labelled `"4 m USV"` when those are `zboat_1800hs`'s numbers and that hull
  is **1.9 m** — a mislabel that had propagated into this file and README.md. Data
  untouched; all 21 turn assertions unchanged.
- `e070350` **the survey move grip was drawn, live, and invisible** — Andy asked for the SURV
  whole-pattern handle to be ported from the sibling. **It already was, byte-identical and
  working**; it was drawn inside `drawPattern()` (early) and the boat marker (late) painted
  over it, and the boat sits at the A-B midpoint whenever you draw the box around it.
  Measured: **0 grip pixels on the boat, 70 off it.** Now drawn last, haloed, and finally
  named in the SURV hint — which was the one thing the port actually missed. New suite
  `tests/pattern_move_grip.js` (7). **DIVERGENCE FROM THE SIBLING — see that section.**
- `8669230` **the cards say what the boat is actually going to do** — three readout faults
  Andy reported, all the same shape. (a) **END ACTION**: an end-of-plan RTH now reads `rth`
  on a Go-To / Transit / Survey from the START of the run, and is *not* promised when the
  chain cannot fire. Found while verifying it: **the chain's one-shot never re-armed for a
  run commanded while already under way**, so it held at its endpoint indefinitely.
  (b) the **Mission card is now a section of the vessel-status card** (`#missionPanel` gone;
  the old `Run mode` row deleted as the duplicate it was). (c) the **Nogo row was stuck on
  "loading…"** — a repaint painted one statement too early, on the one path that ends in a
  working model; it now names its state. New suites `tests/end_action.js` (16) and
  `tests/nogo_readout.js` (15). **Live-verified in a real browser, both windows.**
- `2a28a59` **ROC + moving HOME** ported from the sibling (`roc_tracks.py`, `/api/roc`,
  ROC card, RTH chases a mothership), plus `gps_sim.py`, the **Mission card**, the
  **SURV move grip** (old parity gap, now closed), and the **docs set** —
  `tools/build_tech_manual.js` → `docs/asv-simulator-technical-manual.docx`, 15 chapters,
  generated, brand-free. ROC was made **vessel-aware** (standoff scales off LOA; a
  closing check against the vessel's top speed).
- `494f048` **charted point hazards have an EXTENT** — a wreck was a buffer-sized dot,
  so a Go-To planned over one off Lewes. Both the exact check and the A* raster fixed.
- `7151149` **end-of-plan setting vs run completion** — a conflated field meant a Go-To
  overwrote "End of Plan: RTH" with loiter. Split; no Engine method writes the setting.
- `2388856` **default vessel → `drix08`**. The default also decides AIS start-up scope
  and the tide station, so an Erie default pointed both at the wrong water.
- `055373f` + `21d7810` **water level earns trust by distance** — ghosted when the
  station is far, and **not applied to charted depths** when it is remote.

**THE RECURRING THEME, worth carrying forward:** every bug this session was one value
serving two masters, or one value trusted without its provenance. Vessel-derived
constants going stale on a switch (`apply_vessel` must re-derive — see `HULL_A_LAT`,
the ROC standoff, the nogo buffer floor); a persistent setting clobbered by a transient
one; chart data trusted without its extent or its distance. Check for that shape first.

**THE ANTIDOTE, and it is cheap (`d832456`): DERIVE, DON'T REMEMBER.** A value read back
off the thing it describes cannot drift from it, survives a reload for free, and follows
later edits. The survey card's obvious fix was to snapshot the pattern figures on commit;
deriving them from `mission.lines` instead **forced out two bugs the snapshot would have
hidden** — `planKind` is unreliable after a refresh, and the derived direction came back
as the RECIPROCAL, which only showed up because it had to agree with the typed value.
Prefer derivation wherever the source of truth is already in hand, and make the derivation
**self-validating** (the card checks the lines really ARE parallel) rather than trusting a
flag alongside it.

**THE READOUT COROLLARY (`8669230`, three instances in one pass):** a card can be
perfectly accurate about its own field and still be **wrong about the boat**. Ask what
question the operator is actually reading the row for, then check whether any field
answers it — "where does this run leave the boat" had no field at all, and "loading…"
answered "what is the console doing" with a word that fit four different states. Two
mechanics behind it, both worth checking directly: a **paint taken before the flag it
reads was cleared** (the Nogo row; the success path was the one that never repainted),
and an **edge-triggered reset for a condition that is not edge-shaped** (the RTH
one-shot re-armed on idle→running, but "a new run" does not always cross that edge).
`e070350` added a third: a **control painted before something that covers it** (the move
grip under the boat marker). `d832456` a fourth: a **readout whose only source was thrown
away by a normal step in the workflow** (the survey card, blanked by the `resetPattern()`
inside `Add to plan`). All four were live, correct, and unusable.

**AND A DIAGNOSTIC HABIT WORTH THE SAME WEIGHT:** Andy reported the survey card blanking
"after uploading". It blanks at `Add to plan`, one step earlier — upload was simply when he
noticed. **Reproduce the operator's CASE, not their diagnosis.** Their account of *when*
is a clue about where to look, never the answer.

**AND THE PORT COROLLARY (`e070350`):** a clean diff is not evidence a UI port works. That
grip was byte-identical to the sibling's and the feature was still missing. **Verify a UI
port by looking at the pixels** — `getImageData` at a known screen point costs one tool
call, works on the animating canvas where screenshots time out, and answered in a minute
what the diff had already said was fine. Ask "can the operator SEE it and REACH it", not
"is the code here".

**OPEN / NEXT:**
- **ROUTE COVERAGE, remainder.** The estop_chain audit found 20 of 33 routes untested;
  covered since: E-STOP, the five in `run_link_control.py` (transit/pause/reset/connect/
  disconnect), `sethome` + `spawn` in `home_spawn.py` — which also drives `rth`'s
  happy path (closes on home) for the first time — and `energy` + `chartinfo` in
  `energy_chartinfo.py`, and `enc` in `enc_extract.py` (2026-08-05, which also
  DEDUPLICATED the chartinfo twin: `_bbox_key` + `_bbox_from_query` now serve both
  endpoints, and shared-helper mutations are run against BOTH suites). Still open, all
  lower-consequence data/plumbing routes: `logevent`, `logs`, `vessels`, `comms`,
  ~~`tide`, `roc`~~ — ALL FOUR remaining surfaces covered in `data_routes.py`
  2026-08-05; THE COVERAGE THREAD IS COMPLETE (see the section above) — `logevent` +
  `logs` + `log` covered in `log_routes.py` 2026-08-05 (logging ON — the --no-log mask
  was the coverage hole), which also fixed the kwargs-collision defect — `env` +
  `waterlevel` covered in `env_water.py` 2026-08-05, which also fixed the
  dropped-connection defect on bad manual_offset input. NOTE `/api/enc` and `/api/chartinfo` are GETs — an earlier arithmetic here
  counted them among POST routes off a grep of the string literal. If continuing, keep
  the estop_chain rule: pick by CONSEQUENCE, and drive a real console for anything
  whose failure is an interaction.
- **BLOCKED, WAITING ON ANDY — MARINETRAFFIC AIS.** He is negotiating API access under
  `andy.mcleod@unh.edu` and said **"hold this for now"**. Nothing has been built. When it
  lands, two things are needed before a line is written: **(1) which service is enabled** on
  the account, and **(2) one sample response with the key REDACTED** — the response shape
  differs per service and a wrong guess costs real metered credits to discover.
  **There is no password**: MarineTraffic authenticates with an API KEY in the URL. Supply it
  as `$MARINETRAFFIC_KEY` (the `$AISSTREAM_KEY` pattern) or a gitignored key file — never in
  chat. **Design note already settled:** aisstream PUSHES over a websocket and costs nothing
  per message; MarineTraffic is PULL and metered, so the source must poll on a minutes-scale
  interval. The architecture already allows that — the service holds a registry and the
  console reads *that*, so the upstream poll rate is independent of the card's 8 s refresh.
  `--source` is comma-separated, so it can run **alongside** aisstream.
- **PARKED — AISHUB MEMBERSHIP (2026-08-05).** The `aishub` source is built, tested and
  skipped-with-a-note until a member username exists (`setx AISHUB_USER ...` or
  `--aishub-user`). Membership is earned by CONTRIBUTING a feed to aishub.net — i.e. it
  needs a local receiver actually feeding them first. Do not poll their API on guessed
  credentials; the refusal is measured and surfaced already.
- **WHY he is switching, measured, don't re-litigate:** aisstream has **no receiver within
  44 nm of Lewes**. Ran 90 s against the real subscription box with his key: 94 vessels, 101
  reports, no errors — and the nearest of all 94 was 81.6 km. Sector split W 59 / N 15 /
  NW 14. Not even the Cape May–Lewes ferry is in the feed. **The configuration is correct**;
  it is a volunteer-receiver coverage hole. A local receiver via `--source aisstream,nmea` is
  the only thing that will show local traffic.
- ~~ABORTED: the GLOBAL km↔nm units selector~~ — **BUILT 2026-08-04, Andy's choice for the
  "ASV console refinement 1" session** (he picked it from the offered options, which
  supersedes the earlier abort). Shipped to his two recorded decisions exactly: LONG
  distances only, one DIST pill on the top status bar. See "THE km↔nm DISTANCE DISPLAY"
  section for what must not regress.
- **THE DOC BURDEN QUADRUPLED** (`3080e6a`) **AND THE DOCS WERE BROKEN THE WHOLE TIME**
  (`15cf36a`). A user-facing change has FOUR generated documents plus three READMEs, and the
  **operations manual is the operator-facing source of truth** — a new control, a changed
  refusal, a new readout state or a new safety behaviour belongs in it, and
  `cd tools && node build_docs.js` must run in the SAME commit. The quick start is
  deliberately thin: **point into the ops manual, don't grow it.**
  **`tests/docs_valid.py` now proves the output is openable** — it did not exist while all
  four documents were malformed for three days. When you rebuild, only commit a docx whose
  `word/document.xml` actually CHANGED; the others differ by zip timestamp alone and are
  noise in the diff. Compare with:
  `python -c "import zipfile,hashlib;print(hashlib.sha256(zipfile.ZipFile(P).read('word/document.xml')).hexdigest())"`
- **`rearmRthChain()` is a BEHAVIOUR change, not just a display one** (`8669230`). A run
  commanded while the boat is already under way now gets its own end-of-plan RTH, where
  before it silently got none. Correct, and Andy has run it — but if an RTH ever looks
  more eager than expected, that function is the first place to look.
- **Payloads / sonar NOT ported** (Andy's call). It needs a vessel-declared `payloads`
  block first; the sibling's single-beam console is built from vendor manual citations
  and proprietary telegrams that this console's rules forbid.
- **The sibling's teardrop branch is undriven** — reachable only at high speed under
  8.3 m line spacing. Low risk, but the 2026-07-20 lesson stands: static `legClear` does
  not catch follow overshoot.
- Residual, by design: chart datum is the LOW-water reference, so a real tide BELOW datum
  leaves charted depths optimistic. The manual override is the answer.
- ~~RESIDUAL: hidden pop-outs clamped by the 0×0 sliver rule on reveal~~ — **STALE, DO NOT
  REBUILD IT** (caught 2026-08-04): this entry described the state at `ae4eceb`, one commit
  before `2aef779` **closed it** — `showPanel()` IS the "reveal hook the six show sites all
  pass through", and it shows-then-re-clamps in that order precisely so the panel measures
  its real size. The only true residual is narrower and invisible to the operator:
  `placePanel()` at registration still clamps a hidden panel against the 120 px fallback,
  and `showPanel` corrects it on reveal.
- **MUTATION-TESTING GOTCHAS, all three cost a false result this session.** Set
  **`PYTHONDONTWRITEBYTECODE=1`** when mutating a Python source — rapid rewrites fall inside
  the mtime granularity and a run imports the PREVIOUS mutation's `.pyc`. **`asv_console.py`
  is LF, `ais_service.py` is CRLF** — a multi-line anchor written with `\n` matches one and
  not the other. And a runner **must score a missing anchor as SKIP and a crash as its own
  outcome**, never as "caught": "no FAIL lines" and "the process died" look identical if you
  only parse stdout.

## MULTI-SOURCE AIS — MANY FEEDS, ONE MERGED PICTURE (2026-08-05)

Andy's ask: "multiple source feeds merged into a single display source", naming AISHub,
AIS-catcher, rtl-ais and OpenCPN. The service already had the right shape — every source
writes one MMSI-keyed `Registry` — so this build-out added SOURCES and made the merge honest.

**What was built (`ais_service.py` + console pass-throughs + card logic):**
- **`aishub`** — HTTP poll at AISHub's hard 1-req/min limit (65 s; 15 min after an auth
  refusal). **Faults arrive AS DATA on HTTP 200** (`[{"ERROR":true,...}]` — measured live:
  `Invalid username or password!`) and are surfaced in the upstream's words, never ingested
  as an empty sea — the aisstream error-frame lesson, third instance. **Response format
  (human units vs raw AIS units) is detected ONCE PER RESPONSE from the coordinates**, then
  scales every field — field-by-field guessing cannot work, a raw SOG of 74 (7.4 kn) is
  indistinguishable from 74 kn on its own.
- **multi-endpoint `nmea`** — repeat `--nmea udp:PORT | tcp:HOST:PORT` (console:
  `--ais-nmea`); one source per endpoint, each named (`nmea-udp-10110`) with its own health.
  AIS-catcher and rtl-ais both emit AIVDM over UDP — `udp` BINDS; `tcp` CONNECTS to a
  served stream. A bad spec REFUSES loudly (`_parse_nmea_spec`), never binds the wrong thing.
- **`opencpn`** — a NAMED TCP client source (subclass of NmeaSource) for OpenCPN's relay:
  Options → Connections → Add → Network/TCP, port 10110, Output enabled. Console:
  `--ais-opencpn [HOST:]PORT`. Nothing OpenCPN-specific on the wire; the name is provenance.
- **Merge provenance + the stale-position guard** (`Registry.update`): per-vessel `srcs` =
  every feed that reported it; `src` = the feed whose POSITION is displayed; a polled report
  with `pos_time` OLDER than the held position drops its position fields (statics still
  merge) — a 1-min AISHub poll can never walk a live receiver track backwards.
- **`auto` expands IN PLACE** in a comma list (`auto,opencpn` keeps both) and appends
  `aishub` when `$AISHUB_USER` exists. **Naming an endpoint enables its source** — the
  console appends `nmea`/`opencpn` to `--ais-source` when `--ais-nmea`/`--ais-opencpn` given.
- **Card logic** (`asv.html`): the named source is the healthiest by preference order
  (prefix-matched so `nmea-udp-*` reads as a local receiver); the layer reads "error" ONLY
  when EVERY source errors — one dead feed beside a live one is a note, not an outage.

**A LIVE ORDERING DEFECT FIXED ON THE WAY:** `main()` applied `--ais-collect-km` AFTER
`_start_ais_service()`, so a widened collect radius never widened the FIRST subscription —
only the one rebuilt after a vessel switch. The radii and source flags now settle before
the child starts (and `_rescope_ais_service` reproduces the same config from module globals).

**Machine recon (2026-08-05):** OpenCPN 5.10.2 IS installed (`C:\Program Files\OpenCPN`)
but has never been configured — no connections in its config, so its Output relay needs the
4 clicks above before `--ais-opencpn` has anything to read. AIS-catcher / rtl-ais are NOT
installed (no RTL-SDR path exercised); their UDP path is verified synthetically. AISHub API
probed live: answers, and refuses without a member username — **membership requires
CONTRIBUTING a feed**, so like MarineTraffic this is PARKED until Andy has an account
(`setx AISHUB_USER ...`; it is a username, not a secret, but still never hardcoded).

**Verification:** `tests/ais_sources.py` (26 assertions, hermetic — fake AISHub HTTP
server, loopback TCP/UDP, the canonical GPSd AIVDM sentence: MMSI exact, position range
checked, and my remembered "Vancouver" coordinates were WRONG — it decodes to 47.58 N
Seattle; the fixture originally mixed human+raw units in one response, contradicting the
uniform-format premise the detector rests on — both fixture bugs, not code bugs).
**6/6 mutations caught** (stale guard, error-head swallow, format detection, proto
honoured, provenance, opencpn label), source restored byte-for-byte, runner table in the
docstring. **Live end-to-end:** a real console with `--ais-nmea udp:31399` + a crafted
AIVDM sentence at Lewes → `/api/ais` returned the vessel (decode exact, `src`
`nmea-udp-31399`, range 2.5 km); browser-driven check on a scratch console: card reads
`● 2 vessels · 27 nm · nmea-udp-31388`, label "(local receiver)" via the prefix match.
All AIS-adjacent suites green (`ais_range`, `ais_error_frames`, `ais_table`,
`http_contract`, `data_routes`). Ops + tech manuals updated and rebuilt (the only two
docx that changed); README AIS section rewritten for the merge model.

## THE EMPTY AISSTREAM FEED, AND THE ERROR-FRAME SWALLOW (2026-08-05)

Andy: “check aisstream. no vessels to 81nm seems strange.” He was right — the baseline
measured 2026-08-04 was 94 vessels / nearest 44 nm on this exact geography, and 81 nm is
just the 150 km collect radius in nm: the display was maxed over an EMPTY registry.

**THE DIAGNOSIS CHAIN, each link verified live (keep the technique):** console healthy at
Lewes → service child running with the CORRECT key (`auto → aisstream`) and the CORRECT
box (byte-identical to the proven-good subscription) → fresh service instance: connected,
zero reports → the proven-instant NY/NJ box: zero → a RAW-SOCKET probe printing every
frame verbatim: handshake accepted, subscription accepted, then pure silence — no data,
no error frame, no close → **whole-world, filterless: zero frames in 60 s**, which rules
out geography, box format and message filter in one stroke. **VERDICT: upstream —
aisstream delivering nothing on this key that day.** Discriminator if it recurs: mint a
second free key; silence on a fresh key = their outage, traffic on it = this key flagged.
**ALSO MEASURED: aisstream rate-limits connections PER KEY** — a fourth simultaneous
connection got `429 Too Many Requests` on the handshake. `$AISSTREAM_KEY` is
machine-wide, so the ASV and Z-Boat consoles CONTEND if both run AIS at once.

**THE FIX THE INVESTIGATION FORCED OUT (Andy's call): the error-frame swallow.**
aisstream reports faults — “Api Key Is Not Valid”, connection limits — as a TEXT frame
`{"error": ...}` on the SAME channel as vessel data. The read loop stamped “ok /
connected” on ANY frame and passed it to `_ingest`, whose no-MMSI discard dropped it
silently; and the quiet-box timeout path re-stamps its note every 30 s, so even a
surfaced error would have been overwritten moments later. **A dead key read as a quiet
sea, forever.** Now: `_frame_error()` classifies (MetaData = vessel data whatever other
keys it carries), the loop surfaces `aisstream: <message>` as state “error”, the timeout
path HOLDS a remembered error instead of erasing it, and real data flowing clears it.
`tests/ais_error_frames.py` (10 assertions, hermetic — the REAL run() loop driven
through a scripted fake websocket, no network, no console; 4/4 mutations caught incl.
the swallow restored). Ops manual: the empty-card taxonomy gains its third kind — an
upstream-named fault is never displayed as a quiet sea.

## THE ROUTE-COVERAGE THREAD IS COMPLETE — vessels/comms/tide/roc (2026-08-05)

The last four surfaces, and with them **every route the estop_chain audit flagged now
has a behavioural suite watching it**. `tests/data_routes.py` (15 assertions, real
console, logging ON, 8/8 mutations caught after one weak check was exposed and
strengthened — table in its docstring).

**What it pins:**
- **The vessel switch's SAFE gate** (409 while armed — read in code the day the audit
  began, exercised now for the first time) and the switch itself — where the mutation
  pass caught ME: the energy-gauge flip alone SURVIVED the respawn-dropped mutation,
  because `energy_type` reads the module global `POWER_TYPE` at snapshot time and the
  OLD boat starts reporting "battery" the moment `apply_vessel` runs. The check now
  demands the boat come up at the NEW vessel's OWN spawn — the one observable a
  respawn uniquely produces. **Pick the observable only the mechanism under test can
  produce** — the estop seam lesson, hit again from a new angle.
- **The comms password's THREE never-leak paths, separately mutated:** not persisted
  (comms_config.json), not echoed (the GET's config dict), not logged (`_redact` →
  `***` in the session recording — needs logging ON, the --no-log mask again). Plus
  the mode whitelist ignoring garbage.
- **/api/tide answers** whatever CO-OPS' mood — degradation lives in the body, never
  the response.
- **The ROC HTTP face's error mapping**, which roc_tracks.py's unit tests never see:
  unknown op → 400 naming it, malformed args → 400 "bad roc request", feed for a
  missing id → 404 ok:false, and an add echoes the fresh snapshot.

**COVERAGE ARITHMETIC, FINAL:** the audit found 20 of 33 routes untested on 2026-08-04.
Every consequential route got its suite (estop_chain, run_link_control, home_spawn,
energy_chartinfo, enc_extract, env_water, log_routes, data_routes — eight suites, five
live defects found and fixed on the way: the AIS-radius tuple break's three
dropped-connection cousins, Set-Home's dead-boat fix, and the enc/chartinfo twin's
weak-check findings). The thread that began with "does anything prove E-STOP stops the
boat" ends with 29 suites / 405 assertions and no route whose failure mode is untested.
**The development guide now carries the campaign** (added 2026-08-05, after the
closing commit): defect shapes **6.5 "the unguarded branch before the safety net"**
(the dropped-connection family + its placement rule) and **6.6 "the masked branch"**
(--no-log; a masked branch is untested no matter how many suites run past it), and case
study **8.7 "the coverage campaign"** with the four mutation rules the thread earned.

## /api/logevent + /api/logs + /api/log UNDER TEST — THE FAMILY'S THIRD MEMBER (2026-08-05)

Andy's next two routes (plus /api/log, their sibling). Grounding found the THIRD
dropped-connection defect in three rounds, and the sharpest: **/api/logevent unpacked the
CLIENT-supplied `data` dict as kwargs — `LOG.event("client:"+kind, **data)` against
`event(self, kind, **payload)` — so a legal JSON body with a data key named `kind` or
`self` was a TypeError** ("got multiple values for argument"), a dropped connection and a
dead thread, in a branch before the dispatch try. Reproduced live, both spellings.
**WHY 28 SUITES NEVER SAW IT: every real-console harness passes `--no-log`, which sets
`LOG = None` and skips the branch entirely** — a masked branch is an untested branch no
matter how many suites drive the console. `tests/log_routes.py` boots WITH logging on.

**THE FIX: RENAME, don't refuse** — colliding keys become `kind_`/`self_`; a session log
should swallow an odd field name, not reject the operator's event over it. The record
shape stays FLAT (playback reads it — a nesting fix would have been a silent format
change, and check 2 pins the flat shape as a contract).

**`tests/log_routes.py` (9 assertions, real console, logging ON; 6 mutations caught + 1
survival predicted-then-earned — table in its docstring).** Beyond the fix: the logevent
round-trip is read back OUT OF THE JSONL (kind prefixing, default kind, non-dict data
wrapped, 64-char truncation, a non-identifier key recorded); `/api/logs` lists the live
session with name/size/mtime; and **`safe_log_path`'s traversal guard is exercised for
the first time since it was written** — seven refusal spellings including two SEEDED
targets that isolate each layer: a shape-perfect `asv_*.jsonl` OUTSIDE the dir (only the
bare-basename rule refuses it) and a wrong-shape file INSIDE it (only the shape rule
does). **The seeding is the lesson: a layered guard cannot be tested by spellings one
layer happens to stop** — and the lone bare-basename drop SURVIVES by design (the join
is on the basename), predicted before the run this time, earned by the pair.

## /api/env + /api/waterlevel UNDER TEST — AND A DROPPED-CONNECTION DEFECT (2026-08-05)

Andy's next two routes. Grounding found a live defect BEFORE any check was written, in
the recurring family but a new subspecies: **`/api/waterlevel`'s `manual_offset` cast
was a bare `float()` in a branch that sits BEFORE `_dispatch_post`'s try/except** — the
only unguarded numeric cast outside the guarded region (swept: env guards locally, ROC
has its own 400-returning try). POST `{"manual_offset": "abc"}` unwound the dispatcher:
**the client's connection DROPPED with no response at all and the handler thread died
with a ValueError traceback** — reproduced live before fixing. A cousin of the
ais/radius shape, but worse for the client: ais/radius at least answered before dying.
Fixed with a local guard in env's style → 400 naming the rule. **Placement note for
future routes: a branch added before the dispatch try gets NO safety net — its guards
must be local.**

**`tests/env_water.py` (11 assertions, real console, 6/6 mutations caught — table in
its docstring).** What it pins:
- **THE PHYSICS SEAM:** a manual 25 kn wind + enabled monitor on a RUNNING boat must
  publish a nonzero `env_set_kn` — the override REACHES the boat, not just the
  snapshot; idle stays zero (env applies only to a running boat); **DISABLING returns
  the set to zero** — `field()` yielding None on disabled is what makes calm reproduce
  clean tracking, and every other suite that assumes calm water stands on it.
- **Merge semantics:** field-by-field merge across posts; `""` clears ONE field;
  `auto` drops the whole override and the source reverts to the live buoys. **The
  mutation lesson: a check that catches a merge bug must SPAN posts** — fields sent in
  one body look identical under merge and replace; only a two-post sequence tells them
  apart (the merge mutation survived the one-body check and was caught by the
  two-post one).
- **Waterlevel server half** (the client trust chain is `water_trust.js`'s): manual
  set echoes source/value/note; `""` CLEARS rather than becoming a 0.0 override — a
  cleared box and a zero-metre override are different states with the same rendered
  number, and `source` is what says which.

## /api/enc UNDER TEST + THE CHARTINFO TWIN DEDUPLICATED (2026-08-05)

Andy's instruction: cover `/api/enc` and collapse the duplication the previous pass had
surfaced (the anchor-×2 SKIP). Both done in one commit — `tests/enc_extract.py`
(10 assertions, real console, 6/6 mutations fully caught) plus two shared helpers.

**THE DEDUPE:** `_bbox_key(bbox)` — one cache-key format for the features cache AND the
chartinfo cache; `_bbox_from_query()` — one query parse for both GET handlers, each
keeping its OWN usage message. Behaviour-preserving (energy_chartinfo passed untouched
against it before the new suite existed). **The mutation rule that makes the dedupe pay:
shared-code mutations run BOTH suites and must be caught from BOTH sides** — the key
break was caught by six checks across the two suites on its first run.

**THE ENDPOINT'S CONTRACTS:** malformed bbox (five spellings incl. no query at all) is a
400 naming the ENC usage, never a 502; the extract is SERVED FROM `features_v3_<key>`
cache (proven by a sentinel at a mid-ocean bbox upstream would refuse — only the cache
can answer); **the shallow retag is PER-REQUEST and the cache is READ-ONLY under it** —
`shallow = DRVAL1 < min_depth` computed fresh every request, `min_depth` echoed, the
boundary EXCLUSIVE (DRVAL1 exactly at the limit is not shallow), the cache byte-identical
across three different depth limits. That read-only property is what makes one fetch
safe for every depth limit; a baked-in tag would answer only the first limit ever asked.
The retag touches ONLY depth_area features. `%2C` and plain commas are the same bbox.

**THE PASS'S BEST FINDING WAS A WEAK CHECK IN THE NEIGHBOUR SUITE:** cross-wiring
chartinfo's usage message to the ENC one was caught by enc_extract's cross-check and
SURVIVED energy_chartinfo — whose 2b accepted ANY message containing "usage". The suite
that OWNS an endpoint could not see its own usage line replaced; the guard lived only in
a bystander a refactor could delete. 2b now demands `usage: /api/chartinfo?` and the
re-run is caught from BOTH. **Rule worth keeping: a mutation that survives the owner and
is caught by a bystander is a weak-check finding, not a covered property.**

Also corrected in OPEN/NEXT: `/api/enc` and `/api/chartinfo` are GETs — the earlier
route arithmetic counted them among POSTs off a grep of the string literal.

## ENERGY OVERRIDE + CHARTINFO UNDER TEST (2026-08-05)

Andy's next two routes. No defect this time — but the pass pinned two shapes that were
one refactor away from silent loss, and recorded a twin worth knowing about.

**`tests/energy_chartinfo.py` (13 assertions, real console, 6 mutations caught + 1
survival EARNED by its pair — table in its docstring).**

**ENERGY IS TWO LAYERS, and the suite had to be designed around the mask.** The sim link
stops the burn and holds the tank (`SimVcu.set_unlimited_energy` + the tick's
`_unlimited_energy` branch, which RE-FILLS every frame); the engine SEPARATELY force-fills
the published gauge at `state()` time. While the override is ON, the engine force masks
whatever the sim tank does — so check 8 holds the override ON through ~45 s of hard
running and reads the tank ON THE FRAME AFTER lifting it: only then can a silently-dead
sim layer show (a missing ~0.13 L at the 1-decimal gauge). Asserting during the ON window
cannot see this. The engine layer's own proof is check 10: override ON while
DISCONNECTED — no sim to snap, stale status carrying the burned reading — and the gauge
must still publish full; the force-fill mutation was caught by that check ALONE.
The enable-time snap mutation SURVIVED alone (the tick hold re-fills every frame) and the
pair-removal was caught — earned layered defence, same as the estop tick gate.

**CHARTINFO IS HERMETICALLY TESTABLE via its exact-key cache** (`chartinfo_v1_W_S_E_N
.json`, %.4f each, under `charts/enc`): the suite SEEDS a sentinel entry at a mid-ocean
bbox and the endpoint must serve it byte-for-byte, in BOTH spellings — plain commas and
`%2C` (the ais_service percent-decoding bug made that a class). Malformed or wrong-arity
bbox is a 400 with the usage string, never a 502 from downstream. The REAL Lewes cache is
checked opportunistically when present (gitignored, so a fresh clone reports the reduced
scope explicitly rather than failing).

**THE TWIN, recorded for whoever covers `/api/enc`:** the first mutation runner SKIPPED
both chartinfo mutations — anchor matched TWICE, because `/api/enc` carries a
byte-identical parse-and-key block. The SKIP rule surfaced it instead of silently
mutating the wrong function. `/api/enc` is still uncovered, and that duplication is a
refactor candidate the day it gets a suite.

Ops manual: the BATT/FUEL pill row now documents the click-to-override the pill has
always carried (it only said "energy remaining"). Tech manual 13.1 picks up the suite
(derived).

## SET-HOME COULD CAPTURE A DEAD BOAT'S FIX — FOUND COVERING sethome/spawn (2026-08-04)

Andy's next two routes. Grounding the contracts before writing a single check found a
REAL defect of the project's recurring shape (one value trusted without its provenance):
**`Engine.status` was only ever ASSIGNED when a telemetry frame arrived** (`if telem:` in
the run loop), so it retained the previous link's last fix forever — and **`set_home` had
no not-connected guard**. Two live consequences: Set-Home after `/api/disconnect`
"succeeded" and captured the DEAD boat's position, announcing "Home set to present
position"; and connecting a REAL link (Phase 0 produces no telemetry at all) after a sim
session did the same — a home for a real boat, taken from a simulation. **RTH drives to
home, so a stale home is a destination, not a display blemish.**

**THE FIX, two halves, deliberately both:**
- `set_home` gains `_require(self._link is not None, "not connected")` — the guard every
  other command already had. The no-fix guard STAYS behind it for a link that is up but
  has not fixed yet.
- `connect()` clears `self.status = {}` — a new link's life starts with NO telemetry.
  This is the server-side twin of the boot_id rule (the browser drops the old trail; the
  server now drops the old boat's last frame). Every consumer of `status` benefits, not
  just Set-Home.
The halves are INDEPENDENT: the guard catches the disconnected case, the clear catches
the connected-but-fixless case, and the mutation pass proved neither check covers the
other's fault (`home_spawn` 9 and 10, each caught alone).

**`tests/home_spawn.py` (14 assertions, real console, 8/8 mutations caught — table in
its docstring).** The other contracts it pins: **sethome captures the boat's own fix and
IGNORES the request body** (a decoy posted 0.5° off must be discarded — a home the client
can plant is a home a stale form field can plant); **HOME IS THE RTH TARGET** — sail out
~600 m, Return-to-Home closes to <120 m on exactly the home sethome captured, which puts
`rth`'s happy path under test for the first time; **spawn is reset-with-a-position** —
numeric + range-validated (a REFUSED spawn power-cycles NOTHING: same boot_id, the
running RTH hold undisturbed), and an accepted one is a full fresh boot AT the point with
home re-arming THERE, not at the old home a kilometre away. Spawn on a real link refuses
with reset's simulator-only message — the same guard covers both doors into the
power-cycle. Best unplanned catch: planting client coordinates as home failed check 5
too — the RTH closed on the planted point, so the consequence check sees the lie from
the other end.

Ops manual 8.5 (Set Home) now states the provenance rule and both refusals. No client
change — the SET HOME button already sent no coordinates; the decoy in check 2 proves
the server ignores them if anything ever does.

## RUN + LINK CONTROL: FIVE MORE ROUTES UNDER TEST (2026-08-04)

Andy's follow-on to the estop_chain audit: cover transit, pause, reset, connect and
disconnect — the five most consequential of the routes the audit had measured as
untested. **`tests/run_link_control.py` (21 assertions, drives a real console, 9/9
mutations caught, table in its docstring).** ONE console, ONE arc in mission order
(a boot is the expensive part and the routes genuinely interleave): transit under way →
pause mid-leg → resume → reset → disconnect → a REAL link to a dead host → sim reconnect.

**The contracts it pins down (read from the code, not assumed):**
- **PAUSE IS NOT STOP.** SOG to a standstill, `run="paused"`, and the plan AND
  `wp_index` preserved so start() resumes the SAME leg. The transit's first leg is
  deliberately ~245 m at high speed with a 30 m approach radius so the boat is on
  wp_index 1 BEFORE the pause — "resume did not restart the route" asserted at index 0
  proves nothing, and the injected restart bug was caught only because the index was real.
- **Reset is the sim power-cycle, and its identity change is load-bearing:** back at the
  vessel's spawn, SAFE/idle/no plan, energy refilled, home dropped then re-armed on the
  next fix, and a **NEW `boot_id`** — that is what tells the browser to drop the previous
  trail, so losing it would splice two boats' lives into one track. On a REAL link reset
  REFUSES with the honest simulator-only message.
- **The link lifecycle is a circle with honest edges:** disconnect leaves no zombie
  (commands refuse "not connected"); a fresh connect ALWAYS comes up SAFE with a new
  boot_id; a real link to a dead host reports unreachable and refuses commands with the
  Phase-0 message rather than hanging or faking.

**TWO HARNESS TRAPS, both now written into the suite and both general:**
- **A bodyless "POST" is a GET.** `urllib.request` with `data=None` sends GET, the
  command routes only dispatch on POST, and the response still LOOKS healthy — the
  suite's first run watched a "paused" boat sail on at 13.8 kn. Every command now goes
  through a `cmd()` wrapper that forces `{}`. If a harness commands a console and the
  command seems to change nothing, check the VERB before anything else.
- **After reset, the state carries the DEAD boat's last telemetry** until the fresh
  SimVcu's first frame lands — sampling straight after the POST read the old boat's
  position (248 m off spawn) and fuel (249.9 L) and attributed them to the new one.
  Same family as estop_chain's telemetry lag: wait for the new boot's first fix.

**The best catch was unplanned:** cutting `Engine.pause`'s `link.pause()` call broke the
pause checks AND check 11 — the real link's honest refusal travels through the same seam
(`link.pause()` is what reaches `RealVcu._blocked()`), so one cut loses two contracts.

Coverage arithmetic after this suite: of the audit's 20 untested routes, the five most
consequential are now covered; the remainder (`sethome`, `spawn`, `energy`, `chartinfo`,
the GET-side data routes…) are lower-consequence and still open — see OPEN / NEXT.

## THE km↔nm DISTANCE DISPLAY (2026-08-04)

The units selector Andy scoped and aborted on 2026-08-02 came back at his choice for this
session, and was built to the two decisions he had already recorded — nothing was
re-litigated: **LONG distances only** (line spacing, buffers, draft, DEPTHS and the LINES
table stay metric — 25 m of spacing is 0.0135 nm, unusable) and **one global toggle on the
top status bar** (the DIST pill — Andy's standing rule: global toggles live on the
persistent top bar, not on a card). Canonical is METRES
everywhere; the unit is applied at the DISPLAY EDGE like the feet on chart tiles and the
nm on the AIS card.

**The shape (static/asv.html):**
- `fmtDist(m, dp)` beside the state block near the top — **THE formatter for a long
  distance**. Under 1000 m prints metres IN BOTH MODES (that is the scope decision, not an
  accident); above, km with `dp` decimals or nm via `M_PER_NM`, whose single declaration
  MOVED here from the AIS section (one definition serves both display edges;
  `ais_range.py`'s regex still finds it). `fmtLenM` is GONE — fmtDist replaced it, and the
  old hand-rolled `(x/1000).toFixed(2)+" km"` sites (punchOut survey/approach,
  recalcCommittedForSpeed, the HOME→ pill, the tide-station distances) all call fmtDist
  now. `tests/units_toggle.js` check 9 fails if a hand-rolled km site creeps back.
- `applyDistUnit(u, save)` beside the battPill handler + a `storage` listener: ONE function
  whether the change is a click here or arrived from the OTHER window of the UI split
  (localStorage is shared; `storage` fires in the windows that didn't write). The listener
  passes `save=false` — adoption must not write back. Repaint rides EXISTING paths: the
  mission card / HOME range / water note redraw every state frame, and the survey/committed
  figures are owned by `recalcForSpeed()` — the SAME path a plan-speed change takes.
- **Startup sets the PILL TEXT ONLY, deliberately not applyDistUnit()** — its
  recalcForSpeed() walks plan state that later top-level script may not have initialized,
  and a `let` read before its declaration is a ReferenceError that kills the whole script
  (the showPanel lesson). Nothing unit-dependent has painted yet, so there is nothing to
  repaint.
- Preference: `lsGet/lsSet` under `asv_units_v1`; **default km** — an operator who never
  touches the pill sees exactly what they saw before.

**What deliberately does NOT follow the pill** (each asserted in the suite): short/metric
sites (check 11), chart-tile feet, and the AIS card, which reads nm ALWAYS by its own
earlier decision (check 12) — two display edges, deliberately independent.

**`tests/units_toggle.js` (12 checks, 7/7 mutations caught).** The check that matters most
is 3, straight from the AIS-range lesson: assert the nm VALUE both ways (1852 m = "1.00
nm"), because a field can be labelled nm while holding the km number — wrong by 1.852 with
a plausible number on screen. Check 10 runs the REAL `recalcCommittedForSpeed` under both
units. Live-verified in the browser on a moving boat: HOME→ read `996 m` at 13.76 kn
(short metric), then `0.54 nm` (= 1000 m exactly — the value converts), then `1.02 km`;
choice survives a reload; console clean.

**Suite-harness note:** `speed_recalc.js` now greps `fmtDist` and declares
`M_PER_NM`/`distUnit` beside its other page globals — a harness that extracts page
functions must track their new collaborators.

## THE E-STOP CHAIN HAS A TEST, AND THE HOOK DERIVES ITS SUITE LIST (2026-08-04)

Session "ASV console refinement 1", Andy's scope: expand usability AND make working
components stay stable version to version while adding capability. The stability half
started with a question none of the twenty suites had ever been asked: **what does the net
FAIL to cover?** Cross-referencing every `/api/*` route against `tests/` (excluding
`http_contract.py`, which names every route but only proves the handler contract) showed
20 of 33 routes with NO behavioural test — and among them `/api/cmd/estop`. The only two
mentions of `estop` in the whole test tree were a display prediction (`end_action.js` 8)
and a contract POST of `{"on": false}`. **The most safety-critical control in the console
had no test because it had never broken** — a net shaped by history, not by consequence.

**`tests/estop_chain.py` (17 assertions, drives a real console, in the hook).** Structure
and the reasons for it:
- **The vessel must be genuinely UNDER WAY first** (checks 3–4). Everything else asserts
  that motion stops; without real motion, a console that never moved at all passes.
- **The seam is asserted separately from the engine's flags** (5b vs 6/7/8). `/api/state`
  carries TWO `estop` fields — the engine's commanded latch at top level and the LINK's own
  reported one inside `status` — and they are different facts: what the console commanded
  vs what the vessel heard. Cutting `link.estop()` out of `Engine.set_estop` leaves every
  console-side flag looking right; only the telemetry shows the boat was never told.
- **Latch, refusals, release, re-arm** (9–12): release must leave the boat SAFE — clearing
  the latch must NOT re-arm or resume — and a deliberate re-arm must run again, because an
  E-STOP that cannot be cleared is a different bug from one that does not latch.
- **Telemetry lags the POST**: the engine's field updates synchronously, the link's lands
  on the next frame — sample-once assertions on `status.estop` flake; `wait_link_estop()`
  waits, same reasoning as `wait_stopped`.

**Mutations: 8 run, 6 caught alone, and the 2 survivors were then EARNED as layered
defence** (the roc_tracks technique — remove the pair together and the suite must fail):
the tick gate's `not self._estop` survives because `SimVcu.estop` also halts directly
(pair caught by 5/5b/10b/11); `Engine.set_estop`'s `run="idle"` survives because the
telemetry path re-derives it at line ~2745 (pair caught by 7). Full table in the suite's
docstring.

**AN UNREACHABLE-GUARD FINDING** (recorded in the docstring, don't re-derive): the
`_require(not self.estop, ...)` guards in `upload`, `start` and `_run_route` can NEVER
fire through the API — latching always force-disarms and `_require(self.armed, ...)` runs
first, so the operator always sees "ARM before …". They are defence in depth behind the
disarm; deliberately kept (they back a safety chain), but no test can provoke their
message, which is why check 10 asserts the refusal and not the wording.

**THE HOOK NO LONGER CARRIES A HAND-MAINTAINED SUITE LIST.** Fourth instance of the
"list beside a directory" drift, found while adding the suite: the hook's HEADER comment
documented seventeen suites while the run block ran twenty, and the run block itself
needed a hand edit per suite — so a suite written and not registered would never run in
anger. Both replaced: the loop globs `tests/*.js tests/*.py`, so **a new suite is run the
day it is written**; `gps_sim.py` added to the staged-path filter (it was missing).
README's test section had the same disease ("Six regression suites" heading thirteen
descriptions with eight suites absent) — rewritten to name the directory as the authority
and describe a sample. What stays hand-kept, deliberately: the per-suite failure ADVICE
in `advice_for()` — a missing advice line is cosmetic, a missing run was a hole.

## LINE-TIMING: sequence-keyed activation (2026-07-27)

The LINES-card actual-time accrual is now **sequence-keyed**: a coverage line
accrues time ONLY while the boat's current uploaded-route leg (the waypoint pair
it is between, from the live `wp_index`) IS that line — `currentLegLine()` matches
leg endpoints against committed line endpoints (either direction, 5 m tolerance).
Approach / detour / teardrop / inter-area legs match no line and can never
activate one; the old geometry checks (moving + aligned + XTE) remain only as a
secondary dropout within a line's own leg. The hover time-to-end tooltip gates on
the same `runLineIdx`. This fixes lines "activating" and banking time while the
boat merely transits across or parallel to them on its way to the survey start —
a twice-shipped bug in the sibling console; if it ever resurfaces, check the
sequence gate first and do NOT re-add a geometry-only guard. Harness-verified
(4 cases against the real page functions).

## CHANNEL LANE — the shipping Rule 9 behaviour (ported 2026-07-31)

**This is what runs.** The buoy-line section below is history: that colour design, and
the geometric quarter-width keep-right that replaced it on the sibling, BOTH rode the
wrong side of the buoys on the water. Ported here from the Z-Boat with the routing.

**The rule** (operator-specified from a marked-up chart of the Erie Harbor Channel):
outbound keeps the GREEN buoys to starboard, inbound keeps the RED to starboard, and
**both keep the channel CENTRELINE TO PORT**. One direction-based geometric rule —
ride a lane offset to **STARBOARD of the centreline, `LANE_FRAC` (0.5) of the local
half-width** out (= a quarter of the full width in from the edge). Colour is never an
input; it falls out of where IALA marks sit.

**Applies to EVERY mode**: Go-To, RTH, the drawn Transit, the survey approach leg, the
survey inter-line transits, search-pattern transits, and any routed obstacle detour.
Survey coverage lines and teardrop turns are never offset.

**Pipeline** (`channelLaneRoute` in `static/asv.html`):
1. `buoyChannelLane` — marked channels. `systemCenterline(sy)` pairs each port-hand
   buoy with its nearest starboard-hand buoy, takes midpoints ordered by number; each
   point carries `hw` (half the pair spacing). The system is chosen by the **longest
   stretch of the ROUTED PATH inside it**.
2. `narrowChannelLane` — the SAME rule with no buoys (basin exit, canal). Centreline
   from the water's own edges: `ctr=(RC−LC)/2`, `hw=(RC+LC)/2`. Fires only where BOTH
   edges answer within `CONFINE`. **This is where the ASV's `channel_reach_m` vessel
   override now lives** (it used to set `keepRight`/`channelEndExtend`'s wall-search
   REACH; both DELETED 2026-08-02): `CONFINE = max(120, channel_reach_m ?? buf*30)`.
3. `smoothTrack` — resample by ARC LENGTH at `STEP = max(45, buf*13)` (the waypoint
   count dial) + two light `[0.25,0.5,0.25]` passes to round the bends.

**Non-negotiable invariants — each one is a bug that actually shipped on the sibling:**
a lone buoy is NOT a wall (the edge march runs against a mark-free keep-out view);
SPLICE the lane into the routed path, never replace it; never emit an unverified leg
(abandon the lane instead); the full quarter-width is not always available (take the
largest offset that stays in clear water, then slew-limit); always SAMPLE a polyline,
never trust its vertex count; and measure the lane against the pre-shift samples, not
by marching perpendicular to the final route.

**DELETED 2026-08-02 — the divergence is closed.** `keepRight`, `channelEndExtend`,
`gateProject`, the colour system (`buoyageDir`, `buoyLaneAt`, `crossToLine`) and the
write-only `lastBuoyage` are **gone** (595 lines, 10 % of the page). They had been left
in place as a deliberate "lower risk" divergence after the port; the sibling deleted its
colour helpers outright and this now matches. Nothing referenced them but each other —
verified by a reference scan before and after, which also confirmed **no function was
newly orphaned** by the cut. `pairGates` SURVIVES: it is live for `channelSpanKeepouts`
(the buoy-gate fairway corridor), which is a different job from the retired gate
projection. **NOT implemented** (retired with them, unchanged): the channel end
extension and the buoy-gate projection.

Dead code is not free: it was still being read, still being maintained in comments, and
`tools/buoy_lane_test.js` had already been deleted for *testing* it and passing. The cut
was verified three ways — all 14 suites (177 assertions) green, both pages parse, and the
real page driven in a browser: `planNogoRoute` along the Lewes canal returned 26
waypoints with the lane engaged and no console errors.

**Test:** `node tests/buoy_lane.js` — 11 assertions (lane side + magnitude both
directions, opposing transits pass port-to-port, unmarked channel both ways, a lone
buoy is not a wall, open-water no-op, `systemCenterline` geometry). Verified on the
real Erie cache: outbound **99 % starboard at 0.50 of half-width**, inbound **98 % at
0.39** — matching the sibling. The old `tools/buoy_lane_test.js` was **deleted** with
this port: it exercised the dead colour keep-right and still printed "all checks
passed", which is worse than no test — it tells you to stop looking.

## MULTI-MONITOR UI SPLIT (ported 2026-07-31)

Two windows: **main** (chart + status + command bar) and **controls** (`?panel=controls`,
only the control column + its pop-out panels). Independent pages talking over a same-origin
**BroadcastChannel** (`asv_ui`). Main is the single source of truth — it owns the chart and
all logic; the controls window renders no app logic, mirrors main's control DOM, and
forwards gestures back so every existing handler still runs exactly once, on main.

- `UIROLE` from the query string; tabs self-title **ASV Chart** / **ASV Controls**.
- `UI_BRIDGED` = `.controls` + every pop-out this console has. No `#missionPanel` (it is a
  section of `#vcard`) and, since 2026-08-02, **no `#vcard` either** — see below.
  **`node tests/ui_split.js` now VERIFIES** that every bridged selector, every
  `UI_CARD_TITLES` key and every `#id` in the injected CSS resolves; that claim used to be a
  sentence somebody had checked once.
- **THE VESSEL-STATUS CARD LIVES ON THE CHART WINDOW ONLY (Andy, 2026-08-02).** It used to
  be bridged, so the SAME card rendered in BOTH windows — "VESSEL STATUS" on the chart and a
  "Vessel" uicard in the controls window with nine rows trimmed to stop it echoing the top
  bar. **Two copies of one card is not a second view, it is a second place to look.** Now:
  not bridged, not titled, and `body.ui-controls #vcard{display:none}` — hidden rather than
  removed, because the controls window is the same page under `?panel=controls`. It is
  deliberately NOT in the `ui-split` hide list; that would strip it from the chart too.
  **THE TOP STATUS BAR IS LEFT ALONE** — Andy likes it, and its nine-row overlap with the
  card is accepted rather than a defect. The old row-trimming CSS is retired with the mirror.

**RESIZABLE CARDS — ONE MECHANISM (2026-08-02).** Asked to make the vessel-status card
resizable, I built it a private resize: own CSS, own key, own save path — beside the
`.uicard` mechanism that already did exactly that in the controls window. **Andy asked
whether something was fundamentally different about that card. It was: I had made it a
special case.** Generalised to `.rsz` + `RESIZABLE_CARDS` + ONE key `asv_card_sizes_v1`,
mirroring `asv_ui_cards_v1`. All ten chart-window cards resize.
- **DISPLAY-AGNOSTIC ON PURPOSE.** Cards are shown by different paths, some as `block` and
  some as `flex`. A mechanism needing one of them would silently no-op on half, and the next
  card added would be a coin toss. So the CARD is the scroll container with a **sticky
  header** — the same shape as `.uicard-grip`. A nominated `.rszbody` gives up its OWN
  scrolling (`!important`, the caps are inline).
- **ONLY AN OPERATOR-CHANGED SIZE IS PERSISTED**, compared against the authored default
  captured at init. Several cards carry an inline width in the markup, so "has an inline
  size" stored the DEFAULT the moment a card opened — and a stored default overrides a
  changed default forever, which is the mission-buffer-vs-vessel-floor shape again. An
  earlier attempt inferred intent from gestures and marked cards nobody had touched: a
  mousedown while a card is HIDDEN measures 0×0, so any later reveal looked like a resize.
- **THE SAVE IS EVENT-DRIVEN, IN BOTH WINDOWS.** `ResizeObserver` is delivered with the
  rendering steps, and an occluded window has those suspended — **measured: in a hidden pane
  it does not fire at all, not even on attach.** Same trap that froze the split mirror under
  `requestAnimationFrame`. `mouseup` + `beforeunload` carry the guarantee; the observer is
  the extra. **The controls window had the identical gap** and now gets the same trigger.
- **The card is RESIZABLE** (same pass), and remembers its size next to its position.
  `resize:both` needs a non-visible overflow, and the card had to become a **flex column** so
  `.vbody` absorbs the dragged height instead of the rows spilling past the border — which is
  why `display` now toggles to `"flex"`, never `"block"`.
  **THE SAVE IS ON `mouseup`, NOT ONLY `ResizeObserver`.** An observer is RENDERING-driven,
  and an occluded window has its rendering steps suspended — **measured here: in a hidden
  pane the observer does not fire at all, not even on attach.** That is the same trap that
  froze the window-split mirror when it used `requestAnimationFrame`; the note in the split
  section says "use setTimeout, not rAF" and this is the same rule wearing a different name.
  The observer is kept as the extra that catches a non-mouse resize.
- Controls-window CSS hides the chart/status/command bar, pins the buttons as a left column,
  and wraps each panel in
  a draggable+resizable `.uicard` (layout persisted to `localStorage`, key
  `asv_ui_cards_v1`).
- **Main is only stripped while a controls peer is actually alive** (`body.ui-split`, driven
  by presence pings). With `--single-window`, or if the controls window closes/crashes,
  everything returns to main and a **⏏ Controls** pill appears to reopen it — the console is
  never left without its toolbar.
- Server opens the second window 1 s after the first (sidesteps the pop-up blocker);
  `--single-window` skips it.

## BUOY-LINE KEEP-RIGHT: full backport (2026-07-28) — HISTORY, superseded
> Superseded by the CHANNEL LANE above (2026-07-31). Everything below describes the
> retired colour design; `keepRight` and its helpers are dead code. Retained for the
> record and because several of its *mechanisms* encode real failure modes.

The keep-right is now the sibling's current **IALA-B buoy-line generation** (the
old wall-only version lagged behind while routing work continued on the branded
console). Added: `MARK_TAIL`/`markId`/`markSystems`/`crossToLine` (mark identity +
buoy lines), `buoyageDir`/`buoyLaneAt`/`lastBuoyage`/`buoyageNote` (direction of
travel + signed lane constraint). Replaced with the current generation:
`buildKeepouts` (marks carry `num`/`sys`; returns grouped `sys`), `keepRight`
(buoy-lane tier + wall tier + open-water approach alignment, fast occupancy grid,
curvature limit, clear-water envelope), `channelEndExtend` (grid-aware), and
`drawMarks` (draws the buoy lines). The ASV's `channel_reach_m` vessel override is
preserved inside the new `keepRight`/`channelEndExtend` (the sibling hardcodes
`buf*10`). Banners now report the buoyage reading. Same-day routing fixes carried
in the same code: escalating-region long-goto fix and stitch/knot pruning were
already ported (`ea5e92a`, `85dcf55`). Verified at the time by the since-deleted
`tools/buoy_lane_test.js`
(ported alongside, cache picker keyed to the Erie transit): all checks green —
INBOUND/OUTBOUND direction read, 100% right-side in the fairway, no hairpin at
the buoy gap, no nogo violation, confidence guard holds.

## CHART SOURCE CARD (`SRC`) — backported 2026-07-29

The ENC's answer to a paper chart's title block, ported from the sibling. Server
`fetch_chart_info()` → **`/api/chartinfo?bbox=`** reads two S-57 META layers on the same
band the routing extract used: `Coverage_area` (M_COVR — cell identity; `DSNM`'s 3rd
character is the usage band) and `Quality_of_Data_area` (M_QUAL — `CATZOC`, survey dates,
source) **with geometry**, so confidence can be reported per position. Client `#chartPanel`
shows cell / usage / units / datum / correction, then the zone of confidence **under the
vessel**, amber at ZOC C or worse.

**Deliberately a separate endpoint** — folding M_COVR/M_QUAL into `ENC_ROLES` would bloat
every routing keep-out cache and force a `features_v3` → `v4` bump, dumping every cached
extract for data no route consults. Caches to `charts/enc/chartinfo_v1_<bbox>.json`;
soft-fails per layer and honours the ENC circuit breaker.

**Divergences from the sibling:**
1. ~~No multi-window UI split here~~ — **RESOLVED 2026-07-31**: the split was ported, and
   `#chartPanel` is now registered in `UI_BRIDGED`, the `ui-split` hide-list and
   `UI_CARD_TITLES` like every other pop-out. (It keeps its own `chartPanelHead` drag for
   the main window; in the controls window the `.uicard` grip moves it — same combination
   the sibling runs.)
2. **The nogo floor is VESSEL-DERIVED** (`hull.draft_m + planning.under_keel_clearance_m`),
   so the units tooltip quotes the live `NOGO_MIN_DEPTH_M` instead of the sibling's fixed
   1 m. Keep it dynamic on future ports.

**UNITS — display ≠ data.** The rendered NOAA tiles print soundings in **FEET**; the ENC
vector data and everything this console computes/logs (nogo floor, corrected depths) are
**METRES**. Verified empirically (the chart service's metadata endpoint 500s and the tile
request carries no units parameter): US `Depth_Area` bands come out at exact foot contours
(1.8/3.6/5.4/7.3/9.1/18.2 m = 6/12/18/24/30/60 ft) while the chart prints numbers only
consistent with feet. The card says both out loud. **Don't "fix" it to say metres.**

**Live-verified over the DriX base (Lewes, DE):** 4 cells (`US5DE1DF/DG/EF/EG`), 13 quality
polygons — 7 × ZOC B and **6 × ZOC D**, the lowest confidence class. The spawn resolves to
`US5DE1EF`, ZOC B, source `US,US,reprt,L-297/15`. Harness-tested against that real payload.

**Client-code style rule inherited with the port:** the extract-page-functions harnesses
desync on a nested backtick inside `${…}` and on a regex literal containing a quote — this
card uses plain concatenation and `split('"').join()`.

## Run it

```bash
python asv_console.py --sim --browser none --port 8791          # headless, for testing
python asv_console.py --sim                                     # opens a browser tab
python asv_console.py --sim --vessel example_usv_4m             # study a different ASV
```

- Web UI at `http://localhost:<port>/`; playback at `/playback`.
- Commands: `POST /api/cmd/{arm,upload,start,pause,stop,estop,rth,goto,hold,sethome,transit,speed,approach,energy,reset,spawn}`.
  `speed` and `approach` are LIVE tuning — they apply to a run in progress.
- Vessels: `GET /api/vessel` (active + params + available list), `GET /api/vessels` (list), `POST /api/vessel {id}` (switch — only when disarmed & idle).
- State + telemetry stream over SSE at `/events`; snapshot at `/api/state` (live telemetry is nested under `status`).
- Session recorder writes `logs/*.jsonl` (disable with `--no-log`); playback reads them via `/api/logs`, `/api/log?file=`.
- `--acm <host>` (generic VCU host) + `--transport {tcp,serial}` for a real link; `RealVcu` opens the transport but **refuses to actuate** (no wire format implemented — honest 409, never a fabricated frame).
- **AIS layer (2026-07-25):** selectable **AIS** on/off overlay of nearby vessels + an openable/closable draggable **AIS traffic table** (range/bearing/speed, nearest-first). Data from a **separate stdlib script `ais_service.py`** the console proxies at `/api/ais` (`--ais URL`, default `http://127.0.0.1:8788`). **Area is lake-aware, decided server-side** from the boat centre via `_lake_of`/`GREAT_LAKES_BOXES`: whole lake on a Great Lake, else a 50 km box (response carries an `area` tag). Sources: **digitraffic** (keyless REST), **aisstream** (global WS, minimal stdlib WS client), **nmea** (RTL-SDR/AIS-catcher AIVDM; bundled stdlib AIVDM decoder verified vs canonical vectors). **Zero-config key:** `ais_key.txt` (gitignored) or `$AISSTREAM_KEY`; `--source auto` picks aisstream if a key exists else digitraffic; `--bbox` needs `=` for a leading minus. Feeds + key live in the service, never the browser. **The console AUTO-STARTS `ais_service.py`** as a child in `main()` (`_start_ais_service`, after `apply_vessel` so the spawn is current): scopes `--bbox` to the operating area (whole lake via `_lake_of`, else a box around `SPAWN_LAT/LON`), reuses an already-running one, and passes `--parent-pid` so the service watchdog reaps itself on console exit — robust to a hard kill. `--no-ais-service` opts out. Same generic `ais_service.py` in the Z-Boat console. MarineTraffic scraping ruled out (ToS); no keyless US source. **LIVE-VERIFIED on Lake Erie (Z-Boat, 2026-07-25):** aisstream + the stdlib WS client work against the real server; whole-lake path returned `area: Lake Erie` with ~56 real vessels (lakers/tankers/tour/USCG). Gotcha: ship TYPE lags (~6-min AIS static cycle) — `cat` is "unknown" until a static msg arrives, then classifies right. Client draw/table still want a real-browser eyeball.

## Architecture

- **`VcuLink` seam** with two implementations: `SimVcu` (full boat model — GPS
  fix, waypoint-following autonomy, battery drain, wind/wave environmental
  effects) and `RealVcu` (transport + honest protocol stubs).
- **`Engine`** owns authoritative C2 state (armed / e-stop / run / plan) and the
  arming gates. The console comes up SAFE and read-only; every actuating command
  requires an explicit ARM.
- **Safety model:** the RC transmitter is master; this console is additive and
  cannot touch the RC autonomy switch or E-stop. Link-loss is safe (stop
  commanding, surface the vehicle failsafe: motors 0 / steering straight; never
  auto-resume). Commands are validated/clamped before encode.

## Vessel configuration (the single source of truth for a modeled ASV)

Every vessel-specific parameter lives in one self-contained `vessels/<id>.json`
file — hull/windage, speeds, turn rate, guidance gains, an **energy model**,
planning defaults (incl. under-keel clearance), and spawn. The console studies ASV
behavior **across vessel types**: `--vessel <id>` picks the active profile at
startup, and the UI's vessel picker (or `POST /api/vessel`) switches live when
disarmed & idle (the sim respawns with the new physics).

**Energy model** — `power.type` is `"battery"` (voltage that sags with load; block
`battery_v` + `drain`) or `"fuel"` (diesel litres burned at ~`idle + (full-idle)·
(v/vmax)^exp`; block `fuel`). Battery vessels report V/%, fuel vessels report
fuel %/endurance/range. Validation branches on the type. The DriX is `fuel`.

**Vessel-aware nogo** — the nogo depth floor is `hull.draft_m +
planning.under_keel_clearance_m` (a deep-draft boat avoids more shallow water). The
client reads it via `/api/vessel` and **re-extracts** the nogo model on a switch.

**COLREGS Rule 9 keep-right — SUPERSEDED 2026-07-31 by the CHANNEL LANE (see the top
of this file); the description below is the retired colour design, now dead code.**
(IALA-B buoy-line generation, backported 2026-07-28) —
every transit offsets to the starboard side of a channel. The primary channel model
is the **buoy lines**: lateral marks (ENC `chan_mark` role = buoys + beacons, with
`CATLAM`) carry their channel identity in OBJNAM — `markId()` strips the designator
to get the SYSTEM name + buoy NUMBER, `markSystems()` groups and sorts each system's
port-hand and starboard-hand marks into two polylines (the red line and the green
line), and `buoyageDir()` correlates buoy number against along-track distance to
read the **direction of travel** (numbers rising = INBOUND, red kept to starboard;
falling = OUTBOUND, green to starboard; ambiguous/short hop = no claim). At each
path sample `buoyLaneAt()` gives a SIGNED offset to the line that must be kept to
starboard — so a path on the wrong side is pulled back **across** the line, which a
purely geometric wall search can never see. Where no buoyage answers, a wall-based
tier takes over (both channel walls within reach → lane 20% right of center), and
in open water an approach-alignment query (`buoyLaneAt` with an extended fairway
projection) lines the track up with an upcoming buoyed channel instead of a blind
bias. The reach is `planning.channel_reach_m` (optional vessel override; falls back
to `nogo_buffer_m*10`, the tight-marina scale — the DriX sets 120 m for the ~150 m
Lewes fairway). The offset never trades away obstacle clearance (fast occupancy
grid + exact check), a curvature limit keeps the result followable, and
`channelEndExtend()` stands the track straight on out of a channel mouth.
`pairGates()`/`gateProject()` still steer a Go-To/RTH through the outermost gate
centre and one gate-width past it. Marks are small keep-outs (don't hit a buoy) and
drawn green (port-hand) / red (starboard-hand) with their buoy lines; Go-To/RTH/
Transit banners report the reading ("buoy lane INBOUND (red to starboard)").
Regression harness: `node tests/buoy_lane.js` — **run it after ANY routing change**
(it exercises the real page functions against synthetic marked/unmarked channels).

- **Server:** `load_vessel()` reads + `validate_vessel()` checks a profile at
  load (missing/mistyped field → clear, path-pointed error; a bad file never runs
  with placeholder physics). `apply_vessel()` publishes the values to the module
  globals `SimVcu` reads (`SPEED_KN`, `MAX_TURN_RATE_DEG_S`, `BATT_*`/`DRAIN_*` or
  `FUEL_*`, `POWER_TYPE`, `MIN_NAV_DEPTH_M`, `WP_*`, `WIND_*`, `SPAWN_*`, etc.).
  **Do not reintroduce hardcoded vessel constants** — add/adjust the vessel file.
- **Client:** `loadVessel()` fetches `/api/vessel` and drives the JS mirrors
  (`SPEED_KN`, `MAX_TURN_RATE_DEG_S`, `NOGO_BUFFER_M`, `NOGO_MIN_DEPTH_M`,
  search-pattern sizes) and the energy gauge (BATT vs FUEL), so server and UI agree.
- **Adding a vessel:** drop a new `vessels/<id>.json` (copy an existing one; it
  must be complete — validation requires every field). `vessels/zboat_1800hs.json`
  models the small survey ASV; `vessels/drix08.json` models the Exail DriX H-8 (7.71 m diesel USV; see
  its `notes` for official-spec vs doc-derived vs estimated figures); `vessels/example_usv_4m.json`
  is a larger illustrative USV for comparison. A profile may name a real modeled
  vessel (it's data); keep the console *core* generic (no vendor protocol / manual figures).

## Behaviors (all ENC-aware, arm-gated)

Go-To, Return-to-Home, Hold/station-keep, Set-Home, Transit (multi-vertex),
Search patterns (expanding box / sector / parallel), and Survey (CAMP-style
boustrophedon with Punch-Out clipping to NOAA ENC features + arbitrary polygon
clip). Punch-Out also **excludes a navigation channel when the survey spans across
it** (`channelSpanKeepouts`): a coverage line that runs outside→into the channel
→outside gets a gap there. The channel is the ENC **dredged area** OR the
**buoy-gate fairway** — `pairGates()` pairs the lateral marks and sweeps each gate
line ±one gate-width into a corridor polygon (so a marked inlet with no dredged
polygon is covered too). It applies ONLY to the survey-line clip, not to the transit
routing — so normal transits still cross the channel, and a survey confined *within*
a channel (never out→in→out) is unaffected. Every commanded motion routes
clear of a startup-built **nogo model**
(shoreline + manmade features + water shallower than a 1 m corrected floor),
with COLREGS Rule-9 keep-right in channels. Real-time water-level datum
correction from NOAA CO-OPS; wind/wave sim from NOAA NDBC buoys.

**Survey operational awareness & editing:** (1) hovering the survey line the ASV is
currently on (running survey) shows a time-to-end-of-line tooltip (remaining dist /
live SOG); (2) WPT mode edits a punched plan before Upload — drag a waypoint (its
line endpoint follows), click a waypoint to delete, click a line to delete it (+ its
endpoints), click open water to add; (3) the **LINES** panel shows a per-line table
(length, planned time = length/speed, and ACTUAL time accrued while running — keyed
off the boat's active line, robust to Upload re-routing), written to the session log
as a `client:survey_lines` event on run end (`POST /api/logevent`).

Public data sources (kept): NOAA ENC / ENCDirect ArcGIS, NOAA CO-OPS water
levels, NOAA NDBC buoys, NOAA chart tiles. All cached under `charts/`
(gitignored, regenerated at runtime).

## WATER LEVEL EARNS ITS CONFIDENCE BY DISTANCE (2026-08-01)

Andy saw an **Erie water level at Lewes**. Not a fault: the console had started on the
Erie vessel, the card **named** its station, and `update_position` forces a refetch past a
3 km move — but CO-OPS polls ~every 6 min, so the previous station's value stands in the
gap and *looks exactly as authoritative as a local one*. He diagnosed it himself.

`waterTrust(wl)` now bands the reading by the **nearest contributing station**:
`local` ≤ 25 km · `far` > 25 km (ghosted + italic) · `remote` > 75 km (heavily ghosted,
warn colour, explicit "not the local tide"). **Graphical, not textual** — translucency
reads as low confidence at a glance, so the operator never has to inspect a station name
on a number that is usually fine. Manual overrides are never ghosted (the operator set
them); `!ok` is not a distance problem and keeps the existing `!` mark.
**NEAREST decides, not the average** — averaging would ghost a good local blend that has
one distant station in it, and would let two remote stations either side average into a
falsely "local" reading. Test `node tests/water_trust.js` (9 assertions, teeth-verified:
averaging → 6 fails, no manual exemption → 4, swapped thresholds → 2 and 8).

**THE OFFSET IS ALSO GATED (Andy's call, done same day).** `effectiveWaterOffset()` is
what actually corrects charted depths for the NOGO model. A `remote` reading is SHOWN
(ghosted, so the operator can see what the distant station says) but **NOT APPLIED** —
routing falls back to chart datum, exactly as it already does with no data at all.
Otherwise an 800 km tide of +1.16 m makes shallow water look 1.16 m deeper than it is:
the same failure mode as trusting a chart symbol without its size. `far` IS still applied
— indicative, not irrelevant, and the ghosting says so. A change in the effective offset
(including the gate flipping) invalidates `patClip`, since the punched survey was clipped
against the old one. The card and tooltip state that the level is not being applied, so a
`+1.16 m` on screen can't be mistaken for a depth correction that happened.
**RESIDUAL, shared with the pre-existing no-data path:** chart datum is the LOW-water
reference, so if the real local tide is BELOW datum, charted depths are optimistic. The
manual override exists for that; the manual exemption lives in `waterTrust()` and ONLY
there (a duplicate guard in `effectiveWaterOffset` was unreachable and was removed —
an unreachable guard is one nobody is testing).

## THE END ACTION — what the card says a run ENDS as (2026-08-01)

**Andy's report:** with End of Plan = RTH the boat *does* come home at the end of a Go-To,
a Transit or a Survey — the chain works — but until it fired, every readout said the run
would LOITER. "An RTH triggered at end of mission should SHOW as an RTH."

**Same shape as the completion bug above, one layer up.** `run_completion` is the literal
completion the LINK was uploaded with, and for a Go-To/Transit/Hold that really is
`loiter`. What happens NEXT is the client's chain, which the readouts knew nothing about.
Each field was accurate about itself and **wrong about the boat**.

**`endAction()` is the third value, and the ONLY one the cards show.** The run's own
completion, upgraded to `rth` when the chain will fire and downgraded `rth`→`loiter` when
it cannot. `rthPending()` holds the preconditions: a home, ARM, no E-STOP, the **live**
setting (not the frozen uploaded one), a run that actually HOLDS (`runHolds()` — repeat
laps forever, complete stops, neither can chain), and `!rthChainFailed` (doRTH refused →
retract the promise; set only for `doRTH({chained:true})`, since the button hands it a
click Event). **The link holds for both `loiter` and `rth`; only the chain makes it a
return home** — so the field never decides on its own.

**Found live while verifying it, and worth more than the display fix:** the chain's
one-shot `rthChained` was re-armed only on the idle→running edge. The console lets you
command a second Go-To while the first is still running, so `run` never leaves `running`
and that edge never fires — the second run inherited a **spent chain** and held at its
endpoint indefinitely. Invisible before; now the card would advertise a return home for
five minutes. `rearmRthChain()` re-arms on **UNDER WAY** (`running && !holding`), which is
either a new commanded run (has earned its own chain) or the chained RTH itself (excluded
by the `behavior!=="rth"` guard). Holding — including the seconds `doRTH` spends routing —
never re-arms, so the one-shot still does its job.

**Test:** `node tests/end_action.js` — 16 assertions over the real page functions.
Teeth-verified: drop `runHolds()` → 10,11; drop the `rth`→`loiter` fallback → 6,12; read
`run_completion` instead of the live setting → 1,2,12; drop `rthChainFailed` → 9; drop the
armed/estop guards → 7,8; drop `behavior!=="rth"` → 5; re-arm on every running frame → 15;
re-arm only on idle→running (the old behaviour) → 14. **Live-verified** on a scratch
console: a Go-To under RTH reads `Type GOTO / End mode RTH` from the start, the hold reads
"END OF PLAN — returning home (RTH)", and a second Go-To commanded mid-run chains its own
RTH (before the fix it sat holding for 5 min).

## SANITIZATION: THE SIBLING'S IDENTITY IS OUT OF THE CORE (2026-08-01)

Andy's call on the long-standing flag. **The line that was drawn, and the one to keep
drawing:** the SIBLING CONSOLE's identity must not appear anywhere in this repo's code —
that is the thing this derivative exists to be sanitized from. **A modeled vessel's name is
DATA and stays** (`vessels/*.json`), including `DEFAULT_VESSEL_ID = "drix08"`, which is a
data key the core cannot avoid naming.

Cleared (five in the core, comments/docstrings all): the CHANNEL LANE header and the dead
`keepRight` divergence note in `static/asv.html` → "the sibling console"; the port-number
note and the `connect()` docstring in `asv_console.py`; and the spawn-override comments in
both, which named which vessel spawns where — replaced with "each profile carries its own
operating area", which is also **more accurate**, since it does not go stale when a
profile's spawn moves.

**STANDING CHECK — this must return nothing:**
```
grep -rniE "z-?boat|teledyne" --include=*.py --include=*.html --include=*.js . | grep -v vessels/
```

**Two things found while sweeping, both fixed:**
- `tests/buoy_lane.js` cited `static/routing.js` and the sibling's page as the source it
  reads. **Neither exists here** — it reads `static/asv.html`. A ported comment sending the
  next reader after a file that was never in this repo. The rule it now states: *the source
  a harness names must be the source it actually reads.*
- `tests/turn_geometry.js` had `const ZBOAT` / `const DRIX` labelled `"4 m USV"` / `"8 m
  USV"`. Renamed to `SMALL` / `LARGE` — but the labels were also **factually wrong**: those
  are `zboat_1800hs`'s numbers and that vessel is **1.9 m LOA**, not 4 m (the real 4 m
  profile, `example_usv_4m`, has neither those speeds nor that turn rate). The same
  mislabel had propagated into CLAUDE.md's turn-geometry section and README.md; both
  corrected. Data untouched, so the 21 assertions are unchanged and still pass.

## AIS RANGE: COLLECT WIDE, FILTER NARROW (2026-08-02)

**Andy asked for a range control on the AIS card, and specified the design:** subscribe at
**150 km**, default the control to **50 km**, filter to the operator's selection inside the
app, and **do not apply it to lakes — all contacts in a lake are still displayed.**

**That is better than what I was about to build, and worth understanding why.** One radius
used to drive BOTH the service subscription and the display query, which is where the
documented invariant "they must move together" came from: widening only the query filtered
against vessels the service had never subscribed to, and silently showed nothing new. My
instinct was to honour the invariant by re-scoping the subscription on every change — which
means restarting the child process while the operator drags a number. **Collecting wide and
filtering narrow DELETES the invariant.** Every radius up to the collect width is already in
hand, so a change is instant, needs no restart, and cannot out-run the subscription.

- `AIS_COLLECT_RADIUS_KM` (150, boot-only, `--ais-collect-km`) — what the service SUBSCRIBES
  to. `AIS_SHOW_RADIUS_KM` (50, live, `--ais-radius-km`) — what the operator looks at.
  `AIS_SEA_RADIUS_KM` is **retired**; the old flag now means the display radius.
- **Filtered SERVER-SIDE in the `/api/ais` proxy**, so the chart overlay, the table and the
  count cannot disagree — one decision about what is displayed. Verified live: rows and
  overlay matched at 50 / 150 / 10 km.
- **A true great-circle CIRCLE, not the collect box** — a contact in the box corner is ~1.4×
  the radius out and must not sneak in.
- **`POST /api/ais/radius` clamps to the collected width.** Asking to see 900 km would show
  nothing extra while implying the sea beyond is empty. The control snaps back to 150.
- **NOT APPLIED ON A LAKE.** The area is the whole lake and every contact stands. The card
  disables the input and says *"whole lake — all contacts"* rather than sitting there looking
  broken — a control that silently does nothing is the failure this console keeps re-learning.
- The row reports **"3 of 6 in 150 km"**, so *nothing out there* is distinguishable from
  *I narrowed it down myself*.

**Test:** `python tests/ais_range.py` — 8 assertions against a STUB provider at known ranges,
because the subject is what the console does with an answer, not whether a real feed has
traffic near the test machine today. Teeth-verified: drop the filter → 3,4,5,8; filter a lake
→ 6; filter by box → 3,4,5,8; unclamped radius → 7. **A flake fixed in the stub itself:** it
first routed queries by substring-matching the path and mis-served the lake case, failing
check 6 for a reason unrelated to the console. It filters by BBOX now, like a real provider —
a different filter from the console's range circle, so it cannot mask what is under test.

## SPEED IS A LIVE COMMAND, NOT A PROPERTY OF THE LAST UPLOAD (2026-08-02)

**Andy's report:** speed over ground is not changing with user speed changes; these must be
real time, with application-wide awareness of the ASV state and how it affects the sim.

**He was right, and the previous commit had made it worse-looking.** `f382b85` made a speed
change recompute every planning figure on screen — turn geometry, durations, per-line times.
It did not make the boat go faster, because **`SimVcu._speed_key` was set in exactly one
place: `upload_plan()`.** There was no speed command anywhere in the stack — no seam method,
no Engine method, no endpoint. The selector recorded an intention nothing acted on.

**The tell was sitting next to it in the command bar:** `Appr m` has been a live command all
along (`/api/cmd/approach` → `set_approach`). Speed had the same shape and none of the
plumbing.

- `VcuLink.set_speed` on the seam; `SimVcu.set_speed` applies it live; **`RealVcu.set_speed`
  refuses honestly** like every other actuating call.
- `Engine.set_speed` validates against **the active vessel's own `SPEED_KN`** (so a profile
  with different speeds validates against its own), commands the link, **persists to the
  mission store** so a later Upload re-sends the operator's choice instead of reverting, and
  sets `note` — which is a SALIENT field, so the session recorder snapshots it for free.
- `/api/cmd/speed`.
- **State publishes `speed_key` + `speed_target_kn`**, and `speed_key` rides `TELEM_FIELDS`
  so a playback can put commanded speed beside speed made good. The MISSION block's new
  **Speed** row shows the BOAT's value and turns warn if it disagrees with the selector —
  because these are two values that were silently disagreeing for as long as the command
  went nowhere.

**Live-verified:** under way, SOG **4.11 → 13.94 → 7.06 → 4.08 kn** as the selector moved
low → high → survey → low. (Slightly over target is the environmental set — correct.)

**Test:** `python tests/live_speed.py` — 10 assertions, drives a REAL console, because the
failure spans a command, the link's internal state and the persisted mission. **It has to
let the boat ACCELERATE**: asserting the command was accepted proves nothing, since the old
code accepted the selector change too and dropped it. Teeth-verified: restore the bug → 6,7;
stop publishing `speed_key` → 1 (at the readiness gate); no validation → 4; skip the persist
→ 8.

**A FLAKE CAUGHT AND FIXED IN THE TEST ITSELF:** the first version waited only for the
console to ANSWER, then asserted on a status that had no telemetry in it yet — checks 3 and
4b failed once and passed on re-run. **A test that fails for the wrong reason discredits
every assertion around it.** Readiness now means answering AND the link reporting a frame.

## PLAN SPEED IS AN INPUT, NOT A LABEL (2026-08-02)

**Andy's report:** the speed selection is not monitored when a change of speed for a given
plan is suggested; speed and end-of-plan settings should initiate recalculation on user
input.

**The "suggested" part is what makes it sharp.** Punch Out ALREADY advises on speed — when
the spacing is inside `2 × minTurnRadiusM(speed)` it quotes the spacing a plain reversal
needs at the plan speed AND at low speed, precisely so the operator can choose between
widening the lines and slowing down. Acting on that advice changed **nothing**: `#c_speed`
saved the value and recomputed nothing at all. **Advice the console then ignores is worse
than no advice.**

- `recalcForSpeed()` — if a punched pattern is still drawn, re-run `punchOut()`: it OWNS
  the whole recalculation and its chart extract is cached, so it is cheap. Live proof it is
  real work: the same plan went **7 teardrops → 7 semicircles** and the routed length
  **0.63 → 0.44 → 1.27 km** across survey → low → high.
- `recalcCommittedForSpeed()` — a COMMITTED plan cannot be re-punched (anchors gone), so
  durations are recomputed from `mission.waypoints`, and the reversal feasibility is
  re-checked using `committedPatternInfo().spacing`. **Slowing down is always safe** (the
  radius shrinks); **speeding up can make a committed reversal untrackable and the plan
  looks identical on the chart** — so that case, and only that case, is reported.
- **Also called from `commitPattern()`**: `resetPattern()` blanked the duration rows at the
  moment the plan became real — the same fault as the survey card, one row over.
- **End of plan**: the note said "applies on the next Upload", which was **half true in the
  dangerous direction**. The SETTING is live the moment it is saved — the RTH chain gates on
  `s.completion` every frame — so switching to RTH mid-run arms a return the operator may
  not expect. What waits for Upload is the completion the LINK is given.

**TWO GAPS THE LIVE RUN FOUND, both fixed:** the durations blanked at `Add to plan` (above),
and **the warning did not clear** — slowing back down left it on screen claiming the plan
could not be flown at a speed it was no longer set to. `speedWarnShown` clears it, and only
if OUR banner is still the one showing, so an unrelated banner is not wiped.

**Test:** `node tests/speed_recalc.js` — 10 assertions. Teeth-verified: radius instead of
DIAMETER → 2,3,5b; warn on every change (cry-wolf) → 1,4,5,5b; never clear → 5b; fixed speed
for durations → 7; no recompute → 6,7,7b. **Live-verified:** committed at low → sped up to
high (duration recomputed, warning raised quoting 24.9 m vs 57.8 m) → slowed back (recomputed,
warning cleared).

**NOTE for anything using `flashNote()`:** `onState` overwrites `#note` with the vessel's own
note every frame, so a flashNote is visible for well under a second. Anything the operator
must actually read belongs in `showBanner()` or a panel hint.

## THE SURVEY CARD BLANKED ON A COMMITTED PLAN (2026-08-02)

**Andy's report:** the survey card's information goes blank after uploading the plan; keep
the inputs until the user clears or resets. The blanking is actually at **`Add to plan`**,
one step earlier — `addPatternToPlan()` ends with `resetPattern()`, which drops the three
anchors, and **every figure on the card was derived from those anchors alone**. Spacing,
direction, line length, width and count all went at exactly the moment the operator most
wanted to check them: immediately before Upload. The plan was still there; the chart still
drew it. Only the card forgot.

**`committedPatternInfo()` DERIVES the figures from `mission.lines` — it does not remember
them.** A remembered snapshot is one more value that can drift from the plan, which is the
bug shape this repo has paid for most often. Deriving cannot disagree with the plan,
survives a page refresh for free (the mission persists server-side), and correctly follows
a plan edited in WPT mode — the card then describes what the plan IS, not what was typed.

- **SELF-VALIDATING, not `planKind`-gated.** `planKind` is NOT persisted and resets to
  `"survey"` on refresh, so gating on it would have described a committed SEARCH as a
  survey with meaningless spacing. Instead the lines must actually BE parallel (~2°).
  Expanding-box and sector searches get no figures; parallel-track lanes do, and correctly.
- **`width` is the measured across-plan extent**, not `spacing × (n−1)`, so an unevenly
  edited plan is described truthfully. `legLength` is the LONGEST line, not the first — a
  clipped plan has short end lines.
- **DIRECTION MUST MATCH THE TYPED CONVENTION.** A boustrophedon alternates end for end, so
  line 0's raw bearing is only defined modulo 180 — reading it raw returned the RECIPROCAL
  about half the time (caught live: typed 327, card read 147). `surveyPattern` derives
  direction as `across-bearing − 90`; this derives it the same way from the across-plan
  offset. A single-line plan has no across direction and falls back to its own bearing.
- `loadMission()` now calls `updatePatReadout()` — without it a committed plan read blank
  after every page refresh, since nothing else repaints the card on load.

**Clearing:** `CLR PLAN` empties `mission.lines`, so the card blanks with it. The SURV
`Reset` discards only the pattern being DRAWN — the card then reverts to describing the
committed plan, which is still in the mission and still on the chart. That is deliberate.

**Test:** `node tests/survey_card.js` — 11 assertions. Teeth-verified: restore the blanking
→ 1 (loudly); drop the parallel test → 8; first line's length instead of the longest → 5;
width as `spacing × (n−1)` → 7; gate on `planKind` again → 9. **Live-verified** end to end:
drawn → Add to plan → Upload → page refresh all hold 34.7 m / 029° / 188 m / 21 lines, and
CLR PLAN blanks it.

**Known cosmetic difference:** the drawn `width` is the pattern's nominal box width and the
committed one is the measured line-to-line extent, so they differ by the alignment margin
(seen live: 698 → 693 m). The measured figure is the more truthful of the two.

## THE SURVEY MOVE GRIP WAS DRAWN, LIVE, AND INVISIBLE (2026-08-01)

**Andy's report:** the SURV whole-pattern move handle "is not there — find it in zboat and
apply it here". **It had already been ported, completely.** `patMoveLL` / `patMoveScreen` /
the `"M"` branch of `patHandleAt` / `patMoveLast` / the translate-every-anchor drag are all
byte-identical to the sibling, and `drawPattern` diffs identical too. Measured on the
running page: the hit test returned `"M"` at the midpoint and a drag moved the pattern
rigidly with spacing/direction/width/count preserved exactly.

**So why "not there"? It was drawn INSIDE `drawPattern()`, which `render()` calls early —
and `render()` paints the boat marker near the END.** The grip sits at the A-B midpoint, and
the operator's normal move is to drive to the survey area and draw the box **around the
boat**. A 6 px grip under a 6 px boat disc plus its 26 px heading line is simply not there.
Measured: **ZERO grip-coloured pixels when the midpoint landed on the boat, 70 when it did
not.** Live, draggable, and invisible in the commonest case there is.

- `drawPatMoveGrip()` split out and called **last in `render()`**, just before
  `drawViolation`. Dark halo ring + outlined "move" label so it reads against the boat and
  the coverage lines. Worst case (grip exactly on the boat) went 0 → 24 amber px.
- **The real port gap was the HINT.** The sibling's `#sp_hint` names the grip in both
  variants; this port's copied the strings without the mention, so nothing on screen ever
  told the operator the handle existed. Ported verbatim.
- The hit-test tie-break is unchanged and load-bearing: **corners win**, so reshape stays
  reachable on a small pattern where the grip sits near a corner.

**DIVERGENCE FROM THE Z-BOAT, and it is now the only one in this feature.** The sibling
still draws its grip inside `drawPattern()` and has the same burial — it was never noticed
there. **A future re-port of the survey code from the sibling would silently undo this**;
`tests/pattern_move_grip.js` check 5 is what will catch that. The hint strings, by contrast,
now MATCH the sibling — that half was a plain port gap, not a divergence.

**The lesson, and it is the READOUT COROLLARY again in a different costume:** "the code is
ported" and "the operator can use it" are different claims. The diff was clean, the logic
was right, and the feature was still missing. **Verify a UI port by looking at the pixels,
not the diff** — the canvas sample is what found this in about a minute.

**Test:** `node tests/pattern_move_grip.js` — 7 assertions. 5 and 6 are deliberately
**source-order** assertions (canvas z-order is not observable without a full render
harness): the grip must NOT be drawn inside `drawPattern`, and `render()` must call
`drawPatMoveGrip()` after the boat marker (anchored on `getCSS("--asv")`). Teeth-verified:
grip back inside `drawPattern` → 5; no post-boat draw → 6; drop either hint mention → 7;
wrong anchor pair → 1,2; grip wins a tie → 4; 60 px hit radius → 3.

## THE NOGO ROW WAS STUCK ON "loading…" (2026-08-01)

**Andy's report:** "the nogo entry in both cards always shows ...loading". It did — and it
was a **repaint bug wearing a vague word**, not a wording problem.

`refreshNogo()`'s success path ended `rebuildNogo(); nogo.busy=false;` — and `rebuildNogo()`
finishes by calling `updateNogoUI()`. So the row was painted **while `busy` was still true**,
printed "loading…", and then nothing ever repainted it. **The one path that ends in a working
model was the one path that never showed it.** Every behaviour routed correctly off a model
the card insisted was still loading — the worst kind of stale readout: it reports NOT READY
about something that is. Fix: clear `busy` **before** `rebuildNogo()`.

**Then the wording, which was the real ask.** `nogoReadout()` names the STATE — the same
lesson the AIS table already learned about its link status. Four states, and the pair that
matters: **"clear water" and "no chart" both look like zero keep-outs and are opposite
facts** — one is open water, the other means nothing was checked and every route is direct
and unverified. `nogo.band` (set only by a SUCCESSFUL extract) is what tells them apart;
`nogo.ready` cannot, because it is false in both.

- reading → `reading chart… 6 s`, **counting seconds** so a hung chart service does not look
  like a slow first fetch. Ticked from `tickClock()` while `busy`.
- read → `334 zones · floor 2.3 m` (the floor is **vessel-derived**, so the operator sees
  what "shallow" means for the boat they are driving), tooltip broken down by the keep-outs'
  **own `kind` strings** — it can never invent a category the model does not have.
- clear water → `clear — none charted`, normal colour.
- no chart / failed → the reason, truncated in the row and whole in the tooltip, warn colour,
  and the tooltip says routes will go DIRECT. The `catch` now sets `nogo.note` instead of
  leaving the previous one standing.

**NO NEW STATE FIELD** — every state derives from `busy` / `nogo.band` / `nogo.note` / the
counts, so nothing can drift out of step with the model behaviours actually route against.
(Only `nogo.since`, a timestamp for the elapsed display.)

**Test:** `node tests/nogo_readout.js` — 15 assertions. 10–14 drive the **real**
`refreshNogo` → `rebuildNogo` → `updateNogoUI` with only the leaves stubbed (chart fetch,
keep-out builder, banner, DOM) and record every paint, because wording assertions alone
would never have caught a statement-ordering bug. Teeth-verified: **restore the original
order → 10,11 fail**; key off `nogo.ready` → 4,6; drop the busy branch → 1,2,12; drop the
elapsed counter → 2; fold no-chart into clear-water → 5,13,14; drop the article strip → 7;
untruncated note → 6; no note on the throw path → 14. Live at Lewes: `334 zones · floor
2.3 m`, tooltip `126 × dock / pier, 93 × shoreline, 57 × charted hazard, 37 × water
shallower than 2.3 m, 16 × land, 5 × channel buoy`.

**Two harness traps this suite hit, both worth remembering:**
1. `grab()` matches `"function NAME("` and **silently drops an `async` prefix** — the torn
   body was a SyntaxError (loud, luckily). It now grabs the modifier too.
2. A **stray top-level `process.exit()`** after the async IIFE ended the process at exit 0
   after check 9, silently skipping five checks. The summary now prints the number of
   checks that RAN.

## MISSION CARD MERGED INTO THE VESSEL-STATUS CARD (2026-08-01)

Andy's call, same pass. The operator was reading the boat on one card and its run on
another. `#missionPanel` is gone; its rows live in `#vcard` as `#v_mission`, a `.vsec`
shown only while there is a run to describe (`updateMissionCard()` now targets it).

- **The old `Run mode` row (`#v_mode`) is DELETED, not moved** — it was `behaviour ·
  completion`, which is exactly the block's `Type` + `End mode`. Merging means removing
  the duplicate, not carrying it.
- `#v_wpt` moved INTO the block (so the controls window's "drop what the top bar already
  shows" rule still hides it) and gained the old `mi_wpts` pre-upload fallback, as
  "N planned". `#mi_wpts` is gone.
- Removed with the panel: its drag/persist block (the orphaned `asv_missionpanel_pos_v1`
  key is left in localStorage), and its entries in `UI_BRIDGED`, `UI_CARD_TITLES` and the
  `ui-split` hide list. **The stale comment claiming this console has no Mission card is
  now true again.**
- `.vbody` gained `max-height:calc(100vh - 170px); overflow-y:auto` — the block pushed the
  card past a laptop viewport with a run up.
- Verified live in BOTH windows: main renders the merged card; the controls window shows
  one `.uicard` "Vessel" carrying the mission rows and no stale Mission card.

## END-OF-PLAN SETTING vs RUN COMPLETION — one field per concept (2026-08-01)

**Bug Andy hit (and had hit before):** End of Plan **RTH** selected, console acting on
**loiter**. Confirmed live — the mission store said `rth`, `/api/state` said `loiter`.

**Root cause: a CONFLATED FIELD.** `Engine.completion` was doing two unrelated jobs —
the operator's persistent END-OF-PLAN SETTING (owned by the mission store, decides what
happens when a survey/search PLAN finishes) *and* the completion of the RUN CURRENTLY IN
PROGRESS. Go-To / RTH / Hold / Transit all correctly station-keep at their own endpoint,
so `_run_route()` set the field to `"loiter"` — **and thereby overwrote the setting with
it.** Nothing restored it until the next `start()` re-read the mission. The command bar
still SHOWED RTH, the RUN MODE pill read `goto · loiter`, and the client's end-of-plan
RTH chain (which gates on that value) was silently disarmed in between.

**The robust fix is structural, not a patch — one field per concept:**
- `plan_completion()` — THE SETTING. Cached in `_PLAN_COMPLETION`, refreshed by
  `_cache_plan_completion()`, which **every** mission read and write funnels through, so
  the cache cannot drift from disk and the 4 Hz telemetry loop never touches the file.
  **No Engine method writes it** — that is the invariant that kills the whole bug class.
- `Engine.run_completion` — what the run in progress does at ITS end. `_run_route` sets
  `loiter` (correct for a Go-To); `start()` sets it from `plan_completion()`.
- **Both** are published: `completion` (setting) and `run_completion` (this run). Client:
  the command-bar selector and the RTH chain read `s.completion`; the cards read
  **`endAction()`**, which is built on `runCompletion()` — see the END ACTION section
  above; the RUN MODE row that read `runCompletion()` directly is gone.
  `syncCompletionSel()` mirrors the server's setting back into the selector (skipped
  while focused), so the two **cannot drift unnoticed**.

**Test:** `python tests/completion_modes.py` — 10 assertions, ~5 s, drives a REAL console
over the API because the failure was an interaction between a command and persisted
state, which a unit test of either half alone would have missed. In the pre-commit hook.
Teeth-verified: publishing `run_completion` as `completion` → 3,7,8,9 fail; `_run_route`
writing the setting (the exact old code) → 3,7; `start()` ignoring the setting → 10;
breaking the cache refresh → 8.

**Note on check 10:** the first version of this test passed all its mutations except
`start()` ignoring the setting, because it never STARTED a plan — the setting would have
been perfectly preserved and then never used. Preserving a setting and *honouring* it are
two assertions, and a test needs both. (The same pass also caught a flake in the test
itself: it assumed a position fix instead of waiting for one, so it failed on the wrong
check. A test that fails for the wrong reason discredits every assertion around it.)

## CHARTED POINT HAZARDS HAVE AN EXTENT (2026-08-01)

**Bug Andy hit:** a live Go-To out of Lewes planned straight over a charted wreck. The
wreck was fetched (`Wreck_point` → `hazard_point`), classified and enforced (`enf.haz`
defaults **true**) — the ENC side was fine. The failure was that `blocked()` gave EVERY
point keep-out a radius of exactly the nogo buffer, so a **wrecked ship, a mooring pile
and a channel buoy were the same object to the router**. At the 3 m buffer in the
report, a charted wreck was a 3 m obstacle: a route only had to miss the charted
position by 3 m to validate clear. **The buffer is a CLEARANCE MARGIN and was being
asked to double as the OBJECT'S EXTENT.** It cannot do both.

**Fix, three parts:**
- `hazExtent(f)` gives an intrinsic radius to hazards whose extent the chart does not
  give — `HAZ_UNKNOWN_EXTENT` = Wreck / Hulk / Obstruction / Underwater-Awash-Rock
  points. `WRECK_RADIUS_M` defaults **50 m**, vessel-configurable via
  `planning.wreck_radius_m`. The buffer is then added ON TOP as the margin. Piles,
  buoys and beacons keep extent 0 — the fix must not inflate every mark on the chart.
- **VALSOU is now used.** It was fetched in `ENC_KEEP_PROPS` and thrown away. A wreck
  with a charted sounding that clears `NOGO_MIN_DEPTH_M + WRECK_CLEAR_MARGIN_M`
  (tide-corrected by `waterOffset`, same as depth areas) collapses back to a point.
  **No VALSOU means UNKNOWN, and unknown takes the full berth** — not the reverse.
- `bufferFloor()`: the vessel's `planning.nogo_buffer_m` is a FLOOR. `loadMission` was
  doing `nogo.buffer = mission.buffer_m ?? 10`, so a plan saved against a small boat
  silently gave the DriX 3 m where its own file demands 5. Same vessel-staleness class
  as the ROC standoff. The operator can still widen it beyond the floor by hand.

**BOTH clearance paths had to learn it.** `blocked`/`blockedInfo` is the exact check;
`rasterKeepouts` is the A* occupancy grid, and it stamped each point into a SINGLE CELL
before the uniform buffer dilation. Fixing only the exact check would make the search
plan through the wreck and the leg then simply fail — no detour. The raster now stamps a
disc of `pt.r` first. Sized hazards also DRAW their circle (dashed red), so the operator
can see why a route swings wide instead of reading a bare cross as the whole danger.

**Verified against the REAL cached Lewes ENC** (6,210 features, 38 `Wreck_point`
records → 7 distinct wrecks): 5 have no VALSOU → 50 m extent → a leg 10 m abeam is now
REFUSED where it was clear; 2 carry VALSOU 4.5 m and 3.6 m → extent 0 → still passable
for the DriX's 2.3 m floor, which is correct. 161 of 448 point keep-outs are now sized.
**NOTE:** the wreck in Andy's screenshot may well be one of the VALSOU pair, which the
fix deliberately still allows — a wreck with 3.6 m over it is passable for a 2.0 m draft.

**Test:** `node tests/wreck_clearance.js` — 12 assertions, in the pre-commit hook.
Teeth-verified by mutation: bare-buffer radius → 4,5,6,12 fail; single-cell raster stamp
→ 9; no VALSOU branch → 2,10; extent on every class → 1,8; no `bufferFloor` → 11.

## SURVEY TURN GEOMETRY — radius decoupled from line spacing (2026-07-31)

`teardropTurn()` in `static\asv.html` builds every line-to-line reversal. **Two
shapes, one contract**: end on the next line aligned with its heading, at a radius
the boat can HOLD at the plan speed (`minTurnRadiusM` = `1.4 × v/ω` from the vessel
file's `max_turn_rate_deg_s`), nogo-validated before return.

- **Semicircle** — line offset ≥ `2×minR`. One 180° arc at *half the offset*,
  bulging outboard; reaches exactly `R` past the line ends. Unchanged behaviour.
- **Teardrop** — line offset < `2×minR`. Three tangent circles **at `minR`**: a short
  arc away from the next line, a >180° loop over the top, a short arc onto the line.
  In a frame with the entry at the origin, `+y` = exit heading, `+x` = towards the
  next line, offset `d`: `C1=(-R,0)`, `C3=(d+R,0)`, `C2=(d/2, √(4R² − ((d+2R)/2)²))`,
  tangent points at the centre midpoints. Solvable exactly when `d ≤ 2R` — precisely
  the case the semicircle can't serve — and it degenerates into the semicircle at
  `d = 2R`, so the two families agree on their shared boundary. Along-track offset
  between the line ends (clipped lines of unequal length) is absorbed by a straight
  run collinear with a survey line.

**WHY this exists.** The old code had only the semicircle, so a boat whose minimum
radius exceeded half the spacing got **no turn at all** and fell back to a "straight"
hop between anti-parallel line ends — which is a 180° reversal at half the spacing,
i.e. the exact radius just rejected as unflyable, only now unmodelled. Coupling the
turn radius to the line spacing meant a big boat on tight lines could never get a
turn: **the 7.71 m USV needs 14.4 m of radius at its 7 kn survey speed (28.9 m of
spacing) where the 1.9 m ASV needs 2.1 m (4.1 m)**, so ordinary small-boat line spacing
silently produced no teardrops at all. That symptom is what prompted the rework.

**Cost, and what the operator is told.** A teardrop reaches up to ~`2.75×minR` past
the line ends (vs `R` for the semicircle), so `punchOut()` reports the actual
excursion, the spacing a semicircle would need at the plan speed, and the spacing
needed at low speed. If even the teardrop hits a keep-out the reversal falls back to a
straight hop and the banner calls it **untrackable**, not merely routed — that is a
plan defect to act on, not a working turn. `turnMargin` (`spacing/2`) was deliberately
**left alone**: raising it to suit the teardrop would trade coverage off every line,
which is the operator's call, not a silent default.

**Known modelling limit (unchanged, but now load-bearing):** the sim caps yaw RATE,
not radius, so `minR` grows linearly with speed. Real hulls hold a roughly constant
minimum radius — Exail publishes ~8 m for the DriX H-8 at 14 kn, where the 20°/s cap
implies 20.6 m. The cap is calibrated at survey speed (10.3 m physical vs the spec's
~8–10 m), so it is right where surveys are planned and pessimistic at high speed.

**Test:** `node tests/turn_geometry.js` — 21 assertions over the real page functions
for both shipped vessels (shape selection, radius, curvature floor along the whole
path, exit alignment, turn-away direction, outboard excursion, the `d = 2R` boundary,
nogo refusal *and* its clear-water twin, along-track absorption, skew refusal, speed
as the operator's lever). **Run it after ANY change to the turn geometry.** Verified
with teeth: restoring the old clamp fails 3 checks, building the teardrop at half the
offset fails 6, reversing the middle sweep fails 4, dropping the nogo sweep fails 1.

## Testing notes

- Headless: `python asv_console.py --sim --browser none --port 8791`, then drive
  via the `/api/cmd/*` endpoints and read `/api/state` / `/events`.
- Geometry/routing regressions run offline against `static\asv.html` with plain
  Node (no deps, no server): `node tests/turn_geometry.js`, `node tests/buoy_lane.js`.
  **A pre-commit hook runs BOTH** when `static\asv.html` or either test is staged
  (`.githooks/pre-commit`, ported from the sibling 2026-07-31; enable per clone with
  `git config core.hooksPath .githooks`, bypass with `--no-verify`). `.gitattributes`
  pins `.githooks/**` to LF — a CRLF shebang breaks the interpreter on checkout.
- The map page canvas animates continuously — **browser-pane screenshots time
  out**; verify via DOM/`read_page` or the state endpoints instead.
- **CANVAS PIXEL SAMPLING is the way to check anything DRAWN** (found 2026-08-01, and it
  found the buried move grip). `canvas.getContext("2d").getImageData(x, y, w, h)` over a
  small box at a known screen point, then count pixels matching the feature's own colour —
  one `javascript_tool` call, no screenshot, immune to the animation. Two traps: the boat
  is drawn at the same place as several handles, so **place synthetic geometry AWAY from
  the boat** unless burial is what you are testing (an accidental overlap is what made the
  grip look broken, then proved it was); and `javascript_tool` caps at ~30 s, so long waits
  belong in a `setInterval` sampler read back by a later call — but note a **hidden browser
  pane throttles timers to ~1/min**, so trust the outcome, not the sample density.
- Windows/store-Python gotcha: a stray server process can hold the port and serve
  stale code. Check `netstat -ano | grep :<port>` and `taskkill //F //PID <n>`
  before retesting server changes.

## ROC + MOVING HOME (ported from the sibling 2026-08-01)

`roc_tracks.py` — Remote Operations Center tracking, GPS ingest, and a HOME that can
MOVE. Self-contained: it owns all ROC state and imports NOTHING from the console (the
console injects the boat-fix getter). Wired in at four points in `asv_console.py`:
`ROC = roc_tracks.RocTracker(...)` global · `GET/POST /api/roc` · `ENGINE.set_home_provider(
ROC.home_intent)` in `main()` · the Engine tick, which resolves HOME every telemetry
frame and runs the moving-HOME chase.

**Shore vs ship.** A shore ROC is a fixed antenna whose ARRIVAL POINT is offset by an
operator-entered range/bearing (the ramp). A ship (mothership) ROC moves, and its offset
is normally `relative` — measured from the ship's COURSE, so "50 m astern" stays astern
as she turns. `PLACE → EDIT → CONFIRM`: staged ROCs are editable and **cannot be HOME**;
confirming activates (and starts a ship steaming). Hold reverts to staged.

**The chase.** While an RTH follows a ROC, the run loop re-aims the boat at the current
arrival point, re-issuing a single-waypoint plan only once it has drifted past ~half the
arrival radius — reusing the link's own waypoint-follow, no separate pursuit controller.
A ROC home is driven DIRECT, not ENC-routed: a detour to a moving point is stale on
arrival. Any command leaving RTH/running clears the chase.

**VESSEL-DERIVED — the divergence from the sibling.** The sibling hardcodes a 50 m astern
standoff and has no closing check. Neither survives contact with this console's vessel
system, so both are re-derived in `apply_vessel()` via `roc_tracks.configure_vessel(v)`:
- `SHIP_RECOVERY_M` = `planning.roc.ship_recovery_m` if declared, else `max(20, 6×LOA)`.
  1.9 m boat → 20 m, 7.71 m → 46.3 m. Existing ROCs keep operator-entered offsets; only
  the default for NEW ships moves.
- `ASV_MAX_SPEED_KN` = `propulsion.speeds_kn.high`, backing `Roc.closing_kn()`/`closable()`.
  RTH to a moving mothership only converges with a real overtake margin; below
  `CLOSE_MARGIN_KN` the card, `home_intent` and the RTH note all say it is unreachable.
**This is the `HULL_A_LAT` staleness trap** — an import-time-only derived constant goes
stale on a live vessel switch. Verified live: DriX→small boat moved the new-ship default
46.3→20 m and re-based the closing check 14→6 kn.

`gps_sim.py` — NMEA-0183 emitter (RMC/GGA, XOR checksums, TCP server or UDP), the "real
GPS feed" stand-in. The tracker can spawn one per ROC (`--parent-pid` reaped). Ingest
verifies the checksum and rejects a void fix: a GPS feed is untrusted input.

**Test:** `python tests/roc_tracks.py` — 17 assertions, teeth-verified (drop the relative
branch → 4 fails; let a staged ROC be HOME → 6 fails; hardcode the standoff → 9 fails;
skip `configure_vessel` → 11 fails; skip the checksum → 14 fails). Run by the pre-commit
hook. Also ported in the same pass: the **Mission card** (then `#missionPanel`, one readout
for every commanded run; **merged into the vessel-status card later the same day** — see
that section) and the **SURV whole-pattern MOVE GRIP** (`patDrag==="M"` — crosshair
at the A-B centre translates all CAMP anchors by one delta; corner handles win hit-test
ties — **but it was buried under the boat marker and unmentioned in the hint until
2026-08-01; see that section**). **NOT ported, by decision:** the sonar/payload subsystem — it hardcodes a specific
two-sonar fit and would need a vessel-declared `payloads` block first, and the single-beam
echosounder console is built from vendor manual citations and proprietary telegrams that
this console's sanitization rules forbid.

## Keep docs current

**THE START HERE HANDOFF IS REFRESHED IN THE SAME COMMIT AS THE WORK — Andy's standing
instruction (2026-08-02). Not as a follow-up commit.** Five separate "refresh the handoff"
commits were made in one session, and **each one immediately falsified its own `HEAD` line**,
because the refresh moved the tip it had just named. Folding it in ends that: the handoff
lands with the change it describes, and there is no trailing docs commit to invalidate it.

**Which is why the "Repo" line no longer quotes a hash.** A self-referential pointer cannot
be right — a commit cannot name itself. The session list carries hashes, which are
historical facts that never rot, and the tip is one `git log --oneline -5` away.

**Every commit that changes behaviour updates, in that same commit:** the START HERE session
list (one line per commit) · any section the change touches · the suite table if a suite was
added · the relevant README(s) — `README.md` (overview + "Using it"), `README_SIM.md` (sim
model / command flow / endpoints / walkthrough), `README_PLAYBACK.md` · and
`node build_docs.js` if a generated document covers it. Internal-only refactors need none of
it — say so in the commit rather than silently skipping.

**THE WHOLE `docs/` DOCX SET IS GENERATED** (docx-js; `npm install` in `tools/` first; output
paths are script-relative). **Never hand-edit a docx** — edit its script and rebuild. If
one does get hand-edited in Word, diff the text against the generated version and fold the
edits back INTO the script. All four are brand-free by rule: the console core names no
vendor; vessel FILES may name real vessels, since that is data rather than branding.
**A fifth generated artifact sits beside them:** `ASV-Console-Programming-by-Conversation.pptx`
(added 2026-08-05, Andy's request) — a presentation on this project + the DES schema for a
graduate audience. **Its generator is `tools/build_deck.js`** (`npm install` covers it —
pptxgenjs is in `tools/package.json`); a rebuild was verified to reproduce the committed
deck's slide XML byte-for-byte. Same never-hand-edit + only-commit-on-change rules as the
docx set, with the hash check on `ppt/slides/*.xml` instead of `word/document.xml`. Its
icons are pre-rendered into `tools/deck_icons.json` — regenerate ONLY when changing them
(`tools/build_deck_icons.js`; its heavy deps are deliberately not in `package.json`).
It is NOT covered by `docs_valid.py` (which globs `*.docx` and asserts exactly four), and it
names real outside projects and vendors by design (the Starlink / Q-Hub / DeltaT case-study
series; NOT the sibling) — presentation content is Andy's authored material, like the
maintainer notes in this file, and the sanitization rule is scoped to CODE.

```
cd tools && node build_docs.js     # rebuilds all four
```

| script | → `docs/` | for |
|---|---|---|
| `build_quickstart.js` | `asv-simulator-quick-start.docx` | first-time users, ~20 min to a running survey |
| `build_ops_manual.js` | `asv-simulator-operations-manual.docx` | operators: safety, display, every behaviour, contingencies, checklists (17 ch) |
| `build_tech_manual.js` | `asv-simulator-technical-manual.docx` | engineers: architecture, API, formats, extension (15 ch) |
| `build_dev_guide.js` | `asv-simulator-development-guide.docx` | contributors: testing philosophy, defect shapes, case studies (10 ch) |

**`tools/docx_kit.js` holds the shared formatting** — extracted 2026-08-02 when the set
grew to four, and the tech manual's `word/document.xml` is **byte-identical across that
extraction**, which is the only reason the refactor was safe. Add a document by writing
`build_<name>.js` against the kit, listing it in `build_docs.js`, and adding it to the
document-set table in the tech manual AND `README.md`.

## Not yet done

Git repo (local, no GitHub remote). `RealVcu` command/telemetry codecs are
unimplemented by design (this is a simulator). Design docs: `PLAN.md`,
`ASV_BEHAVIORS_PLAN.md`, `ENC_PUNCHOUT_PLAN.md`.

---

## SESSION CHECKPOINT — 2026-07-23 ("ASV Simulator Project Continued 1" handoff)

Full context for resuming in a fresh session. Everything below is committed
(clean working tree). `git log --oneline` is the authoritative record.

### How this project started
Derived from `D:\Claude\Zboat` (the Teledyne Z-Boat console) as a **sanitized,
brand-free generic ASV simulator**. All vendor/model/proprietary identity was
stripped (VCU not ACM; no ZBoat/Teledyne names, no proprietary wire protocol).
Then a **per-vessel config system** was added (`vessels/*.json`, single source of
truth loaded by server + served to client). Do NOT reintroduce brand identity into
the console core; vessel *files* may name real modeled vessels.

### Current state
- **Server running** (during dev) on port **8791**, active vessel **drix08**,
  logging ON (`logs/asv_*.jsonl`). Restart pattern: kill stale PIDs on the port
  first (see Testing notes), then `python asv_console.py --sim --vessel drix08`.
- **Vessels:** `drix08` is the **DEFAULT** (`DEFAULT_VESSEL_ID`) — it is the vessel
  actually operated, and the default also decides the AIS start-up scope (the service
  subscribes around the then-current spawn, so an Erie default left the traffic layer on
  the wrong water until a switch re-scoped it). `zboat_1800hs` (small battery ASV),
  `example_usv_4m` (battery),
  `drix08` = **Exail DriX H-8**, 7.71 m **diesel** (fuel model), operating from the
  **UDel Lewes facility** — spawn `38.789650, -75.160940` (Lewes-Rehoboth Canal
  centerline). DriX tuned params: `nogo_buffer_m 5`, `under_keel_clearance_m 0.3`
  (nogo floor 2.3 m), `channel_reach_m 120` (Rule 9 fairway reach for the wide
  Lewes channel), speeds 4/7/14 kn, `max_turn_rate_deg_s 20`.

### What was built this session (newest first — see commit hashes)
1. **Survey ops-awareness/editing:** hover current line → time-to-end tooltip;
   WPT-mode plan editing (drag waypoint / click-delete waypoint / **Shift**-click
   line to delete / plain click adds); **LINES** panel per-line table (length,
   plan, actual) logged as `client:survey_lines` via `POST /api/logevent`.
   Mission duration on Punch Out split into **Survey** + **Approach** vessel-card
   rows; TIME pill shows **local · UTC** (1 s ticker).
2. **Punch-Out channel exclusion:** a survey that SPANS ACROSS a channel excludes
   it from coverage (`channelSpanKeepouts`, survey-clip only — transits unaffected,
   internal-channel surveys unaffected). Channel = dredged area OR **buoy-gate
   fairway** (`pairGates` sweeps a corridor).
3. **Lateral channel marks (buoys/beacons):** server role `chan_mark` + `CATLAM`
   (cache bumped to `features_v3_`); client draws them (green port / red stbd),
   keeps clear, uses them as Rule 9 channel walls; `gateProject()` steers a
   Go-To/RTH through the outer gate centre and stands on past it.
4. **Rule 9 keep-right** vessel-tunable reach (`channel_reach_m`); DriX now keeps
   right in the ~150 m Lewes fairway (was tuned for tight marinas).
5. **DriX fixes:** couldn't route around ENC objects → buffer 10→5 m; UKC 0.5→0.3;
   spawn moved to Lewes (from Presque Isle).
6. **Trail:** persists across page refresh within a session, **dropped on sim
   reboot** (tagged with server `boot_id`).
7. **Named-reason nogo refusal highlight** for Go-To/RTH AND Survey/Transit/Punch
   Out legs (pulses the offending feature + ✕ marker; names the kind).
8. **Server:** suppress benign client-disconnect tracebacks; `boot_id` +
   `/api/logevent` + `/api/vessel(s)` endpoints; energy model (battery|fuel).

### NEEDS LIVE VERIFICATION (historical list — see the correction below). All were
unit/harness-tested where possible, but the click/drag/hover UX itself was unverified
in a real browser at the time:

> **The stated reason was WRONG and cost real coverage.** "localhost is blocked in the
> in-app browser" was never true — disproved 2026-08-02 by simply doing it
> (`preview_start` on `http://127.0.0.1:<port>/`, then `javascript_tool` to drive the
> page). Canvas screenshots do still time out, but `getImageData` reads the pixels
> instead. **A believed-blocked tool is worse than a missing one: nobody retries it.**
> Start a scratch console on a SPARE port so Andy's 8791 is untouched.
- WPT-mode waypoint **drag** feel + hit radius (10 px); **Shift**-click line delete.
- **Hover** time-to-end tooltip on the active line during a run.
- **LINES** panel live actuals + the auto-log on run end.
- Gate-pairing projection visually threading the Roosevelt Inlet jetty gate.

### Open threads / possible next
- Only ONE gate is charted in the Lewes ENC cell (Roosevelt Inlet jetty lights +
  Buoy 4); gate features engage only where marks exist.
- Mission-duration estimate is straight length ÷ speed (no turn/accel modeling).
- Could add a playback-viewer table view of the logged `survey_lines` events.

### Key gotchas learned (don't relearn these)
- **Client-side routing:** `routeAround`/`planNogoRoute`/`channelLaneRoute`
  are ALL browser JS (this list named `keepRight`/`gateProject` until they were
  deleted 2026-08-02). Driving via raw `/api/cmd/*` + `upload` with no `route`
  BYPASSES ENC routing → the boat crosses nogo. The GUI Punch-Out+Upload flow
  routes clear.
- **Go-To distance (2026-07-25):** two effects made distant Go-To inconsistent —
  (1) coverage: the nogo model is a ~5 km box and `doGoTo`/`doRTH`/`doTransit` didn't
  extend the fetch to the target (surveys do); (2) resolution: `routeAround`'s grid
  coarsens past ~4 km (cell = bbox/1400). **COVERAGE FIX shipped:** `ensureNogoCovers`
  (mirror of `ensureNogoArea`); the three behaviors are now `async` and `await` it
  (boat ⋃ target) before planning. **Resolution fix also shipped:** `routeAroundSeg`
  splits a leg >~4.5 km into ~2.2 km sub-legs (each keeps the fine 3 m grid), routes
  each with `routeAround`, stitches; `legPath` calls it. Safe by construction (falls
  back to a single `routeAround`); short legs byte-identical. Harness-validated on the
  Z-Boat (same code). Live GUI spot-check owed.
- **Stale server PIDs** on Windows hold the port and serve old code — always kill
  by PID before retesting server changes.
- **Testing pattern that works well:** extract the real JS functions from
  `static/asv.html` with a brace-balance grabber into a Node harness and run
  against real ENC fetched from `/api/enc` (see the many scratchpad `*.js` tests).
- Delete a stale `mission.json` to pick up new vessel defaults (it persists old
  buffer/arrival).
- **NDBC station id case:** `activestations.xml` lists coastal / C-MAN ids in
  **lowercase** (`lwsd1`, `cman4`), but the realtime2 data files are served under
  **UPPERCASE** (`LWSD1.txt`) — using the raw id 404s and silently drops the nearest
  local wind stations (near Lewes it fell back to a buoy 55 km out). Ids are now
  normalised to uppercase at ingestion + at the data URL; keep them that way.
