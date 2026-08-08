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
read the effect on the vessel card's **Wind / Sea / Set·crab** rows (sim only; a real
boat feels real weather). There is no ENV card — override or disable the forcing over
the API (`POST /api/env`).

## Run

```
python asv_console.py --sim            # simulator, opens a browser tab
python asv_console.py --sim --browser none --port 8791   # headless, no auto-open
python asv_console.py --sim --vessel example_usv_4m      # start on a different vessel profile
python asv_console.py --sim --single-window               # one window (no controls window)
python asv_console.py --sim --ais-collect-km 250          # collect a wider AIS area (sparse feed coverage)
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
and restored next session. The **vessel-status card stays on the chart window** — it is
not mirrored, because two copies of one card is a second place to look rather than a
second view; the chart window has the card, the top bar has the quick read, and the
controls window is the toolbar. **Every card on the chart window is resizable** —
drag its bottom-right corner; the size is remembered per card, and only a size you
actually changed is stored, so a card's default can still be improved later. If the controls window is closed the toolbar and panels
return to the main window automatically, and a **⏏ Controls** pill appears on the top
bar to reopen it — so the console is never left without its controls. Pass
`--single-window` to skip the second window.

### Vessel profiles

The console studies ASV behavior **across different vessel types**. Every
vessel-specific parameter — hull/windage, speeds, turn rate, autopilot gains, an
**energy model** (battery *or* diesel fuel), planning defaults (incl. under-keel
clearance), spawn — lives in one self-contained file under `vessels/<id>.json`,
and that file is the single source of truth (the server and the UI both read it,
nothing is hardcoded twice). **The default is `drix08`** — the DriX H-8 at Lewes.
Profiles that ship: `zboat_1800hs` (a small ~1.9 m
battery survey ASV), `drix08` (the Exail DriX H-8, a 7.71 m **diesel** survey USV
— shows fuel/endurance/range, not battery), and `example_usv_4m` (a larger
illustrative USV). Add your own by dropping a new complete `vessels/<id>.json`.

Selecting a vessel also changes the **nogo model**: the minimum navigable depth is
that vessel's `draft + under-keel clearance`, so the deep-draft `drix08` (2.5 m floor)
avoids shallow water the shallow-draft `zboat_1800hs` (1.0 m) can cross.

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
closed to a chip / reopened at will. The table always carries a **status line naming
the live feed and its coverage** — e.g. *connected · aisstream (global) · no vessels in
50 km yet*, or *connected · digitraffic (Finland/Baltic only)* — so an empty list tells
you whether the service is down, still warming up, genuinely quiet, or simply on a feed
that cannot cover where you are. It is **situational awareness only** — subject to
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
at it.

**Multiple sources merge into ONE picture.** Every enabled feed lands in a single
vessel registry keyed by MMSI, so the chart and table always show one combined
layer: each vessel carries `srcs` (every feed that has reported it) and `src` (the
feed whose *position* is displayed), a stale polled report can never walk a live
track backwards (static fields like the name still merge), and each source has its
own health entry — one dead feed beside a live one is a note, not an outage. Pick
sources for the auto-started service straight from the console:

```
python asv_console.py --sim --ais-nmea udp:10110                                # + AIS-catcher / rtl-ais receiver
python asv_console.py --sim --ais-opencpn 10110                                 # + OpenCPN relaying its inputs
python asv_console.py --sim --ais-source aisstream,nmea --ais-nmea udp:10110 --ais-nmea udp:10111
```

(Naming an endpoint is asking for its source — `--ais-nmea`/`--ais-opencpn` enable
`nmea`/`opencpn` by themselves.) Running `ais_service.py` by hand is only for
advanced/standalone use:

```
python ais_service.py --source aisstream,nmea --nmea udp:10110 --nmea tcp:127.0.0.1:2000
```

Sources (any combination, comma-separated — all merge):

- **digitraffic** — Finland/Fintraffic open REST feed ([meri.digitraffic.fi](https://www.digitraffic.fi/en/marine-traffic/)),
  keyless, CC BY 4.0. Real live vessels in Finnish/Baltic waters — proves the pipeline
  out of the box.
- **aisstream** — [aisstream.io](https://aisstream.io/) global real-time WebSocket; the
  source for real **US / Great Lakes** coverage (a bundled stdlib WebSocket client — no
  pip). Needs a **free API key**: set `AISSTREAM_KEY` once
  (`setx AISSTREAM_KEY KEY` on Windows) and every console on the machine picks it up;
  a per-project `ais_key.txt` or `--aisstream-key` also work. `--source auto` uses it. On a Great Lake the console pulls the
  **whole lake and shows every contact in it**; at sea it **collects a wide area (150 km)
  and shows a narrower radius out of it — 50 km by default, changed LIVE from the range
  control on the AIS traffic card**. Because the wide area is already collected, widening
  the view is instant and never re-subscribes; the control clamps to the collected width,
  and the card reports *"3 of 6 in 150 km"* so *nothing out there* is distinguishable from
  *I narrowed it down myself*. `--ais-radius-km` sets the control's starting value and
  `--ais-collect-km` the collected width — raise the latter where receiver coverage is
  thin: at the Delaware Bay mouth 50 km sees almost nothing because the receivers are
  inland, while 150 km picks up the Bay and river traffic. Scope a
  standalone service to your area with `--bbox W,S,E,N` — note the leading-minus form needs an `=`, e.g. Lake
  Erie: `--bbox=-83.7,41.2,-78.7,43.05`. **Verified live on Lake Erie** — real lakers,
  tankers, tour and Coast Guard boats; ship types fill in over the ~6 min AIS static cycle.
- **aishub** — the [AISHub](https://www.aishub.net/) member data-sharing pool, HTTP-polled
  at their one-request-per-minute limit. Access needs a **member username**
  (`setx AISHUB_USER AH_XXXX` or `--aishub-user`), and membership is earned by
  **contributing a feed** — so this source stays skipped until a receiver is feeding
  AISHub. An upstream refusal (measured: `Invalid username or password!` on HTTP 200)
  surfaces on the card in the upstream's own words, never as an empty sea.
- **nmea** — local **RTL-SDR + [AIS-catcher](https://github.com/jvde-github/AIS-Catcher) / rtl-ais**
  receiver(s) emitting NMEA **AIVDM** (VHF 161.975 / 162.025 MHz) — the real onboard
  receiver path, decoded by the service (a bundled stdlib AIVDM decoder; no pip).
  Repeat `--nmea udp:PORT` / `--nmea tcp:HOST:PORT` (`--ais-nmea` on the console) to
  merge **several endpoints at once** — say AIS-catcher on one UDP port and rtl-ais on
  another — each with its own named health entry (`nmea-udp-10110`, …). `udp` binds and
  listens (what both decoders send by default); `tcp` connects to a served stream.
- **opencpn** — **[OpenCPN](https://opencpn.org/)** relaying everything it aggregates
  (its own receivers, other networks) as an NMEA stream. In OpenCPN: *Options →
  Connections → Add Connection → Network, TCP*, port 10110, **Output** enabled; then
  `--ais-opencpn 10110` (console) or `--source opencpn` (service) connects and decodes
  what it serves. Nothing OpenCPN-specific is on the wire — the source is named so the
  card says where the picture is coming from.

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
   stay draggable and the pattern regenerates live, and the **crosshair grip at the
   centre moves the whole pattern** — every anchor by one delta, so shape, spacing and
   direction are preserved exactly. An alignment option
   (start / center / finish) positions the leftover margin. Both **Spacing** and
   **Direction** are editable fields — type a value to force the spacing or rotate
   the whole pattern to a bearing. `Add to plan` commits the lines + waypoints. Set
   arrival radius, speed (Low / Survey / High), and **completion** (below) in the
   command bar. The plan persists server-side (`mission.json`).

   **Chart source (`SRC`).** The ENC's answer to a paper chart's title block, as a
   card: **every cell in view, one row each** (broadest scale first, usage band
   spelled out), with the cell the vessel is actually in marked and named — where
   scales overlap it is the **largest-scale** cell covering the vessel, the sheet
   you are bound to navigate by. Then the **usage band**, the **chart datum** with the *live* water-level
   correction being applied, and WGS 84 / Mercator. It states the **sounding units
   on both sides**, because they differ: the chart image prints **feet**, while the
   ENC data and every depth the console computes — including this vessel's
   draft-derived nogo floor — are **metres**. Below that, the part a printed title
   block can't give you: the IHO **zone of confidence under the vessel right now**,
   with the **survey dates** and source behind it, read from the chart's own
   `M_QUAL` polygons and re-evaluated as the vessel moves. It matters — the DriX
   operating area at Lewes returns a mix of ZOC B and **ZOC D** (the lowest
   confidence class), and the card flags the poor ones in amber as you enter them.

   **Distance units (`DIST`).** A pill on the top bar switches every **long**
   distance — route lengths, distance remaining, HOME range, station distances —
   between **kilometres and nautical miles** (persisted, both windows). Display
   only: every stored and transmitted value stays metric. Deliberately outside it:
   short distances (spacing, buffers, depths, the LINES table) always read metres,
   chart tiles print feet as charted, and the AIS card always reads nm.

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
   tight marina. The buffer can never drop **below the active vessel's own**
   `planning.nogo_buffer_m` — a plan saved against a small boat must not quietly narrow
   a bigger one's clearance.

   **Charted hazards have a SIZE, not just a position.** A wreck symbol on a chart is a
   *position*: the casualty under it can be a 100 m ship, and the ENC says nothing about
   its extent or which way it lies. So wrecks, hulks, obstructions and awash rocks carry
   an intrinsic **50 m radius** (vessel-configurable via `planning.wreck_radius_m`), and
   the buffer is added on top of that as the margin it was always meant to be. Objects
   that genuinely *are* point-sized — piles, buoys, beacons — are unaffected. A sized
   hazard draws its circle on the chart, so you can see why a route swings wide.

   Where the chart gives a **sounding over** the hazard (`VALSOU`) that clears the
   vessel's own navigability floor — tide-corrected, the same as depth areas — the boat
   can pass over it and the hazard collapses back to a point. **No sounding means
   unknown**, and unknown takes the full berth rather than the benefit of the doubt. Depth areas that merely *straddle* the minimum are kept (classified
   by the band's deepest edge). `CHRT` / `NOGO` show the chart features / the red nogo
   overlay. (Finger piers are charted as line features that NOAA's server returns
   empty to a naïve query — the console fetches them by object-id so they aren't
   silently missed.)

   **Obstacle-aware order + line-to-line turns.** Where a keep-out splits a line, the
   waypoints are re-ordered (Boustrophedon Cellular Decomposition) so the ASV never
   runs a leg straight through the punched-out area — each obstacle-free region is a
   serpentine. At each line-to-line reversal Punch Out inserts a **generated turn**
   that rolls the boat onto the next line *aligned* with its heading instead of
   pivoting hard, and **shortens the survey lines** slightly to give the turn room.
   Every turn is built at a radius the boat can actually **hold** at the run speed
   (from the vessel file's `max_turn_rate_deg_s`), in one of two shapes:

   - **Semicircle** — where the line spacing is at least twice the minimum turn
     radius. One 180° arc of radius *half the spacing*, reaching no further than that
     past the line ends. The classic boustrophedon turn, and what a small ASV gets at
     any realistic spacing (the 1.9 m survey ASV needs only ~2 m of radius at survey speed).
   - **Teardrop** — where the spacing is *tighter* than that. A semicircle at half the
     spacing would be tighter than the boat can hold, so the turn instead loops at the
     boat's **own minimum radius**: a short arc away from the next line, a >180° loop
     back over the top, and a short arc onto the line. Decoupling the turn radius from
     the line spacing is the point — an 8 m USV at 7 kn needs ~14 m of radius, which a
     15 m line spacing can never supply as a semicircle. The trade is outboard water:
     a teardrop reaches up to ~2.75× the minimum radius past the line ends, so the
     readout and banner quote the excursion, the spacing a semicircle *would* need,
     and the spacing needed at low speed.

   Both shapes are **nogo-validated** before use. If even the teardrop can't fit clear
   of the keep-outs the reversal falls back to a straight hop, and the banner says so
   plainly — a straight hop between anti-parallel line ends is a 180° reversal at half
   the spacing, i.e. the radius that was just rejected, so that case is a warning to
   act on (widen the lines, slow down, or move the line ends), not a working turn.

   The turn waypoints — the line reversals and the arc points — are drawn
   **unlabeled** (each line already carries its own `L#` label, so per-point `W#`
   numbers are just clutter), and arcs are sampled coarsely (~3 m) so a wide-spacing
   survey doesn't flood the plan with turn waypoints. Turns and any longer transit are
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

   The vessel-status card's **Nogo** row names which of four things is true, because they
   are not interchangeable: *reading chart… 6 s* (with the seconds climbing, so a chart
   service that has stopped answering doesn't look like a slow first fetch), *334 zones ·
   floor 2.3 m* (the depth floor is **this vessel's** — draft + under-keel clearance — and
   the tooltip breaks the count down by kind: docks, shoreline, hazards, shallow water,
   land, buoys), *clear — none charted*, or the reason there is **no model at all**. That
   last one is the one that matters: "the chart was read and there's nothing to avoid" and
   "nothing has been checked and every route is direct" both look like zero zones and mean
   opposite things, so only the second is flagged amber and says so.

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

   **The card says where the run leaves the boat.** With End of Plan = **RTH** the
   console chains a real ENC-routed Return-to-Home at the end of a **Go-To** or
   **Transit** exactly as it does at the end of a survey — so the vessel-status card's
   **Mission** block reads *End mode: **RTH*** for all three from the moment the run
   starts, and its status line calls the last moments *"END OF PLAN — returning home
   (RTH)"* instead of a loiter. It only says RTH when the return can actually happen:
   no home set, disarmed, E-STOP latched, a **Repeat** run that never ends, or a return
   that was routed and refused all read as what the boat will really do instead.

   That **Mission** block — type, waypoint progress, routed length, distance and time to
   the end, end mode, run time, and a plain-language status line — is the one readout
   every commanded run shares (survey, search, Go-To, RTH, transit). It used to be its
   own pop-out card, which put the boat on one card and its run on another; it is now a
   section of the **vessel-status** card that appears only while there is a run to
   describe.
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

**Water level you can trust at a glance.** The live level is only the tide near the
station it came from, and the console interpolates the nearest few. So the readout shows
its own confidence **graphically**: within 25 km it reads normally; beyond that it is
**ghosted and italic** (indicative only — tidal range and phase drift over tens of km);
beyond 75 km it is **heavily ghosted with a warning**, because that is simply another
area's tide. The nearest contributing station decides, so a blend dominated by a close
station still reads as local. Hover for the station list with distances.

Beyond 75 km the level is also **not applied to charted depths** — routing falls back
to **chart datum**, the same as when there is no data at all. A tide from another coast
would otherwise credit the boat with depth nobody has measured here. A *far* reading is
still applied (indicative), and a **manual override always is** — it is your own number.

**ROC · HOME — Remote Operations Centers and a moving recovery point.** Missions are
commanded from one or more **Remote Operations Centers**, and the `ROC` card tracks
them. Click **+ Shore** or **+ Ship**, then click the chart to place one:

- A **shore ROC** is a (usually fixed) antenna position. The real launch/recovery
  point is **offset** from it by an operator-entered range and bearing — *"the ramp
  is 40 m at 210° from the antenna"*.
- A **ship ROC (mothership)** is aboard a vessel near the mission area, so it is a
  **moving** point. Its offset is normally taken **relative to the ship's course**,
  so *"50 m astern"* stays astern as the ship turns.

Each ROC comes up **STAGED** — edit its position (and a ship's heading and speed)
while it sits still, then **Confirm** to make it **ACTIVE**. A confirmed ship starts
steaming; **Hold** stops it and returns it to staged. Only an active ROC may be
selected as **HOME**, and when HOME is a ship, **Return-to-Home chases it live**.

Two things scale with the **active vessel**, because a single number cannot serve a
2 m ASV and a 20 m one:

- The default **astern-recovery standoff** for a new ship ROC scales with the hull
  (overridable per vessel with `planning.roc.ship_recovery_m`).
- A **closing check** compares the ship's speed against the ASV's top speed. A
  mothership a fast ASV overhauls easily is one a slow ASV never catches, so the card
  and the RTH banner report the closing rate and flag a recovery point that cannot be
  reached — rather than letting the boat chase it indefinitely.

A ROC's position can be typed in, **pushed** by any external process to `/api/roc`,
or read from a real **NMEA-0183 GPS feed** over TCP or UDP (checksum-verified; a void
fix is rejected). `gps_sim.py` is a faithful stand-in emitter for when no hardware is
present, and the console can spawn one per ROC on request.

## Documentation

Four documents in `docs/`, each aimed at a different reader:

| Document | For | Covers |
|---|---|---|
| **Quick Start** | first-time users | Running it, a first commanded behaviour, a first survey — about twenty minutes |
| **Operations Manual** | operators | Safety model, the display, chart awareness, every behaviour, planning depth, contingencies, checklists, glossary |
| **Technical Manual** | engineers | Architecture, the vessel-configuration system, subsystems, the HTTP API, formats, constants, extension recipes |
| **Development Guide** | contributors | How the project is built and verified: testing philosophy and its failure modes, recurring defect shapes, worked case studies, extension recipes |

All four are **generated** from scripts in `tools/`, sharing one formatting module
(`tools/docx_kit.js`). **Never hand-edit a document** — edit its script and rebuild:

```
cd tools && npm install && node build_docs.js
```

Each generator is standalone (`build_quickstart.js`, `build_ops_manual.js`,
`build_tech_manual.js`, `build_dev_guide.js`) if you only want to rebuild one.

`docs/` also holds `ASV-Console-Programming-by-Conversation.pptx`, a
presentation on this project and the Domain-Expert Specification (DES) schema
for a graduate audience. It has its **own generator**, separate from
`build_docs.js` and not covered by `tests/docs_valid.py`:

```
cd tools && npm install && node build_deck.js
```

Its icon set is pre-rendered in `tools/deck_icons.json`; regenerate that only
when changing icons (`tools/build_deck_icons.js`, which documents its own
extra dependencies).

## Tests & git hooks

The regression suites in `tests/` guard behaviour that has bitten — and, since the
E-STOP suite, behaviour whose failure would be worst, whether or not it has failed yet.
**The directory is the authority**: the pre-commit hook derives its run list from
`tests/` itself, so a new suite runs from the day it is written, and each suite's own
docstring says what it guards and how its teeth were verified. This section describes a
representative sample, not the full set. Most suites run the real page code against
synthetic worlds with stdlib Node and no server; the Python ones include several that
drive a **real console** over the API. Run everything at once with:

```
for f in tests/*.js; do node $f || break; done
for f in tests/*.py; do python $f || break; done
```

```
python tests/estop_chain.py
```

**E-STOP chain** — the most safety-critical control in the console, and the first suite
written for *consequence* rather than in reaction to a bug. With the boat genuinely under
way it proves the latch reaches the vessel (speed over ground falls to a standstill **and
the vessel itself reports the stop** — the console's own flags agreeing with each other is
not evidence the seam carried it), force-disarms, refuses arming and commands while held,
and releases cleanly: clearing the latch leaves the boat SAFE and disarmed, never silently
re-armed, while a deliberate re-arm runs again — E-STOP is not a one-way trip.

```
node tests/buoy_lane.js
```

The **Rule 9 channel lane** — the ASV riding starboard of the channel centreline, in
marked *and* unmarked channels, both directions, with a lone buoy correctly *not* treated
as a wall.

```
node tests/turn_geometry.js
```

**Survey line-to-line turns** — that each reversal ends on the next line *aligned*, that no
part of it asks the boat to hold a radius tighter than it can at the plan speed (checked
along the whole path, not just at the nominal radius), that the outboard excursion reported
to the operator is what the path actually does, and that a keep-out over the loop refuses
the turn. Both a fast-turning small hull and a slow-turning larger one are exercised, since
the turn shape is chosen from the **active vessel's** minimum turn radius.

```
python tests/roc_tracks.py
```

**ROC arrival geometry and moving HOME** — that a recovery point lands where the offset
says (including a *relative* offset following the ship round), that only an **active** ROC
can be HOME, that a steaming ship's HOME actually moves, that corrupt NMEA is rejected
rather than fed to the boat, and that every vessel-derived default **re-derives on a
vessel switch** rather than going stale.

```
node tests/water_trust.js
```

**Water-level trust** — that a tide reading from another coast is flagged rather than
shown as if it were local, and that the *nearest* contributing station decides.

```
python tests/completion_modes.py
```

**End-of-plan setting vs the run in progress** — that commanding a Go-To (which correctly
station-keeps at its own endpoint) can never change the operator's **End of Plan**
selection, and that a plan run actually *adopts* that selection. This one drives a real
console over the API, because the failure it guards was an interaction between a command
and persisted state.

```
node tests/end_action.js
```

**End action** — that the card names where the run actually leaves the boat: an
end-of-plan Return-to-Home shows as **RTH** on a Go-To, a Transit and a survey alike,
from the start of the run rather than the moment it fires; that it is *not* promised
when the chain cannot fire (no home, disarmed, E-STOP, a Repeat run, a refused route);
and that the one-shot re-arms for a run commanded while the boat is already under way.

```
node tests/nogo_readout.js
```

**Nogo readout** — that the row stops saying "reading chart" once the extract has actually
landed (it used to be painted one statement too early and stuck there forever, on the one
path that ends in a working model), and that *"clear water"* and *"no chart at all"* — both
of which look like zero keep-outs — never read as the same thing.

```
node tests/pattern_move_grip.js
```

**Survey move grip** — that the centre handle for moving a whole pattern is both reachable
(hit test, with corner handles still winning ties so a small pattern stays reshapeable) and
**visible**: it is drawn last, above the boat marker, because the boat sits at the centre of
a survey box more often than not and used to cover it completely.

```
node tests/survey_card.js
```

**Survey card** — that a COMMITTED plan is still described on the survey card instead of
blanking the moment its pattern anchors are dropped, and that the figures are derived from
the committed lines rather than remembered (so they cannot drift from the plan, survive a
refresh, and follow a plan edited in WPT mode).

```
node tests/speed_recalc.js
```

**Speed recalculation** — that changing the plan speed actually recalculates (the console
advises on speed, so acting on that advice has to change something), and that a plan already
committed is re-checked against the turn radius the new speed implies: slowing down is always
safe, speeding up can make a committed reversal untrackable while the plan looks identical.

```
python tests/live_speed.py
```

**Live speed** — that a speed change actually reaches the boat: with the boat under way,
speed over ground follows the commanded speed both up and down. It drives a real console and
lets the boat accelerate, because accepting the command proves nothing — the bug it guards
accepted it too and never told the boat.

```
python tests/ais_range.py
```

**AIS range** — that the display range filters the collected area as a true range circle
(not the collect box), that it is clamped to what was actually collected, and that it is
**never applied on a lake**, where every contact stands. Runs against a stub provider at
known ranges, so it tests the console rather than today's real traffic.

```
node tests/ui_split.js
```

**UI split** — that every selector the two-window bridge names still resolves against the
page (a stale one fails silently: a panel just stops mirroring), and that the vessel-status
card stays on the chart window — not mirrored into the controls window, and not stripped
from the chart either.

A pre-commit hook runs all of them automatically whenever a source they cover, or any test
itself, is staged, and blocks the commit if an invariant regresses. The hook is versioned in
`.githooks/`; **enable it once per clone**:

```
git config core.hooksPath .githooks
```

Bypass in a pinch with `git commit --no-verify`.

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
