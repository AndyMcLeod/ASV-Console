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
python asv_console.py --sim --browser none --port 8791   # headless, no auto-open
python asv_console.py --sim --vessel example_usv_4m      # start on a different vessel profile
python asv_console.py --sim --single-window               # one window (no controls window)
```

**Multi-monitor.** On start the server opens **two** windows: the **main** window
(chart, status, command bar) and a **controls** window (`?panel=controls`) holding
*only* the control column and its pop-out panels — drag it to a second screen for a
clean chart. The tabs name themselves **ASV Chart** and **ASV Controls** so they are
easy to tell apart. The two are bridged over a same-origin BroadcastChannel: the main
window runs all the logic and owns the chart, the controls window mirrors its controls
and forwards your clicks and edits back. You still draw on the main window's chart. In
the controls window the buttons become a vertical column on the left and each panel or
table becomes a **draggable, resizable card**; the layout is saved to `localStorage`
and restored next session. If the controls window is closed the toolbar and panels
return to the main window automatically, and a **⏏ Controls** pill appears on the top
bar to reopen it — so the console is never left without its controls. Pass
`--single-window` to skip the second window.

### Vessel profiles

The console studies ASV behavior **across different vessel types**. Every
vessel-specific parameter — hull/windage, speeds, turn rate, autopilot gains, an
**energy model** (battery *or* diesel fuel), planning defaults (incl. under-keel
clearance), spawn — lives in one self-contained file under `vessels/<id>.json`,
and that file is the single source of truth (the server and the UI both read it,
nothing is hardcoded twice). Profiles that ship: `zboat_1800hs` (a small ~1.9 m
battery survey ASV), `drix08` (the Exail DriX H-8, a 7.71 m **diesel** survey USV
— shows fuel/endurance/range, not battery), and `example_usv_4m` (a larger
illustrative USV). Add your own by dropping a new complete `vessels/<id>.json`.

Selecting a vessel also changes the **nogo model**: the minimum navigable depth is
that vessel's `draft + under-keel clearance`, so the deep-draft DriX (2.5 m floor)
avoids shallow water the shallow-draft Z-Boat (1.0 m) can cross.

Pick the active vessel with `--vessel <id>`, or switch live from the **vessel
selector** in the top bar (allowed only when disarmed and stopped — swapping
physics under a running boat is refused). Switching in sim respawns the boat with
the new vessel's parameters, so you can run the same mission on different hulls
and compare.

Each profile also carries its own **spawn** position, so a vessel comes up in its own
work area — `zboat_1800hs` in **Erie** (Presque Isle Bay) and `drix08` at **Lewes**
(the UDel facility on the Lewes-Rehoboth Canal). To place the boat anywhere else,
press **Spawn** in the command bar and click the chart: the sim boat comes up there
instead, with the same clean slate as Reset (full energy, SAFE, no plan or home).
That override lasts for the current sim boot only — the profile's spawn is untouched
and is restored on the next start or vessel switch. Sim only; a real boat can't be
teleported.

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

### AIS layer (nearby vessels)

Marine **AIS** (Automatic Identification System) is how ships broadcast their
identity, position, course and speed — over VHF, and onto the internet via shore
and satellite receivers. The **AIS** button is a simple on/off overlay of the vessel traffic around the boat —
the **whole lake** when you're on an enclosed lake (e.g. a Great Lake), or **within
50 km** at sea: a triangle pointing along each vessel's course, coloured by ship type
(cargo / tanker / passenger / fishing / tug / …), with the name (or MMSI) beside it
and full details on hover — **and** in an **AIS traffic table** (each vessel by
range / bearing / speed, sorted nearest-first) that opens with the layer and can be
closed to a chip / reopened at will. It is **situational awareness only** — subject to
feed coverage, latency and gaps — not a navigation or collision-avoidance system.

The data comes from a **separate service, `ais_service.py`**, which the console
queries (proxied at `/api/ais`); the feeds and any API key stay out of the console
and the browser. **The console auto-starts it** — you never run it yourself. It's
scoped to your operating area (the whole lake, or a box around the boat) and is reaped
when the console exits (a parent-PID watchdog, robust even to a hard kill). The only
optional setup is a **free aisstream.io key for real US / Great Lakes coverage**, set
up once (otherwise it falls back to keyless digitraffic, Finnish/Baltic waters):

```
setx AISSTREAM_KEY YOUR_FREE_KEY    # one-time, machine-wide (or: echo KEY > ais_key.txt). Then just run the console.
```

`--no-ais-service` disables the auto-start (to use an external one); `--ais URL` points
at it. Running `ais_service.py` by hand is only for advanced/standalone use:

```
python ais_service.py --source nmea --nmea-host 127.0.0.1 --nmea-port 10110   # a local RTL-SDR receiver
```

Sources (any combination, comma-separated):

- **digitraffic** — Finland/Fintraffic open REST feed ([meri.digitraffic.fi](https://www.digitraffic.fi/en/marine-traffic/)),
  keyless, CC BY 4.0. Real live vessels in Finnish/Baltic waters — proves the pipeline
  out of the box.
- **aisstream** — [aisstream.io](https://aisstream.io/) global real-time WebSocket; the
  source for real **US / Great Lakes** coverage (a bundled stdlib WebSocket client — no
  pip). Needs a **free API key**: set `AISSTREAM_KEY` once
  (`setx AISSTREAM_KEY KEY` on Windows) and every console on the machine picks it up;
  a per-project `ais_key.txt` or `--aisstream-key` also work. `--source auto` uses it. Scope the feed to
  your area with `--bbox W,S,E,N` — note the leading-minus form needs an `=`, e.g. Lake
  Erie: `--bbox=-83.7,41.2,-78.7,43.05`. **Verified live on Lake Erie** — real lakers,
  tankers, tour and Coast Guard boats; ship types fill in over the ~6 min AIS static cycle.
- **nmea** — a local **RTL-SDR + [AIS-catcher](https://github.com/jvde-github/AIS-Catcher) / rtl-ais**
  receiver emitting NMEA **AIVDM** (VHF 161.975 / 162.025 MHz) over TCP or UDP — the real
  onboard receiver path, decoded by the service (a bundled stdlib AIVDM decoder; no pip).

Point the console at a non-default service with `--ais http://host:port` (default
`http://127.0.0.1:8788`). If the service isn't running, the layer simply shows
"AIS service offline" and no vessels.

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

   **Chart source (`SRC`).** The ENC's answer to a paper chart's title block, as a
   card: which **cell** the vessel is in (e.g. `US5DE1EF`) and how many more are in
   view, the **usage band**, the **chart datum** with the *live* water-level
   correction being applied, and WGS 84 / Mercator. It states the **sounding units
   on both sides**, because they differ: the chart image prints **feet**, while the
   ENC data and every depth the console computes — including this vessel's
   draft-derived nogo floor — are **metres**. Below that, the part a printed title
   block can't give you: the IHO **zone of confidence under the vessel right now**,
   with the **survey dates** and source behind it, read from the chart's own
   `M_QUAL` polygons and re-evaluated as the vessel moves. It matters — the DriX
   operating area at Lewes returns a mix of ZOC B and **ZOC D** (the lowest
   confidence class), and the card flags the poor ones in amber as you enter them.

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
   loop the boat would overshoot. The turn waypoints — the line reversals and the
   teardrop's arc points — are drawn **unlabeled** (each line already carries its own
   `L#` label, so per-point `W#` numbers are just clutter), and the arc is sampled
   coarsely (~3 m) so a wide-spacing survey doesn't flood the plan with turn
   waypoints. Turns and any longer transit are
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
   and any obstacle detour inserted at Upload — rides a **channel lane**:

   > offset to **starboard of the channel centreline**, half way out to the edge on
   > that side — a **quarter of the channel width in from the edge**.

   So the **centreline always stays to port**. Outbound that puts the green marks to
   starboard; inbound it puts the red ones there ("red right returning") — but
   **colour is never an input to the calculation**. It falls out, because lateral
   marks sit on fixed sides. Which side is "starboard" comes from the **direction of
   travel**, so the two directions ride opposite halves of the same channel and
   opposing traffic passes **port-to-port**.

   **What defines the channel.** Two sources, one rule:

   * **Marked channels** — each port-hand buoy is paired with its nearest
     starboard-hand buoy; the pair midpoints, in number order, are the centreline,
     and half the pair spacing is the local half-width. The console picks the
     channel by the **longest stretch of the routed path that actually runs along
     it**, so a channel merely passed nearby is ignored.
   * **Unmarked, channel-like water** — a basin exit, a canal, a cut between banks.
     The centreline comes from **the water's own edges**: the console looks out both
     sides and takes the middle of what it finds. This engages **only where both
     edges answer** within the vessel's channel reach (`planning.channel_reach_m`,
     120 m on the DriX; otherwise buffer-scaled) — genuinely confined water. Open
     water and a single bank nearby are left alone, so a plain open-water Go-To is
     never bent toward a channel that isn't there.

   A **lone buoy is not a wall.** Marks are kept clear (don't hit a buoy) but never
   bound the channel on their own — you may pass either side of a mark. Only
   *paired* marks define a fairway.

   **Safety first, every time.** The lane is *spliced into* the ENC-routed path, so
   the routing that gets the boat out of a basin or around a breakwater is preserved
   — the lane only replaces the stretch running along the channel. The offset is the
   largest that keeps the boat in **clear water**, rate-limited so the track eases in
   and out where one side is shoal. Every leg is clearance-checked; if a leg cannot
   be routed the lane is **abandoned entirely** and the plain routed path is used.
   The console never plans a leg it has not verified. Survey coverage lines and
   teardrop turns are never offset (planned geometry). The track is resampled at a
   fixed spacing and lightly smoothed, and generated Go-To / RTH / Transit waypoints
   draw as unlabelled diamonds. The banner reports when a plan rode the lane.

   > **History.** This replaced two earlier designs that both rode the *wrong side of
   > the buoys* on the water: a colour buoy lane that inferred direction from IALA
   > numbering, and a geometric keep-right that measured its offset by probing for the
   > channel edges. Measuring from a **paired-buoy centreline** instead is what made it
   > hold. Retired with them, and not currently implemented: standing on past a channel
   > mouth by the channel's own width, and steering through the outermost buoy gate.

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
   at the end — **RTH** (chain the ENC-routed Return-to-Home and station-keep at home;
   the default), **Complete** (stop), **Loiter** (station-keep at the last waypoint), or
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
