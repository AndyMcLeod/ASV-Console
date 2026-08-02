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

## ⇒ START HERE (handoff 2026-07-25, fresh context window)
**Repo:** local git only (no GitHub remote), clean, HEAD **`c350e00`**. Default web
port **8791** (Z-Boat is 8781 — they can run side by side). Run: `python asv_console.py
--sim`. **This session (2026-07-25)** added, all committed (details below in this file):
survey-turn declutter; draggable LINES card; **NDBC uppercase station-id fix**; the
default port 8791; Quick-Start scroll fix; the **AIS layer** (same generic
`ais_service.py` as the Z-Boat — console auto-starts it, lake-aware area, traffic
table, zero-config `ais_key.txt`/`--source auto`; see the AIS note); and the **Go-To
distance fixes** (coverage `ensureNogoCovers` + resolution `routeAroundSeg` sectioning;
see the gotcha note). Most of this session ALSO drove the **backport of these features
into the Z-Boat** (`D:\Claude\Zboat`) — keep the ASV brand-free; the Z-Boat is branded.
**Open:** live GUI spot-checks owed (AIS draw/table, Go-To fixes). The aisstream key now
lives in the **`AISSTREAM_KEY` user environment variable** (2026-07-31) — one value for
every console on the machine, no per-project `ais_key.txt`.

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
   REACH; both are dead): `CONFINE = max(120, channel_reach_m ?? buf*30)`.
3. `smoothTrack` — resample by ARC LENGTH at `STEP = max(45, buf*13)` (the waypoint
   count dial) + two light `[0.25,0.5,0.25]` passes to round the bends.

**Non-negotiable invariants — each one is a bug that actually shipped on the sibling:**
a lone buoy is NOT a wall (the edge march runs against a mark-free keep-out view);
SPLICE the lane into the routed path, never replace it; never emit an unverified leg
(abandon the lane instead); the full quarter-width is not always available (take the
largest offset that stays in clear water, then slew-limit); always SAMPLE a polyline,
never trust its vertex count; and measure the lane against the pre-shift samples, not
by marching perpendicular to the final route.

**Now dead here, kept for reference:** `keepRight`, `channelEndExtend`, `gateProject`,
and the whole colour system (`buoyageDir`, `buoyLaneAt`, `crossToLine`) — all only
reachable from `keepRight`. **DIVERGENCE FROM THE Z-BOAT:** the sibling deleted its
colour helpers outright; here they are left in place with the dead function (lower
risk, behaves identically since nothing calls any of it). **NOT implemented** (retired
with them): the channel end extension and the buoy-gate projection.

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
- `UI_BRIDGED` = `.controls` + every pop-out this console has. **No `#missionPanel` or
  `#rocPanel`** — the Mission card and the operations-centre/moving-HOME card are
  sibling-only features. Verified: every bridged selector, every `UI_CARD_TITLES` key and
  every `#id` named in the injected CSS resolves against this page's DOM.
- Controls-window CSS hides the chart/status/command bar, drops the vessel card rows the
  top status bar already shows, pins the buttons as a left column, and wraps each panel in
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
- Commands: `POST /api/cmd/{arm,upload,start,pause,stop,estop,rth,goto,hold,sethome,transit}`.
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
  the command-bar selector and the RTH chain read `s.completion`; the RUN MODE pill and
  Mission card read `runCompletion()`. `syncCompletionSel()` mirrors the server's setting
  back into the selector (skipped while focused), so the two **cannot drift unnoticed**.

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
turn: **the DriX H-8 needs 14.4 m of radius at its 7 kn survey speed (28.9 m of
spacing) where the 4 m USV needs 2.1 m (4.1 m)**, so ordinary small-boat line spacing
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
hook. Also ported in the same pass: the **Mission card** (`#missionPanel`, one readout for
every commanded run) and the **SURV whole-pattern MOVE GRIP** (`patDrag==="M"` — crosshair
at the A-B centre translates all CAMP anchors by one delta; corner handles win hit-test
ties). **NOT ported, by decision:** the sonar/payload subsystem — it hardcodes a specific
two-sonar fit and would need a vessel-declared `payloads` block first, and the single-beam
echosounder console is built from vendor manual citations and proprietary telegrams that
this console's sanitization rules forbid.

## Keep docs current

When a change alters **user-facing** behavior, update the relevant README(s) in
the same change — `README.md` (overview + "Using it"), `README_SIM.md` (sim model
/ command flow / endpoints / walkthrough), `README_PLAYBACK.md`. Don't let them
drift behind the code.

**The technical manual is GENERATED:** `docs/asv-simulator-technical-manual.docx` comes
from `tools/build_tech_manual.js` (docx-js; `npm install` in `tools/` first; output path
is script-relative). **Never hand-edit the docx** — edit the script and rebuild. If it
does get hand-edited in Word, diff the text against the generated version and fold the
edits back INTO the script. The manual is brand-free by rule: the console core names no
vendor; vessel FILES may name real vessels, since that is data rather than branding.

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

### NEEDS LIVE VERIFICATION (couldn't drive in the sandbox — localhost is blocked
in the in-app browser, and canvas screenshots time out). All were unit/harness-
tested where possible, but the click/drag/hover UX itself is unverified in a real
browser:
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
- **Client-side routing:** `routeAround`/`keepRight`/`planNogoRoute`/`gateProject`
  are ALL browser JS. Driving via raw `/api/cmd/*` + `upload` with no `route`
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
