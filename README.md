# ASV Simulator Console

A browser-only command-and-control (C2) shore station and simulator for a
**small-class survey ASV** (autonomous surface vehicle) — a small (~2 m × 0.75 m),
battery-powered boat for **short surveys in constrained waters**. Plan a survey (or
search pattern, or a transit line) on a live NOAA-ENC chart, and run it — or a
one-off **Go-To / Return-to-Home / Hold / Transit** behaviour — on the boat's
Vehicle Control Unit (VCU), while watching position (decimal degrees),
heading, speed, **battery voltage** and autonomy state.

Every commanded motion is planned **clear of charted ENC obstacles** (shoreline,
piers/docks, and shallow water) — the console extracts a **nogo model** at startup
and routes Go-To, RTH, search, transit and survey transits around it.

Single-file, Python-3 standard library only. No pip, no build step. Run it, a
browser tab opens. Defaults are scaled for the ~2 m boat (tight turns, small
keep-clear buffer, short survey/search patterns).

> **The RC transmitter is master.** This console is *additive* shore-side C2. It
> never replaces the RC transmitter, whose Autonomy switch (Sw A) and E-stop are
> the true failsafe. Autonomous-only by design — live manual driving stays on
> the RC.

## Status — Phase 0 (sim-first, no hardware)

The VCU's shore-side wire protocol is left unspecified in this simulator (a real
integration would supply the vehicle's own frame format). This build runs the **entire UI, command flow and
safety model against a built-in simulator** (`SimVcu`). The real-hardware path
(`RealVcu`) opens the transport for reachability but **refuses to send commands**
until the protocol is captured — it fails honestly rather than emitting an
uncertain frame to a real boat. See [PLAN.md](PLAN.md) for phasing.

Sim mode drives the whole console with no hardware — see
**[README_SIM.md](README_SIM.md)** for a full description and step-by-step
operating instructions (GUI + headless API), the boat model, the command flow,
and the safety gates. Sim mode also runs an **environmental simulator**: it pulls
**real-time wind + sea state** from the nearest NOAA buoys and pushes the boat off
course (a steady crab + a gust-driven wander the autopilot steers out) — toggle or
override it from the **ENV** panel (sim only; a real boat feels real weather).

## Run

```
python asv_console.py --sim            # simulator, opens a browser tab
python asv_console.py --sim --browser none --port 8781   # headless, no auto-open
python asv_console.py --sim --vessel example_usv_4m      # start on a different vessel profile
```

### Vessel profiles

The console studies ASV behavior **across different vessel types**. Every
vessel-specific parameter — hull/windage, speeds, turn rate, autopilot gains,
battery banding + drain, planning defaults, spawn — lives in one self-contained
file under `vessels/<id>.json`, and that file is the single source of truth (the
server and the UI both read it, nothing is hardcoded twice). Profiles that ship:
`zboat_1800hs` (a small ~1.9 m survey ASV), `drix08` (the Exail DriX H-8, a 7.71 m
diesel-powered survey USV), and `example_usv_4m` (a larger illustrative USV). Add your own by dropping a
new complete `vessels/<id>.json`.

Pick the active vessel with `--vessel <id>`, or switch live from the **vessel
selector** in the top bar (allowed only when disarmed and stopped — swapping
physics under a running boat is refused). Switching in sim respawns the boat with
the new vessel's parameters, so you can run the same mission on different hulls
and compare.

Real link (Phase 2+, once the protocol is known), serial-over-IP by default:

```
python asv_console.py --vcu 192.168.x.y --vcu-port 4001 --transport tcp
```

Offline chart prep (bulk-cache NOAA ENC tiles for a survey area):

```
python asv_console.py --fetch-charts "42.137,-80.087,3" --zooms 8-16
```

A **Quick Start** card opens on first launch (and any time via the `?` button)
with the survey-planning and command steps below.

## Using it

1. **Plan** — `WPT` to drop/remove waypoints, or `SURV` for a **CAMP-style
   3-click survey pattern**: click the start corner, the opposite (diagonal)
   corner, then a third point that sets the **line spacing** (distance from the
   start) and **orientation** (its bearing). Parallel lines fill the box
   automatically as a boustrophedon (lawnmower) route — the line *count* is
   derived from width ÷ spacing, not entered by hand. All three control points
   stay draggable and the pattern regenerates live; an alignment option
   (start / center / finish) positions the leftover margin. Both **Spacing** and
   **Direction** are editable fields — type a value to force the spacing or rotate
   the whole pattern to a bearing. `Add to plan` commits the lines + waypoints. Set
   arrival radius, speed (Low / Survey / High), and **completion** (below) in the
   command bar. The plan persists server-side (`mission.json`).

   **Search patterns.** `SRCH` generates a canned search route (à la CCOM's
   Project 11 `track_patterns`): **Expanding box**, **Sector**, or **Parallel /
   creeping-line**. Click a datum, tune the params (leg / radius / spacing /
   heading / turn), and `Add to plan`. Legs clip to the nogo zones just like a
   survey (green kept / amber routed-around / red blocked).

   **Punch Out (chart-feature clipping).** Draw a survey rectangle, set the survey
   **depth window** (Min depth, optional Max — blank surveys deep water), and click
   **Punch Out**: the console trims every survey line to safe water using the same
   **nogo model** every behaviour avoids — off land / shoreline / **piers & docks**,
   outside the depth window, and clear of fixed aids, hazards and (optionally)
   dredged/restricted areas, each expanded by the keep-clear **Buffer**. The buffer
   and the enforce toggles are **shared** (edit the buffer from the SURV panel or the
   command bar's *Buf m*); lowering it (to ~1.5–2 m) lets the small boat thread a
   tight marina. Depth areas that merely *straddle* the minimum are kept (classified
   by the band's deepest edge). `CHRT` / `NOGO` show the chart features / the red nogo
   overlay. (Finger piers are charted as line features that NOAA's server returns
   empty to a naïve query — the console fetches them by object-id so they aren't
   silently missed.)

   **Obstacle-aware order + teardrop turns.** Where a keep-out splits a line, the
   waypoints are re-ordered (Boustrophedon Cellular Decomposition) so the ASV never
   runs a leg straight through the punched-out area — each obstacle-free region is a
   serpentine. At each line-to-line reversal Punch Out inserts a **teardrop turn** —
   a smooth semicircular loop that rolls the boat onto the next line *aligned* with
   its heading instead of pivoting hard — and **shortens the survey lines** slightly
   to give the turn room within cleared water. A teardrop is only used where its
   radius is one the boat can actually hold at the run speed; for spacing/speed too
   tight to hold, the turn stays a straight hop (the readout says so) rather than a
   loop the boat would overshoot. Turns and any longer transit are
   **nogo-validated**: a transit that would cross a keep-out is **auto-routed around
   it** (grid A\*, drawn amber); only a transit with *no* clear route stays **red**
   and flagged.

   **Real-time water level.** ENC depths are charted to a fixed datum (Low Water
   Datum in the Great Lakes, MLLW in the oceans), which can differ from the actual
   water level by tenths of a metre to over a metre. On startup the console takes
   the vessel's GPS position + the clock, finds the **nearest NOAA CO-OPS tide
   stations**, **interpolates their live water levels** (inverse-distance weighted)
   to the vessel — capturing the spatial gradient (seiche tilt across a lake, tide
   phase along a coast) rather than assuming one station's level everywhere — and
   **adds that to the charted depths** so Punch Out uses the depth available *right
   now* (it refetches every 6 min and on a large move). Only stations sharing the
   vessel's datum are blended, and in the Great Lakes only stations in the *same
   lake* (LWD is defined per lake). **Fallback chain:** real-time *observed* levels
   → NOAA tide *predictions* (projected; ocean/tidal stations only) → the *ENC chart
   datum* itself (offset 0) as the safe default. The panel/card mark predicted (`~`)
   and chart-datum (`!`) fallbacks in amber so you always know which you're on. The applied offset shows in the
   command panel and vessel-status card; a **Water m** field lets you override it
   (e.g. offline), and ↻ forces a refresh. Falls back to the chart datum if no
   station is reachable. It is a
   **planning aid, not a hydrographic-certified ENC engine** — ENC scale/currency
   varies and the operator remains responsible for the plan (a banner says so).
   Needs a connection the first time an area is fetched; features cache to
   `charts/enc/` for offline reuse.

   **Arbitrary survey-area boundary.** `BND` draws a **CAMP-style survey-area
   polygon** — click the chart to drop points, click the first point to close
   (vertices are draggable). The survey lines are clipped exactly to that polygon,
   including concave shapes (legs crossing a notch split into two). It **composes
   with Punch Out**: the boundary keeps lines *inside* the area, ENC features keep
   them *out* of hazards / shallow water. The boundary **persists** (saved in
   `mission.json`, so it survives a reload / a session at sea), and **`AREA`**
   shows / hides the boundary overlay — hidden, it still clips the lines; editing
   in `BND` always shows it.

   **ENC nogo — every behaviour avoids it.** On the first GPS fix the console
   extracts the ENC for the operating area and builds a persistent **nogo model**:
   shoreline + manmade structures (piers, docks, dolphins, breakwaters, locks…) +
   water shallower than **1 m corrected** (charted depth + live water level). `NOGO`
   toggles the red overlay. *Every* commanded motion routes clear of it — Go-To and
   RTH route around it (or refuse an unreachable target), search and survey legs clip
   to clear water, and the transit **to** a survey (boat → first waypoint) plus every
   inter-line transit is routed around obstacles at **Upload** (the ENC-clear path is
   drawn green from the boat, shrinking as it goes). If there's no ENC coverage the
   console warns and routes direct — verify the plan.

   **Keep right in channels (COLREGS Rule 9).** Every *transit* in **every
   behaviour** — Go-To, RTH, the drawn Transit line, the approach leg to a survey,
   the routed transits between survey lines (Punch Out), search-pattern transits,
   and any obstacle detour inserted at Upload — automatically keeps to the
   **starboard side of a channel** (relative to the direction of travel): the
   console finds both channel walls, defines the **centerline**, and tracks a
   smoothed lane **20 % of the channel width to starboard of center** so opposing
   traffic passes port-to-port. In open water (no wall to starboard) the track is unchanged, and
   the offset never trades away obstacle clearance — it falls back to the
   centerline path wherever the channel is too tight. Survey coverage lines and
   teardrop turns are not offset (they must stay on their planned geometry).
   A channel is treated as **extending past each end by its own width**: the ASV
   stands on straight out of a mouth (and lines up before entering one) instead
   of turning across the opening where opposing traffic appears.

2. **Behaviours (no survey plan needed).** Beyond a survey/search plan, the command
   bar drives one-off autonomy behaviours, all available once **Armed**:
   - **Go-To** — click a point; the boat drives there (around obstacles) and holds.
   - **Transit** — `TRAN`, draw a single- or multi-segment line, then **Follow**; the
     boat drives the line clear of obstacles and station-keeps at the end.
   - **Hold** — station-keep at the present position.
   - **RTH** — Return-to-Home: drive to the home point (auto-set at launch, or **Set
     Home**) and station-keep.

3. **Arm** — comes up **SAFE**. `Arm` confirms an operator is on the RC with Sw A
   forward. Every actuating command is gated behind arming.
4. **Upload → Start** — push the plan to the boat, then start the run. The transit is
   routed clear of obstacles at Upload; **completion** (command bar) sets what happens
   at the end — **Complete** (stop), **Loiter** (station-keep at the last waypoint), or
   **Repeat** (loop the route). Watch waypoint progress, track, and battery.
5. **Pause / Stop / E-STOP** — Pause holds the next waypoint; Stop aborts the
   plan; the command E-STOP latches motors to zero and disarms. Link-loss also
   halts commanding automatically and surfaces the boat's own failsafe.

**Session recording (for a future playback mode).** Every run is recorded
automatically to `logs/asv_<timestamp>.jsonl` — one JSON event per line: every
command / setting / action the console receives (arm, upload, start/pause/stop,
E-STOP, Go-To/Hold/RTH/Transit, Set-Home, approach + buffer + completion changes,
connect/disconnect, mission edits, comms & water-level settings) with its input
and outcome code, interleaved with a telemetry trace of the same state the browser
sees (a full snapshot on every transition, plus a ~1 Hz position/heading/speed/
battery sample in between). It works identically in sim and against a real VCU.
Passwords are redacted; the file is append-only and line-buffered, so a crash or
kill still leaves a complete record. It's on by default (both sim and live);
`--no-log` disables it. `logs/` is gitignored.

**Playback.** Open **`/playback`** (or the **▶ Playback** link in the top bar) to
replay any recording on the same chart: the boat drives its recorded track, the
plan and commanded routes appear as they were sent, a timeline lists every command
and state transition (rejected ones in red), and the vessel card shows the state at
the cursor — with play/pause, speed, and a scrubber. It's **read-only** (no
commanding) and works for sim and real sessions alike. See
[README_PLAYBACK.md](README_PLAYBACK.md).

## Architecture

Forked from the sibling **companion Console**, reusing its proven stdlib
infrastructure: the slippy NOAA-ENC map + local tile cache, the Ubiquiti-airOS /
Starlink comms monitor, the mission store, and the SSE state stream. The new
piece is the `VcuLink` seam (`SimVcu` + honest `RealVcu` stub) and the C2 layer.

```
Browser (asv.html) ── HTTP + SSE ── asv_console.py
                                         ├── VcuLink (SimVcu | RealVcu)
                                         ├── CommsMonitor (WiFi / Starlink)
                                         ├── Mission store (mission.json)
                                         ├── SessionLogger (logs/*.jsonl)
                                         └── Chart tile cache (charts/)
```

The **SessionLogger** taps the two choke points every command and every state
update already pass through — `do_POST` (commands/settings) and the Engine's
state publish (telemetry) — so recording is transport-agnostic (sim or real) and
adds nothing to the command path but a best-effort append.
