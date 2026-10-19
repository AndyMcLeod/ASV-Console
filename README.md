# ASV Simulator Console

A browser-only command-and-control (C2) shore station and simulator for **survey ASVs**
(autonomous surface vehicles), from a ~1.9 m battery boat to the 7.7 m diesel **DriX H-8**.
Each hull is a profile under `vessels/` (see *Vessel profiles*); **the default is the DriX
H-8 with the Kongsberg EM712 gondola**. Plan a survey (or
search pattern, or a transit line) on a live NOAA-ENC chart, and run it — or a
one-off **Go-To / Return-to-Home / Hold / Transit** behavior — on the boat's
Vehicle Control Unit (VCU), while watching position (decimal degrees),
heading, speed, **energy** (fuel, endurance and range on a diesel hull; battery voltage
on an electric one) and autonomy state.

Every commanded motion is planned **clear of charted ENC obstacles** (shoreline,
piers/docks, and shallow water) — the console extracts a **nogo model** at startup
and routes Go-To, RTH, search, transit and survey transits around it.

Python-3 standard library only. **No pip, no build step, no bundler** — the page
and its ES modules under `static/js/` are served exactly as written. Seven of those
modules (`core_geodesy.js`, `core_geometry.js`, `core_turns.js`, `raster.js`,
`keepouts.js`, `routing.js`, `contracts.js`) began as copies **vendored from `asv_core`**.
The `core_` prefix marks the three whose natural name is already taken by a module of this
console's own.

> **⚠ Two of them are this repository's files now** (2026-08-31): `core_turns.js` and
> `keepouts.js` carry local safety changes — the turn that goes *away* from a dock rather
> than being abandoned, and the live clearance measure — that `asv_core` does not have.
> Their vendor headers still say *"DO NOT EDIT THIS COPY"* and name `tools/vendor.py`;
> **that instruction is wrong here and running it would silently delete the fix.** Each
> file opens with a note saying so, and `tests/clearance_guard.js` is what would catch it.
> A drift report from that repo is correct and expected. The other five are still plain
> copies and are still best changed at the source.

The console's own modules beside them include `guard.js` (what is AHEAD of the boat and
the four-rung ladder that answers it) and `hold.js` (where a boat is asked to hold, and how
much water it has there: a target inside a keep-out is held OFF at the nearest clear water
in any direction, and every holding command tells the vessel the radius certified clear
round its hold point (clear of the chart and of the AIS contacts the guard sees), so a boat set off station re-approaches direct only inside that
water and is routed back beyond it).

Run it, a
browser tab opens. Defaults (speeds, turn rate, keep-clear buffer, search-pattern sizes)
come from the active vessel profile, so they are the DriX's unless you start on another
hull with `--vessel <id>`.

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
the API (`POST /api/env`); disabled, the simulator applies no wind, no waves and no tidal
stream, which is what a calm, repeatable rehearsal needs. A **wind rose** sits on the chart itself — a graduated
compass ring with the wind needle and `wind N.N kn DDD°` (speed, from-direction) beneath it,
drawn with a transparent background (no card, no chip) and **draggable anywhere on
the chart**; it remembers where you put it and is clamped back into view if the
window shrinks.

**The status bar is two lines (2026-10-14).** The upper line, from the left, is the console:
the port and vessel pickers, the link, the autonomy state, Playback, Controls, the station
windows, and last any warning that comes and goes (`RESTART CONSOLE`, `DISK LOW`, the
supervisor's pill), so one appearing moves nothing already there (only a warning too long for
the room left can add a line, and that moves the readouts down, never sideways). The lower line, from the
right, is the vessel's live data - POS, SOG, HDG, COG, HOME→, PITCH, ROLL, the energy, WPT,
the units (METRIC / SAE) and TIME - each at a fixed width sized to its longest value, so nothing in
either line moves as the numbers change. Until then it was one line that wrapped inside the
readouts on most screens, and the readouts jumped between lines as their widths changed. Both
lines fit a window wider than about 1,200 px; a narrower one wraps a line, always at the same
place.

**Operating port + vessel — two choices, not one.** The top bar carries two pickers.
The **port** is *where you are*; the **ASV** is *what you are driving*. Selecting a port
sets the chart's opening view and, in sim, where the boat spawns — switching hull no
longer moves the boat, and switching base does. Shipped bases: **New Castle, NH**
(primary — Piscataqua River off the UNH Judd Gregg Marine Research Complex) and
**Lewes, DE** (the UDel Hugh R. Sharp Campus pier). `--base <port_id>` picks one at
launch.

**Ports you add are retained**, and there are two ways to add one:

* **⊕ Find port by name…** — type a place (`Nome, Alaska`) and the console *goes there*.
  The name is geocoded, and then — this is the part that matters — the result is
  **snapped to charted water deep enough for the selected hull**. A geocoder returns the
  centre of a *town*, and a town centre is on land: Nome resolves to a street corner, and
  the console moves it 600 m to charted 3.6 m water before calling it a berth. If no
  navigable water is charted nearby (somewhere landlocked, or off-chart) the port is
  still created at the place centre but **flagged unverified with the reason**, never
  presented as a berth. A name that matches nothing is refused outright.
* **+ Save this view as a port…** — pins the chart's current centre under a name you
  give it. This is the refinement step: once you can see the berth, put it exactly there.

Either way the entry is written to `ports.json` and is in the list from then on. That file is your **live registry** and is not tracked by git — the repository ships `ports.default.json`, which is copied to it on first run, so the bases you add are yours and never show up as repository changes. Both
pickers refuse while armed or running, for the same reason: moving the base under a live
boat is as incoherent as swapping its physics.

**Changing base is shown as the journey it is.** A **MOVING BASE** card comes up the moment
you pick — before the console has even been told where the new base is — and stays up
through the whole change, naming what is still outstanding: the lookup, the slew, then
reading the chart for the new area. It clears when the area is *ready*, not on a timer.
Under it the chart **slews**: it zooms out until both bases are on screen, crosses at a
constant speed across the glass, and zooms back in over the new one, with the two bases
ringed and named and the leg drawn between them. That last part matters because the tiles
for a place the console has never visited do not exist yet — the leg is drawn on the
overlay, so the move is legible over empty chart. The pan holds a constant *screen* speed,
so a 5 km hop and a 14,000 km one look the same and differ in time by the log of the
distance; touching the chart at any point ends the slew immediately **on the destination**.
Arriving is the quick part: the new area's keep-out model is extracted before the card
comes down, so the console is never sitting at a new base with the old sea's zones — or
with none, which is what it used to do.

*Previously the console opened on a hard-coded Lake Erie position belonging to neither
the vessel nor any base, and each hull file owned its own spawn.*

**The vessel marker is an isosceles triangle** with the sharp end down the **line of
travel** — course over ground while making way, falling back to heading when stopped
(below ~0.3 kn the COG is fix noise, and a marker that spins with it is worse than one
that holds). It replaced a circle, which showed where the boat was and nothing else.

Its colour is **the hull's own**, carried in `vessels/<id>.json` as `display.hull_color`
(and an optional `hull_color2` for a two-tone livery, filled across the aft third) — a
property of the boat, so it lives with the boat rather than in a table of vessel ids in
the page. Shipped: **yellow** for the small survey launch, **red** for the DriX. A vessel
file that names no colour falls back to the chart's default, so older profiles are
unchanged.

**AIS contacts use the same glyph**, smaller — they are boats, and drawing them as a
different shape would say they were a different kind of thing. Each points down its own
line of travel and is coloured by ship type: **green** cargo, **grey** military, **blue**
fishing, **black** tug / tug-and-tow, **pink** sailing. The remaining categories are
chosen only so no two collide. A contact reporting neither course nor heading is drawn
bow-north with no speed stalk — the missing stalk is what says it has no track.

The outline is picked from the fill's own luminance, light on a dark hull and dark on a
light one. That is not decoration: the chart ground is near-black, and a black tug drawn
with a dark edge measured as *invisible* on the live canvas.

**Surveying is not the same thing as being on a survey.** The vessel card carries two
rows, and the distinction between them is a paradigm the rest of the system follows:

* **Mode** — the behaviour the *run* is in (`survey`, `goto`, `rth`, `transit`). It stays
  the same for the whole run.
* **Doing** — what the vessel is doing *at this moment*. **SURVEYING means it is on a
  coverage line, and nothing else does.** The approach out of the harbor, every reversal
  between lines, a hop between separated coverage regions, a Go-To, a Return-to-Home —
  all **TRANSITING**: under way, but not acquiring coverage. Holding and idle are their
  own states, and a boat holding station *on* a line is holding, not surveying.

So a run can read `Mode SURVEY · Doing TRANSITING — approach to the survey area`, which is
the honest description of a boat an hour from its first line.

**Why it is drawn this sharply:** sonar is collected *continuously*, so nothing downstream
can tell coverage from transit by looking at the data — it has to be told. Every change of
activity is written to the session log with its time and position, so a recorded run can
be segmented into "these pings are coverage on line 7" and "these were acquired on the way
there" without re-deriving the classification from the track. One classifier, one answer:
anything that needs it reads `currentActivity()` rather than deciding for itself.

**And the recording carries every card.** A full `state` snapshot is written at least every
10 s (wind, sea, water level, current, comms, ROCs, the supervising tab), the AIS contacts the
page polls go in as `ais` records, and the page posts what only it knows — the nogo readout,
History rows, the guard bar, the LINES table and run-time readouts — on change. Playback
(`/playback`) resolves all of it at its cursor and puts every other record kind on its
timeline, so a replay populates the same cards the operator watched. The files are larger for
it, by design.

**And the recording goes quiet when there is nothing to record.** In the simulator, once the
boat has been home and idle for ten minutes (holding or stopped within 25 m of the home point),
the routine stream — state, telemetry, the page's activity and health rows — stops,
with one `log_quiet` record saying so; commands and lifecycle events still land. Planning a
mission (a plan saved with lines, or uploaded) or commanding the boat (Start, Go-To, RTH,
Transit) writes `log_resume` and the stream is back. The simulation itself keeps running and
the console stays ready; it is the file the rule is about. A real vessel's record never
pauses. `/api/state` carries `log_quiet`; `--log-quiet-s` shortens the wait for a harness
(`tests/log_quiet.py`).

**Intent — what, why, and what next.** The section under Run on the **Mission Status** card,
answering the question a moving track raises: *why is it doing that?* Three parts, updated
every telemetry frame. It was its own draggable pop-out behind an `INTENT` chip until
2026-09-05; the chip and the pop-out are gone, and it sits under the Run section on the
card that already carries the boat, for the same reason that readout moved there —
the boat and what it intends were on two cards the operator had to keep apart on the chart.
It is a long readout in a narrow card, so **the card scrolls** (its header sticks, and the
card is resizable and remembers its size):

* **Now** — **what it is doing** (surveying or transiting, and which line or why), the
  mode beneath that, which waypoint of how many and what that waypoint is, bearing and
  range to it, **off track**, speed. Off track is the signed displacement from the leg the
  boat is *actually flying* — the waypoint it last passed to the one it is running to —
  **named with its subject**: `12.4 m right of line 3` while a coverage line is the active
  leg, `12.4 m right of leg 7→8` on an approach, a reversal, a Go-To or an RTH. It is the
  perpendicular to that line of advance, not the range to the segment, so it does not
  decay into range-to-waypoint as the boat closes a turn; and before the first waypoint is
  passed it reads `— no leg of advance yet` rather than a `0.0` an operator would read as
  dead on track.
* **Speed** — three rows, because one number answers none of the questions once there are
  three speeds. What the boat is **making good** and what it was **told** (`6.8 kn · told
  7 kn`); the **role** that value is for and why (`SURVEY — on coverage line 7 of
  22`), so 14 kn in the middle of a survey reads as *TRANSIT — approach to the survey area*
  rather than as a fault; and all three **settings** with the live one in bold, so a value
  can be checked without opening the survey card. When the clearance guard has the throttle
  the middle row says **SAFETY OVERRIDE** instead — the role is not why the boat is slow.

  **Transit speed covers everything that is not coverage and not a reversal**: Go-To, RTH,
  the transit out to the start of a survey, hops between separated coverage regions, a drawn
  transit line, and the Return-to-Home that chains after a survey ends.

  **A reversal and a region hop are told apart from the plan, not from where the boat is.**
  The gap between two consecutive lines is a reversal when it is within four times the plan's
  own median end-to-start gap, and a transit otherwise — so a gap where a line was struck or
  dropped (two or three times the spacing) is still flown as the reversal it is, while a hop
  to another region, which is many times it, is flown as a transit. The committed plan's
  duration estimate is billed by the same rule, which is why the vessel card's **Survey** row
  can read `@ survey/low/high`: each part of the run is timed at the speed it will be run at.

* **Clearance** — beside off track, and the other half of *where is the boat*: its live
  distance to the **keep-out model**, named (`4.2 m to a dock / pier`), with `CLOSING` and
  `SLOWED` when either applies. Shown whenever the model is loaded and not only when it is
  tight, so the alarm is never the first you hear of the quantity.

  **This is the buffer applied to the boat rather than only to the plan.** Every other
  keep-out check in the console runs at *plan* time — Go-To, RTH, transit, Punch Out,
  Upload — so until 2026-08-31 a boat wide of its own track for any reason closed on
  charted structure unwatched. Inside the buffer the console **alarms and names the
  feature**; inside it *and closing*, it **commands the low speed**, handing it back at
  1.5× the buffer. It slows and it **never steers**: slowing cuts the energy of a contact
  and buys turning room without taking a control from the RC transmitter, which is master
  and is the true failsafe. It commands nothing at all unless the boat is running, armed,
  not E-STOPped and not holding.
* **Why this route** — the planner's own reasoning, **captured when the plan was
  committed**: routed clear of the keep-out model via *N* waypoints, or direct because
  the straight line was already clear; whether it rode the Rule 9 lane and whether that
  lane was only **partial**; legs with **no clear detour** (unsafe, in red); a plan built
  with **no nogo model loaded**, which is not the same as a clean direct run. Plus mean
  **waypoint spacing** — the fastest way to tell a resampled smooth track (points metres
  apart, bearings swinging between neighbours) from a genuinely erratic route.
* **Then** — the next three waypoints with bearing, range and role, and what happens at
  the end of the plan (return home, hold, or a return that has already been refused).

The reasoning is recorded *with* the route and dropped with it — never re-derived, since
a re-derivation would describe the console's current state rather than the route being
flown. A plan committed before the page was loaded therefore says so outright rather than
showing an empty section. And it goes with the SESSION: a console restarted under a page
that stayed open comes back with nothing running, so the page gives up the route, its unsafe
legs and this reasoning, and the section says so (`Cleared with the route — the console
restarted, so this is a new session`). Until 2026-10-09 the last session's intent stood until
the first command of the new one. The **History** section under it is NOT cleared by a
restart: it is the last 20 things the console did, each with its time, kept in the browser
across a reload and a restart - until the next mission starts (below).

**History — last 20.** Below Intent, the Mission Status card lists what the console **did**,
newest first, each line with its time: every command it sent with the answer it got — the
server's own words (`Upload — Run plan uploaded (719 waypoints · ENC-routed, rth).`) or the
refusal (`Return home — refused: ARM before commanding the boat`, in red) — every note it
flashed, and every banner it posted (in amber). A note is on screen for four seconds and some
fifty messages share the one banner slot; the history keeps them. Twenty are kept per
browser, and a reload keeps them. A command sent again straight away is one line counted up
(`Speed low ×5`); a banner posted again moves its line to the top and counts up rather than
taking another, matched with its numbers set aside, so the two banners every page load posts
stay two lines (`Nogo established (583 nogo zone(s) …) ×3`). Commands are never merged past
the newest line, because their order is the record. Hover a line for the full text and date.

**A new mission starts its own history (2026-10-14).** When you command a new mission - an
Upload, a Go-To, the RTH button, a Transit, Sail passage - and the vessel takes it, the lines
from before your press go, and the new mission's history opens with its own planning and its
own command. The last mission's lines (why it ended, the hold she sits in) stay readable until
then. A refused command clears nothing: she is still on the mission she had. The end-of-plan
RTH, the low-fuel RTH, Resume, Continue passage, Upload from here and the Continue past a held
survey carry on the mission she is on and keep its history. Nothing is lost: every line is in
the session record, where playback shows it and marks where each mission began
(`MISSION NEW`). The Intent was already replaced by each new mission's plan. Another window
of the console (the controls window, a second chart page) takes up the cleared list too
(`tests/action_history.js` 14-16, `tests/command_result.js` 54).

**Surface current** (Mission Status card, `Current` row). The console also reads the surface
current **at the boat's own position**, and since 7 October 2026 it is **fused** from
station predictions and a model (`stream_fusion.py`) rather than read from one model:

- **NOAA's tidal current predictions** at the stations round the boat
  (tidesandcurrents.noaa.gov) come first. Each station gives a signed speed on its own
  flood and ebb axis, at its shallowest published depth. The tables are fetched a week ahead
  and kept under `charts/coops_currents/`, so the stream is there at sea and for any time a
  plan reaches. A subordinate station publishes only its slacks and strengths; between them
  the curve is the tide's own shape, a quarter sine from slack and a quarter cosine to it,
  not a straight line. Between stations the vectors are weighted by inverse distance
  squared, out to 3 km.
- **A gridded model** gives the pattern away from the stations: the NOAA **Operational
  Forecast System** the port names (where it names none, the one given with `--currents-ofs`;
  with neither, no model: the stations and PacIOOS carry the stream, and the card says no model
  is named, never the previous port's model, which a blank port kept until 2026-10-09), or a
  **PacIOOS** regional ocean model at Honolulu, Samoa, the main Hawaiian Islands and the
  western North Pacific. Where stations lie inside it, the model is **calibrated** to them
  by a gain and a time lag along each station's axis, and only where the fit is a fit.
  **A model the stations reject is left out near them** (2026-10-09): where no station
  within 15 km fits it and one there rejects it - the model has water at that station and
  the fit fails - a station reading stands alone and the tooltip says why; past the
  stations' 3 km reach the model still fills in. Measured at New Castle that evening with
  the console's own calibration: GOMOFS has water at only 7 of the 26 stations within 25 km,
  all at the harbor mouth, and there runs at about a tenth of NOAA's predicted strength
  (peaks 0.09-0.33 kn against 0.97-2.17), so none accepts it; blended in raw it had taken
  the port's reading from 0.64 kn to 0.47. DBOFS at Lewes, the same test: r 0.88-1.00,
  15 of 16 stations accept it.
- The two are **blended by distance** to the nearest station.

The simulator is **set by this stream at her own position, every tick**, so a boat running
up a river meets the river's own current as it changes, instead of one value for the whole
run. The row's tooltip names what the reading was built from: the stations with their
distances and shares, the model with its gain and lag, or why no model is in it. River
discharge is not a layer (it adds about 0.01 kn in the tidal water measured), nor yet the
global ocean model or live current meters; a position with no station in reach and no
model water still reads `--` with the reason. `--no-stream-predictions` runs on the model
alone, as before: a deterministic or offline rehearsal, and what every test harness's
console is given, so no suite passes at slack water and fails at full ebb. Set is **where the water goes**, degrees true. Unlike the wind rows this is
**not** simulator-only: a real hull sits in real water, and while the simulator invents
the wind, nobody invents the tide. It is a *model prediction*, not a measurement, and a
different question from the **Set / crab** row above it — that is the leeway the boat is
actually fighting, except on a vessel link that reports no set of its own, where the row carries
this forecast and says "stream forecast" (see the last four open items, below). Every way it can fail to be a live reading is stated rather than
dressed up as a number: NOAA's model server down (a server error or no connection, said as
such since 2026-10-09 - it used to read "no cycle cached yet"), no cycle cached yet, no
model water at that position, or a value
**projected by whole tidal cycles** because no forecast frame covers now (marked `~`,
and refused outright past three cycles). The model fetch runs on a background thread, so
a multi-megabyte download never sits on a request. **When NOAA's model server is down the
console reads the same files from NOAA's open-data S3 bucket** (`ofs_s3.py`, 2026-10-09) -
still the standard library only: a small reader for exactly the HDF5 structures those
netCDF-4 files use, range-reading only the surface rows in the box round the boat (tens of
kilobytes a frame; a WCOFS cycle in about 15 s, LEOFS's 127 hourly frames in about 70 s),
written into the same cache so everything downstream is unchanged. The tooltip says when a
cycle came from there. It reads each file's own time units, which differ by model (LEOFS
counts from 2015, SSCOFS from 2018, the rest from 2016) - **and since the same evening so
does the model-server path**: the vendored `currents.py` (fixed in `asv_core`) took every
model as counting from 2016, so it cached Erie's model a year late and Bellingham's two
years early and no frame ever covered now. It reads the units from each file's own
attributes now, and a cycle whose frames land outside the hours its file names give is
refused in words rather than cached misdated. `GET /api/currents` (`?force=1` to
kick a refresh) serves the same reading headlessly. The **chart's wind rose carries it
too**: a single-headed **sea-blue arrow** riding the ring, pointing where the water goes,
with `current N.NN kn DDD°` beneath the wind's line, in the same format - the **Current** row's reading, labeled
so (it said `set`, and read as a second, disagreeing **Set / crab** row: that one is the whole set,
the wind's and the sea's leeway in it). It is a different *shape* from the
wind needle on purpose — wind is named by where it blows **from**, a current's set is
where it **goes**, and two needles differing only in color is exactly how one gets read
as the other. A projected (estimated) current draws **hollow** and keeps its `~`. And the
**Set / crab** row's own value is on the rose too: a shorter **amber arrow** out from the hub,
with `set N.NN kn DDD°` beneath (in the current line's place when there is none). It is always
there - the vessel reports its set every tick - where the current needs a forecast: none at a
port whose entry names no model (`ofs`), nor while NOAA's model server is down.

**Page-thread performance (2026-10-17).** Measured from 40 session logs and an instrumented copy of
the page: the chart page's thread had stopped 267 times in 40 sessions (892 s, median 2 s), mostly
as the keep-out model arrived and as Go-Tos re-read the chart, and its fuel row cost about 100 ms
every second for the whole of a run. Three fixes, no GPU: the mission card walks the fuel projection
every 10 s (at once for a new plan or a jump in the level) instead of every second; the controls and
chart are always separate windows (above); and the walk over the chart's seabed edges that finds the
floats NOAA leaves out (266-528 ms of the page's thread per chart read) runs in a worker
(`static/js/skin_worker.js`) on the extract's own bytes, with the page walking it itself exactly as
before whenever the worker cannot answer for that extract. A chart read lands up to about a quarter
of a second later and the page no longer stops for it. The extract's parse and the model's build stay
on the page: measured, receiving them from a worker cost as much as doing them.

**The chart's layers off the page, and the route's grid faster (2026-10-17, items 4 and 5).** The ENC,
keep-out and shore-band layers are drawn in the same worker, from its own copy of the extract, with the
page's own drawing (`static/js/chartlayers.js`); the page shows the last picture, moved or scaled,
until the new one arrives, and draws a layer itself as before whenever the worker cannot. At New
Castle a zoom held the page for one frame of 96-197 ms; now the longest is about 10 ms, and the
worker's picture is the page's to the byte. The route search's grid (`static/js/raster.js`) is built
in about half the time and is the same grid, so the routes are the same. A GPU version of it was
weighed and not built: it cannot draw the same cells, and the grid must never under-draw a keep-out.

**Bug and reliability review (2026-10-16).** Six area reviews of the whole project, every finding
re-verified, 28 findings repaired the same day, each with a check that failed on the code before it; the
report, with file and line for each, is [docs/review-2026-10-16.md](docs/review-2026-10-16.md). What an
operator can see of it: a route is never shipped across a charted line from a berth alongside it, nor under
its buffer; a passage's hold survives a page reload, a take-over and Drop passage (End of plan does not send
her home from it); LINK LOST stops the run and says so, and LINK RESTORED says she is stopped and disarmed -
check her, then ARM; a second console on the same port exits saying so instead of serving nothing; the
states' speed zones never hold a chart read past 6 s (a slow service's tiles arrive behind the answer, said
as still being read); the current readout keeps refreshing while NOAA's model server is slow (the look goes
on behind it, said), and an unreadable cycle is set aside and fetched again; an E-STOP is taken from any tab
but released only from the supervising one; a session log that cannot be written says so once and stops
rather than silently; and a sleeping laptop no longer moves the simulated boat an hour's way in one tick.

**Review of the updates (2026-10-18).** Six area reviews of every change since the 2026-10-16 review
(26 commits: the chart read's partial handling, the lock transit, the planner changes, the page's
workers and windows, the server, the tests and documents), every finding re-verified, 33 of its
34 findings repaired the same day with checks that fail on the code before them (the 34th, a spelling rule's
gaps, handed to a parallel session); the report is
[docs/review-2026-10-18.md](docs/review-2026-10-18.md). What an operator can see of it: a lock transit
ends only once she is past the far gate, is ended by any other command, waives one gate at a time and
takes its points exactly or not at all; nothing is commanded while the link is LOST, and LINK RESTORED
says where she stands; a chart answer that came from a failure is asked again, not kept as "no chart
here"; a read that lost a marina's layer is unread water, not a whole chart; the NOGO row keeps saying
a failed read while the earlier zones stand, and its retry no longer dies on a tide tick; the NOGO key
names the floor the overlay is drawn at; every long distance follows the UNITS pill; the controls
window does not read red while the console restarts; a ship anchored just outside the chart box is in
the plan's model; a dead NMEA peer is noticed within a minute.

## Run

```
python asv_console.py --sim            # simulator, opens a browser tab
python asv_console.py --sim --browser none --port 8791   # headless, no auto-open
python asv_console.py --sim --vessel ben_cworker4        # start on a different vessel profile
python asv_console.py --sim --single-window               # one window (no controls window)
python asv_console.py --sim --ais-collect-km 250          # collect a wider AIS area (sparse feed coverage)
```

**Windows: `start_sim.bat`** is the same thing for a double-click, and is what a desktop
shortcut should point at. It finds the project from **its own location**, so the repo can be
moved or cloned anywhere without editing it, and resolves the interpreter through `PATH`
rather than a pinned path (the Microsoft Store build of Python lives under a
version-stamped directory, so naming the executable outright breaks at the next upgrade).
It **forwards any extra arguments** to `asv_console.py`, so one launcher also serves a
variant shortcut — `start_sim.bat --vessel ben_cworker4`, or `--port 8792` for a second
console beside the first. The window it opens *is* the console: closing it stops the run.

To put it on the desktop, run the script that builds it:

```
powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1
```

It resolves the project from **its own location** and writes that into the shortcut, so
there is no path to edit and no way to end up pointing at a folder that has moved — clone
or copy the repo anywhere, re-run it, and the shortcut is right. It picks up
`tools\asv.ico`, asks Windows where the Desktop actually is (this matters on a
OneDrive-redirected profile, where `%USERPROFILE%\Desktop` is not it), and **verifies by
reading the shortcut back** — `Save()` accepts a target that does not exist and would
otherwise only fail on double-click. Re-running overwrites rather than making a second one.

`-Name` and `-Arguments` make a variant shortcut beside the first, since `start_sim.bat`
forwards everything through:

```
powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1 -Name "ASV Console (BEN)" -Arguments "--vessel ben_cworker4"
```

The `.lnk` is not tracked in the repo — it is a binary holding absolute paths for one
machine. The script and the icon are what travel; between them the shortcut is
reproducible on any clone. (The old manual route still works: right-drag `start_sim.bat`
to the desktop → *Create shortcuts here*, then Properties → *Change Icon* → `tools\asv.ico`.)

**Multi-monitor.** On start the server opens **two** windows: the **main** window
(chart, status, command bar) and a **controls** window (`?panel=controls`) holding
*only* the control column and its pop-out panels — drag it to a second screen for a
clean chart. The tabs name themselves **ASV Chart** and **ASV Controls** so they are
easy to tell apart. The two are bridged over a same-origin BroadcastChannel: the main
window runs all the logic and owns the chart, the controls window mirrors its controls
and forwards your clicks and edits back. You still draw on the main window's chart. In
the controls window the buttons become a vertical column on the left and each panel or
table becomes a **draggable, resizable card**; the layout is saved to `localStorage`
(the chart's own buttons - `+`, `−`, `BOAT`, `CHRT`, `NOGO` - are on the command bar, left of
ARM, since 2026-10-15, Andy: "They are used for the chart so they should live there"; they stay
with the chart in either layout, and the column carries the rest; and since 2026-10-19 four more at
the bar's left end - `QUICK`, `OPS`, `TECH`, `DEV` - open the four Word documents in `docs/`: on the
console's own machine Word opens the document itself, from another machine the browser downloads
it from `/docs/<id>`, and either way a note says which happened)
and restored next session. **The ALERTS card lives in the controls window** (2026-09-28, Andy:
"the pop-up alert messages are blocking each other or covering standing messages at the bottom
center of the chart screen"): the guard's bar with its buttons (PROCEED, CONTINUE AT LOW, RESUME,
ROUTE ROUND HER NOW, RELEASE LOW, CANCEL, LEAVE IT HOLDING), the standing banner and the flash
note are one card now, stacked so they never cover one another or the RC banner, with the last
six banners, notes and refusals listed beneath them so a note that faded is still there to read.
The card is mirrored to the controls window and hidden on the chart while that window is alive;
**ON CHART** on the card's head puts it above the command bar instead (and **TO CONTROLS** sends
it back). One place at a time: the choice is a single browser-storage key both windows read.
With no controls window — `--single-window`, or it closed — the chart shows the card whatever the
choice says, so the alerts never vanish. On the chart it drags anywhere by its head and keeps its
width wherever it is put (at most half the chart), and every line in it wraps (29 September, Andy:
"locks to the left of the frame and cannot be moved around. also, not all the lines wrap" — the
drag left the card's centering on, so it was drawn half its width left of where it was put and
held there, and the recent rows were cut off). The **Mission Status card stays on the chart window** — it is
not mirrored, because two copies of one card is a second place to look rather than a
second view; the chart window has the card, the top bar has the quick read, and the
controls window is the toolbar. **Every card on the chart window is resizable** —
drag its bottom-right corner; the size is remembered per card, and only a size you
actually changed is stored, so a card's default can still be improved later. If the controls window is closed the toolbar and panels
return to the main window automatically, and a **⏏ Controls** pill appears on the top
bar to reopen it — so the console is never left without its controls. **They move only when
the window CLOSES** (2026-10-18, Andy: "Stop moving cards to chart automatically unless the
browser window closes. allow button to swap back and forth."): the controls window holds a
browser lock (Web Locks) for as long as it is open, and the chart waits on it, so the cards
come back the moment it is closed, reloaded or crashes - and never while it is merely slowed,
covered or asleep in the browser (it used to be 6-7 s of silence). A controls page from before
this, holding no lock, still goes by its silence. **To move them yourself**, while both windows
are open: the **⇄ Cards here** pill on the chart's top bar (it reads **⇄ Cards to Controls**
while they are on the chart), or the **⇄ Cards to chart** button at the top right of the controls
window, which then shows only a note and **⇄ Bring the controls here**. A controls window
opened after none takes the cards again. **More than two pages** (2026-10-10, Andy: closing the controls
window left the chart without its cards, and the alert card flashed): every start of the
console opens a chart and a controls window, and pages left open from before reconnect on
their own. **Each is a window of its own, never a tab** (2026-10-17): the console launches Edge (or
Chrome) itself with `--new-window` for both, because Python's request for a new window is a hint Edge
ignores and the controls window had been opening as a tab in front of the chart - and a page behind
another tab is one the browser throttles and then puts to sleep, while the chart page runs the
clearance guard, the speed governor and the RTH chain (40 sessions of logs held 4.75 hours of it
asleep). The ⏏ Controls pill reopens it as a window too. **A page load is never refused at the door**
(2026-10-18): the console sends every file uncached, so each load of the page asks for all its
modules at once, and with Python's standard listen queue of 5 Windows refused the overflow - in a
browser with nothing cached, opened as the console started, the page never started and no chart
window took supervision. The queue is 64. The controls window **watches the chart**
(2026-10-17): it asks the console every 2 s, and if the chart has stopped handling the console's
telemetry - closed, asleep in the browser or stuck - it says so in red across its top. While the
chart is only covered or minimized, slowed by the browser but still answering, a small amber note
in its corner says that. (The first version put up the red banner whenever the chart was covered,
so with the controls window maximized over the chart it stood through a whole run that went well.)
And the chart's **trail** has no hole where its window slept (2026-10-17): the console keeps her
track this boot, every 2 m, and a chart window that missed some of it - frozen by the browser, or
closed and opened again - fills in the stretch from the console (`/api/track`).
Only the **supervising** chart drives the controls window - it alone mirrors into
it, carries out its clicks and hides its own cards; a view-only chart keeps its own, and
TAKE OVER moves the controls window with supervision. Of two controls windows the
**newer steps aside**: it closes itself, or, where the browser will not let it, goes silent
and says ANOTHER CONTROLS WINDOW IS ALREADY OPEN. And the mirror is sent only when it
changes - it used to go out four times a second regardless. **A tip you are reading holds
still** (2026-10-14, Andy: "hovering tool tips flash rather than hold steady so I can read
them"): the controls window brings each card up to date IN PLACE after its first picture,
so the control under a still pointer is the same one through every reading change (it was
rebuilt, and its tip restarted, on each); and in either window a readout that rewrites its
tip while you read it changes the tip's words, never brings the browser's own tip back
under the pointer. Pass
`--single-window` to skip the second window. Those two are all the console opens at
start-up. The official pages behind its readings are **offered, not opened** (2026-09-02):
a **`⏏ Tide`** pill on the top bar opens the NOAA CO-OPS water-levels page for the station
nearest the vessel — the station is derived from the live GPS fix, not configured, and the
depth correction behind it is an inverse-distance blend of up to 3 stations in range
(`--no-tide-window` withdraws the pill). A **`⏏ Weather`** pill does the same for weather —
the NDBC page for the nearest buoy, whose wind and waves drive the sim forcing
(`--no-weather-window`). Each pill appears once the vessel has a fix, and hides while its
window is open.

**Both of those windows follow the boat, in place.** The station is re-derived whenever the
vessel moves far enough — changing port, or simply steaming until a different gauge is
nearest — and when it changes, **the same tab re-points itself**. The trigger is the
*station*, not the port, so a port change that resolves to the same gauge correctly does
nothing, and a long transit that crosses into another gauge's range is followed even though
no port changed.

Each window costs **one click** the first time, from a `⏏ Tide` / `⏏ Weather` pill on the
top bar, and never again. That click is unavoidable: a browser blocks `window.open` without
a user gesture, and the pages cannot be framed instead (NDBC sends `X-Frame-Options: deny`).
Only a page can hold a window handle and navigate it, which is why the console — not the
server — opens these; the server gets no handle back from the operating system and could
only ever open a second tab beside the stale one. If the browser blocks the pop-up anyway,
the console says so and gives you the URL rather than leaving a pill that appears to do
nothing.

A **`⏏ Current`** pill (2026-10-09) does the same for the CURRENT, through the same one-tab
mechanism. The current is a blend — NOAA's tidal-current *predictions* at the stations round
the boat, and a gridded forecast model away from them — so the page is the source carrying
more of the reading: the heaviest station's NOAA predictions page, at the depth bin the
console read (`noaacurrents/predictions?id=DEB2102_21`), or the OFS model's own page
(`ofs/dbofs/dbofs.html`) where the model carries more. Hover the pill to see which, and its
share. Where a PacIOOS model carries it, PacIOOS's own dataset page opens instead. The pill
always shows: with no current data at the boat it is **ghosted**, still opening the page of
the model the port names (the console has no reading from it right now), or nothing when the
port names none (2026-10-09).

Independently of any window, the console **prints which gauge the correction came from and
what it is made of** whenever the station changes — that correction is applied to charted
depths whether or not a browser is open at all.

### Vessel profiles

The console studies ASV behavior **across different vessel types**. Every
vessel-specific parameter — hull/windage, speeds, turn rate, autopilot gains, an
**energy model** (battery *or* diesel fuel), planning defaults (incl. under-keel
clearance), spawn — lives in one self-contained file under `vessels/<id>.json`,
and that file is the single source of truth (the server and the UI both read it,
nothing is hardcoded twice). **The default is `drix08_em712`** — the DriX H-8 at Lewes as
she is fitted now, with the Kongsberg EM712 gondola. Profiles that ship: `zboat_1800hs` (a
small ~1.9 m battery survey ASV), the Exail DriX H-8 - a 7.71 m **diesel** survey USV that
shows fuel/endurance/range, not battery - as **`drix08_em712`** and as **`drix08`** (the same
hull with the original EM2040 gondola), and **`ben_cworker4`** - BEN, a 4.2 m diesel-waterjet
ASV Global C-Worker 4 surveying with an EM2040P (2026-10-10; it replaces `example_usv_4m`, an
illustrative hull). Add your own by dropping a new complete `vessels/<id>.json`.

A hull's **windage** is its length, and its beam, times one above-water height, and its
**underwater lateral area** (the leeway drag's) its length times its draft - unless the file
gives measured areas: `hull.wind_area_side_m2`, `hull.wind_area_front_m2` and
`hull.underwater_lateral_area_m2` (2026-10-09). The DriX needs all three. Off iXblue's own
dimensioned starboard view (in the DriX training notes; the method and ranges are in the
file's `hull.wind_source` and `hull.underwater_source`), the wind sees **6.5 m^2 side-on**
(with the H-8's radar dome and stern pole) and **1.8 m^2 end-on**, and the water **4.2 m^2**
below the design waterline: its 2.0 m draft is a gondola on a slender drop keel, where
length x draft said 15.4 m^2 - so every DriX leeway ran about 1.9 times too slow. BEN gives
all three too (below); the small-class profile gives none and is unchanged.

**The DriX's gondola is sized round the sonar in it**, and it sets more than the payload
(2026-10-09). The original **EM2040** gondola (`drix08`; iXblue drawing 920C12-1-DWG-002) is
2.0 m long and 0.31 m deep - the one in iXblue's general drawing, and the one fitted for every
log measurement. The **EM712** gondola (`drix08_em712`, fitted now; 922C01-DWG-002) is 2.25 x
0.56 x 1.21 m and 577 kg in air. Off the drawings and the measured laws, the EM712 profile has a
**2.25 m draft** (depth floor 3.15 m, against 2.9), 4.5 m^2 underwater (4.2), a top speed of
**10 kn at 3100 rpm** (Andy's own figure; 11.5 kn with the EM2040), and its own fuel law - about
a quarter fewer miles a liter at 8 kn. Both burn curves are the Fuel planner's measured laws
now, not Exail's endurances, which had the DriX burning 1.65 L/h at 7 kn against 2.61 measured.
The EM712's coast and slow-down are **estimated** from the EM2040's measured ones (scaled by
mass over drag) until EM712 logs can measure them; each file's `*.source` fields say where
every number came from.

**BEN** (`ben_cworker4`, 2026-10-10) is the Bathymetric Explorer and Navigator, an ASV Global
C-Worker 4 built in 2016: a Yanmar 3YM30AE diesel through a centrifugal clutch, direct drive to
a waterjet, with a Kongsberg EM2040P on a ram amidships. Measured off ASV Global's general
arrangement (ASV-396-7-000-i0001-01-C, rev C), she is **4.21 m** overall and 3.90 m on the
waterline, the wind sees **3.46 m^2** side-on and the water **1.39 m^2** below the waterline;
the 1.7 m^2 end-on is estimated, since no front view is drawn. Her top speed is **5.5 kn**
through the water and she surveys at it (Andy's own figure), so she is selectable at 2-5 kn.
Her **0.66 m draft is the sonar's, not the hull's** (0.404 m): to survey, the ram lowers the
EM2040P's face to 0.66 m below the waterline (UNH CCOM's 2018 offsets: 0.36 m retracted, a 300 mm
stroke), and the depth floor is judged at the deepest point - 0.66 + 0.65 = 1.31 m.
Her tank is **100 L** (Andy's figure), and her full-throttle burn of **5.0 L/h** follows from
it and her 20 h of survey at full throttle; the burn below full throttle is still a guess. The
file's `notes` and `*.source` fields name every estimate.

**Speed is selected in whole knots** (2026-10-09, every hull). The three role speeds - the
survey card's Survey, Turn and Transit kn, and the command bar's Transit kn - offer the hull's
whole knots, from its low speed rounded up to its high speed rounded down: 4-10 kn on the DriX
with the EM712 gondola, 4-11 with the EM2040, 2-5 on BEN and 2-6 on the small-class
hull. The speed picked is **commanded through the water**: the current and the wind act on it,
so the speed over the ground is the commanded speed plus the set - 7 kn into a 1 kn head current
makes good about 6. The hull's named low / survey / high stay as the **console's own** speeds -
the guard's LOW, the escape's HIGH, the slowest speed a hold makes way at - and are on no
selector, so advice to slow down names the slowest whole knot instead. A plan saved before this
reads back at the nearest whole knot (only BEN's 5.5 kn survey and high speeds, held to her
top whole knot of 5, the small-class hull's 1.5 kn low and the EM2040's 11.5 kn high move), and a vessel switch brings
each speed inside the new hull's range.

Selecting a vessel also changes the **nogo model**: the minimum navigable depth is
that vessel's `draft + under-keel clearance`, so the deep-draft DriX (2.9 m floor with the
EM2040 gondola, 3.15 m with the EM712)
avoids shallow water that BEN (1.31 m, surveying) and the shallow-draft `zboat_1800hs` (1.0 m)
can cross.

Pick the active vessel with `--vessel <id>`, or switch live from the **vessel
selector** in the top bar (allowed only when disarmed and stopped — swapping
physics under a running boat is refused). Switching in sim respawns the boat with
the new vessel's parameters, so you can run the same mission on different hulls
and compare.

Each profile also carries its own **spawn** position, so a vessel comes up in its own
work area — `zboat_1800hs` in **Erie** (Presque Isle Bay) and both DriX profiles at **Lewes**
(the UDel facility on the Lewes-Rehoboth Canal). To place the boat anywhere else,
right-click the chart and choose **Spawn here**: the sim boat comes up there
instead, with the same clean slate as Reset (full energy, SAFE, no plan or home).
That override lasts for the current sim boot only — the profile's spawn is untouched
and is restored on the next start or vessel switch. Sim only; a real boat can't be
teleported. **A spawn makes the new position the reference** (2026-10-13): HOME is planted
at the spawn point on her first fix (a mothership that owned home is released), the chart
is read round the spawn point at once - outside the last read's box the old keep-out model
is dropped first, since it describes other water - so the model and the plane it is measured
in are referenced there, and the AIS subscription is re-pointed round her when she lands
outside the box it covers (a Reset puts it back round the profile's spawn). And a frame of
the OLD boat still in flight when the spawn lands is dropped, not applied: it had seeded home
at the old position for good.

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

**What each contact carries.** Beyond position, course and speed, every contact carries
the **particulars AIS itself broadcasts**: ship type, **length and beam**, **destination**,
draught, IMO number, call sign and ETA. None of that needs a second service — message 5
(Class A static and voyage) and messages 19 / 24B (Class B) have carried it all along, and
the console simply had not been keeping it. All of it reads on **hover**, and the **icon is
drawn to the hull's true size** whenever the chart is zoomed in far enough to show it,
anchored on the **GNSS antenna** rather than centered: AIS reports the antenna's offsets
within the hull, and on a 295 m ship with the bridge aft, centering the box would put the
stem 77 m from where it actually is. Zoomed out, where a 300 m ship is seven pixels, it
falls back to the standard glyph. **Each ship points the way her bow does**, by the same rule
as her keep-out: her true heading; her course over the ground only while she is under way; a
dashed circle when she is stopped and reports no heading (see *Two drawings of one ship* below).

**Contacts are keep-outs (2026-09-25).** Every AIS contact near the boat is a keep-out the
clearance guard steers clear of, exactly as it does a pier: the **hull she broadcasts** (or
**20 m x 8 m** about her antenna where she broadcasts none), oriented by her heading, grown by
**half her length** - her clear water (2026-10-17: 100 m round a 200 m ship, 10 m round a 20 m
boat; until then the hull alone, and a survey line ran 28.8 m off a 200 m ship at anchor) - with
the vessel's own keep-clear buffer outside that. A boat already inside a ship's clear water (a ship
anchoring beside her) is guarded against that ship's bare hull, so the guard never takes the helm
to escape water she was already in; a passage that starts inside it is laid out of it the short
way. While she is under way the
keep-out is **dead-reckoned** between polls and **swept** over the guard's look-ahead — the
water she will occupy within the next 45 s — so a contact crossing ahead holds the boat
before her track and one bearing down reads in extremis while there is still water to escape
in. The contacts are polled whenever the console is armed, **layer or no layer**, and drawn in
the keep-out red whenever the guard has them (dashed where it is the sweep). **The poll rides the
telemetry stream** (2026-10-13): every frame asks whether one is due, as the guard itself runs once a
frame. It ran on a timer, and a chart window covered by the controls window - one screen - has its
timers throttled by the browser while its telemetry still arrives, so the guard ran on contacts gone
stale: **AIS KEEP-OUTS BLIND**, and a test contact ahead was driven through. A poll that never answers
is abandoned after 15 s rather than holding out every later one, and the **controls window polls
nothing**: it never knows where the boat is, so its own poll ranged everything from New Castle (a
contact under a mile away read 26 nm and never closed); its AIS card is the chart's. They reach the
**guard's model only** while they are under way: the punch, the router and the plan never see one, so **a ship
crossing the survey area reconfigures nothing**. A vessel **not under way** - moored, at anchor or stopped - is
the one exception, and only for a **passage** (2026-10-07): a Go-To, an RTH, a drawn transit and an Upload's
transit legs are planned round her at the standoff, as round a pier, from the traffic read along the whole route
as it is planned, and the banner names her; a survey's own lines are never moved for her. After a contact has stopped or steered the
boat off a survey line, the console **brings her back itself** once the contact is clear of
the line for 4 s: it rejoins **100 m back down the line** over water already run, so the
coverage overlaps, and carries on — with none of the operator's resume latches (no LOW
hold, no override). A contact that **stays on the line** gets the three answers Andy set out
(2026-09-27): the same line where she left it is **refused** — she would meet the contact again;
the operator may right-click the line **beyond** the contact (*Resume from here*, below) and the
console routes her round it and continues the survey from there; and if the operator has not
answered **within 10 s** (a minute until 28 September, 30 s until 29 September - shortened at his word both times), the
console routes round the contact **itself**, as if it were a buoy or
a dock, to the first point of the line beyond her that is clear by the standoff with the rest of
the line clear too, and carries on (a contact covering the rest of the line leaves that line and
picks the plan up at its next waypoint). The guard bar counts the 10 s down, to the next try
after one that did not go, and names both answers. Never on a stale feed, never while you have
her **paused** (a paused hold keeps the offer now, and the bar says the console waits), not twice
inside 10 s, and where no way round
is found it says so and keeps holding (`koWithAis`, `aisAroundPlan`, `aisAroundTick`, the held
path of `resumeHeldRun`). **The way round keeps one ship-length from her, and no more than it has
to** (Andy, 2026-09-27: "an avoidance maneuver of a radius equal to the length or the estimated
length of the vessel"; 2026-09-28: "Too much distance from the AIS target and a long failure to
regain the survey line"). The radius is about her **center**: the way round, and the way in to a
point chosen beyond her, keep at least her length from her center and at least the guard's
standoff plus the buffer from her hull, whichever is further. Only **she** — the contact being
routed round, named by her MMSI or else the first one the line ahead runs into — gets that ring;
every other contact is the bare hull the guard itself measures to. The survey is picked up at
the first point of the line past her ring, unless another hull sits on the line inside the hold
horizon after it (then past that one too), and the way in is the **taut** path round her ring,
checked leg by leg against the whole model at the standoff, with the router's own search as the
fallback wherever something else is in the way; a boat held inside her standoff first moves
straight away from her. The escape's own search keeps the wider berth, her hull grown by her
length, because getting well clear is an escape's whole job (`aisRoundKeepout`, `aisHerPoly`,
`koRoundHer`, `tautRoundHer`; the escape's `aisAvoidKeepout`). A point within a ship-length of
her center is "the near side", and Resume from here refuses it. **His 28 September run showed
what the first version did:** KLEOS on line 6 and FRIGGA anchored 35 m off its far end, in a
1.75 kn set. Every contact in range was grown by her length and the whole rest of the line held
clear of all of them, so FRIGGA pushed the rejoin to 587 m along, 375 m of coverage skipped; and
the router's 19.5 m standoff was added *outside* KLEOS's grown hull, so the way round passed
48 to 63 m off a 20 m vessel and was off the line for 109 s. Replayed on a throwaway console with
the same boat, set and contacts: rejoined at 301 m with 90 m skipped, 28 m off her, back on the
line in 24 s. **Four
things his 27 September session taught** (KLEOS, moored across line 8 at New Castle): a moored
vessel that transmits every twelve minutes was **dropped from the AIS proxy's list** by its
ten-minute time-to-live between reports, so the guard's model went empty of her and the boat
drove onto her position unwarned — a vessel with no way on is now kept for an hour
(`STATIONARY_TTL` in `ais_service.py`), one under way still ages out at ten minutes — and
since 28 September **a contact whose last report is more than about seven minutes old at under
2 kn, or whose status says anchored, moored or aground while she is doing under 3 kn, is not
under way**: no dead reckoning, no sweep, and the registry
keeps any vessel under 2 kn the hour outright (FRIGGA at New Castle: 0.8 kn, twenty minutes
between reports, at anchor, and 43 m of phantom hull swept up her course reached the way round
her; kept on her reporting *interval* she would still have been purged before her second report
could record one); her next
report put her back at 0.0 m, the helm rung escaped her and **the hold rung cancelled the escape
0.44 s later**, because from inside the buffer every track "enters in 0 s" — the slow and hold
rungs now stand down while an escape is in flight (`escaping` in `clearanceGuard`); and the
banked survey is **not spent by a frame inside its own command's round trip** (`HELD_GRACE_MS`),
which is what emptied the guard bar and hid *Resume from here* that evening. A feed that stops
answering is an **empty model that says so** — a
banner while a run is under way, never a quiet sea (`static/js/ais_keepout.js`; the guard's
`koAll`, `aisReturnTick` and `resumeHeldRun` in `static/asv.html`).

**From 50 m, the same way round on every leg, and ten seconds to answer** (29 September: "The
buffer zone on approach to an AIS target appears to be 150m. confirm distance and modify to 50m";
"the avoidance maneuver used on survey lines for avoidance of AIS contact should have identical
avoidance behavior when running a GOTO, RTH or transit line"; "reduce the wait for user input from
30 seconds to 10 seconds"; "extend for drix if necessary"). The 150 m was the guard's 45 s
look-ahead: a contact was a keep-out like a pier, so she was answered wherever the next 45 s of
track reached her hull - 139 m at 6 kn - and his session slowed for TEST-1 132 m out and crept at
LOW to her. The ladder now answers a contact only once her keep-out (her hull, swept along her own
track while she is under way) is within **50 m** of the boat - and from further out on a hull that
needs the water to come down to LOW first. For the DriX that water is **measured** (2026-10-03, from
her own Aug 2026 logs): the guard's SLOW is flown at idle with the clutch still in gear - not a
prop-out coast - so after a dead time her speed decays toward her idle-in-gear speed (3.6-3.7 kn),
and 6.2 to 4.0 kn took **32.5 m and 13 s** (n=20), about twice what the coast law allowed. Her
`maneuvering.slowdown` block (idle 3.65 kn, decay length 23.8 m, lag 3.3 s - the slower measured
response) now sets her reach: **about 90 m at the 6.2 kn her 7-kn setpoint really makes, 96 m at a
literal 7 kn, 131 m at 14 kn** (an extrapolation - she never logged above ~10.6 kn; 14 kn was her
high setting until 2026-10-09, and her profiles now top out at 11.5 kn, or 10 kn with the EM712,
whose slow-down is estimated), more in a set -
the console's own 1 s command delay included, since she runs on for it before the SLOW reaches her.
It was 65-70 m. Her prop-out coast datum, which the drift-in uses, is measured too: 40.3 m from 6 to
2 kn (Lc 36.7 m, against the 35.1 m estimate). The simulator flies the same law (see *the lead*
below), so a sim rehearsal of the guard slows her as the real boat slows. A hull with no datum, or one already at LOW, is
answered from 50 m. Charted keep-outs keep the whole look-ahead, and the escape,
the way round and the hold disc still see every contact. A **Go-To, a Return-to-Home or a
transit** held for a contact is now banked like a survey: the bar says GO-TO / RETURN-TO-HOME /
TRANSIT HELD, with ROUTE ROUND HER NOW, RESUME <leg> AT LOW SPEED and LEAVE IT HOLDING; once the
rest of the leg reads clear of her for 4 s she carries on from where she stopped, and if she stays
the console routes round her itself - one ship-length off her, the leg picked up beyond her - and
re-issues the leg's OWN command, so she still holds at its end point. Right-clicking a contact on a
running leg amends it round her. The wait before the console routes round her itself is **10 s**
(30 s until now), and its retries follow it. Rehearsed on a throwaway console with the DriX: a
Go-To, the Return-to-Home chained after it and a drawn transit each met a moored test contact at
7 kn, were slowed 67-69 m off her, held 44-45 m off, and were routed round her 10 s later in their
own command. The rehearsal found one more thing: slowed to LOW 58 m off her - outside the DriX's
50 m at LOW - the guard released her, she sped back into her 70 m and was slowed again; the
release now asks the reach at the speed it would restore.

**On station the guard judges the drift; the hold disc is re-measured while she holds; a way round
that fails says so** (30 September, items 1, 2, 5 and 7 of his list). A boat already
station-keeping - at a plan's end point, on the operator's Hold, at an escape's point - is being
steered back to her point, so her own velocity flown on for 45 s is a track she will never make.
At home after an RTH the DriX hunted at 3.9 kn and that line reached a keep-out 89 m off: SLOW and
"Clear ahead again" every 19 s. At the end of a line run at HIGH with the set behind her, the
moment she reported holding the line at 7.7 kn read "entry in 16 s", and the guard held her at
present position - replacing the plan's own end hold, so its end-of-plan RTH never fired. On
station the ladder now judges the **drift**: the helm decides on it exactly as before (and no longer
reads a boat sitting still as clear before the drift is even tested); a drift that reaches the
hazard beyond a decision's worth of time reads HOLD, said once as the hold she is on answering
it; and slow and hold command nothing, because a hold at present position only moves her point.
The guard's own hold keeps its rules. **The hold disc** - the water round her hold point in which
she drives a straight chord back to it - was certified once, with the command; while she holds it
is now re-measured every 2 s against the chart and the contacts, and when a contact moors inside
it the vessel is sent the smaller disc (`/api/cmd/hold_clear`), so a boat set off beyond it takes
the way off and is routed back round the contact. It grows back when the water opens, never past
the disc it began with, and a disc under the working margin a hold point needs is said once as a
**CROWDED** hold point. **A Route round** - or any chart-menu row - that fails with an error is
now a banner naming it and saying whether anything was sent; it was a click that silently did
nothing. Rehearsed on a throwaway console: a survey arrived on its end point with a contact
moored 38 m beyond it and chained its RTH, and her disc was re-certified from 104 m to 38 m for
it; at home a contact moored 11 m off shrank the disc from 143 m to 4 m - CROWDED - and the drift
reading stood on the bar with nothing commanded.

**Two drawings of one ship, and one rule for which way she points** (30 September, at the Port
of Los Angeles: "The AIS targets at the pier ... show 2 separate states. The red outlines are
perfectly alongside their respective pier as expected, while the green targets are rotated.") A
contact near the boat is drawn twice, and the two drawings mean different things:

- the **ship in her type color** (green for cargo, to scale when the chart can show her) is the
  AIS target as she reports herself;
- the **red outline** over her is the clearance guard's **keep-out** - her clear water, half her
  length round her hull (labeled "· 100 m clear"), with the hull itself filled inside it, dashed
  ahead where she will be within the look-ahead while she is under way.

The two were turned by two different rules. The keep-out pointed the hull along her **heading**;
the layer pointed it along her **course over the ground** first - and a moored ship's course is
GNSS noise, not a direction. On his own feed round Pier 300, CMA CGM AMAZON lay moored at 0.0 kn,
heading 251° (her berth) and course 327.5°: her keep-out lay along the pier and her ship was drawn
76° across it, and 21 of the 45 contacts nearest the pier were drawn more than 10° off their own
keep-out. Both now ask one function (`aisMotion`, `static/js/ais_keepout.js`), which has three
answers: **her true heading** where she reports one; **her course only while she is under way**;
and, stopped with **no heading**, no direction at all - she can lie any way round, so the ship is
a **dashed circle** and her keep-out the disc that fits her every way round. The speed stalk alone
follows the course: the hull says where she points, the stalk where she is going. The keep-outs are
drawn **over** the ships now, because once the two agree a moored ship's hull lies exactly on her
red outline and would otherwise paint it over. Hover a ship and the tip says which way she is
drawn and why, and marks a stopped ship's course as noise. (That disc is half her hull's diagonal
about her antenna; for a ship with her antenna far forward or aft it does not cover her bow's
whole swing - recorded, not changed, because it is the guard's model rather than a drawing.)

**The guard can no longer undo the way round halfway through it** (his 28 September run, FRIGGA).
Held 48 m off her in a 1.75 kn set, the console released the hold rung's own latch six seconds
into the hold, because a station-keeping boat reads clear. When he pressed for the way round, the
resume paused her and uploaded the route round her, and paused she drifted toward FRIGGA. The
ladder read a fresh HOLD and posted its own hold 51 ms after the upload, which replaced the route
round on the vessel. The Start then started that hold ("Station-keep started"), the page announced
ROUTED ROUND anyway and spent the held survey, and every later press resumed only the hold. Now the
rungs below helm **stand by** while a held resume is in flight, for its four steps and at most
10 s, so a resume stalled on a dead link hands the ladder back; the helm rung never stands by. The
resume counts the guard's own stops, holds and escapes, and will not upload, set LOW or Start over
one. It also reads the vessel's own answer to Start for the plan it actually started. Anything but
the remainder says **THE WAY ROUND IS NOT RUNNING** with the cause, keeps the held survey and the
contact's hold, and the console tries again itself 10 s later (`heldResumeOwns`, `guardMove` and
the checks in `resumeHeldRun`). His wait before pressing was not the cause: the latch was gone six
seconds into the hold, and the automatic way round takes the same path. Rehearsed on a throwaway
console with his line, boat, set and FRIGGA across the line: held 51 m short of her, the latch
released four seconds later, and at 30 s the way round went, started the remainder and passed her
30 to 45 m from her center. That race needs a telemetry frame carrying her paused drift to land
inside a quarter-second window, and neither that run nor a control on the previous version landed
one, so it is pinned by replaying his exact sequence (`tests/ais_avoid.js` 20-20h).

**And the hold the guard commands now stands until she leaves it** (29 September, the three items his
FRIGGA run left open). The guard no longer ends its own hold because a station-keeping boat reads
clear. That frame used to say "Clear ahead again", hand the throttle back and wipe the hold rung's
record of having acted, so every later frame reading HOLD was a first action - the one that
undid the way round, and each Pause answered by a fresh hold where the set had carried her, 48 m
off FRIGGA, then 41, 33, 25. The hold now ends only with a new commanded motion: the resume,
which also ends the rung's record, or any new plan. A hold coming onto station is flown at the
slowest speed that makes way against the set, not the transit speed that used to leave her at
HIGH for the whole hold. A **Pause** on the guard's hold no longer ratchets her in: if the set
carries her toward the hazard, the guard resumes the hold she is paused on, which drives her back
to its own point ("BACK ON STATION"). With a plan staged on the vessel it holds her where she is,
as before, because a Start would apply the staged plan; a **Stop** ends the hold, and then only
the in-extremis rung acts. In the **simulator** station-keeping no longer creeps: the way back
onto station was driven at LOW, which is 1.5 kn on the small-class boat, so a 1.75 kn set carried
her toward FRIGGA at about 0.1 m/s for as long as she held. It now takes the slowest speed that
beats the set by half a knot, with the bow crabbed so her track runs home (`hold_speed_kn` in
`asv_console.py`; a real vessel's station-keeping is its own). Rehearsed on a throwaway console
with his line, boat and set and FRIGGA on the line: held within 2 m of her point for 20 s where she
used to creep, and paused, she drifted 4.7 m toward FRIGGA before the guard put her back on station.

**And the last four open items** (29 September, "Fix the open items, push and merge"). **The
deviation chatter.** The guard's look-ahead walked the route with the bow swung straight at each
waypoint and the set added on top, so in a cross-set it predicted a boat carried downstream of
every leg, while the vessel's own line-follower crabs into the set and holds the line. Beside a
structure with the set toward it, that phantom track read an entry the vessel was never going
to make, and the guard deviated her off a line she was holding. Driven through the page's own
guard, a line held 8 m off a pier with half a knot to a knot and a half of set toward it was
deviated 2 to 4 times in 90 s. His 26 September record has 62 deviations in six minutes, with
the bow 25 to 37 degrees off the course made good, which fits; it came from an older build and
was not replayed. The projection now crabs the bow into the set the way the vessel does, up to
about 64 degrees (a set too strong to cancel still carries her, and the projection says so).
The line 8 m off is now left alone, and one 2 m off, inside the buffer, is still deviated,
once. **Every station-keep takes the hold speed.** At a Go-To point, at home after a
Return-to-Home or at the end of a plan she kept the speed her last leg ran at (HIGH, after a
Go-To or a Return-to-Home), because the speed governor stood down whenever the vessel reported
holding. It now acts there and commands the slowest speed that makes way against the set; a
speed selector pressed during the hold sets the next leg's speed. An in-extremis escape's hold
keeps the escape's speed. **The clear water round a hold point counts the contacts.** Every
holding command tells the vessel the radius certified clear round its point, inside which she
drives straight back when set off station. It was measured against the chart alone, so a moored
ship near the point was inside it: held 51 m short of FRIGGA, the vessel was told 64 m. It now
counts the contacts the guard sees - for the guard's own hold, the Hold button, an escape, the end
of an uploaded plan, and a Go-To, Return-to-Home or drawn transit, whose planned disc is cut to
the smaller of the two before anything reads it - and a boat set beyond it is routed back round
the contact too. Plans still never see a contact. **A link that reports no set is given the
stream forecast.** Only the simulator wrote the set (`env_set_kn`), so a vessel link that
reports none read as slack water to everything that uses it: the guard's drift and standoff, the
slowest speed that makes way, the hold margins. The console already fetches NOAA's forecast of
the stream at the boat's position in both modes, so a frame with no set of its own now carries
that, marked `env_set_src: "stream"`, and the **Set / crab** row says "stream forecast". It is
not the whole set: the wind's leeway is modeled only in the simulator, and in a blow it can be
most of it. A link's own set is never replaced, and no forecast leaves the set absent rather than
claiming slack water. **The real link still sends no telemetry at all** (Phase 0), so this takes
effect with its first frame; the simulator reports its own set and is unchanged. Rehearsed on a
throwaway console with his line, boat and set and a moored test contact 45 m north of HOME: the
Return-to-Home ran at HIGH and, arrived, held at SURVEY - the slowest speed that makes way in
1.75 kn - where HIGH used to stay on; it told the vessel 38.0 m of clear water round home, and
143.2 m once the contact was cleared.

**Avoidance you can see and trigger** (2026-09-27, Andy: "There is no button or right-click
selection to initiate or manually avoid an AIS target"). Three additions, none of which changes
the automatic answer above. **Right-click a contact** — her red hull on the chart — and the
menu offers **Route round <name>**, her length in the key: while the guard holds the survey for
her it is the way round *now*, the held path without waiting out the 10 s; on a survey still
**running or paused** it **amends** the plan round her — the remainder from the first point of
her line beyond her ring, the way in routed with the contacts in the model at the standoff — with
no hold and no re-upload, and the guard's ladder settles while the amendment lands (`contactAt`,
`avoidContactAt`, `aisAroundRunning`; the row says why when it cannot: not on a coverage line,
held for a charted feature, arm first). The held bar carries **ROUTE ROUND HER NOW** beside
RESUME SURVEY AT LOW SPEED while she is held for a contact still on the line (`aisAroundNow`
forces `aisAroundTick`; refused in words while you have her paused). And in the **simulator**
the menu offers **Place a test contact here** — a moored 20 x 8 m hull snapped onto the nearest
survey line within reach and lying across it (at the click itself where no line is near), served
by `/api/ais` with age 0 beside the real traffic, with or without the AIS
service running — and **Clear test contacts** (`POST /api/ais/test`; a real link refuses it).
**To rehearse the whole thing:** run a survey in the sim, right-click the line a few hundred
meters ahead of the boat and place a test contact, and watch the guard slow and hold her
(SURVEY HELD, the 10 s counting down on the bar); then press ROUTE ROUND HER NOW, or
right-click the contact and choose Route round, or right-click the line beyond her and choose
Resume from here, or wait the 10 s out — each ends with the survey carrying on beyond her,
one ship-length off. **The first rehearsal caught a defect the suites could not** (their router is a
stub): the way in to the rejoin point was judged as a place to *hold* — the 6 m hold margin and
the hold disc — so a point a standoff beyond her ring was moved off the line and the resume
refused with "inside a keep-out"; the automatic way round would have failed the same
way. A rejoin point is a waypoint the boat passes through, so the three way-in sites now ask the
router for a **fly-through** target (`flyThrough` in `holdTarget`): clear at the buffer it stands
where it is, blocked it is refused by name, nothing is relocated (`planner_guard_seam` 7e). **And
the second rehearsal caught the next one:** held while *swinging onto* the return line, with no
coverage line under her, the way round had no line to walk beyond her and refused, while the bar
went on promising the console would route round her. Held on a turn, the way round now picks the
plan up at its **next waypoint**, routed round her (a next waypoint inside her ring is refused by
name), and the bar says she was stopped on a turn (ais_avoid 17h). **And a live run caught the
gap in that (2026-10-16):** a test contact dropped on the survey's *approach*, where the next waypoint
lay 33 m before her and the plan's next leg ran 3 m from her center - the guard held her, the
console's way round went, and the next leg brought her straight back, ten times in three minutes.
Held anywhere off the coverage lines (a turn or a transit), the way round now **walks the route past
her** as a held Go-To's does - from where she stopped, through the waypoints still to fly, to the end
of the first coverage line - and picks the plan up at the first point clear of her ring with the
rest of that stretch clear of it, the way in routed round her (ais_avoid 17h-17j); the bar says she
was stopped off the coverage lines.

**CPA and TCPA** — the closest the two vessels will come, and how long until that happens —
are shown for every contact with a track. The contact is projected on its present course and
speed. So is your boat, **unless she is being steered along a route** (a running plan, a
Go-To, a transit, an RTH): then she is walked **along that route** — every turn, each leg at
the speed the plan commands on it and the set along it — and holds at its end (2026-10-10;
Andy: *"the ASV path should be known through the whole mission barring avoidance
maneuvers"*). The route is the one the clearance guard projects, so a deviation it splices
in is the route, and a hold, a stop or the transmitter is not: then her present course and
speed stand in. Along a route the CPA is the closest over the **whole** route, not the first
close pass; a contact the route only opens from shows its range now and no time (her route
behind her is not walked); and the hover tip says *along her route* when it is. They are recomputed
from the live kinematics every time they are read, so a **manoeuvre by either vessel is
reflected immediately**; there is no cached figure to go stale. A contact already drawing
away says so rather than showing its past closest approach as though it were ahead, and two
vessels holding station on each other report a range with **no** time rather than an
enormous one divided out of report jitter. CPA is a *prediction* on the assumption that the
contact holds its course and your boat its plan — an input to a watch, never a substitute
for one, and the console reports it
without ever steering on it.

**TCPA has its own column, beside CPA** (2026-09-08). It used to ride only in the row's
hover title, which put the one number that says *how long you have* behind a hover. The
sign is carried rather than clamped: a closing contact counts down (`2m16s`), one already
opening reads negative (`-1m37s`) to match the arrow on its CPA, and two vessels holding
station show an en dash because there is no moment of closest approach to name.

**The traffic table sorts on any column, including CPA and TCPA.** Range is the default,
and the card opens closest-first. Sorting by
CPA orders by *state* first — closing contacts, then those holding station, then those
already opening, then those reporting no track — and by distance only within a state, with
ties broken by time-to-CPA. The state order does **not** flip when the column is reversed,
because a plain numeric sort would put a vessel that passed 10 m astern a minute ago above
a ship closing to 400 m, which is backwards for the one job a collision-ordered list has.
An opening contact's CPA is marked with an arrow so the number is not misread.

**The card is stable between updates, and each value moves on its own.** Rows are keyed
by MMSI and reused, cells are EDITED rather than replaced, and the status line is three
fixed spans rather than a rebuilt one — so a poll writes only the characters that
changed. Measured on a six-contact feed: 51 DOM node insertions and removals per three
updates became 6, with the writes landing as in-place text edits instead. And **a
contact missing from a single update is no longer deleted** — AIS is intermittent and
the range filter runs on the server, so a ship near the edge dropped out of one snapshot
and returned in the next, blinking every 8 s. Since 2026-10-10 a contact that falls silent
inside the range is not removed except by the operator: it stays in its place on its last
report, dimmed as not reporting (the table's order, below; out of range it is deleted), and its CPA and
TCPA read "–", so stale numbers are never shown as live.

**Tonnage is the one thing AIS does not carry.** No AIS message contains gross or deadweight
tonnage — it is a registry fact rather than a broadcast one — so `gt`, `dwt`, `built` and
`flag` are carried through the pipeline and stay **absent** until a licensed
vessel-particulars source is configured. **MagicPort is not that source**: it publishes no
API, and its terms prohibit *"the use of any robot, spider, scraper or other device,
program, tool, algorithm, code, process or methodology"* without written permission, so
nothing here queries it.

Marine **AIS** (Automatic Identification System) is how ships broadcast their
identity, position, course and speed — over VHF, and onto the internet via shore
and satellite receivers. The **AIS** button is a simple on/off overlay of the vessel traffic around the boat —
the **whole lake** when you're on an enclosed lake (e.g. a Great Lake), or **within
5 nm** (9.26 km) at sea by default, which the card's range control widens or narrows:
each vessel drawn pointing the way she is heading, colored by ship type
(cargo / tanker / passenger / fishing / tug / …), with the name (or MMSI) beside it
and full details on hover — **and** in an **AIS traffic table** (each vessel by
range / bearing / speed / CPA / TCPA) that opens with the layer and can be closed to a
chip / reopened at will. **The table keeps its own order.** Contacts stand in the order the
console acquired them (a batch first seen together goes nearest first, card open or not),
and nothing the feed does reshuffles them: a new contact joins at the bottom however near
she is. **Drag a row by its grip (⠿) to put it where you want it**, the top included, and
**× removes one**; she comes back, at the bottom, once she has left the range and come back
into it. A header click sorts the list once, and it then stays in that order. A contact
**out of the selected range is deleted from the list** (since 2026-10-13; it used to be
struck through in red and keep her place): she comes back, at the bottom, the next time she
reports from inside the range. Each poll names the contacts the card is holding (`held` on
`/api/ais`), and the console reports the ones it still collects beyond the range (`beyond`,
apart from `vessels`, so the guard's model is untouched): one that sails out is deleted then,
not left on her last report from just inside the line. One that falls silent inside the range
is dimmed as *not reporting*. Nothing else leaves the list but by the operator's ×; there is no row cap, the
card scrolls, and the order and the removals survive a reload. The table always carries a **status line naming
the live feed and its coverage** — e.g. *connected · aisstream (global) · no vessels in
5 nm yet*, or *connected · digitraffic (Finland/Baltic only)* — so an empty list tells
you whether the service is down, still warming up, genuinely quiet, or simply on a feed
that cannot cover where you are. **While a passage is being sailed the card shows at least
15 nm** (Andy, 2026-10-16: "widen the AIS range to 15 nm during a passage"; offshore on a
night passage, 5 nm showed nothing for most of the night). Each poll asks the console for it
(`floor_km` on `/api/ais`). The range field keeps your own setting, the note beside it reads
*15 nm on passage*, a wider setting of yours stands, and your setting is back on the first
poll after the passage is done or dropped. The guard's AIS keep-outs are built from the same
contacts, as they are at any range you set. It is **situational awareness only** — subject to
feed coverage, latency and gaps — not a navigation or collision-avoidance system.

The data comes from a **separate service, `ais_service.py`**, which the console
queries (proxied at `/api/ais`); the feeds and any API key stay out of the console
and the browser. It is **vendored from `asv_core`** and shared with the sibling console —
change it there, not here. **The console auto-starts it** — you never run it yourself. It's
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
  and shows a narrower radius out of it — 5 nm (9.26 km) by default, changed LIVE from the
  range control on the AIS traffic card**. The card reads in nautical miles, to a tenth of a
  mile below 10 nm as the contact list does. Because the wide area is already collected, widening
  the view is instant and never re-subscribes; the control clamps to the collected width,
  and the card reports *"3 of 6 in 81 nm"* so *nothing out there* is distinguishable from
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

**A service the console started that exits is started again** — 5 s after it goes, the wait
doubling on each failure up to 5 minutes and dropping back to 5 s once a restarted service has
run two minutes, so one that dies at start does not spin. Each exit is printed with its code
and written to the session log. The console restarts only a service it started and has not
stopped; one already listening on the port when the console starts is used, and never taken
on. Until this a crashed service left the layer empty for the rest of the session, reading
exactly like a quiet sea.

## Using it

**One tab is in charge.** The clearance guard, the speed governor and the end-of-plan
Return-to-Home all run in the PAGE, so a second browser tab would be a second set of them
commanding the same boat — and a tab the browser has put to sleep is a set that has quietly
stopped, with nothing on screen to say so. Each chart window tells the console which tab it
is and reports in as it handles the console's telemetry stream (at most every 2 s); the
console grants supervision to ONE of them, refuses the others' commands in words (HTTP 409),
and says on its own window when the supervising tab has not reported for 10 s. A view-only
tab shows **👁 VIEW ONLY · TAKE OVER** in the top bar, greys its command bar, and draws
everything else exactly as before — a second screen is what it is for, and you can still
draw and save a plan from it. Click the pill to supervise from there instead; the handover
is immediate and recorded. **Stop, Pause and E-STOP work from every tab**, in both
directions — the page never withholds them and the console never refuses them. A lapse is an
**alarm, not a hold**: nothing the vessel does depends on the page, and a browser hiccup
halting a survey mid-line would be its own hazard.

The **controls window** the console opens beside the chart is not a second tab in this sense:
it runs none of those checks, and every control in it is carried out BY the chart window
supervising in the same browser, so it never takes supervision itself. (Until 2026-09-16 it
did report in, and took the post from the chart window ten times in twelve minutes of one
session; while it held it, nothing ran the guard.) A window
that is merely **out of sight** keeps supervising: the browser slows its timers but keeps
delivering the telemetry stream, and the checks run on the stream. A tab the browser actually
put to **sleep** is the lapse — when it wakes it says how long it was gone and writes
`page_asleep` to the session log — so keep the console out of Edge's sleeping tabs: add
`127.0.0.1` under Settings → System and performance → "Never put these sites to sleep"
(`edge://settings/system/managePerformance`), once, for every console window on any port. It is
not a per-tab switch - Edge has none - and the console cannot set it from the page; the controls
window's red banner names it. (Measured 2026-10-18: a chart tab behind another, Edge's sleeping
tabs on, stopped at five minutes.) A tab that has only
just come back from a silence of its own cannot take supervision on that report
(`tests/supervisor.py`, `tests/supervisor_page.js`).

**A tab that is planning keeps the post (2026-10-12).** A Go-To's route search runs on the page
itself, and over a wide chart it can hold the page for many seconds; a page that is computing
cannot report in. On a Go-To up the Piscataqua the supervising tab went silent for 11 s and then
17.8 s, a second chart tab took the post each time, and the Go-To was refused when it went. The
supervising tab now tells the console just before each search that it is planning, and the
console keeps its post through the silence (at most 60 s; its next report ends that), says on its
own window that the tab is planning rather than that it stopped, and the page does not call the
gap a sleep. Meanwhile a view-only tab's pill reads **👁 VIEW ONLY · the other tab is planning**,
and TAKE OVER still moves the post at once. While another chart tab is open, the supervising
tab's top bar shows **⚠ 2 CHART TABS**: close the chart tabs you are not using
(`tests/supervisor.py` 13-13c, `tests/supervisor_page.js` 5 and 9-9c).

**The route search runs in a worker (2026-10-12).** Go-To, RTH, a drawn transit, Upload, Continue,
Resume from here, a passage's section and the ETA rows now search for their route in a background
worker (`static/js/route_worker.js`), so the chart, the clearance guard, the controls and
supervision's report keep running while it searches. The worker runs the planner's own code and its
answer is the page's own, field for field: on a Go-To from New Castle up the Piscataqua, the
299-waypoint route the worker returned was identical to the same search run on the page. The chart's
keep-out model goes to the worker once per model, its points packed into one array of numbers and
handed over rather than copied: a few hundredths of a second, where copying it took up to 0.7 s.
Reading the chart wider still pauses the page about a second while it takes the read in. On a two-core
laptop the search itself takes somewhat longer in the worker than it did on the page, because the
page keeps working beside it. If the worker cannot answer, the page plans on its own thread as
before, and `?route_worker=off` on the page's address does that every time. **A Stop, Pause, Hold or
E-STOP pressed while a route is being planned withdraws it**: the banner says so, and nothing is
sent (`tests/route_worker.js`).

**Planning is several times faster (2026-10-13).** Every keep-out test used to check every feature on
the chart, and on a long Go-To that was most of what the plan cost. Each list of chart features now
has a grid of 250 m cells, so a test reads only the features near the point it asks about, and gets
the same answer (`tests/keepout_index.js` holds the grid against the plain walk, on two of his own
charts among others). The 61 km Go-To from New Castle to Gloucester now plans in 5.5 s with deep
water first, where it took 23.2 s; each the mean of three runs alternating with the code before it, and the route is identical.

**Two waters are not a reversal (2026-09-25).** When the chart splits a line into runs on both
sides of a land mass, Punch Out's order finishes one side and crosses to the other, and the join
between the last run on one side and the first on the other used to be judged a *reversal* by
geometry alone — neighboring lines, opposite headings, ends within the turn ladder's span. The
ladder was then asked for a loop that could only cross the land, and the pair went red with its
straight join drawn straight over the land (a Fort Point survey, on the console). Now a join with
**more than a spacing's worth of charted keep-out on it** is a **region hop**: routed round, at the
transit speed, counted in the punch's readout as "pair(s) of runs on different waters", and never
refused as a turn. A join that merely grazes a shore, or crosses a finger pier, keeps its turn
ladder and its trim; a navigation channel between two runs keeps the turn-water rule's own remedy.

**Ask the chart what a line is.** Right-click a line → **What is this line?** and the console
names the layer it belongs to: a committed survey line (yellow, with its number, length and
heading), the uploaded route (green, the only green), the **pattern preview** (cyan, *not in the
plan* — ADD TO PLAN commits it, Reset on the Survey tab clears it), a **red join** in that preview (which two
runs it joins, and whether it is a reversal with no flyable turn — Add to plan refused — or a
hop Upload will route again), the survey boundary, a measurement you
drew (magenta, never uploaded), the vessel's trail, or a keep-out read off the chart. The
NEAREST thing within 14 px wins, and a click near nothing says so rather than naming the nearest
line. The row reads rather than commands, so it is never gated on the link, the arm state or
which tab is supervising (`tests/identify_layer.js`).

**And a page that stops responding leaves evidence.** A watchdog on its own timer measures how
late it was, so a freeze the operator felt becomes a record instead of a memory: a gap of more
than 1.5 s that BEGAN while the page was on screen writes `page_stall` — wherever it ended —
with the gap, the editing mode, which pattern corners were down, how much geometry was on the
chart (waypoints, lines, route, track, keep-out zones, zoom) and the operator's last action;
over 5 s it also says so on a page that is on screen, once per half minute. A gap that began
OFF screen is the browser's throttling, not a stall, even when the page is back on screen by
its end. This does not fix the hang reported while placing survey corners; it makes each one
diagnosable (`tests/frame_health.js`).

**And the freeze it kept recording on every Upload and Return-to-Home is gone** (29 September,
"Fix the routing freeze, push and merge"). It was never the router: routing his 25-line plan takes
about 100-300 ms, and a Return-to-Home route 40 ms. It was the chart-image read that runs before
every Upload, Go-To, Return-to-Home and drawn transit (the one that finds the piers the ENC does not
carry). Once the tiles had arrived, everything after them ran as ONE task, with the clearance guard
blind for all of it: 3.0 s on a Return-to-Home from the far end of his line 8, 6.6 s in the
rehearsal log, 4-9 s on his Uploads. Two thirds of it was one search. To decide whether a mark is
ATTACHED to a charted structure, the read measured both ends of every mark against every structural
segment in the whole extract, 97,753 of them for 70 marks, of which 2,904 lay anywhere near the
picture. That search now uses a grid, and it gives EXACTLY the old answers: the scan's output
compared byte for byte on his chart, and 5,642 probes (every tie at a shared vertex included) gave
the same distance and the same segment. The read also paints only the features that can touch the
picture (214 of 5,530 there, with an identical mask), and it hands the page back between its steps
so the guard judges the telemetry in between. Measured with the browser's own long-task record, the
longest single task is now 137 ms on that Return-to-Home, and 378 ms on his plan's Upload, where
the plan's own routing is what remains.

**And every telemetry frame costs about a fifth of what it did** (29 September, "#1", then
"definitely push and merge"). With his 25-line plan loaded, drawing the chart took 22.9 ms of each
23.9 ms telemetry frame, four times a second, whether or not anyone could see the page, and 18.6 ms
of that was the keep-out layer, redrawn from every feature of the extract on every frame. The chart
layer beside it was cached, but keyed to the view to the pixel, and the view follows the boat, so
under way it missed as well. Both layers are now drawn over the view plus a 256-pixel margin and
slid into place as the view moves. They are redrawn only when the view leaves the margin, the zoom
changes, or something they are drawn from changes (the tide, the depth floor and survey window, the
enforce toggles, a new chart read). Measured on a throwaway console with his plan: a frame costs
5.1 ms with the boat idle (was 23.9), and 7.3-8.0 ms under way at 7.7 kn with the view following,
at zoom 13 and 17 (was 27.0); neither layer was redrawn once in 30 s. The chart still draws on every
frame, hidden or not: pausing it in a covered window would risk a chart that stops updating in front
of the operator.

**THE PATH PLANNING CARD (2026-10-13).** Every way a path is drawn is one card, always loaded - in
the ASV Controls window when it is open, otherwise on the chart (where ▾ folds it to its tabs).
Five tabs: **Survey** (the plan's surveys in run order, the pattern, its **Area**, Max depth, the
survey and turn speeds, leads, turn shape, Punch Out), **Search**, **Transit** (Follow, or plan
and sail it as a passage), **Go-To** and **Waypoints**. A tab only chooses what the card shows;
**Draw** in the card's head arms the chart for it, so a click to look at the chart is never a
point added to a plan. A tab with nothing drawn yet arms itself (Waypoints never does: a click
there adds a waypoint); **Esc**, Add to plan, Follow, Sail passage and Go put the chart back to
panning, and while it draws the chart says so (*DRAWING SURVEY PATTERN · ESC TO STOP*).
**Route rules** under every tab is what every behavior routes by - Min depth, Water, Buffer,
Transit kn, Open water, Channel rocks, the chart features - and the only copy: the command bar no longer
repeats Buffer, Min depth or Transit kn. **Waypoints and end of plan**, under every tab after Route
rules (2026-10-14, Andy: "Move waypoint approach and arrival status and end of plan to the Path
Planning card"), holds what the command bar did: the arrival radius (Arrival m), the approach
radius (Approach m) and the End of plan; it folds to one line like Route rules. An End of plan
picked is kept until the console reports it: the console's echo of the old one, every frame
until the save lands, used to put the old one back - picked in the controls window, the pick was
lost. The plan as a whole (waypoints, length, CLR PLAN) is the card's foot. The WPT / SURV / BND /
SRCH / TRAN buttons are gone. `tests/path_card.js`.

1. **Plan** — on the **Path planning card**: the **Waypoints** tab to drop/remove
   waypoints, or the **Survey** tab for a **CAMP-style 3-click survey pattern** (its switch on
   **Pattern**, the default; **Bounded** fills an area instead, below): press
   **Draw**, then click the start corner, the opposite (diagonal)
   corner, then a third point that sets the **line spacing** (distance from the
   start) and **orientation** (its bearing). Parallel lines fill the box
   automatically as a boustrophedon (lawnmower) route — the line *count* is
   derived from width ÷ spacing, not entered by hand. All three control points
   stay draggable and the pattern regenerates live, and the **crosshair grip at the
   centre moves the whole pattern** — every anchor by one delta, so shape, spacing and
   direction are preserved exactly. An alignment option
   (start / center / finish) positions the leftover margin. Both **Spacing** and
   **Direction** are editable fields — type a value to force the spacing or rotate
   the whole pattern to a bearing. `Add to plan` commits the lines + waypoints. Set the
   arrival and approach radii and **completion** (the End of plan, below) under the card's
   **Waypoints and end of plan**, and the transit speed (whole knots, the hull's own range) under
   Route rules. The plan persists server-side (`mission.json`). Reads and writes are locked and
   retried; a file that is there but cannot be read as a plan is refused rather than treated as
   empty (a corrupt one is copied aside as `mission.json.corrupt-*`); and each change to the
   plan's geometry keeps the previous plan as `mission.json.bak1`..`bak5`. A live speed command
   never writes the file - the commanded speed is the vessel's.

   **A save is checked, and it is said when it is not kept.** A body posted as the plan that is
   not one - no waypoint list, a position that is not a position, a negative buffer - is refused
   in words and writes nothing (an explicitly empty plan, CLR PLAN, is still saved). The plan
   carries a **revision**: every save bumps it and the page sends back the one it holds, so a
   page whose copy is older than the plan on disk - another tab, or a window left open - is
   refused rather than writing over the newer plan, and it says **PLAN NOT SAVED** and stops
   saving until it is reloaded. Any other failed save is said too and retried with the next
   change. A page that could not LOAD the plan - the console still starting, the file locked for a
   moment - saves nothing until it has, says **PLAN NOT LOADED**, and tries again every 3 s, so an
   empty page can never be saved over a real plan. And what destroys work asks first even in the
   simulator, where every other confirmation answers itself: **Reset**, **CLR PLAN** (naming what it
   deletes) and dropping a held survey's remainder. And every request the console serves answers: an error in any of them is a 500 in
   words, never a dropped connection with nothing in the session log.

   **Chart source (`SRC`).** The ENC's answer to a paper chart's title block, as a
   card: **every cell in view, one row each** (broadest scale first, usage band
   spelled out), with the cell the vessel is actually in marked and named — where
   scales overlap it is the **largest-scale** cell covering the vessel, the sheet
   you are bound to navigate by. Then the **usage band**, the **chart datum** with the *live* water-level
   correction being applied, and WGS 84 / Mercator. It states the **sounding units
   on both sides**, because they differ: the chart image prints **feet**, while the
   ENC data and every depth the console computes — including this vessel's
   draft-derived nogo floor — are **meters**. Below that, the part a printed title
   block can't give you: the IHO **zone of confidence under the vessel right now**,
   with the **survey dates** and source behind it, read from the chart's own
   `M_QUAL` polygons and re-evaluated as the vessel moves. It matters — the DriX
   operating area at Lewes returns a mix of ZOC B and **ZOC D** (the lowest
   confidence class), and the card flags the poor ones in amber as you enter them. Where NOAA does
   not answer whole for the water she is in - its chart-cell or confidence query fails - the card
   says which and asks again every 30 s (2026-10-17: it had kept the empty answer for as long as she
   stayed there).

   **Units (`UNITS`: METRIC / SAE).** A pill on the top bar switches the display
   units (2026-10-17; it was the DIST pill, km / nm): **METRIC** reads every **long**
   distance — route lengths, distance remaining, HOME range, station distances — in
   **kilometers** and fuel in **liters**; **SAE** reads them in **nautical miles** and
   **US gallons** (persisted, both windows; a choice saved before carries over).
   Display only: every stored and transmitted value stays metric. Deliberately
   outside it: short distances (spacing, buffers, depths, the LINES table) always
   read meters, chart tiles print feet as charted, the AIS card always reads nm,
   and a battery reads volts.

   **The Lines card (`LINES`).** A per-survey-line table: each line's length, its
   planned time at the plan speed, and the actual time once flown (actuals accrue
   while the survey runs and land in the session log, with the turns timed as their
   own components — and, since 2026-09-25, the **transits** too: every gap between
   lines that is not a reversal, the hop to the next coverage region, has its own row
   with the committed route's meters, a plan at the transit speed and the clocked actual,
   and the transit and RTH rows carry their actuals once flown). **A line is the line you drew**: when Punch Out cuts one around a
   keep-out, it stays one row, read as its parts with the gap between them
   (`833 + 1115 (392 m gap)`), and the chart's labels, the turn table, the survey
   card's line count and spacing, and every "line N of M" count it the same way. Above and below the table sit the **transit and RTH rows**:
   the **ENC-routed** time and distance from the boat to line 1, and from the last
   line back home — routed by the same planner every behaviour flies (keep-outs +
   the Rule 9 channel lane), because at this console's home water the straight
   line to the survey area crosses land and a straight-line "estimate" would be a
   different route's time. Each row degrades alone and honestly: no fix, no
   transit row; no home, no RTH row; planner refusal, the refusal itself in the
   row ("unroutable — the target sits in land"); nogo not loaded, the figure
   marked **direct**. A plan-speed change re-times both rows instantly from the
   cached routed distance — no re-route — and the transit row stays **live during
   the run**, re-routing once per 50 m of real motion as the boat closes on line 1.
   **The table is updated in place**: a telemetry frame rewrites only the figures
   that changed — a line's clock, the highlight on the line under way, the transit
   rows — so a tooltip, a selection and the scroll position survive the run (it
   used to be rebuilt four times a second). It is built afresh only when the plan,
   its leads or its number of turns change.

   **The chart menu + the measuring tool (right-click).** Right-clicking the chart
   opens the **point commands** — its header names the position you clicked:
   **Measure distance**, **Go-To here**, **Set Home here**, **Spawn here**,
   **Copy position** — and, only while a run is PAUSED, **Resume from here** (see
   *Resume from here* under the run controls). Go-To, Set Home and Spawn are **no longer on the command bar**;
   each was a two-step control (arm a button, then click the chart) and the menu
   already carries the point. It is a shortcut past the arming *step*, never past the
   arm *gate*: every row asks the console's own predicate — `canCommand()` (armed, no
   E-STOP), `canSetHome()` (a live link), `canSpawn()` (simulator only) — and says why
   beside the row when it is closed (`arm first`, `no link`, `sim only`), so each rule
   still exists exactly once. **Set Home moves HOME to the clicked point** — `set_home`
   takes an explicit lat/lon (validated numeric and on the globe — which rejects `inf` and
   `NaN` too, since every comparison against them is false) or, given none,
   still captures the vessel's own live fix with both its stale-telemetry guards intact.
   **Because RTH *drives* to HOME, the client tests the chosen point against the same
   keep-out model every behaviour routes by and WARNS on the banner** when it is not water
   the vessel can sit in — it widens the ENC extract to cover the point first, so a distant
   home can't read as "clear" merely because nothing is loaded near it. It warns rather
   than refuses: the point you picked is the point you asked for, and RTH still refuses a
   route it cannot plan. **Measure** is click → move → click: the leg follows the
   pointer and the reading — **distance and true bearing** — is drawn **along the
   line**, rotated to it and flipped so it never reads upside-down. Distance goes
   through the same `fmtDist()` as every other long distance, so a measurement follows
   the `UNITS` pill. Legs accumulate until cleared; `Esc` peels one layer at a time
   (menu → half-drawn leg → all measurements → the tool), and **dragging still pans**.
   Drawn in **magenta** — S-52's colour for the mariner's own information, and the one
   chart colour this console had not spent — because a measurement is an *annotation*:
   it is never uploaded, saved to the mission, sent to the vessel, or logged.

   **Search patterns.** The card's **Search** tab generates a canned search route (à la CCOM's
   Project 11 `track_patterns`): **Expanding box**, **Sector**, or **Parallel /
   creeping-line**. Click a datum, tune the params (leg / radius / spacing /
   heading / turn), and `Add to plan`. Legs clip to the nogo zones just like a
   survey (cyan kept / amber routed-around / red blocked).

   **A preview never looks like the route.** A pattern not yet added to the plan - a survey
   before or after Punch Out, a search - is drawn **cyan** and labelled **PREVIEW — not in
   plan** on the chart. **Green** is only ever the route uploaded to the boat, and the committed
   plan's lines are **yellow** with their L# labels. (A punched preview used to be green, the same
   green as the route under way.)

   **Punch Out (chart-feature clipping).** Draw a survey rectangle, set the survey
   **depth window** (Min depth, optional Max — blank surveys deep water), and click
   **Punch Out**: the console trims every survey line to safe water using the same
   **nogo model** every behaviour avoids — off land / shoreline / **piers & docks**,
   outside the depth window, and clear of fixed aids, hazards and (optionally)
   dredged/restricted areas, each expanded by the keep-clear **Buffer**. The buffer
   and the enforce toggles are **shared** (edit the buffer under the Path planning card's
   **Route rules**, shown on every tab); lowering it (to ~1.5–2 m) lets the small boat thread a
   tight marina. The buffer can never drop **below the active vessel's own**
   `planning.nogo_buffer_m` — a plan saved against a small boat must not quietly narrow
   a bigger one's clearance.

   **Two of the toggles DISREGARD a rule, and both start armed (2026-09-30).** The survey
   card lists six: the four it always had — *Land / shore / docks*, *Water shallower than
   floor*, *Aids & hazards*, *Dredged / restricted* — and **Shipwrecks** and **Shipping
   channels**. Both new boxes are checked on a fresh page, so nothing changes until the
   operator unchecks one, and each says so wherever it shapes a plan.
   - **Shipwrecks** unchecked drops every charted wreck — wreck points and wreck areas —
     from the keep-out model that **every** behavior shares: survey, Go-To, RTH, search
     and the guard. It only ever narrows: a wreck that *Aids & hazards* or *Land / shore /
     docks* has already switched off stays off whatever this box says, and a wreck the
     chart proves passable is counted as passed, not disregarded. The no-go row adds
     **· wrecks off**, its tooltip counts the charted wrecks the model no longer holds, a
     disregarded wreck keeps its chart symbol but loses its keep-out (a point's dashed
     circle, an area's red fill), and every punch made with it off says how many charted
     wrecks it disregarded.
   - **Shipping channels** unchecked disregards the survey's own two channel rules: a
     channel that a survey line runs all the way across is no longer cut out of the
     coverage, and the reversal turns and the line order may use channel water that no
     coverage line enters. It is **survey-only** — Go-To, RTH and transits still keep
     right in a channel under COLREGS Rule 9 — and the punch summary says *shipping-channel
     rules OFF*.

   **Charted hazards have a SIZE, not just a position.** A wreck symbol on a chart is a
   *position*: the casualty under it can be a 100 m ship, and the ENC says nothing about
   its extent or which way it lies. So wrecks, hulks, obstructions and awash rocks carry
   an intrinsic **10 m radius** (vessel-configurable via `planning.wreck_radius_m`), and
   the buffer is added on top of that as the margin it was always meant to be. Objects
   that genuinely *are* point-sized — piles, buoys, beacons — are unaffected. A sized
   hazard draws its circle on the chart, so you can see why a route swings wide.
   The radius was 50 m until 2026-10-09, when Andy set it to 10 m for all four kinds,
   wrecks and hulks included. A casualty bigger than 10 m plus the buffer is therefore
   NOT covered by the default; a vessel that wants more berth sets it in its own file.

   Where the chart gives a **sounding over** the hazard (`VALSOU`) that clears the floor
   in force by a metre — tide-corrected, the same as depth areas — the boat can pass over
   it, and the hazard is **dropped from the keep-out model entirely**. **No sounding means
   unknown**, and unknown takes the full berth rather than the benefit of the doubt.

   *That used to say "collapses back to a point", and a point in this model still carries
   the buffer — so the boat could not pass over it after all.* Andy, 2026-09-09, on a
   survey line cut in two beside a rock with **8.8 m** charted over it, on a hull drawing
   **0.12 m**: *"The avoidance maneuver circled in red for a rock on the chart is
   unnecessary."* It was. The sounding test had fired and the assumed 50 m extent had
   already collapsed to zero — but the feature stayed in the model, the 3 m buffer made it
   a dot, the dot sat 0.2 m off the line, and the clip split a 350.4 m line into 334.5 m
   plus an 8.0 m offcut. Punch Out then serviced that offcut like any other line: **77 m
   of track across 16 waypoints to collect 7.8 m of coverage**. A hazard the console has
   decided is passable is now simply not in the model.

   It is **still drawn on the chart** — the overlay reads the extract, not the keep-out
   model — so you can see what you are passing over, and the Nogo row's tooltip says how
   many were dropped and why. Two questions, deliberately separate: *may the vessel be
   here* is the model; *what is charted here* is the chart. Depth areas that merely *straddle* the minimum are kept (classified
   by the band's deepest edge). `CHRT` / `NOGO` show the chart features / the red nogo
   overlay. (Finger piers are charted as line features that NOAA's server returns
   empty to a naïve query — the console fetches them by object-id so they aren't
   silently missed.)

   **How the plan becomes the route the boat runs.** The plan runs in the order its
   waypoints were committed, and nothing re-orders it afterwards — not Upload, not the
   boat. Five steps decide that order (the operations manual's 9.9 is the operator's
   version, the technical manual's 8.3 has the rules in full, and
   `tests/survey_order.js` pins them):

   - *The pattern.* Line 1 starts at your first click and runs square to the bearing of
     your third; every further line is one spacing further toward your second click and
     runs back the other way. So the drawn pattern is already a serpentine from the
     start corner — and **that is the order an un-punched plan commits in**, with no
     generated turns, no leads and nothing clipped.
   - *Punch Out's order* (Boustrophedon Cellular Decomposition), so the boat never runs
     a leg straight through a punched-out area. The clipped runs are numbered across the
     pattern starting from the **outermost line on the side away from your third
     click**. That is line 1 at the start corner when the pattern fills *toward* that
     click — and the **far side of the box** when it fills *away* from it, in which case
     the survey works back toward the start corner. Where a keep-out splits lines, the
     runs on either side become separate **cells**: each is run as its own serpentine,
     always starting from its line nearest the survey's first line, and the next cell is
     whichever has a run end nearest to where the last one finished — so a cell passed
     over early is reached last, with a transit back to it. Every run after the first is
     entered at its end nearer the previous exit, and a line with no runs left (struck
     off, or clipped away whole) does not break a cell.
   - *Trimming and joining.* Every run loses half a line spacing (at least 2 m) at each
     end to give the turn room, runs under the hull's minimum survey line are dropped,
     and the lead-in / lead-out are added. Each consecutive pair is then joined: a
     **generated turn** when the next run is a reversal (headings 180° ± 50°, less than
     about four and a half spacings away, so a reversal across a missing line still gets
     one), which rolls the boat onto the next line *aligned* with its heading instead of
     pivoting hard; otherwise a straight leg if that is clear, a routed **detour** (amber)
     if not, and **red** if nothing gets through. A red *reversal* keeps the pattern out of
     the plan until it is fixed; a red hop is routed again at Upload.
   - *Add to plan* **appends** (once nothing red is a reversal, and not after the water
     level has moved since Punch Out): each run's two ends, then its joining points to the
     next run. A second pattern runs after the first, in the order you added them. Editing
     never re-orders: a Waypoints-tab click adds a waypoint at the **end**, and SHIFT-deleting a
     committed line removes its two ends but **leaves the turns either side** — so the
     boat still travels that line's track, uncounted. Strike the run off *before* Add to
     plan to have the order, the turns and the transits rebuilt around the gap.
   - *Each pattern added is a survey* (2026-10-02, the first phase of sequenced surveys;
     no new controls yet). The plan lists its surveys in the order it runs them, and every
     line and every waypoint a survey put in the plan carries that survey's id. A survey's
     **number** is one past the highest the plan holds and **stays with it**: S2 is never handed
     out again in that plan, and nothing renumbers by order. Two things read the grouping. A
     gap **between two surveys is always a transit**, flown at the transit speed and timed in
     the LINES card's transit rows, however close the next survey lies. And each survey's
     reversals are judged by **its own spacing**: one plan-wide median let a tightly spaced
     survey set the scale for a wide one, so an 80 m survey added after an 8 m one had every
     reversal read as a hop and flown at the transit speed. A plan saved before this loads as
     **one survey, S1**, and is judged exactly as it was. Two patterns added before today stay
     one survey, because nothing recorded where one ended. A plan whose grouping does not hold
     (a hand-edited file, a tag naming no survey, one survey's lines split by another's) is
     flown as one survey, and the page says **PLAN LOADED AS ONE SURVEY** and why. Dragging a
     waypoint now keeps what it was: its survey, and for a turn point the fact that it is one.
   - *The survey table* (2026-10-02, the second phase of sequenced surveys). The top of the
     Survey card lists the plan's surveys **in the order they run**, one row each: the number,
     a **name** you type (shown on the chart and in the LINES card), its line count and
     coverage, and four buttons. **▲ ▼** run it a place earlier or later - its lines and every
     waypoint it put in the plan move with it, a free waypoint (one added on the Waypoints tab, a search) between two
     surveys stays between them, and Upload sends the new order. **✎** loads the survey back
     onto the card - its drawing **and its own settings**: its boundary, Max depth, leads and
     turn shape, which each survey now records at Add to plan. Punch Out, and the button reads
     **Update S*n***: it replaces that survey **where it stands**, keeping its number, name and
     place in the run. Reset cancels. **✕** deletes the survey (it asks; the others keep their
     numbers and order, and the plan as it was is kept as `mission.json.bak1`). The buffer, the
     three speeds, End of plan and Min depth stay **plan-wide** - Min depth is the routing floor
     every behavior and the guard use. Click a row to have the card's Spacing, Direction, Line
     len and Lines describe that survey; a plan of surveys at different headings used to read
     blank there. A survey added before 2 October has no recorded drawing, so its ✎ is grayed:
     draw it again and delete the old one. On the chart each survey is labeled at its first
     line ("S2 Rye ledge"; cyan, "editing", while ✎ has it), and the LINES card puts a heading
     with the survey's own plan and actual times in front of each survey's lines when there is
     more than one.
   - *Running the surveys* (2026-10-02, phase 3a). Click a row and it shows four more
     buttons. **Go-To** sends the boat to the survey's start (its first waypoint), routed as any
     Go-To. **Upload from** uploads the plan *from* that survey on - it and everything after it,
     the approach routed from the boat; the surveys before it are left out, and the banner says
     so. **Backwards** punches the survey again from its other end - entered at the far end of
     its last line, the lines in reverse order and each the other way - and puts it back where it
     stands (it then reads **Forwards**); the card's own **Backwards** box does the same for a
     drawing, and it is one of the settings each survey records. **Clear** forgets the survey's
     progress. **Progress**: each row reads ✓ when every line is done, **n/m** while some are,
     from what this page has seen her run ON each line - 90% of a line's coverage, leads left
     out, makes it done; it is kept in this browser and survives a reorder, a refresh and a
     re-punch over the same water. **The water each survey was cut at** is recorded at Add to
     plan; once the level has moved a quarter meter either way the row shows ⚠ and its tip says
     which way and what it means (fallen: its lines were cut for deeper water than there is).
     **Punch all** (beside the table's heading) punches every survey with a recorded drawing
     again, each with its own settings, against the chart and the water now, and replaces each
     where it stands; a survey the punch refuses is left exactly as it was, and the banner names
     it and why.
   - *A hold before a survey* (2026-10-02, phase 3b). A clicked row's **Hold: off/on** marks the
     survey held (⏸ on its row and its chart label). The vessel can only act at the END of a
     route, so **Upload splits the plan** there: it sends the plan only as far as the held
     survey's first waypoint and asks her to **loiter** at it - your End of plan setting is not
     touched - and the banner says the rest is not aboard. She waits there; nothing releases her
     by itself. The held survey's row shows **Continue S*n* ▶** once she is holding (before
     that it reads "on her way"): it uploads the plan from that survey on and starts it through
     the Start button (its question included); a later held survey splits it again. The
     end-of-plan Return-to-Home does **not** fire at a hold (it did on the first live run - she
     was sent home from the point she was told to wait at), and a guard-held resume of the way
     there still ends in the loiter. Upload from a held survey goes to its start and waits too.
     (Also fixed: with the chart model not loaded, Upload from a survey - or a split - used to
     send no route at all, and the console then flew the WHOLE saved plan.)
   - *Upload* walks the waypoints in order from where the boat is **now**. The
     **approach** is routed clear of the chart and keeps to the starboard side of any
     channel, and so is the **leg into each later survey** (2026-10-02: routed exactly as a
     Go-To over that leg would be - at the guard's standoff where the water allows, keeping
     right in a buoyed channel - where it used to keep the bare buffer like a hop inside a
     pattern); every other leg keeps its planned track and gets a detour only if it now
     crosses a keep-out (a survey line that needs one is no longer counted as a line —
     punch again instead). A leg with no way through blocks the upload. The boat then
     runs the waypoints strictly in order, turning onto each next leg within the
     approach radius, and the End of plan setting applies at the last one. While it
     runs, a leg is a **survey line** only when it runs between the two ends of a
     committed line; everything else is timed and speed-set as a turn or a transit.
     Where more than one line's ends lie within the 5 m match of a leg's, the
     **nearest** is the line it runs (2026-10-02). The first one used to win, and on a
     pattern spaced 5 m or less the line before - run the other way, its ends a spacing
     off - matched too and came first: at 4 m every line after the first was credited to
     the one before it, so the LINES table timed the wrong lines, "line N of M" named
     them, a slow turn and a pause were keyed to them, and **Resume from here** could take
     the line before's leg and run the chosen line backwards. The plan-time estimate's
     walk also takes each line's two ends as a pair now, so a turn point close to a line's
     start no longer makes it give up.

   **Speed is chosen per job, not once for the plan.** A survey run is three different
   things and they do not want the same speed, so the Path planning card carries three: **Survey**
   (the coverage lines — the speed the sensor is specified at, and what the per-line plan
   times are computed from), **Turn** (the reversals between them) and **Transit** (the
   approach out, hops between regions, and Go-To / RTH / Transit). The console commands
   whichever the boat's current job wants as the run moves between them, and hands the
   value back when it changes. They start **equal**, so a console that has never been told
   otherwise behaves exactly as it always did.

   *The turn speed is not only a throttle.* A hull can only hold `v/ω`, so it also sets the
   **radius every generated turn is built at** — a slower turn is a tighter one that reaches
   less far outboard, which is what buys clearance from a dock at the end of a line. Changing
   it re-checks the committed plan and says so if its reversals no longer fit.

   Two overrides sit above the operator's choice, in this order: the **clearance guard**
   (see the Intent card's clearance row) drops the boat to low speed when it is inside the
   buffer and closing, and a turn the planner could **only fit at the slow radius** is flown
   at that speed. Both are temporary; the run returns to the role's speed when clear.

   **A refused turn is retried, not abandoned.** The normal turn loops *outboard*,
   past the end of the line just run. Where a keep-out stands in that water the
   console tries the same turn swept the **other way** — back over water the plan has
   just surveyed, and so known clear — and then both sides again at the **slow-speed
   radius**, which reaches less far. Only if every one of those is refused is there no
   turn, and then the pair is flagged **unsafe** — drawn red — and **Add to plan is
   refused** while it stands. The button grays out, and the note under it names the pairs
   (right-click a red join to see which runs it joins), what refused each turn, and only
   the fixes that can work there: draw the box so those lines end short of what refused
   it, or strike off one of the two runs; a slower **Turn** speed where the boat could not
   *track* the loop; a wider spacing where every turn is a teardrop; standoff from a
   navigation channel. Never a shorter lead — the ladder has already tried the pair with
   none. A red **hop** (two runs that do not reverse, with no detour found) does not stop
   Add to plan: Upload routes every hop again with the full router, and refuses the upload
   if it still finds no way through.

   ⚠ Until 2026-09-16 **nothing stopped a red reversal being added and uploaded**: the red
   was not carried into the plan, and at Upload the straight leg left between the two
   line ends was clear of the chart model, so the boat was sent a 180° it cannot track,
   beside whatever refused the turn — 17 times in one Honolulu plan uploaded that
   evening. A plan added before then can still carry them, and so can one whose turn
   points were deleted on the Waypoints tab (nothing re-checks a committed turn): clear it and draw
   it again. And **a punch the water level throws away** — every tide update does, since
   the runs were cut against the old level — now keeps Add to plan refused until Punch
   Out runs again; it used to leave the *un-punched* pattern to be added in its place,
   lines straight through the piers and no turns at all.

   **A punch that leaves no survey line is refused too (2026-10-01).** It used to end
   *"clear of keep-outs … Add to plan."*, and Add to plan then committed nothing, set the
   plan to a survey, and threw the drawn pattern away. Now the summary says *NOTHING LEFT
   TO SURVEY*, Add to plan is grayed out, and the note under it names what took the lines,
   from the punch's own count of each stage:
   - the chart, when nothing at all was left of them (every line in a keep-out or outside
     the depth window);
   - the operator's own strikes;
   - slivers under a meter the clip left;
   - lines under the vessel's minimum survey line.

   It offers only the fixes that answer those causes: the box over survey-able water, the
   struck runs put back, or lines long enough for the hull's minimum.

   *This matters more than it looks.* Until 2026-08-31 a refused reversal fell back to
   a straight leg between the two line ends. That leg is genuinely clear of the model —
   and it is a 180° the hull cannot track, so the boat loops on its own, uncommanded,
   **outboard**: into the very feature that refused the turn. Refusing the turn was
   what steered the boat at the obstacle, because it removed the only geometry keeping
   it away. One recorded run put a DriX 0.6 m off a wharf on a plan that cleared it by
   14.3 m. Note that *slowing* only reshapes a **teardrop**; a semicircle's radius is
   half the line spacing and no speed changes it — there, widening the spacing is the
   lever.

   **Minimum survey line (per vessel).** A survey line costs two turns whatever its
   length, so below some length the boat spends longer manoeuvring onto the line
   than surveying it. That length belongs to the *hull*, so it is vessel
   configuration — `planning.min_survey_line_m`. Any segment shorter than it is cut
   from the plan and the boat runs straight on to the next one. The length judged is
   the segment **as run**, after the turn margin comes off both ends, since that is
   the water actually surveyed. **0 (or an absent setting) keeps every line** — a
   small survey launch is built for exactly the short lines a large vessel should
   skip. Whatever is dropped is named in the Punch Out readout with the count and the
   threshold: coverage is never removed silently. **Surveys only** — transits, search
   patterns and hand-drawn lines are never filtered. Shipped values: the 7.7 m DriX
   **80 m**, the 4.2 m BEN **25 m**, the 1.9 m Z-Boat **0**.

   **Lead-in and lead-out (the run is longer than the coverage).** The first stretch of
   a survey line is not usable data: coming out of the reversal the steering is still
   settling onto the track and the IMU is still settling with it. The Survey tab takes a
   **lead-in** and a **lead-out**, and a **unit** — metres or seconds. Punch Out extends
   every run by that much past both ends of the coverage, so the boat rolls out, steadies,
   and the coverage the operator drew starts exactly where they drew it. A duration is
   converted at the **survey** speed, because that is the speed the lead is flown at;
   flying it at anything else is what the settling is there to avoid. The value stored is
   the one typed, in the unit chosen — so a lead set as *20 s* stays 20 s and re-derives
   its metres when the survey speed changes, rather than freezing into a distance that no
   longer settles anything.

   *A lead is flown water, so it is clipped like flown water.* A punched run ends either
   where the operator's box ran out or where the chart said stop, and nothing can tell
   those apart from the endpoint alone — so the extension is checked against the same
   keep-out model the turn it leads into uses, sample by sample. Where it will not fit it
   comes back **short**, and the readout says by how much against how much was asked
   (`lead 40 m in / 25 m out (+409 m of 455 m asked, run only — not coverage), 3 run(s)
   cut short of the full lead by the chart`). The ENC extract is padded by the lead for
   the same reason: outside the fetched chart the keep-out model is *empty*, which reads
   as clear rather than as unknown.

   *The reversal is built from the two line ends' HEADINGS, not from the chord between
   them.* A lead-in longer than the lead-out leaves the two ends offset along-track, and
   the turn runs that offset out **on the line** before it arcs — so the boat leaves the
   line it has just run on that line's heading and joins the next one on its heading,
   whatever the offset. (Before 2026-09-08 the semicircle was drawn on the E–F chord, which
   is the same shape only while the ends are abeam; a 40 m lead-in against a 25 m lead-out
   threw the boat off the line at 19° and put it onto the next at 22°.) The water a reversal
   needs past the coverage end is then `max(lead_in, lead_out) + R`, which the Punch Out
   readout quotes.

   *And the lead gives way to the turn, not the other way round.* A lead can take a
   reversal that fitted and make it not fit. Rather than block Upload over a settling
   distance, Punch Out shortens **both** leads on that pair — 60%, 30%, none — retrying the
   whole turn ladder at each step, and says so (`N reversal(s) had the lead shortened to fit
   the turn water`). The last rung is zero on purpose: with no lead the pair is the pair the
   console punched before the feature existed, so a lead can never be the reason a plan has
   an unflyable turn.

   *And when the lead has nothing left to give, the line ends do.* A reversal a keep-out still
   refuses on every rung (every loop the boat could fly enters it, or the hull flown along the
   loop enters the buffer) has **both** line ends pulled back at the turn end, one meter at a
   time, the whole ladder retried at each step, until a turn flies — the first step that does
   is the one kept, so the survey loses the least that buys a flyable turn. When the chart has
   clipped the two runs to different extents, every loop turns around beyond the *further* end
   — in the very shallows that clipped it — so the run whose end reaches past the other gives
   first, up to the stagger (the stub its neighbor never had), and only then do both give
   equally: the loop's apex moves back to the shorter run's level, over the survey's own water.
   The far run may give its whole stub (down to a remainder the hull can still survey), since
   that is coverage the pair could not turn at anyway; the equal phase on top is capped at 60 m
   and a third of what is left. Past that the pair is red and Add to plan is refused as before.
   The banner says so (`N reversal(s) had both line ends pulled back (up to 23 m) to fit the
   turn water`), the LINES table shows the coverage as trimmed, and a strike still finds the run
   by the midpoint it was drawn with (`tests/turn_refusal.js` 15–15d).

   *And the join is judged by the walk that will judge it at Upload.* Upload walks the whole
   routed plan with the follower model and flags corners the hull would round inside the
   buffer (`cornerSlowPlan`); until 2026-09-24 it walked every corner at the plan's **fastest**
   speed, so a 3 m arc the punch had built for 3 kn was walked at 6 kn and six corners of a
   certified punch came back "inside the 3 m buffer EVEN AT THE LOW SPEED". Now the walk takes
   the speed the run will command on each leg — transit onto the plan, survey along a line,
   turn across a join (`routeSpeedKeys`) — and Punch Out asks that same walk of every join
   before presenting it: onto the line end at the survey speed, across the join at the turn
   speed, then with the join at LOW flown exactly as Upload's second pass flies it (the slow
   command withheld for the console's own latency, then ramped). A join that clears only at
   low ships marked `slow`, so the run commands low there; one that clears at neither is
   refused as `track` and the line ends are pulled back another meter. What Punch Out
   presents is what Upload accepts (`tests/turn_refusal.js` 16–17b, `tests/corner_slow.js`
   14b–14c).

   *And on a hull that slows in gear, the governor slows AHEAD of a slower leg* (2026-10-03,
   Andy: "Model the in-gear slow-down in the sim", then "Lead + walk + sim"). The DriX does not
   shed a commanded cut on the 1.5 kn/s ramp the walk used to assume: measured from her own logs
   she holds her speed for a dead time and then decays in gear toward her idle speed, so 7 to 4 kn
   takes **~43 m and 15.5 s**, not 2 s. The governor used to command a turn's speed on the frame
   she reached the turn, so she entered every LOW turn at survey speed. Now, on a hull with a
   `maneuvering.slowdown` block and on a survey, it commands a slower leg's speed where the cut
   must begin - her in-gear run from the speed she is doing plus the console's 1 s command latency,
   **~46 m before a LOW turn at 7 kn** - and the mission card says why ("SLOWING to low 46 m before
   the leg to waypoint N - in gear she needs that water to come down"). The corner walk flies the
   same step and the same lead (coast.js `speedStep`, `leadWant`), Punch Out walks a join from
   where the lead begins, and the simulator sheds speed with the same step (asv_console.py
   `speed_step_kn`, held to the page's tick for tick). The lead is measured from the faster of her
   speed and her leg's own target (so it never lets go on the way in, and a run already at LOW is
   not raised only to be cut again), carries a following set for the cut's time, and latches the leg
   it is slowing for. Measured on synthetic DriX plans, without the lead every corner Upload answered
   by slowing came back "EVEN AT THE LOW SPEED"; with it the punch's verdicts are what the ramp gave
   and Upload answers more. Hulls with no slow-down block - the Z-Boat and the 4 m example USV - are commanded as
   before, and their walk steps as before; but the walk's table of what each leg is commanded at now
   keys a slow-radius turn LOW and a routed hop's vias at TRANSIT, which is how the governor has
   always flown them (it keyed both at the turn speed - the hop an under-flag since 2026-09-24), so a
   few of their corner verdicts move. A stop is still flown on the ramp: it was never measured
   (`tests/coast.js` 17, 19–25, `tests/coast_sim.py` 10–15, `tests/corner_slow.js` 14d, 19g–19o,
   28–30, `tests/turn_refusal.js` 17c).

   *And at the end of a Go-To, a return home or a drawn transit, she comes in slow* (2026-10-08,
   Andy: "AS the ASV approaches end of RTH or GOTO, it hits the final waypoint at full ordered
   speed ... it would be best to slow gradually on approach until it is at or near dead stop prior
   to triggering the loiter command", then "build it with the coast"). She did: the drift-in -
   where the prop stops so she arrives with the way off - armed on the route's LAST LEG only, a
   laned route's last leg is 28–56 m, and from her 14 kn transit the DriX needs 74–150 m of drift,
   so it was refused on all eight Go-Tos and RTHs of his sessions of 2026-10-07/08 and she ran onto
   each hold point at 14 kn. Now, on a hull that slows in gear, the end of a passage is its one
   slower leg: the governor commands the hold speed (the slowest that makes way against the set -
   LOW, 4 kn, in calm water) where her in-gear cut must begin to have her there by the drift-in's
   release - about 133 m before the end of a 14 kn Go-To in slack water - and the drift-in is solved
   from that speed (about 52 m in slack water, shorter against a set) and measured ALONG THE ROUTE
   LEFT. The vessel arms it on the range left along her plan, round whatever legs lie between, and
   publishes it (`coast_from_m`) for the governor to lead to; she comes in at about a knot, and
   station-keeping takes over. Where the route is too short for the cut and the drift both, the
   drift-in is solved from her higher speed, as it always was (she stops short - the safe side);
   where the solver refuses the slow drift-in (a keep-out on its track) there is none, and she is
   brought down to the hold speed at the hold point itself. The Intent card says which, and the RUN
   block says "SLOWING to low N m before the drift-in". The hold disc no longer decides whether to
   coast (four of those eight had discs of 87–140 m), and a drawn transit comes in on the drift too.
   Two faults of the coast that could not show while it never fired are fixed with it: after a
   spent drift-in the walking-pace cap (1 kn) no longer applies once she is station-keeping - she
   could not hold station in a set over a knot - and on the approach it is never below the set on
   her nose plus half a knot (in 2 kn of head set she was set astern, never arriving). Hulls with
   no slow-down block are commanded as before (`tests/coast.js` 8e–8h, 12, 29–32,
   `tests/coast_sim.py` 7c, 16–18, `tests/corner_slow.js` 19p–19r).

   *A lead is not coverage, but it is the survey speed.* The LINES table keeps `len m` as
   coverage and adds a `lead m` column beside it — the `plan` column times the whole run,
   because `actual` is clocked over the whole run — and the survey card's **Line len**
   stays coverage. The chart draws the lead stubs thin and dashed, so the point where data
   starts counting is visible on the water. The Mission card reads **LEAD-IN** — *settling
   onto line 3 of 9 — 18 m to coverage* — and is **not** acquiring coverage, while the
   commanded speed stays the survey speed across both boundaries. Measured on a real
   7-line punch: coverage 1316 m before the lead and 1316 m after, run 1316 → 1725 m.

   **Eased turns (clothoid transitions).** Every reversal above steps its curvature from
   nothing to `1/R` the instant the boat leaves the line — an infinite rudder rate, which
   no hull can answer, so it overshoots and settles. That settling is exactly what the
   lead-in exists to hide. Setting **Turn shape → Eased** replaces the plain semicircle
   with a **clothoid – arc – clothoid**: curvature ramps linearly over a spiral, holds
   through a circular core, and ramps back, so the steering rate is constant and finite and
   the boat rolls onto the next line with the helm already amidships.

   The spiral length is a **vessel** property times the speed the turn is flown at —
   `maneuvering.steering_settle_s`, how long the steering takes to reach the commanded rate.
   A profile that doesn't declare one cannot ease, and the card says so rather than quietly
   planning plain arcs under an "Eased" label. *The shipped settle times are estimates and
   no trial has been flown*; to replace one with a real number, run up steady at the turn
   speed in slack water, command a hard turn, and read off the recorded track the time from
   the order to the moment the yaw rate stops rising.

   *It is a rung on top of the turn ladder, never a replacement.* Where the eased shape
   won't fit — it needs a little more outboard water and a slightly tighter radius — the
   plan gets exactly the turn it would have got with easing off, and the readout counts
   both. **Off by default**, so a console that has never been told otherwise plans the
   turns it always did.

   *What it costs and what it buys, measured on a live 7-line punch:* the three reversals
   that took the eased shape went from a worst per-waypoint curvature change of **0.049 to
   0.0071 per metre — about 7× gentler** — for 29 waypoints each instead of 20 (90 → 117
   over the plan). A fourth pair, where the eased shape didn't fit, is byte-for-byte the
   racetrack it was. Note the sampling matters as much as the curve: a curvature ramp
   emitted at the ordinary 3 m arc step is an arc wearing the word "eased", so the spirals
   are emitted at `Ls/8` and the core at the normal step.

   **Striking a run off by hand.** A minimum line length drops short coverage by
   *rule*; this is the same decision one line at a time, because "not worth
   surveying" is a judgement about this water and this vessel that no threshold
   makes. On a punched plan, **click a survey run to select it** — it highlights
   amber — and press **Delete** to strike it off. Escape, or a click on open water,
   deselects. The run leaves the plan and the survey is **re-punched around the
   gap**: the running order, the reversals and the inter-line transits are all
   rebuilt, so nothing downstream can tell how a run left. The card counts what has
   been struck and carries a **Put them back** button, since a struck run is not on
   the chart to click a second time. Strikes are remembered as *midpoints*, not
   indices, and they **evaporate** when the pattern or the chart changes — carrying
   one across a reshape would delete a run nobody chose.

   Two consequences worth knowing. A reversal onto a survivor two spacings away is
   **wider** than a normal one and reaches further outboard; those are counted and
   named in the readout, because whether that water is acceptable is the operator's
   call. And the rebuild is **coalesced** — strike five runs in a row and the plan
   is re-solved once, at the end. Anything that reads the plan as a result (Add to
   plan) waits for that rebuild first.
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

   - **Racetrack (direct)** — what the ladder flies when the gentle arc has been
     **refused**. Two quarter-circles at the boat's own minimum radius joined by a
     straight run across the gap. It exists because a semicircle's radius is *half the
     line spacing* and that is often far wider than the hull needs: on a Z-Boat at
     31.5 m spacing the arc is 15.75 m against a hull radius of **2.06 m**, and it has
     to bulge somewhere. It needs its full 15.75 m of clear water past the line end to
     bulge outboard, and where a wharf takes that water away the old fallback was the
     **same arc swept the other way** — back across 33 m of just-surveyed water. The
     racetrack is **32% shorter** and reaches only `minR` past the line end **at any
     spacing** (2.06 m instead of 15.75 m), so a turn that previously had to invert now
     stays outboard, away from the feature. The card names these separately, because a
     racetrack only appears where the water past those line ends is tight.

   The ladder, when a reversal is refused: outboard arc → outboard racetrack →
   racetrack at the slow-speed radius → **inboard** arc → inboard at the slow radius.
   The gentle arc is always tried first and every unobstructed turn still flies it.

   **⚠ THE TWO INBOARD RUNGS NO LONGER PRODUCE ANYTHING, AND THAT IS THE 2026-09-19 FIX.**
   They were meant to be "the same semicircle swept the other way" — turning *away* from a
   feature, back over surveyed water. They are not that shape. Reversing the sweep about a
   center that stays midway between the two lines keeps both endpoints and reverses **both
   tangents**, so what came back was the arc for the *opposite* transition: the boat was
   told to reverse ~175° at the line end, fly the arc backwards, and reverse ~175° again
   onto the next line. Nothing caught it, because every chord of it is lawful water and a
   reversal cusp in open water projects perfectly cleanly. Ten such turns shipped in saved
   plans, and an in-extremis escape fired four vertices inside one of them.

   A generated reversal must now **leave the line on its own heading and arrive on the next
   line's** before any rung is accepted. The rule has two parts: a turn may not begin by
   sending the boat back down the line it has just run (a quarter turn is the boundary —
   the worst legitimate join measures 45°, the mirrored shape 175°), and a join may not be
   tighter than the hull's own turn rate over the leg it has to turn on, judged at the
   *plan's* speed so a slowed rung cannot buy itself a join. What answers "turn away from
   the dock" is the **racetrack** rung above it, which reaches only `minR` past the line
   end. The inboard rungs are kept so the ladder still asks, and because they are the only
   specimen the suites have of a shape that joins neither line.

   Both shapes are **nogo-validated** before use. Where no rung of the ladder fits, the
   pair is flagged red instead of given a turn, and Add to plan refuses the pattern until
   it is fixed — see *A refused turn is retried, not abandoned* above for the remedies it
   offers. A shorter lead is never one of them: the ladder has already tried the pair with
   no lead. **This is the path those ten turns now take** — a real change to plans that
   used to punch clean, and one that is only safe because a refused reversal stopped
   shipping as a straight 180 the hull cannot track.

   **What is AHEAD, and taking the helm in extremis.** Every telemetry frame the console
   projects the vessel's *ground* track forward and asks what it warrants, on five rungs:

   - **clear** — nothing within the look-ahead. Show the number, command nothing.
   - **edge** — entry predicted, but a few meters of deviation clears it. Go a little wide.
   - **slow** — entry predicted, and taking the way off would avoid it. Buy time — at the
     slowest speed that still *makes way* against the set (since 2026-09-26: LOW below the
     set is a stall, not a slow-down; the live check stood 24 minutes at waypoint 0 on it).
   - **hold** — the same, but close enough that slowing alone is no longer enough.
   - **helm** — entry predicted, **and** stopping would not answer it. The console steers.

   And one state that is **not** a rung:

   - **blind** — the vessel reports no course over the ground, so nothing can be projected at
     all. Until 2026-09-19 this read **clear**: `groundVel(null, sog)` returns null, the guard
     substituted a clear verdict, the bar keys on `clear` and went out, and the console showed
     the operator the same nothing it shows in genuinely clear water — at the one moment it
     could not see. A *stopped* vessel reports exactly that, so this was the state a boat
     lying alongside a pier was in. Worse, those frames counted toward the four-second dwell
     that hands the throttle back, so a boat the guard had slowed and which then lost her
     course got her speed returned on the strength of frames that had measured nothing. The
     bar now reads **GUARD BLIND**, carries the clearance it can still state (a distance from
     a model needs no course), and offers no buttons — there is no rung to proceed past.

   The rung that matters is the last two, and what separates them is a **second projection
   made with the engines notionally stopped**. If the boat would drift clear, stopping
   answers the situation and the console has no business steering. If it would not,
   stopping is the one thing that *certainly* fails — because the water is doing the
   carrying. That isn't a theory: a hull lying stopped in a 2 kn stream makes 2.00 kn over
   the ground with no force on it at all, so "take the way off" hands a boat being set onto
   a pier to the tide with no steerage. That is why the console, which for every other
   purpose only ever commands a **speed**, is permitted the helm at this one rung — and why
   it is not permitted it anywhere else.

   **What the look-ahead walks, and from where (2026-10-06).** On a plan the projection
   does not fly a straight line: it walks the boat down the route the vessel is steering,
   from the waypoint the vessel reports it is steering toward, swinging the bow at the
   hull's turn rate and advancing waypoints by the vessel's own two tests (inside the
   approach radius, or past it along the leg). Three things about that index had to be
   learned on the water. Every 4 Hz state frame carries it and the vessel advances it once
   a tick, so a frame can still name a waypoint she is at, or up to 1.8 m past at 14 kn;
   the walk used to ask the two tests only *after* its first step, from her own position,
   so a waypoint 0.6 m astern read as not yet reached, the bow was swung back toward it,
   and the model boat flew a loop astern — into a charted rock's 50 m disc 30 m abeam, on
   a Go-To whose route passed that rock 26 m off: a HOLD at 13.6 kn (and a 4 s slow-down
   on the Return-to-Home at a bend 2.3 km away, off another charted rock). Now the first
   target is judged by the same two tests before the first step, measured from where the
   leg began, which the page hands over with the route: the waypoint she was steered
   *from*, or, exactly as the vessel measures it, her own position at a start and at every
   amendment — after a Pause/Resume the backtrack point lies astern, between the waypoint
   before and her, and measured from that waypoint it read as already passed, so the walk
   ran up the line while she turned to run down it. And a plan's index belongs to its
   plan: when a new Go-To, Return-to-Home, transit or re-approach is taken by the vessel,
   its reply frame carries the new plan's index before the page has swapped the drawn
   route, and the console once sliced the old 106-point route at the new plan's index 0 —
   a waypoint 80 m astern — and held her 80 ms after the vessel had taken the new plan,
   which the hold then replaced. So no route is projected while one of those commands is
   in flight, nor for a frame whose plan is not the length of the route the page holds;
   the straight projection stands in, as for any boat not on a plan. For the lengths to
   agree the page and the vessel must splice an amendment at the same waypoint, and the
   vessel's reply now says how long the plan aboard is, so the page splices where the
   vessel did even when she advanced a waypoint while the amendment was on its way.

   **⚠ "Would not answer it" is a test about danger, and until 2026-09-19 it was a test
   about reach.** The top rung fired on the mere *existence* of a drift-only entry anywhere
   inside the 45 s look-ahead, with no margin and no dwell — so its trigger distance was
   exactly `buffer + 45 s × set`: **15.7 m at a 0.46 kn set and 45.5 m at 1.75 kn** on a 5 m
   buffer, which are the sets in the recorded sessions, against a planner that clips plans to
   the buffer to within centimetres. Measured on the old rung, a drift track passing
   **5.001 m** off read *clear* and one passing **4.999 m** off read *in extremis* — 2 mm,
   skipping every rung in between. It now asks two more questions, each anchored to something
   already established rather than to a new dial:

   - **soon enough** — the drift must reach it inside the same decision margin the hold rung
     has always used (20 s). If stopping buys more than that there is a hold's worth of time
     to decide in, and the hold rung is the right answer.
   - **deep enough** — the drift must reach within **half the operator's own buffer** of the
     feature, not merely graze the outside of their standoff.

   **And since the guard owns those two numbers, the planner now reads them.** The planner
   used to clip a survey to the operator's buffer and nothing else — measured on a real
   plan, to within **three centimetres** (a 5.03 m minimum waypoint clearance against a 5 m
   buffer, with nothing inside it). The guard then judged the boat against a band reaching
   further, so **96% of that plan's waypoints sat inside the band the guard alarms in**. A
   plan could be legal by construction and still be one the console would take the helm on.

   The obvious explanation — that the boat's own tracking eats the margin — is wrong, and
   was measured to be wrong. Across **19,128 running frames in 18 upload windows** (each cut
   at every escape, hold, RTH and Go-To, because each of those *replaces* the route), the
   boat is **0.03 m from its commanded line at the median and 0.30 m at p95**. It holds the
   line. What the planner never asked about is the **set**: a line 5 m off a pier is legal
   however hard the water is setting onto it.

   So the coverage clip now happens at the standoff the guard requires for the set actually
   running — `max(buffer, buffer/2 + 20 s × set)`, which is 8.5 m at a 0.58 kn set and
   20.5 m at 1.75 kn on a 5 m buffer. It is **derived from the guard's own constants, not
   written down a second time**: two numbers meant to agree, kept in two files, is the seam
   itself. With no weather reading the set is zero and the clip is the plain buffer, so a
   console that has never seen one plans exactly as it always did.

   **It costs coverage, so the card says so** — the standoff used, the buffer it replaced
   and the set that caused it. A thin survey with no explanation reads as a chart problem.
   It applies to **the coverage lines, the leads and the turns** — the turns since
   2026-09-26, when the 09:38 New Castle record showed the promise *"not on a line"* kept
   and the boat escaped from the turn at the end of it. Measured against the real extract,
   26 of 56 line ends and 91 of 207 turn legs of that plan sat inside the 19.5 m the guard
   demanded once the 1.75 kn set was running, and a fly-through of the uploaded route at
   that set read helm 115 times in the turns against 28 on the lines. The reversal ladder,
   the lead give and the trim rung now judge at the standoff, so a shoreward reversal that
   would loop into the guard's band is trimmed back until it flies clear. Transits still go
   where the router sends them at the plain buffer, and the guard covers them. A plan built
   this way cannot have the helm rung fire on a line, a lead or a turn in that set; it can
   still fire on a transit, or if the set rises afterwards.

   **And the set the planner reads is the set she will see.** The simulated leeway used to
   be published only while the boat was deployed, so a console planning at the berth read
   *0.00 kn* — a positive claim of slack water — clipped every survey at the bare buffer,
   and met a 19.5 m standoff the moment she started. The set is now reported whenever it
   is blowing and applied (yaw, motion, position) only while deployed: an idle boat reports
   the leeway it would suffer and does not wander on it.

   **And a boat with no way on is judged in the same window.** A boat station-keeping at
   the end of a run, engines stopped, being set down onto a pier, has a drift track that
   *is* its ground track, so "take the way off" is no answer for her. She used to go to the
   helm on *reach* alone — the drift entering anywhere inside the 45 s look-ahead — which
   made the escape's own stopping rule (a whole horizon of water) the boundary of the rung
   that judged her afterwards: on 2026-09-26 she was escaped, held by drifting 2 m and
   driving back, and escaped again 18 s later from the point the console had just chosen.
   She is now in extremis exactly when a moving boat would be — the drift within half the
   buffer inside 20 s — and reads *hold* further out than that, which is what she is doing;
   the sitting point is 25 s of drift inside that rung rather than on its edge.

   **And a slow-down has to make way.** The live check of all this found the last piece: on
   the approach the SLOW rung read *"a keep-out ahead in 43 s"* and commanded LOW, and the
   Z-Boat's LOW is 1.5 kn in a 1.75 kn set — she was set backward at 0.39 kn over the ground
   with a 125° crab, 24 minutes at waypoint 0. The 09:38 record has the same thing seven times
   over: every PROCEED on that approach was pressed with the SOG reading 0.25 kn. Taking the
   way off *below* the set is surrendering the track, so the slow rung, the hold rung's
   slow-in-lieu and every resume now take the **slowest speed that still exceeds the set** by
   half a knot (survey here), say why, and say when there is nothing slower to take off.

   **And a transit tries the standoff first.** The second live run escaped from the
   *approach*: a detour routed at the bare 3 m buffer ran 9.9 m off Fort Point in the same
   set, and that is the helm rung's band. The approach, a Go-To, RTH, the transit line and
   the punch's own hops are now routed at the guard's standoff where the water allows it and
   at the buffer only where it does not — counted and said on the card and in the banner
   ("N transit leg(s) run inside the 19.5 m transit standoff — expect the guard to slow or
   hold her there"), so a hug is a stated decision rather than a surprise. **And since
   6 October 2026 a transit's standoff is also the water she needs to turn away at the
   speed she will be flown** — his call after two holds at Little Bay ("if the ASV is near
   a danger, it should open the distance from said danger by workable distances within
   constraints toward deeper water"; of the numbers offered, "use the turn radius at the
   plan speed"): the guard's standoff or the hull's turn radius at the transit role's speed,
   whichever is larger (`transitStandoffM` in `static/js/guard.js`, read by the page and
   never re-derived). On the DriX at 20°/s that is 5.9 m at 4 kn, 10.3 m at 7 and 20.6 m at
   14 — where a transit in calm water used to be laid at the bare 5 m buffer, passing a
   charted rock's 50 m disc 5.9 m off at 13.7 kn in a river 400 m wide. It applies to a
   Go-To, a Return-to-Home, a drawn transit and the Upload's transit legs; the coverage
   lines keep the guard's standoff (coverage is the operator's, and a line's turns are built
   on the radius already), and so do the re-approach onto station and the way round a
   contact. Where the water will not allow it the leg is found at the buffer and said, as
   before. The legs between a
   plan's own waypoints keep the buffer: they are the punch's geometry, already built at the
   standoff where it matters. **And the standoff survives the finishing pass** (2026-09-28): the
   Go-To / RTH / resume router searched at the standoff and then ran the Rule 9 lane, the
   smoothing, the gate and the knot prune at the bare buffer, so every corner they cut was cut
   back to 3 m — round a hull-sized block in a 1.75 kn set, the search's 20 to 23 m came out at
   6 to 14 m. Its result is re-gated at the margin the leg was found at (`keepStandoff` in
   `static/js/passage.js`); the lane stands wherever it is clear of that. The Upload router
   (`routePlan`) had the same pass for its transit legs, and since 28 September its result is
   re-gated the same way. A leg found only at the buffer, where no line keeps the standoff,
   keeps its Rule 9 lane as in calm water. **The trade this makes, deliberately:** in a buoyed
   channel between two and four standoffs wide (39 to 78 m in a 1.75 kn set), a transit runs
   the centerline rather than the keep-right lane, because the lane a quarter of the width in
   would pass inside the guard's standoff from the starboard bank and the centerline keeps it;
   the lane note reads PARTIAL (`planner_guard_seam` 7g, 7h).

   **And the floor is under every command.** The third live run cleared the approach and then
   stood at the first line's end: the TURN role's speed is LOW, a turn at 1.5 kn in a 1.75 kn
   set does not turn, and the governor flapped low / survey once a second while the role
   classifier flapped turn / line. So `commandSpeed` floors whatever it is asked — the
   governor's turn speed, the corner slow, every resume — at the slowest speed that makes
   way, says so once per asked key, and the punch builds its turns at the speed they will
   actually be flown so the radius it draws is the radius she flies. Calm water is untouched.

   **And the banner says what was measured.** It used to read *"IN EXTREMIS — being set onto
   a dock / pier"*, which the console had never established: it measures that the drift-only
   projection reaches the feature, never how much of the set is closing it. A set 98.9%
   *parallel* to a pier, closing it at 0.02 kn, produced exactly that sentence. It now quotes
   the projection — and calls it the drift rather than a current, because `current.ok` was
   false at every port in the record and what moves the boat there is the wind and wave
   forcing.

   **The guard is cheap enough to run at 4 Hz on a real harbor chart (2026-09-26).** The
   console froze on the water three sessions running: 2 to 6 s stalls whenever the guard read
   *slow* or *hold*, then 123 s solid. Measured on the New Castle chart at the boat's recorded
   position, one deviation search cost 4.6 s — some 5,000 sample points, each walked through
   every edge of land and shallow-water rings 5,000 to 9,000 vertices long — it answered
   "no deviation", and the page asked it again on the very next frame, because only a
   deviation that was *commanded* had ever been put on the 2 s clock. Two changes: the
   keep-out model indexes any ring or shoreline of 256 vertices or more by horizontal band on
   first use, so a point test touches only the edges near it (identical answers, proved side by
   side over 24,500 asks in `tests/keepout_index.js`; that search is now 0.1 s), and the search
   itself runs at most once per `EDGE_REASSESS_MS`, found or not. A slower machine made the
   stalls longer, but the work was the page's own.

   **The ladder is asymmetric: fast to protect, slow to release.** It slows on the frame it
   sees the trouble; it hands the throttle back only once the water has read clear for four
   seconds. One frame's opinion used to be enough, and on 2026-09-10 that put **36 speed
   commands into 35 seconds** — low, survey, low, survey, about once a second — before the
   survey was stopped. The release counterfactual is the *correctness* test ("would the speed
   I am about to restore trigger it again?"); the dwell is the *settling* test, and they
   answer different questions. The dwell restarts every time the water goes bad, so an
   alternating reading never releases at all.

   **And since 2026-09-19 the top rung is damped too — the only one that never was.** It
   alarms on the frame it reads and takes the helm a beat later (1.5 s, about two telemetry
   frames), so one frame's opinion cannot steer the boat. The dwell is on the *action*, never
   on the alarm: the operator is told the moment the console knows, because they may be able
   to answer it themselves. It restarts whenever a frame reads anything else, so two bad
   frames either side of good water do not add up to an escape.

   **And before it stops the boat it asks whether going slower would do.** A deviation cannot
   answer a turn — the console may move a corner, and a reversal is a run of vertices a metre
   apart — but a turn's trouble is *tracking*, and the lever on tracking is speed. Measured on
   a real plan, from the point the guard stopped a survey: at 3.0 kn the projected track
   entered in 14 s; at 1.5 kn it was clear through the whole look-ahead. So the hold rung
   re-asks the question at the low speed first and slows instead of stopping when that
   answers it — a hold destroys the run and hands a stopped hull to the tide, and it has to
   keep answering: if the slow-down is not taken within 2 s (the vessel's `speed_key`, or its
   speed over ground where no key is reported), or stops answering from where the boat now is,
   the hold fires after all.
   It is not offered when the boat is already slow (that answer has been tried) or when the
   drift-only track enters too (that is the helm's case).

   **On a hull that slows in gear the guard asks it as she flies it** (2026-10-03, Andy: "fix the
   guard's model of slowing down"). The DriX takes the console's 1 s command delay, a 3.3 s dead
   time and ~12 s of decay to come from 7 kn to LOW, and the guard took all of it as instant: the
   slow-instead-of-hold walked her at LOW from the moment it decided (at 7 kn it accepted a
   slow-down 41 m from the buffer edge where she needs ~54 m, so in between the hold fired ~7 m
   late), and both slow rungs judged "already slow" by the speed she had been TOLD - which the
   governor's lead puts on the wire ~15 s before she is there. Now the check and its every-frame
   re-check walk her down from the speed she is doing, through the delay and the dead time still to
   run, in gear (`slowProfile`); "already slow" is her speed through the water. A cut counts as
   running - so she is offered the slow-down while she comes down, the slow-instead-of-hold is
   still asked after the SLOW rung has sent LOW, and the time it has run comes off the delay - only
   on evidence (`cutAge`): the console's own last command is that speed, the vessel reports it, and
   her speed through the water is on the curve from the speed she had when it was sent. A LOW sent
   long ago that she has not come down on, or a faster command still on its way (which the SLOW
   rung now replaces), is no cut. And the AIS reach counts the console's command delay, ramped in
   over the last half knot so it stays continuous at LOW (the DriX's ~90 / 96 / 131 m at 6.2 / 7 /
   14 kn). A hull with no measured slow-down is exactly as it was (`tests/coast.js` 26-28b,
   `tests/ais_keepout.js` 11b3, `tests/ais_avoid.js` 24c, 24e2, 24f-24k).

   The escape is its own behavior, never a Go-To — a Go-To's arrival used to re-chain the
   end-of-plan return straight back toward the hazard — and you can see it on the card, stop
   it, or override it from the RC transmitter, which remains the true failsafe throughout. It
   is scored *with the set in it*: a heading that is clear through the water and downstream
   into the pier is not a way out. Among the headings that are clear, it takes the one that
   keeps the **most water between the boat and trouble** along the whole track, not the one
   that makes the most ground: with the set running along a face, the fastest heading over
   the ground runs along the face.

   **It works from inside the buffer too**, which is where it is most likely to be needed.
   From there a heading is a way out when its track never touches the feature, gets out of
   the buffer within the look-ahead, and then stays out for a whole look-ahead — however
   slowly it gets out, because deep in a wide buffer in a strong set, straight out is a slow
   crawl and still the way out. The escape ends a whole look-ahead past the buffer's edge, not
   a few meters outside it. And if **no** heading qualifies, the console **refuses** and says
   TAKE MANUAL CONTROL, naming which refusal it was (every heading enters a keep-out, or none
   gets out of the buffer), rather than offering a confident-looking direction that still
   ends at the pier.

   **The guard's own bar, and the two ways past it.** (Since 2026-09-28 the bar is the top of
   the ALERTS card, in the controls window by default — see the two-window split above.) While the guard is intervening, the
   rung, the reason, the clearance and the operator's way through it all sit in one box on
   the chart — a sentence that scrolls past, with the control it refers to somewhere else on
   the page, is how a survey ends up power-cycled. It offers two answers, and only at the
   two rungs that actually impede the boat:

   - **CONTINUE AT LOW SPEED** — keep surveying, slowly. The console stops *stopping* the
     boat for this situation and holds it at the low speed until you press **RELEASE LOW**
     on the bar (or change a speed selector).
   - **PROCEED — I have assessed it** — the same, at the speed the run's role calls for.

   Neither one switches the guard off. Both keep the alarm, the clearance readout, the
   deviations where there is water, and the helm in extremis; both are recorded in the
   session log as an operator override; and both **stand for the whole approach to that
   hazard** (2026-09-28) and end four ways: it goes in extremis (*"keep going"* was never an
   answer to *"the water is carrying you in"*); a *different* hazard is ahead, said with both
   named; the guard *releases* her — the water reads clear at the speed the plan would restore,
   and has for four seconds, so the hazard is behind her; or a hazard that is *closing on her* — a
   contact under way — is more than 5 m nearer than the range you assessed. A hazard that stays
   put is passed, not closed on; and a press made against clear water that meets no hazard within
   45 s was about nothing, and is dropped rather than kept for whatever comes next. **The treadmill this replaced**, from
   Andy's 28 September log: 58 presses in fifty minutes against one vessel parked on his
   line. The override used to be spent by a single clear frame, and the ladder chatters
   between SLOW and CLEAR around the horizon (slowing pushes the entry beyond 45 s, so it
   reads clear and restores the speed, and the entry comes back inside), so 21 of 35 PROCEEDs
   landed on a clear frame and were thrown away the frame after; the rest lapsed on the 5 m
   give every 6 m down the line, because a parked hazard on the track shrinks the clearance
   by exactly the distance run. The chatter itself had a second cause: the release's
   counterfactual (would the speed we restore put the hazard back inside the horizon?) was
   gated on the *guard* having slowed her, and every press hands the throttle back by
   clearing exactly that flag — so after a press the release fired without it. It is asked
   now whoever holds the throttle. **And the low speed has a home on the bar**: whenever a run
   is held at low on your word (CONTINUE AT LOW, RESUME AT LOW, a pause resume) the bar
   carries **RELEASE LOW — BACK TO THE PLAN'S SPEED**, on its own as *LOW — OPERATOR'S
   AUTHORITY* when the ladder reads clear; it ends a CONTINUE AT LOW override with the latch
   (the hold rung is not left suppressed at the plan's speed on a decision taken about the
   low one); CANCEL OVERRIDE releases it too; and the release note says "still at LOW on
   your authority" instead of promising a speed the latch will not give. Before this the only release was a speed selector in another panel, which fires only
   when its value actually changes.

   **If the guard has already stopped the survey, the bar hands it back.** A `hold` uploads
   a one-waypoint plan over the running plan, so the moment it lands the vessel's plan *is*
   the hold point and the unflown remainder exists nowhere but the console — which is why
   the console keeps it, in the frame before the hold command goes out. And because the
   `hold` rung is only ever reached when the drift-only track is *clear*, a station-keeping
   boat reads clear, so the box that named the hazard used to go out within a frame of the
   survey being stopped and nothing on screen said the run was over. It now stays up as
   **SURVEY HELD — LOITERING**, naming what the boat was stopped off and how many waypoints
   are unflown, with **RESUME SURVEY AT LOW SPEED** and **LEAVE IT HOLDING** (which asks
   first, because the remainder really is gone after it).

   Resuming re-uploads the remainder and starts it, **pausing first** — an upload clears the
   holding state and adopts the *transit* role's speed while the run is still live, so an
   upload sent to a station-keeping boat releases it at the fastest speed on the card before
   the Start that was meant to release it is ever sent. Measured in the simulator: 3.0 kn
   station-keeping → **8.2 kn within four seconds** of the upload, still climbing toward the
   14 kn transit setting, with no Start command sent. Paused first, the same exchange holds
   her at 0.08 kn until the Start. Everything after that is the pause resume: twelve boat
   lengths back down the line, the way back checked against the chart (and *"no chart"* is
   not *"clear"*), the backtrack — never the resume — given up when that water is foul, and
   low speed until you press RELEASE LOW on the bar.

   **The banner NAMES what refused each one** — blocked by a keep-out, more than 15° off
   a true reversal, line ends too close together, or a fold an obstacle forced on a
   detour — because a loop exists at *any* spacing, so a shortfall of turning radius is
   never the reason. `Widen the spacing` is offered only when the spacing is actually
   below what a semicircle needs; above that there is nothing to widen towards.

   **The "not a reversal pair" cap comes from the line spacing, not from the hull**
   (`max(60 m, spacing × 1.6)`, the same factor the reversal gate uses). It was a bare
   60 m until 2026-08-20, which silently threw away *every* generated turn above 122 m
   of line spacing — ordinary deep-water spacing for a larger vessel — while the banner
   blamed a keep-out for it.

   **What counts as a channel is the chart's, first (2026-09-30).** The survey's channel
   rules read one list: the charted **dredged areas and fairways**, plus a corridor swept
   from each port / starboard buoy pair for water the chart charts no channel in (an
   inlet mouth, typically). A buoy pair that brackets a charted channel sweeps **no**
   corridor, and a corridor stops where it would meet charted channel water. It used to
   sweep every pair two gate widths along, however wide: at the Northward Channel
   (Portsmouth) buoys 244 m apart either side of a charted strip about 20 m wide made a
   corridor holding the strip and both banks, so a survey drawn across the channel there
   read as *inside* a channel and was never cut. The Rule 9 lane reads the same list; the
   transits checked through both harbors route identically before and after (the lane
   engaged on the Lewes routes, and on none of the Portsmouth paths tried).

   **And a buoy pair is two marks of ONE channel (2026-10-01).** A mark used to be paired
   with the nearest mark of the other hand whatever channel that one marked. At Portsmouth
   four of seven pairs crossed channels: three paired Sagamore Creek with the Northward
   Channel where they meet, and one paired Goat Island Ledge with Henderson Point. That
   last one kept a 612 x 678 m corridor over water no channel runs through, so a survey
   drawn across it there was cut. Now a mark pairs only within its own channel, by its
   charted name, with a channel's entrance buoys counted as part of it (the same rule the
   Rule 9 lane groups buoys by). Unnamed marks pair only with each other. Lewes and
   Bellingham pair exactly as before, and the lane routes there are identical.

   **Turn water.** The keep-out set the turns answer to is *stricter* than the one
   transits use: channel polygons (the charted ones, plus buoy-pair corridors where the
   chart charts none) that none of the clipped survey lines occupy are keep-outs for the
   reversal turns, the reversal straight-hop check and the serpentine ordering — a
   loop may not swing into a navigation channel the survey does not enter, even
   though the channel is deep, is not an enforced keep-out, and a charted pile row
   (individual point features) cannot block a loop that threads between the points.
   A survey drawn *inside* a channel keeps each fragment its lines reach, and routed
   region-hop transits may still cross the channel as ordinary navigation. Refusals
   name the channel in the banner, outline it as a violation, and quote the standoff
   the turns need (`tests/turn_channel.js`).

   **A turn is verified as a TRACK, not as a drawing** (2026-09-10). Every candidate shape
   on the ladder is projected exactly as the runtime clearance guard will project it — same
   integrator, same turn rate, same approach radius, same keep-out model — and a shape the
   hull would fly *through* a keep-out is refused even when the drawn polyline is clear. The
   two used to answer different questions about the same turn, and where they disagreed the
   boat got a plan it was then stopped for flying.

   That also puts a floor under the **waypoint spacing**: no two turn waypoints closer than
   the approach radius. Both the vessel and the guard advance to the next waypoint the moment
   they are within the approach radius of it, so a cluster of vertices 0.20 m apart is
   consumed in one step and the boat is left steering at a point half way round the loop —
   it flies a chord across the inside of its own turn. Measured on a real plan: the same
   reversal, drawn 3.75 m off a keep-out either way, put the *flown* track **1.42 m** from
   the feature at 0.20 m spacing and **4.01 m** at 1 m spacing. Sampling a curve finer than
   the thing that follows it makes the boat fly it worse, not better. An eased turn whose
   settle length cannot ramp across that spacing is not offered at all; the plain arc takes
   the turn, exactly as it would have before easing existed.

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
   now* (it refetches every 6 min and on a large move). The keep-out model that every behavior and the
   clearance guard read is rebuilt from the same features once the level moves
   `TIDE_REBUILD_M` (0.1 m) from the level it was built at (`applyWaterOffset`), so a
   falling tide brings drying water and charted rocks back into it mid-run. Only stations sharing the
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

   **Pattern or Bounded** (Andy, 2026-10-16: "For some surveys the boundary box is critical and
   should have a draw mode or an input mode for pre-drawn surveys. Otherwise, allow the unbounded
   survey pattern 3 point draw functionality"). The Survey tab's **Survey** switch chooses.
   **Pattern** (the default for a new plan) is the three-click survey above. No area applies and
   the Area row is hidden; an area already drawn is kept for Bounded but neither drawn nor used.
   **Bounded** fills an area with the lines: draw it on the chart, or **Import** one drawn
   elsewhere. With no area yet, the card's Draw (and choosing the tab) arms the chart for the area.
   Once it is closed, Draw moves A, B and C, which then set only the lines' start, spacing and
   direction. The switch is saved with the plan (`survey_bounded`); a plan saved before it loads
   Bounded only when its area was closed, which is when an area applied then. A survey brought back
   with its edit (✎) brings its own switch back: Bounded if it was drawn in an area, Pattern if not.

   **Import a survey area** (Bounded): a **GeoJSON** (`.geojson`, `.json`), **KML** (`.kml`) or
   **CSV** (`.csv`, `.txt`) file, read by `static/js/boundary_file.js`. GeoJSON and KML give their
   first Polygon's outer ring (a closed line counts as an area). A CSV has one corner a line,
   latitude then longitude, or a header naming the columns (lat/latitude/y, lon/long/lng/longitude/x).
   With no header, a first column past 90 can only be longitude and is read so, and said. What it
   does not use is said in the banner: the other areas in the file, an area's holes, a column order
   it swapped. The banner also gives the corners, the area in km² and where its middle is from her,
   and the chart is taken to it. A file it cannot read changes nothing and says why. Refused files:
   a KMZ (unzip it), a projected file (not degrees), a line that does not close, under 3 or over 2,000
   corners, corners on one line, and anything over 5 MB. In the controls window the picker opens
   there; the file is read there and its text sent to the chart, which imports it.

   **Arbitrary survey-area boundary.** The Survey tab's **Area** row (Bounded) draws a **CAMP-style
   survey-area polygon** — press its **Draw**, click the chart to drop points, click the first point to close
   (vertices are draggable). The survey lines are clipped exactly to that polygon,
   including concave shapes (legs crossing a notch split into two). **With a boundary
   closed, the lines are laid across the boundary itself** (2026-10-11), at the pattern's
   bearing and spacing, so it stays full of lines end to end through any change of
   Direction or Spacing. They used to be the A-B box's lines clipped to it, and a new
   bearing reshaped the box: turned, it stopped reaching the boundary's corners and the
   outer lines vanished. A, B and C still set the bearing and spacing, the start side
   (A's) and the alignment of the leftover margin; Line len, Width and the line count
   are then the boundary's. Next to an edge the lines are not parallel to, the strip
   between the edge and the nearest line can be up to one spacing wide (true of any
   parallel lines); inside, every point is within half a spacing of a line. It **composes
   with Punch Out**: the boundary keeps lines *inside* the area, ENC features keep
   them *out* of hazards / shallow water. The boundary **persists** (saved in
   `mission.json`, so it survives a reload / a session at sea), and the Area row's
   **Show** shows / hides the boundary overlay — hidden, it still clips the lines;
   drawing the area always shows it.

   **ENC nogo — every behaviour avoids it.** On the first GPS fix the console
   extracts the ENC for the operating area and builds a persistent **nogo model**:
   shoreline + manmade structures (piers, docks, dolphins, breakwaters, locks…) +
   water shallower than **1 m corrected** (charted depth + live water level). `NOGO`
   toggles the red overlay, and while it shows, a **NOGO KEY** at the bottom left of the
   chart names each of its symbols (2026-10-18): the keep-out and its edge, speed-limited water
   and a charted zone that does not bind this hull, the survey's depth window, water no chart
   covers or could not be read, the seabed's gaps, and what was read off the chart's picture -
   drawn in the overlay's own colors, the depth floor in force in its first line. **Since
   2026-10-19 the console's two rules are hatched, not washed** (Andy: the key "reveals user
   interpretation limits with the current color pattern versus the ENC"): a keep-out is a faint
   red wash under near-opaque red lines at 45 degrees, and speed-limited water - a state's shore
   band or a charted zone - the same in amber at 135 degrees, so the two read as two textures
   before they read as two colors, a keep-out inside a speed band shows as a cross-hatch, and
   either stays legible over any fill of the chart's own (land's tan, a dock's orange, the white
   of the water) where a second wash only muddied the first. The survey window, a planning aid
   and not a rule, is a teal wash (it shared the rules' amber). Why hatching: a thematic overlay
   reads best in a visual variable the base map does not use (Bertin, *Semiology of Graphics*);
   orientation and hue are separable pre-attentive features, so the two rules stay apart for an
   operator who cannot tell red from amber (Treisman and Gelade; Ware, *Information
   Visualization: Perception for Design*); fine lines need luminance contrast to be seen at all,
   so the lines are near-opaque over a faint wash (Ware); and the ENC presentation standard
   itself (IHO S-52) draws a regulated area as a hatched, bounded region, the symbol a mariner
   already reads as "an area with a rule". Checked in simulation: the hatch survives
   deuteranopia, protanopia and a luminance-only rendering. Drag it anywhere by its title, resize it by its corner (both kept, like
   every chart card), and fold it with its ▾ button. *Every* commanded motion routes clear of it — Go-To and
   RTH route around it (or refuse an unreachable target), search and survey legs clip
   to clear water, and the transit **to** a survey (boat → first waypoint) plus every
   inter-line transit is routed around obstacles at **Upload** (the ENC-clear path is
   drawn green from the boat, shrinking as it goes). Where no chart covers the water at
   any scale the console warns and routes direct — verify the plan. Where a chart
   exists but NOAA did not serve it (2026-10-18, after a Go-To at the Canaveral lock
   ran over land), nothing is routed, not even straight: the command is refused saying
   so, and the chart is read again every 30 s; the earlier read's zones stand for their
   own water, the NOGO row saying beside them that the chart over her could not be read.

   **Locks (2026-10-18).** A lock's gates are keep-outs like any structure, so no route
   runs through a lock by itself. When a Go-To is refused and a lock lies between the
   boat and the point (two lock gates facing across a chamber, found on the chart; not
   for a refusal about depth, nor for a way that merely passes beside the lock), the
   alerts card offers **TRANSIT THE LOCK** (**NO** declines it). Taken: the way on from
   beyond the far gate is planned first (a lock she could not be taken out of is not one
   to take her into); she goes to hold 60 m short of the near gate; **GATE OPEN - GO IN**
   takes her slowly along the chamber's axis to hold in the chamber, the NEAR gate alone
   taken out of the keep-out model for this - the guard's and the planner's alike; the
   closed far gate stays a wall; **FAR GATE OPEN - GO ON** takes the far gate out and the
   near one back, and sends her out slowly along the axis and on to the point; once she
   is past the far gate the gates are keep-outs again and the speed is released. Nothing
   passes a gate but on your word, and the transit's own points are taken exactly or not
   at all: a hold point the planner would move is a refusal, never a run through a waived
   gate. The transit owns no run but its own leg: Stop, Pause, Hold, E-STOP, a Go-To, an
   RTH, an Upload or a passage ends it, the gates coming back unless she is inside the
   lock, and the end-of-plan RTH chain and a passage's rejoin stand down while it holds
   her. **CANCEL TRANSIT** ends a taken transit at any stage (on her way at a gate, she is
   held first); inside the lock the gates stay out of the model until she is out of it.
   The console does not talk to the lock: calling it is yours. A reload ends a transit
   (the gates come back, and the guard holds her if one is ahead), and a boat found INSIDE
   a lock is offered GO ON from where she is. Seen live on a scratch console at Canaveral,
   with NOAA serving that chart only in part all evening (17 reads, never whole): a Go-To
   through the lock was refused, "the target lies in water whose chart could not be
   read", where the evening's had gone over land, and the lock was found as charted - two
   lock gates 200 m apart, 27.4 m wide. A whole transit has not yet been run live: it
   needs that chart served whole; tests/lock_transit.js drives every stage through the
   page's own code. The 2026-10-18 review found three defects in the first build and
   repaired them the same day (done declared inside the chamber; nothing ending a transit
   another command replaced; a moved hold point run to through a waived gate):
   docs/review-2026-10-18.md.

   **Speed zones: the law's limit holds her speed** (Andy, 2026-10-16: "Build a bounded area that
   overrides commanded speed and lowers to legal speed. this releases once the ASV is clear of the
   area and it returns to commanded speed"). A speed zone is water where a rule sets her speed. The
   console reads them from two places:
   - **The chart's own.** A restricted area whose text gives a speed, for example the right whale
     Seasonal Management Areas (10 kn, binding only vessels 65 ft / 19.8 m and over, so not these
     hulls) or "5 knot speed limit". A regulated area the chart names only by its citation is read
     from the regulation: **33 CFR 165.101, Kittery, Maine**, by the Naval Shipyard beside New
     Castle, is 5 mph (4.3 kn). NOAA's chart has a no-wake category but uses it nowhere in the US.
   - **The states' GIS**, merged into the chart the console serves (`speed_zones.py`, cached under
     `charts/speed/` for a week): Florida FWC boating restricted areas and manatee zones, North
     Carolina WRC no-wake zones, Maryland DNR speed zones and DC no-wake zones. A seasonal or
     conditional rule is applied at all times, the most restrictive of its regimes, with its
     condition kept in the zone's text. A record that is not a speed rule (no entry, no anchoring) is
     skipped and counted. **New Hampshire, Maine and Massachusetts publish none**: their rules are
     distances, and all three are modeled from the chart's own features (next).
   - **New Hampshire's, Maine's and Massachusetts' rules** (Andy, 2026-10-16: "model the NH and ME
     shore distance rules", then "model the MA shore distance rules").
     **New Hampshire** (RSA 270-D:2 VI): headway speed within **150 ft** (45.7 m)
     of shore and docks, except in the federal channel of the Piscataqua between buoys R2 (Wood
     Island) and R12 (opposite Sprague Terminal). The channel is the chart's "Piscataqua River
     Channel" fairway and its reaches dredged to 8 m or deeper, not the shallow side channels. Also
     headway passing under every bridge (RSA 270-D:2 I). **Maine** (12 MRSA 13068-A(13)): headway
     within **200 ft** (61 m) of any shoreline, mainland or island. A dock is not shoreline there.
     **Massachusetts** (323 CMR 2.07(3), headway capped at 6 mph by 2.02): headway within **150 ft**
     of a marina, boat launching facility or float, and **in every channel**, and under bridges.
     On the chart, marinas are its harbor facilities ("yacht harbor", or no category given) and
     small-craft facilities. Launches are shoreline constructions of category "ramp" or
     "slipway", and floats are floating docks. Channels are the fairways and dredged areas, except
     those named as anchorages. The law lets a channel post a higher speed, but the chart can't
     say which channels do, so every one is held to headway (his choice when asked).
     The shore is the chart's land, islets and coastline (and in New Hampshire its docks, piers and
     wharves). Which state's water she is in comes from the US Census state boundaries, served
     with the chart (`speed_zones.py`, cached a month), each state asked only where its rough box
     reaches the chart. New Hampshire and Maine meet down the middle of the Piscataqua. Where a
     state's line could not be read, that state's rules apply in its box, wherever no line that
     was read says the water is another's; water that could be either of two states gets both
     states' rules. Not modeled, because the chart does not say where they are: rafts, swimmers,
     swimming areas, mooring fields and other vessels in New Hampshire; marinas and approved
     anchorages in Maine; rafts, swimmers, shorelines used for swimming, bends and blind turns in
     Massachusetts. On the chart each shore or facility band is hatched amber (a faint wash under
     amber lines at 135 degrees - the speed rules' own texture since 2026-10-19, the keep-outs'
     red runs the other way) in its state's own water, with a solid amber line at the rule's
     distance; the exempt channel is left clear. Massachusetts' channels and bridges are drawn
     as amber dashed areas, hatched the same. The ramp and marina
     categories are new to the chart reader, so a chart area cached before today gets them when
     it is re-read, within a week.

   The **speed governor** commands the slower of the job's speed and the zone's. It starts before
   the zone, by her slow-down distance plus a margin, so she is at the zone's speed on its edge. It
   holds that speed until she is clear of the zone by her own length (10 m at least), then her
   commanded speed comes back. A zone she is slowing for stays held while her route still meets
   it, however short her slowing makes the slow-down distance. If her route turns away from it, the
   banner says the zone "is no longer on her way", not that she is clear of it. A numeric limit
   takes her fastest speed at or under it. "No wake",
   "headway", "idle", "slow" and "speed restricted" take her slowest. A zone never raises her speed.
   It stands aside for the guard's slow-down and hold, a drift-in, and an escape (collision avoidance
   comes first). A page that cannot say which leg she is on still caps her by position and puts her
   speed back when she is clear. The zone taking her speed and letting it go are each said in a
   banner and logged (`speed_zone`). The Mission Status card's "for" row says which zone and until
   when. Zones are drawn in amber with their rule - hatched at 135 degrees since 2026-10-19, the
   one texture for every water a speed rule holds her slow in, the shore bands too; one that does
   not bind this hull is drawn gray, a wash with no hatch.

   **Entering a new area downloads *every* published layer.** The extract used to fetch
   only the ~45 classes the keep-out roles named, and that was the wrong trade: a cache
   cannot know what it doesn't contain, so a role added later was invisible to every area
   already cached. The extract now holds all 203 layers the harbor band publishes — the
   named ones role-tagged as before, the rest carried as `extra` — which makes
   classifying a new class a decision about data already on disk rather than a refetch of
   every operating area. `extra` is chart *context* and reaches the keep-out model as
   nothing; `tests/enc_roles.js` check 7 is what keeps it that way, since a harbor where
   those 1,556 features became obstacles would be one solid keep-out. Pre-warm the cache
   for every port in the registry with:

   ```bash
   python tools/warm_enc.py
   ```

   It reports **per role, not just a total**, and that is deliberate: ENCDirect reports
   failure as a normal-looking *empty* layer, so a bare feature count cannot tell a quiet
   harbor from a fetch that half-failed. A coastal extract with soundings but no
   shoreline is flagged rather than reported as open water. `--list` inventories what is
   cached and at which version; `--base <id>` warms one port.

   Three kinds of feature joined the model in the same pass, each previously fetched by
   nothing: **obstruction *lines*** (a submerged barrier or a line of piles charted as
   one object — the point and area forms were already fetched, the line was not),
   **bridge supports** (a pylon is a pier that happens to hold something up), and
   **cardinal buoys** (which are placed to mark a danger, so they are hazards —
   deliberately *not* lateral marks, which would let them invent a Rule 9 fairway out of
   a warning). The bridge **span** is fetched to draw and is *never* a keep-out: a
   `Bridge_area` covers the water it crosses, so enforcing it would refuse passage under
   every bridge on the chart. Also fixed here: `Restricted_Area` had never resolved to a
   real published layer name, so the operator's "Dredged / restricted" enforcement had
   only ever enforced the dredged half of what it said.

   **Floats the vector service leaves out are read off the seabed's own gaps.** At
   Pepperrell Cove (Kittery Point), survey lines and transits ran straight across the
   floats off the town piers. They are **pontoons**, and NOAA's vector service publishes no
   pontoon layer at harbor scale (only the coastal band lists one), so the extract held nothing there. The chart-image read
   didn't catch them either: their outlines lay exactly under the depth areas' own
   boundaries, which counted as "already charted". But S-57 tiles the seabed with depth
   areas, land, dredged areas, floating docks, hulks, pontoons and unsurveyed areas, with
   **no gaps and no overlaps**. So every pontoon is cut out of the depth areas around it,
   and the depth areas *are* served. On each extract the console cancels every edge two of
   those polygons share. What's left outlines the holes, and every hole wholly inside the
   extract becomes a keep-out with its exact charted shape. On his New Castle extract that
   is exactly the two floats (62 m² and 194 m²) plus one more at the shipyard. Lewes has
   none; Los Angeles has seven, the San Pedro waterfront's floats. The gaps follow the
   structures toggle, are outlined in **orange dashes** on the NOGO layer, and are counted on
   the Nogo row as *+N seabed*. An extract that arrived without one of its seabed layers is
   **refused**, because a missing depth layer would read as one gap over the whole area. The
   row says the check was not made.

   **A dashed line whose dashes each end in a dot is a symbol, not a pier (2026-10-01).** At
   Bellingham a survey was cut along a 1.4 km line the chart draws southwest from the Whatcom
   Waterway: short dashes, each with a dot on one end, the chart's mark for a cable way.
   NOAA's vector service carries no object along it, so nothing explained its ink. The
   chart-image read, which joins a pier drawn in pieces into one, chained 103 of the dashes
   into a single 1,440 m "structure" counted as attached to the shore. A chained line at
   least half of whose pieces end in a dot is now refused as a **dash-dot line symbol**. It
   is never a keep-out and never a footprint (a bending one would otherwise have been read as
   a marina), and it is never reported as a detached structure. A single piece with a dot at
   its head is still a pier. Over the same tiles the read now finds nothing at Bellingham; over
   the Kittery Point, New Castle and Fort Point piers it finds exactly what it found before.

   **Every chart read is kept, and a plan spread over a harbor is read in pieces (2026-10-02).**
   The page used to keep only the LAST chart-image read. A read of other water replaced it, and
   a refused read emptied it, so every pier found before left the keep-out model the planners and
   the clearance guard use. The read's budget is 256 tiles: at 43° N about a 0.9 km square at
   full detail and about 3.5 km at the coarsest zoom it accepts. An Upload read ONE box over the
   boat and every waypoint, so a plan spread wider than that read nothing at all and dropped the
   piers each survey's own punch had found. Now every read of the present chart extract is kept,
   and the reads are merged: a pier two reads both found counts once, the finer read's (at the
   same zoom, the later one's). Water already read at the detail it would get, or at zoom 18, is
   not read again. A refused or failed read adds nothing and takes nothing away; the banner and
   the Nogo row say which water was not read, and stop saying so once it is. A structure only a
   coarse read found is kept even where a finer read looked, because a tile that read never
   received is blank paper and reads exactly like open water. An Upload reads the whole box when
   it can, and otherwise its **transits leg by leg** (the boat, then each survey's first and last
   waypoint, in boxes that can each be read, at most 16, and it says so if the route ran past
   them). It then reads **each survey's own water** at its own detail, unless the punch's read
   already holds it. A Go-To, a Return-to-Home and a drawn transit still read their one box, and a
   box too big is refused at once, as before. A new extract still drops every read.

   **A route stays inside the water the chart was read over (2026-10-03).** The keep-out model
   holds the features of one box, the extract's, and outside that box it holds nothing, which
   every clearance test reads as open water. A Go-To, an RTH, a transit or an Upload reads the
   chart over a box round the boat and the target (padded 300 m and joined to the operating
   area), but the router's search can reach kilometers past the straight line between them. On
   a fresh console, a Go-To from New Castle up the Piscataqua to Adams Point ran 429 m past its
   box; replayed against the full chart, 21 of its 402 legs crossed land, rocks or water too
   shallow. The planner now refuses any route that comes within 100 m of the box's edge, and the
   command reads the chart over the route it was refused (padded 1 km) and plans again: up to
   three reads, each over the water the last route used, with the banner saying which read it is
   on. On that Go-To one read was enough, and the replanned route is clear on the full chart. Over
   96 commands on his chart, the old code sent foul legs on 28 of them; no route the new code
   sends has any, and none is more than 2% longer than a plan on the full chart. Go-To, RTH, a
   drawn transit, Upload and Resume-from-here all read further this way. A read that fails (the
   chart service offline, an extract missing a layer) leaves the model of the water already read
   in place, and the command is refused, saying why. A wider read of the same chart keeps the
   piers and floats the chart-image reads found earlier. A command whose own target lies past what
   the console can read (the server extracts at most 2.0° on a side; 1.5° until 2026-10-14) is refused at once, without
   planning, and the refusal names the extract it would take. A box that size used to be asked
   for anyway: the server refused it, the refusal emptied the model, and the Go-To was planned
   straight, unchecked, with the guard blind. The hold disc a command carries is kept inside the
   water read, too. The transit estimate on the Lines card marks a route over water not yet read
   as an estimate, not as unroutable. The automatic way round an AIS contact and the vessel's
   re-approach to her hold do not read further: a way that runs past the chart is refused by
   name, and she stays where she is.

   **The chart in layers, and water no chart covers (2026-10-11).** The server used to read each
   box at ONE scale: NOAA's most detailed usage band with any data anywhere in the box. Inside the
   box, wherever that band has no chart, the extract held nothing at all (no land, no depths, no
   hazards), and every planner and the clearance guard read that as open water. Measured on the
   operator's own cache: an extract from Portsmouth to Cape Cod, read at harbor scale, had depth or
   land under 43% of its box; two other wide reads, 81% and 88%; the 10 km operating box at
   Portsmouth, 99%. Now the chart is read in fixed **0.25° tiles**, each cached once complete. Each
   band's coverage outline (NOAA's M_COVR) says where its data is, and within a tile every square
   (down to 0.25/128°, about 217 m north-south) takes the most detailed band that covers it whole:
   harbor, then approach, coastal and general. The harbor chart is served whole; a coarser chart
   is cut to the squares it applies in. In the squares a finer chart's outline runs through, both
   charts' hazards apply: a strip at most one square wide with a few extra keep-outs, never one
   missing. The edges two cells of one chart share cancel, so the seams of NOAA's harbor-cell grid
   cost nothing (checked on the six real Portsmouth cells). Water no chart covers at any scale is
   **unread**: drawn gray with the NOGO zones, named on the Nogo row (*unread*), and a route through
   it, or within 100 m of it, is refused at once ("the route runs through water no chart covers"),
   because no wider read can chart it. A square whose chart could not be read is outlined as well,
   and the refusal says to command it again once it can be read. Only the boat's own first 100 m is
   excused (2026-10-18): a route that runs on through unread water, the square she is in included,
   is refused until the chart there is read - RTH as well. (The whole square she was in used to be
   excused, and at the Canaveral lock that square was a 25 km chart tile: the Go-To ran 856 m over
   land the model never had.) A band whose coverage could not be read (2026-10-19) makes the water
   it might cover unread water that FAILED - the tile is read with the bands whose coverage is known,
   and never from a coarser band in the unknown one's place; its cached coverage of any age stands
   in first; the finest band's coverage unknown with no copy fails the tile whole. A tile with a
   failed layer is served once and not cached. A read asked to plan a route further that
   arrives without some of its layers is USED (2026-10-18), with the earlier read's features of those
   layers kept; it used to be thrown away whole, with the land it had brought. The seabed-gap check runs on the harbor chart
   alone, which is served whole, and a hole a coarser chart's seabed fills is where the harbor chart
   ends, not a float. A coarser chart's piece is drawn with no outline along its cut, and the
   chart-image read doesn't take the cut for charted ink. The first read of the Portsmouth operating
   box took 59 s (two tiles, every layer of the harbor chart); a box offshore toward the Isles of
   Shoals (six tiles) took 57 s more and filled the water past the harbor cells from the coastal
   chart. Read again, both come from the tile cache. The older per-box caches (`features_v5_*`) are
   no longer read, so an area visited only before this change has no chart offline until it has been
   read online once.

   **The Passage tab, and a long Go-To as a passage (2026-10-14).** Andy: "consider another path
   planning behavior called 'passage' that disregards the 9-23 directive and allows for long path
   planning", and "do it in segments starting with beginning and end and then working inward". The
   Path planning card's **Passage** tab has its own line - her position, then the points dropped on
   the chart or typed (**Add**), the last the arrival (P1, P2 ... ARRIVAL, in violet); a point
   clicked again is a fuel stop - and **Read chart**, **Plan passage** and **Sail passage**, which
   were on the Transit tab (Transit is Follow again). A passage is read as a corridor of chart
   tiles, never one box, so the box cap is not in its way; the corridor reaches a fifth of the
   longest leg either side (5 to 25 km - a long straight leg along the Maine coast crosses the
   peninsulas). **Ends first:** Plan passage plans the first and last sections in detail as soon as
   the coarse plan is in, each on a chart read of its own beside the page's (the guard's model is
   never swapped), in the route worker - and a harbor she cannot leave or enter makes the passage
   NOT SAILABLE, said with why, before she sails. **A long Go-To:** the operator's Go-To (the chart
   menu's row, the Go-To tab's Go) past 50 km on a diesel hull is planned as a passage - the tab's
   line set to the point, read, planned, both ends planned, and sailed; refused at any step, it
   says why and leaves the plan on the tab. A battery hull's long Go-To is the box Go-To it was
   (Andy's choice), within the box cap. Live on a scratch console, his Portland -> Penobscot Bay
   Go-To (118 km): 27 tiles read, planned in 7 sections, both ends planned in detail (leaving
   20.5 km, arriving 7.9 km), section 1 sent. `tests/passage_tab.js`.

   **The box cap: 2.0° (2026-10-14).** Andy: "increase that limit. its causing problems.
   investigate ramifications"; he chose 2.0 of 2.0 / 2.5 / 3.0. 1.5° refused the wider read open
   water asked for on his 120 km Go-To from Portland (1.71 x 0.73). What a wider box costs, measured:
   his 21-tile read (0.25° tiles, about 11 MB each on the Maine coast) took 65 s and built 14,534
   keep-out zones; the page stalled 1.6 to 12.9 s on zoom changes with them, the guard blind
   meanwhile. So the chart layers now draw only what is on screen, no finer than a pixel (the
   model the planners and the guard use is untouched): on a 22,661-zone model each zoom change
   took 0.32 to 1.07 s, against 0.73 to 3.22 s on 20,078 before. Building a model that size still
   holds the page for several seconds (6.5 s measured). The state-sized box the cap was put there
   for (5.05 x 3.38°, 2026-09-23) is still refused. `tests/enc_cache.js` 15-17b, `tests/chart_box.js` 5.

   **Reading the chart along a passage (2026-10-11).** A box read stops at 2.0° on a side (1.5°
   until 2026-10-14), about 120 nm; a passage needs the chart along its route, not a box round it.
   The Passage tab's **Read chart** (the transit panel's until 2026-10-14) reads every chart tile within 5 km of the boat and the line's points, in the background,
   with its progress on the panel ("reading chart: 12 of 67 tiles · ~4:10 left"), and ends with a
   summary: how many tiles, the most detailed scale charting each, the water no chart covers near the
   line (drawn gray, as above), and any tile that could not be read (press Read chart again; tiles
   already read answer at once). The tiles are kept, so the passage's chart is on hand before she
   sails, offline too. A line from Portsmouth past Cape Cod to Cape Henry, about 450 nm, is 67 tiles.
   While she runs, the supervising window also reads ahead of her: the tiles along the next 30 km of
   her route, again every 2 km she makes good, so the guard's own 10 km chart reads round her come
   from tiles already read. Neither moves the boat; the planners still read their own boxes. The
   console's side is `POST /api/enc/corridor {route, half_km}` (a background job; the same tiles asked
   again rejoin it) and `GET /api/enc/corridor?id=` for its progress; it reads at most 600 tiles at
   once and is not logged as a command.

   **A chart read no longer stops the console (2026-10-11).** Reading the chart used to stop the
   telemetry stream for seconds at a time. Opening a cached tile (one JSON file of up to 30 MB) held
   the Python interpreter 1.5 s in a single call, and a fresh read parsed each of NOAA's answers the
   same way, a couple of dozen at once, so the frames stopped for 2 to 6 s. The page said TELEMETRY
   STALE, and for those seconds the clearance guard judged nothing. Three changes, each measured:
   a tile is **built in a child process** (`asv_console.py --enc-tile-worker`; the console starts it,
   nothing to run by hand), so NOAA's answers are parsed there; a tile is **kept one feature per
   line** (`charts/enc/tile_v2_<key>.jsonl`; `tile_v3_` since 2026-10-12), read back in thousands of small parses the other
   threads run between; and the **garbage collector is held** while a tile is read, and what was read
   is frozen out of its later walks (with three tiles in memory, a full collection took 0.93 s before
   and 0.014 s after). A thread ticking at 20 Hz in place of the telemetry loop: reading a 22 MB tile,
   worst gap 0.06 s (1.6 to 2 s as one parse); a build whose answers are as big as NOAA's, 0.05 s
   (about 1 s in the console's own process). On a live console (frames every 0.25 s; 0.40 s worst
   with no read at all): a fresh corridor read from NOAA, five tiles and 77 MB, worst gap 0.57 s; a
   box read carrying over two old tiles, 0.74 s. The page calls the telemetry stale at 2 s. A tile
   kept by an older reader is read again (since 2026-10-12, below); only when that read fails is
   the older copy served, offline too, and said so. A child that fails, or runs past 15 minutes, leaves the tile
   unread with the reason, as a chart that could not be read does. `tests/chart_read_stall.py`.

   **Plan passage: a long passage, its fuel leg by leg (2026-10-12, diesel hulls).** The Passage
   tab's **Plan passage** plans its line as a passage of any length: her position (or P1
   with no fix) is the departure, the last point the arrival, and a **click on a point** makes it a
   **fuel stop** (an amber ring and "FUEL"; click again to undo). It reads the chart along the line
   (as Read chart) with each tile's **planning grid** made, then plans the whole passage coarse in a
   background worker, off the guard's thread: a route of straight runs through water that is clear
   at this vessel's depth floor, round islands and headlands, kept off water a danger touches where
   there is room - and, open water first (2026-10-14, below), up to 1 km off it where the water
   allows. Then the fuel, leg by leg between fuel stops, at the transit speed in still water:
   the first leg from what is aboard now, each leg after a fuel stop from a full tank. A leg that
   arrives with less than **20% of the tank** says how far she gets before she is down to it, marked
   red on the chart: put a fuel stop before there. The plan is drawn (pale dashed, on a dark
   casing - 2026-10-14, Andy: "the passage line drawn on the chart is hard to see": the pale dash
   alone was 1.3:1 against a NOAA tile's white water; the Passage tab's violet line and the passage
   being sailed are cased the same way, their labels haloed), with a circle round each port and a
   yellow mark on each narrow stretch, and said on the banner and the panel.
   **What it does not plan**: the water within 4 km of each port, and the narrow stretches, are left
   to the console's own planner (lanes, the chart image, moored AIS) as she comes to them; the
   coarse route runs on cells of about 100 m, so the route she sails will be a little longer.
   **A section that leaves or makes a port is planned as a Go-To is** (2026-10-14, Andy: "ASV exit
   from port through channel looks like the ASV is drunk ... should all harbor entrance/exit be
   goto?"): in one leg to its end - the Rule 9 lane, the marks and open water first over all of it -
   with none of the coarse route's turning points, which cross a port's water on ~100 m cells and
   blocked ones too; its chart is still read, and its water judged, along them. The sections out at
   sea, hold to hold, still run through them. His Portland departure, flown from his wharf on a
   scratch console: 15 coarse points and five turns past 45 degrees before, none of either after.
   **And the Go-To is the harbor's only** (2026-10-15, Andy: "The GOTO should not need to parallel
   the passage line for such a great distance ... should meld into the passage path just outside
   the harbor marker buoy 2KR and meld into the passage line at the near bend to the long straight
   passage northeast ... generalize this"): she joins the passage line at its **join point** - the
   first point of the line (its cell steps folded, 150 m) at least 3 km from the port, 200 m from
   every danger (buoys aside), with the stretch beyond it clear, that begins a run of 3 km with no
   turn of 20 degrees - and follows the line from there, open water only round what blocks it. No
   such point: the whole section one Go-To, as before. Flown from New Castle: 15.1 km of the 8df6ab6
   route ran more than 300 m off the line, none of the new one; it joins at the bend 3.5 km out,
   past 2KR. The line runs nearer the coast than the Go-To did there: more of it within 500 m of a
   danger (4.1 km against 2.9). A
   battery hull is refused ("long passages are for the diesel hulls"). Nothing moves the boat.
   Measured: a 287 nm passage, Portsmouth to the New York approaches (39 tiles), read from NOAA in
   8.6 minutes the first time and planned in 0.8 s; with open water first, New Castle to Castine
   over his 40 cached grids plans in 2.9 s (0.9 s without), 222.3 km against 224.9, its cells within
   two of a danger 99 against 385. **The grid** (`asv_console.py`, "THE PASSAGE
   GRID"): each tile becomes 256 x 256 cells, about 108 m by 80 m at 43 N. Each cell holds the
   shallowest danger at its center and anywhere touching it, judged as the keep-out model judges: a
   depth area by its deepest depth, a rock by its sounding less a meter, land, structures and buoys
   always. It is built in the tile's own child process (0.4-2.2 s a tile), or from a tile already
   read in a child of its own, and kept as `charts/enc/grid_v2_<key>.bin` beside the tile. The
   corridor read takes `grids: true` (`POST /api/enc/corridor`), and `GET /api/enc/grid?tile=W,S,E,N`
   serves a grid. `tests/passage_grid.py`, `tests/passage_plan.js`.

   **Sail passage: the passage sailed a section at a time (2026-10-12, diesel hulls).** Once a
   passage is planned (its fuel legs all arriving with 20%), **Sail passage** on the Passage tab
   sails it. The coarse plan is cut into **sections** of about 20 km, each ending at a port (a fuel
   stop or the arrival) or at a point with water clear all round it to hold in, and never beside a
   danger or inside a port's 4 km circle. Each section is planned in detail by the console's own
   planner as a Transit is (lanes, the chart image, moored AIS, against the guard's own chart), and
   sent as a Transit of what she has left plus the section, so the new end carries its own hold disc
   and arrival coast. In the supervising window the next section is planned and sent **a whole
   section ahead of her** (2026-10-15, Andy: "between passage segments there should be no pause"):
   right after Sail, and as she enters each section, so she always has the rest of hers and one
   more, about an hour at 10 kn. It used to go out with 10 km left, and his boat held 25 minutes at
   the end of section 1 because the chart tab, where the next section is planned, had been asleep
   for 70 minutes; a tab the browser freezes plans nothing. **Section 1's chart image is read when
   the passage is planned** (the same day: "On goto transition to passage ... there should be no
   pause"), not at Sail, so Sail sends at once; Sail waits for it only while it is still being read.
   It is never sent while the guard has something of its
   own in hand, never to a route that changed while it was being planned, and never to a boat
   already holding. A section that cannot be planned is said, and tried again every minute.
   **At the end of the last section sent, she holds** (Andy, 2026-10-12: "she should hold"). That
   happens when no window is open to plan the next section, or when it could not be planned. At a
   fuel stop she also holds and waits. Nothing moves her on from a hold but **Continue passage**,
   beside Start. At a port, Continue passage is refused until the fuel aboard reaches the next port
   with 20% of the tank, and the refusal says so with the numbers. A Go-To, an RTH, a Hold or a Stop
   while she sails records where she left the passage, and Continue passage brings her back to that
   point and sails the rest of the section. **A Go-To given while she sails ends back on the
   passage** (Andy, 2026-10-16: "Follow the plan without adding another layer of confirmation"): at
   the Go-To's end the end-of-plan RTH chain stands down, and she rejoins the passage where she left
   it on her own, as Continue passage would, without asking. A newer Go-To before then is followed
   to its end. An RTH, a Hold or a Stop given after the Go-To leaves the passage for Continue
   passage, as before. If the rejoin cannot be sent, she holds at the Go-To's end, the banner says
   why, and it is tried again every minute. A guard escape is not a leaving: the passage waits for
   the guard to give the route back. **Divert the passage to here** (the chart's right-click menu) is
   a Go-To to a port with the leaving recorded. The passage is kept on the plan (`passage` in
   `mission.json`), so a reload or a console restart mid-passage keeps the section she is on and
   where she left it. The end-of-plan RTH chain stands down at a passage's hold, and at the port
   it was diverted to: there she waits for the refuel and Continue passage. The × beside Continue
   passage drops the passage (she is not stopped). Live (scratch console, DriX): New Castle to
   offshore of Portsmouth, 36 km in 2 sections. Section 1 was sent as 314 waypoints with a 295 m
   hold disc at its end. With 10 km left, after a reload of the page, section 2 was sent ahead of
   her and she held 7.2 kn straight through it. A Divert held her at the port, and Continue brought
   her back to where she left the passage. **One tile is built from NOAA at a time** (`ENC_TILE_BUILDS`): with
   every layer read, three at once lost layers on the same tiles on every read. `tests/passage_sail.js`.

   **Home along the passage, and each section at its own water (2026-10-12, step 6, diesel hulls).**
   An RTH with home more than 50 km away is refused: no chart box holds the water between. From a
   passage's water, with home at one end of it, **RTH now goes home along the passage**. If home is
   where the passage left from, she goes back the way it came; if home is where it arrives (she left
   from a visiting harbor), she carries on. A passage that comes back to its start goes home whichever
   way is shorter. She rejoins the passage where she is (at a section's end, the whole next section
   home), sails its own sections in their turn, and the last ends at home. Each is planned in detail
   as she comes to it, sent ahead of her **as an RTH**, and she holds at the end of the last one
   sent, or waits at a port for Continue passage, exactly as a passage is sailed. The way home is
   kept on the plan as a passage of its own (`kind: "rth"`, with the passage it runs along), so a
   reload, a Go-To, Divert and Continue treat it as any passage. Only the operator's RTH goes this
   way. The end-of-plan chain and the low-fuel monitor still send an RTH only with home in range
   (Andy, 2026-10-11). A ROC's home moves, so it is refused, and so is a way home that does not reach the
   first port on it with 20% of the tank. **Each section is planned at its own water.** The
   live water level follows the boat: the stations nearest her, now. A section is planned ahead of
   her and sailed over the hours after, often tens of km from those stations. So each section is
   planned at the **lowest level predicted along it over the hours she is expected in it**, from
   the stations nearest each of its points (`GET /api/water/along`; the Great Lakes on their observed
   level), at chart datum where no station is within 75 km or nothing could be read, and never
   above a manual water level. The chart it is planned on is built at that level for the planning
   alone. The guard's own chart is not touched and goes on judging the water she is in. The level
   is said on the passage's line and banners, and kept on the section. The coarse plan stays at
   chart datum. Live (scratch console, DriX, 2026-10-12, 16:4x EDT): the boat's level read
   +1.35 m (Seavey Island, observed) with low water predicted at -0.07 m three hours on. A 69 km
   passage offshore of New Castle had its first section planned at -0.07 m. She was spawned 62 km
   out and RTH pressed. She went home along the passage: the first 3 km section home was planned at
   +0.19 m (its 1.3 h window), and the next 20 km section was sent ahead at once, at -0.07 m. Both
   were sent as RTHs (the console: behavior rth, a 295 m hold disc). A reload kept the way home.
   `tests/passage_sail.js` 12-14e, `tests/water_along.py`, `tests/mission_store.py` 17e-17f.

   **NOAA's surge forecast in a section's water (2026-10-13).** Tide predictions carry no storm
   surge and no wind setdown, so a section is now planned on the **lower** of each station's
   prediction and NOAA's Surge and Tide Operational Forecast System (STOFS-3D, built on the SCHISM
   model; `stofs.py`) where STOFS stands at that station - never higher. Its station file (about
   16 MB, once a day) is fetched in the background for the domain she is in and cached under
   `charts/stofs/`. Each station's STOFS series is tied to the gauge by its own observations, or by
   NOAA's published NAVD88 offset where the gauge is not reporting, and its difference from the
   prediction is averaged over one tide before the negative part lowers the prediction (the
   model's tide runs minutes off the prediction's, which alone reads as tenths of a meter on a
   steep tide). With no STOFS forecast held, or at a station STOFS has no point at, the water is
   planned exactly as before. A section STOFS lowered says so ("the lowest forecast ... NOAA's
   surge forecast (STOFS) puts it 0.28 m under the tide prediction"), and the Mission Status
   card's **SURGE** row shows the surge at the nearest tide station STOFS stands at, over the next
   24 h. Measured on the 2026-10-13 cycle over the 12 hours it shared with the gauges' own
   observations: 0.04 m RMS at Lewes where the tide prediction ran 0.28 m, 0.22 m at Portland
   against 0.35 m. A station
   STOFS has no point at **borrows** the surge of the nearest point within 5 km, worked out at that
   point's own gauge against its own prediction (two stations' tides are never compared), and the
   card's tooltip names both: at New Castle the console's tide station is Seavey Island, which STOFS
   has no point at, so it takes Fort Point's, 2.6 km off. A station STOFS does stand at keeps its
   own answer, even when its fit is refused. `tests/stofs.py`, `tests/passage_sail.js` 14f,
   `tests/reading_age.js` 10-10b.

   **A section's chart image, read where it can find something (2026-10-12).** Every passage
   section raised "CHART IMAGE NOT COMPARED - the area is too large to read the chart image ...
   command it again once the chart has drawn in": a 20 km section's one box is past the image
   read's 256-tile budget at any useful zoom, so nothing was compared, and commanding again would
   ask for the same box. A section is now read as an Upload reads its transits, leg by leg in boxes
   that fit, and **only the boxes where the read can keep anything**. The read keeps a mark only
   when it is attached to charted land, a shoreline or a dock (one end within the larger of 6 m
   and the mark's own length), and no mark is longer than the box it is read in. So a box with
   none of those within its own diagonal of it cannot add to the keep-out model, and is not read.
   Open water raises no warning; the water near a shore is read at the detail each box allows. A
   refusal for a box too large to read no longer says "command it again" (for any command), and
   a section the console sent itself is never told to. Live (scratch console, DriX): leaving New
   Castle, section 1 was read in 3 of its 5 stretches (156-207 tiles at z17; 4 small uncharted
   marks found and kept), the 2 offshore not read; the 20 km section home offshore: 4 stretches, all
   open water, nothing read, no warning. `tests/ink_reads.js` 9-13, `tests/chart_ink.js` 14g, 22f.

   **Every layer read, and what each charted thing means to each hull (2026-10-12).** A review of
   how the console reads the chart and what its keep-out model makes of it found charted things that
   reached the model as nothing - each measured on the cached Portsmouth tiles with the code as it
   shipped - and they are now read and applied, for each hull by its own vessel file:
   - **Dredged channels.** S-57 lays a dredged area IN PLACE OF a depth area, and the depth test read
     depth areas alone, so a dredged channel shallower than the hull's floor was open water: New
     Castle's Back Channel (1.8 m) and Northward Channel (0.9 m) for a DriX drawing 2.25 m; 333 such
     channels across the cache. A dredged area is now judged by the depth it is kept to (DRVAL1),
     corrected for the live tide like any depth area, under the depth toggle; the Dredged / restricted
     toggle still only adds the deep ones.
   - **Unsurveyed water** - the same, the other object that stands in for a depth area: open for every
     hull (11 of 11 sampled at Erie). Now refused at every floor and tide, under the depth toggle.
   - **Islets charted as a point or a line** were `extra`. The drying flat round each held a boat off
     at low water; at +1.5 m of tide it stopped holding the 1 m hulls, and all 151 at Portsmouth read
     as open water to the Z-Boat and the C-Worker. Now land, sized by the assumed extent (10 m), never
     passed, and passed either side by the channel lane like a rock.
   - **Overhead.** No hull had an air draft and the server dropped every clearance, so a DriX 2.85 m
     tall was routed under New Castle's 1.8, 2.1 and 2.4 m fixed bridges. Each vessel file now carries
     `hull.air_draft_m` (DriX 2.85 m off iXblue's drawing, both gondolas; C-Worker 1.97 m off the GA;
     Z-Boat 1.1 m, its user guide's whole height) and `planning.overhead_clearance_m` (1.0 m). A bridge
     span, an overhead cable, pipeline or conveyor charted lower than the two together - or with NO
     clearance charted - is a keep-out; an opening bridge is judged shut. At New Castle the 1.8 m
     bridge refuses all three hull types, the 2.4 m one the C-Worker and the DriX, and the Sarah
     Mildred Long lift span shut (4.9 m) passes the DriX. A hull with no air draft is judged as before.
   - **Things in the water**: aquaculture sites, offshore platforms, fishing facilities (stakes, traps,
     weirs), oil booms, light floats, the isolated-danger and cardinal BEACONS and dry docks are
     keep-outs named for what they are (half the sampled aquaculture sites had read as open water).
   - **A rock is passed on a sounding only when the chart stands behind it**: not on a sounding the
     chart calls doubtful, unreliable or only reported, and never when it says the rock is always dry
     or floating.

   Reading the chart:
   - **Every layer of every band.** A coarser chart filling in was asked for its named layers only;
     every band now reads everything it publishes. The **overview** band is read as the last fill
     (water charted only at that scale was refused as unread), and the **berthing** band (65 cells,
     one at Eastport) is read whole beside the harbor chart where it reaches. Restricted areas are
     read under both of NOAA's names - the coastal, general and overview bands call the layer
     `Restricted_Area`, which left 58 polygons in the Gulf of Maine unread - and the coastal band's
     pontoon layer is read too.
   - **What each feature carries**: clearances (vertical, shut, open, horizontal), the water level
     and sounding quality of a rock, a wreck's and an obstruction's category, a restricted area's
     category, notes and restrictions (`INFORM` tells a no-discharge zone, "40 CFR 140", from the
     Naval Shipyard's restricted area, "33 CFR 334.50").
   - **Read whole, or said not to be.** A layer whose geometry came back as an error, or short of the
     objects asked for, was taken as whole and kept for good; now it fails, and a refusal by the
     service is tried up to twelve times, the waits short and growing (a dead link is not tried
     again). Twelve since 2026-10-19: NOAA, republishing its services, answered every other request
     with "Could not find service" - each request on its own, at random, at any number in flight -
     and three tries left a tenth of a tile's layers failed; twelve, each independent, leave one
     query in fourteen thousand. The fault reaches the Nogo row in words. A probe NOAA refuses never
     falls to a coarser chart band for the same water. A tile missing a layer the model acts on is
     **unread water** - the planners refuse it, the guard keeps everything that did arrive - and the
     Nogo row says **incomplete** and the banner names the layers.
   - **The chart's age.** A tile carries when it was read. One past a week is served and read again
     behind it (NOAA corrects its charts week by week); one written by an older reader is read again
     first, and only if that fails is the older copy served, the row saying **old chart**. The layer
     lists are asked for again daily (2026-10-19; NOAA republished every band with group layers and
     prefixed names - the class is the name past the prefix), the chart-source card weekly, and a card answer with a failed
     query is never kept. The row's tooltip gives the oldest tile's date. **On an old chart, nothing
     overhead is judged**: the older reader kept no clearances, so its bridges are not treated as too low
     (they were, for a few hours on 12 October, and every bridge on the Piscataqua was a wall to the DriX
     while his console sat on the older copy - his Go-To to Adams Point was refused). A fresh read that
     failed only on layers the model does not act on is used rather than the older copy; anything not read
     whole is held two minutes before it is read again.
   - **Speed.** Every request built its own TLS context, and on Windows that loads the certificate
     store each time: 22 s of a tile's 36 s of CPU. One shared context read the same tile in 21 s
     instead of 45 (616 requests to NOAA).
   - **Plan passage** judges the same things: its grid (`grid_v2`) holds dredged channels by their
     depth, unsurveyed water under every floor, islets, and a third layer of overhead clearance, so a
     coarse passage goes round a bridge too low for the hull.

   Measured on a scratch console: the Portsmouth to New Castle box read whole from NOAA in 104 s
   (before the TLS change); the page's own planner, run over it for each hull: the run upriver under
   the I-95 bridge unchanged; at +1.0 m of tide the Z-Boat's and the C-Worker's routes into the Back
   Channel unchanged; at chart datum both refused - Northward Channel is 0.9 m, and the other way in
   runs under the fixed span beside the Little Harbor bascule, which has no charted clearance (where
   the committed code ran the Z-Boat through 0.9 m of water against its 1.02 m floor, and the C-Worker
   through four channels shallower than its own). `tests/enc_awareness.js` (each hull against New
   Castle's real chart, `tests/fixtures/enc_newcastle.json`), `tests/enc_acquire.py`; and
   `enc_roles.js`, `enc_layered.py`, `enc_extract.py` (the six bands' layer lists,
   `tests/fixtures/enc_layer_maps.json`), `chart_read_stall.py`, `passage_grid.py`, `passage_plan.js`,
   `nogo_readout.js`, `enc_cache.js` updated.

   The vessel-status card's **Nogo** row names which of four things is true, because they
   are not interchangeable: *reading chart… 6 s* (with the seconds climbing, so a chart
   service that has stopped answering doesn't look like a slow first fetch), *334 zones ·
   floor 2.9 m* (the depth floor is **this vessel's** — draft + under-keel clearance — and
   the tooltip breaks the count down by kind: docks, shoreline, hazards, shallow water,
   land, buoys), *clear — none charted*, or the reason there is **no model at all**. That
   last one is the one that matters: "the chart was read and there's nothing to avoid" and
   "nothing has been checked and every route is direct" both look like zero zones and mean
   opposite things, so only the second is flagged amber and says so.

   **Keep right in narrow channels (COLREGS Rule 9).** The rule applies **only
   within a narrow channel or fairway, and only on a transit** — Go-To, RTH, the
   drawn Transit line, and the approach out to a pattern. Those ride a
   **channel lane** — and only for as long as the route is genuinely *in* that channel.
   The lane is spliced over the stretch inside the buoys plus a fixed standoff, and the
   rest of the leg is handed back to the routed path, so the vessel keeps right
   **through** the channel and then **aims at its destination**. That standoff is a
   distance from the **buoy line**, never a multiple of the channel's width: it used to
   be `2.5 × half-width`, which on a 150 m half-width reached **225 m beyond the buoys**,
   so a 681 m approach that had left the channel a third of the way along was captured
   whole, held on the channel edge to the end and then cut back across — turning 681 m of
   already-clear water into **829 m and 20 waypoints**.

   The lane itself:

   > offset to **starboard of the channel centerline**, half way out to the edge on
   > that side — a **quarter of the channel width in from the edge**.

   So the **centerline always stays to port**. Outbound that puts the green marks to
   starboard; inbound it puts the red ones there ("red right returning") — but for a
   lane **color is never an input to the calculation**. It falls out, because lateral
   marks sit on fixed sides. Which side is "starboard" comes from the **direction of
   travel**, so the two directions ride opposite halves of the same channel and
   opposing traffic passes **port-to-port**. (A single mark, with no channel drawn
   round it, is the one place the color and the numbering are read - see 4 below.)

   **Where it does NOT apply**, and this is as much of the rule as the offset is:
   an **open bay or open ocean** transit, and **anything inside a survey or search
   pattern** — coverage lines, the reversals between them, and the routed hops that
   join them. A pattern is positioned deliberately; a keep-right offset applied
   inside one is neither lawful nor wanted.

   *This was wrong until 2026-08-31 and is worth knowing if you are reading old
   tracks.* There was no width test at all: the console marched perpendicular and
   called the water a channel if anything answered within 150 m on both sides, so a
   bay with shores 300 m apart was laned and the card reported compliance with a rule
   of the road. Routed detours inside a plan were laned too, which laned patterns.

   **A narrow channel is a charted object**, not a shape inferred from two distances.
   Rule 9 is written about "a narrow channel or fairway", and S-57 names both:

   * **FAIRWY** (`Fairway_area`) — the designated lane for larger vessels.
   * **DRGARE** (`Dredged_Area`) — a maintained depth, so a deep-draught vessel
     "can safely navigate only within" it, which is Rule 9(b)'s own test.

   Either makes the water Rule 9 water **at any width**. Failing both, the rule still
   applies where the water is **genuinely narrow** — under **150 m edge to edge** —
   because Rule 9 does not require a channel to be charted, and a 100 m cut between
   two banks is a narrow channel whether or not an ENC draws a fairway over it. That
   150 m is a **policy number**: COLREGS defines no width, so it is named
   (`NARROW_MAX_M`) and documented rather than buried in a comparison.

   Traffic separation schemes (**TCTSBL**) are **Rule 10**, and recommended tracks
   (**RECTRC**) are neither a narrow channel nor a fairway; neither is treated as
   Rule 9 water.

   **Rule 9(b) always binds here.** Every hull this console drives is well under
   20 m (DriX 7.71 m, Z-Boat 1.9 m), so "shall not impede a vessel which can safely
   navigate only within a narrow channel" is never a case to test for. Its two
   actions are both implemented: keeping to the starboard outer limit is the lane,
   and not obstructing by crossing is Punch Out clipping a survey line that **spans**
   a channel — while leaving one **contained within** it alone, because surveying a
   channel is a normal thing to be asked for.

   **What defines the channel, in order** (2026-10-04 — Andy: *"Any given ASV should
   recognize a channel from the ENC before relying on buoy placement"*, and *"Often,
   there are not paired buoys but single buoys of a particular color"*):

   1. **The chart's own channel.** Where she proceeds along a charted fairway or
      dredged area, she rides **three quarters of the way across the polygon** — a
      quarter of its width in from its starboard edge — whatever the buoys or the
      banks would make of that water. The cross-section is the polygon's, taken square
      to her **course** (over 75 m either way, so a short jog of the routed path does
      not tilt it). A fairway is measured on its own rings, so a dredged berth or patch
      beside it is not part of it. Side water that opens abeam — a berth, a side
      channel, a basin — is an *opening*, and the channel's edges are carried across
      it; a short gap between two rings is bridged; and the lane is capped so it never
      stands outside a narrower stretch ahead or behind. She holds the line to the
      channel's **end** and eases off past it; leaving through its **side**, she eases
      off inside it. The line is held past the end only where it is to **starboard** of
      her path: where her path runs outside the channel's starboard edge, the line is to
      port of it, and she eases in to it inside the channel instead. Held past the end
      as an offset from a path that bends there, it put her on the **port** side of the
      water beyond - bound up the Piscataqua, through the south half of the Memorial
      Bridge's lift span and along the south side of the reach below it (2026-10-10;
      tests/channel_end.js, on that chart and that path). A crossing, a path beside the channel that never enters it, a
      basin about as wide as it is long, and a patch shorter than 120 m are not water
      she is proceeding along. A cross-section cut by the channel's own end — where her
      path turns within 75 m of it — is the end's, not the channel's, and does not
      narrow the lane; a channel that really narrows at its end (an entrance channel)
      is laned to its end. The cap reads each stretch's limits as that stretch measured
      them across its own track, round a bend too, so a narrowing just round a bend is
      eased toward before it - but not a cross-section where her path is still turning,
      or one that does not hold her: where two charted rings join at a bend, those are
      cut short by the ring she is leaving, and are no narrowing. It takes the lane to
      port of the channel's middle only for a narrowing on the stretch she runs straight
      along, where staying in the charted water needs it; a routed path that steps off
      the channel cannot drag the lane to port.
      An end is her lane leaving that end's own polygon, even into a dredged basin
      beyond it; but where her route itself ends in the channel, she
      leaves the lane inside it rather than carry it to the end and hook back. Where a
      mark's run brings her into the channel, the chart's line is the line from there.
      In a set, the lane's points are laid clear of the guard's standoff wherever the
      channel has such a point right of its middle.
   2. **Buoy pairs**, where the chart draws no channel — the paired-buoy centerline,
      below.
   3. **Unmarked narrow water** — the banks, below.
   4. **Single marks** — lateral buoys and beacons standing alone, in water the chart
      does not own. *Red right returning*: each is read from the numbered marks **of
      its own hand** before and after it along her route, its own named channel first.
      A buoy kept to starboard is passed **close** — `max(10 m, 2 × buffer)`, and
      outside the guard's standoff in a set; one kept to port gets a wider berth; a
      beacon is never brought close. A mark is **left alone** — neither passed close nor
      counted; the plan's own list (`plan.marks`) records why —
      when it is a junction mark, in charted water (the chart's lane governs), across
      land, unnumbered or alone, when the marks either side of it disagree, when its
      own named channel crosses her route, and when her channel goes on without her past
      it or she joins its channel only beyond it. Each pass is put in **one at a time**
      and kept only if no mark she already has on its proper hand ends up on its wrong
      hand — a mark it would cross brings its own pass along, or the pass is refused —
      and a mark on its wrong hand is seen to before a close pass is made. A mark that
      cannot be kept is **counted and said**. One too near her route's start or end to be
      moved for is excused the move — and the count too where it lies beside her berth
      or her destination (no further along than 1.5 times its distance off); one
      further along is counted, and so is one at a waypoint between two legs of a
      drawn transit, so a waypoint beside a mark does not hide it. Each transit leg's
      marks are judged on
      that leg's own part of the route, and every pass counts (up a channel and back, each
      mark twice); a mark beside the waypoint two legs share is one pass, counted once. A
      gate partner — the other hand's mark numbered one off, within 400 m, however her
      track crosses the line between them — is never read as the mark before or after,
      and another named channel's numbers speak for a mark only where they continue its
      count, numbered on from it (a cove numbered again from 1 beside a harbor's red does
      not). A pass is tried along the channel's course and, failing that, along her own
      track there; and where a mark would be left on its **wrong hand** because its pass
      cannot be joined to the one before it (or after it) within the turn limit, the two
      are laid again **aimed at each other** — buoy to buoy, which is the channel's
      course, where her own track is the shortest way and may cut across what the buoy
      guards. Only where the line between the two runs along her route: two marks
      abeam of each other across the channel are a gate, and she is not sent across to
      the far one. A pass that could not be joined is asked again each time another has
      been placed, until a round places nothing. The stage is bounded by **work** (80
      routed legs), not by the clock, so the same Go-To plans the same route on a busy
      machine as on an idle one. The bound is a **hard stop**: once it is spent no pass
      is tried again, not even one laid buoy to buoy to put a mark right — that mark is
      counted where it stands, and said.
   5. **A buoyed reach** — the stretch of her route between two such marks (no more
      than 1.5 km apart along it), where the chart draws no channel. The marks are
      what make it a channel; leaving each on its proper hand does not by itself put
      her on the starboard side of the water between them (a mark kept to port is only
      given a berth, and a beacon on the starboard hand is never brought close). So
      between the marks she rides **three quarters of the way across** the water they
      buoy, only ever moved to starboard. Its edge on each hand is the nearest of the
      **bank** (side water — a basin, a back channel — read across: what is judged is
      the water's *width* against its width nearby, never one bank's distance from her,
      which changes with every swing of her own path), a **local charted restricted
      area** wherever she is outside it, and that hand's **marks**: the line from one to
      the next where the water runs straight between them, and beside a mark the line
      through it along the water's course. Round a bend the line between two marks is
      no edge — the bank is. A stretch of it must be a channel: water two edges bound
      along at least 150 m, laned no further off her path than it is long at the
      lane's slope — a rock or an islet off an open shore, or two buoys forty meters
      apart, make no channel. The lane is read every 35 m along her route, and those
      places are **anchored at the reach's own marks** (2026-10-10): read from her
      route's first point, every one of them fell where the route's length before it
      put it, so a change kilometers back moved the lane - 27 m at Fox Point when the
      route got 10.9 m longer below the Memorial Bridge, and up to 68 m elsewhere on
      that run. Past the first of its marks the lane is now where her path round it
      says, wherever her route begins (enc_channel 90b).

      *Never across a mark, never round the far side of the bank.* Every lateral mark
      on her starboard hand stays there — a buoy kept to starboard is passed close, any
      other mark (a beacon, an unnumbered or junction buoy, a mark she is already on
      the wrong side of) is given a mark's berth. What of the bank she stands off is
      read between her cross-sections as well as along them — a pier's head, a point
      of the shore — and held over the smoothing, so it is rounded at the lane's own
      clearance (twice the buffer and two meters, or more), on the side the shortest
      route passed it. The chart still comes first: this lane is laid after the
      chart's own, and in charted water moves her no further than the chart's line.
      And it is kept only where the route that ships is no worse for it: no mark on its
      wrong hand that the route without it has right (mark by mark, not by the count),
      no lane the gate had to abandon where the route without it was not, no uncounted
      mark (no number, a junction buoy) between the two routes, no turn over the marks'
      own 45 degree limit where the route without it has none as sharp (within 5
      degrees) within 30 m, and no keep-out passed nearer than the lane's own clearance
      (a rock: its model's floor, below) and nearer, by more than the buffer or 3 m
      (the less), than the route without it passed it. A lane that fails only that
      last test is laid again held off what it grazed — not moved anywhere a shift
      could bring her inside that hazard's floor, eased off and back on either side —
      and judged again, up to three times; it is dropped for the whole route only if
      it still grazes, or fails any other test (dropped whole at its first graze, one
      dock at the Memorial Bridge cost an RTH its keep-right past Pierce Island and
      Henderson Point, and in Little Bay). In a set, where the planner
      re-gates the route at the standoff, the route without the lane is re-gated too,
      and two of these are asked again of what comes out — a mark on its wrong hand
      that the other has right, and a lane the gate abandoned — but not the turn, the
      uncounted marks or the clearance. A restricted area the chart cuts into pieces
      at its cell boundaries is judged whole.

      *A rock is a shallow point, not an edge* (his call on the review: "hold the lane
      and pass the rock wide. do not use a rock as an assumed buoy for path planning
      purposes"). A charted rock, wreck or obstruction, a shoal patch or a small islet —
      no more than 150 m across, with water all round it (twice its floor clear of
      anything else, measured from its outline) and no lateral mark within 50 m of its
      outline — neither bounds the lane nor stops it where it is held past a reach's
      end: she holds her lane and passes it wide. (Read as a bank, a rock 130 m off her
      path in a 500 m buoyed river pulled the lane in from 276 m to 112 m off her path,
      to pass it 18 m off; held, the lane passes it 146 m off.) Rocks closer together
      than twice the floor, outline to outline, are one rock. Which hazards may be
      rocks is read from the chart's class, because the chart charts a pile as a hazard
      point just as it does a rock: a pile, a dolphin, a bridge pylon, a hulk, a shore
      construction and every aid charted as a hazard point (a cardinal, isolated-danger,
      safe-water or special-purpose buoy or beacon) are the bank. So is anything built,
      however small — a pier, a float, a bridge support: the chart serves no floats, so
      a pier head standing off on its own may be joined to the shore by one that is not
      drawn — and so is a rock off a bank, a ledge longer than 150 m, and a hazard a
      lateral mark stands beside. The one exception is something built that the chart
      gives only as an obstruction, with nothing to say what it is: a fish weir, or a
      tidal turbine, cannot be told from a rock on the chart the console reads, and is
      passed as one, on either side (kept so for now, 2026-10-06).

      Only where the lane would bring her nearer to a rock than its floor, and nearer
      than her path without the lane passed it, is it passed — asked of the lane's line
      and of the route **as it will be smoothed**, because the smoothing rounds a bend
      in the river, or the knee where the lane eases in or off, sideways onto a rock the
      line cleared. It is passed on whichever side is the smaller move from the line,
      by moving **the lane's own line** over by what the rock needs abeam of it and no
      more: up past it on the far side (only inside a reach, and only where the lane
      may stand that far over), down short of it on the near side, as far as her own
      path. (Held instead at the rock's offset from her path, a rock on the lane's line
      where her path crosses the river on a diagonal toward a charted fairway held the
      lane 61 to 73 m off its line for hundreds of meters before it.) Where her own path
      passes the rock inside its floor, the lane can come no nearer her path than her
      path, so it rides her path past the rock over the whole of the pass, as the route
      without the lane would, rather than be given up for it. Its width across her
      line is read from its outline, so a shoal 15 m wide and 140 m long lying along
      her course is passed at its floor, not as if it were 141 m wide. The pass runs
      over the rock's own length along her route and, beyond it
      either side, its floor, two smoothing steps and a sample step (outside a set,
      about 120 m either side of a rock of no extent at a 3 m buffer, 175 m at 5; a
      charted rock with no sounding over it is sized by the assumed radius above, 10 m
      by default (50 m until 2026-10-09), and that is added too), so the smoothing that follows rounds nothing
      back toward it. A far pass that another rock's near pass has made
      impossible gives way to a near one (a side only ever changes far to near), a
      pass the smoothing still cuts into is widened by what it cut, and the line is
      laid again — twelve rounds at most (`ROCK_ROUNDS`). What is left after them is
      for the test above that keeps or drops the lane, at the rock's floor.

      **Channel rocks**, under *Turn shape* on the survey card, picks that floor, for
      trying both — for the lane between single marks (4, above) and nothing else, by
      design: in the chart's own channel, between buoy pairs and in unmarked narrow
      water a rock is passed at the ordinary keep-clear whichever is chosen. *Land*
      (the default) passes a rock at the lane's own clearance from a bank: the keep-clear (the
      buffer, or the guard's standoff in a set) and a
      further buffer and two meters, 6 m at the least — 9 m off at a 3 m buffer, and
      12 m at 5. *Shoal* passes it at the keep-clear and a march step, 2 m or half the
      buffer where that is more, as any spot of water shallower than the floor — 5 m
      off at a 3 m buffer, 7.5 m at 5; where a set puts the guard's standoff at 12 m,
      at a 3 m buffer, 14 m to Land's 18 m. Twice the floor is also what makes a
      cluster and what water all round means, so the two can read the same water
      differently: at a 3 m buffer two rocks 15 m apart are one rock as Land and two
      as Shoal. It changes no keep-out
      and rebuilds nothing: the next Go-To, RTH, transit, survey approach or leg into
      a later survey is planned with what it says, the transit and RTH estimates on
      the Lines card are worked out again for it, and a fresh page starts on *Land*
      (it is not saved with the mission).

      *Restricted areas are facts, not walls.* Whether one is a keep-out is still the
      operator's **Dredged / restricted** toggle. But the lane between single marks is
      not laid **into** a local one (no bigger than 1 km²) — a shipyard's waterfront, a
      security zone, a barrier — wherever she is outside it; where the shortest route
      runs through one she is moved there only toward its nearer edge. A regional one
      (a no-discharge zone covering half a river) bounds nothing. The chart's own
      channel, a buoy-pair lane, the banks' lane and a mark's own pass are laid where
      the chart, the buoys or the banks put them, restricted area or not.

   **The two buoy-made channels, geometrically:**

   * **Marked channels** — each port-hand buoy is paired with its nearest
     starboard-hand buoy; the pair midpoints, in number order, are the centerline,
     and half the pair spacing is the local half-width. The console picks the
     channel by the **longest stretch of the routed path that actually runs along
     it**, so a channel merely passed nearby is ignored. A mark of the pairs is
     "ridden as a pair" only where that lane really leaves it on its proper hand;
     otherwise it is read as a single mark.
   * **Unmarked, channel-like water** — a basin exit, a canal, a cut between banks.
     The centerline comes from **the water's own edges**: the console looks out both
     sides and takes the middle of what it finds. This engages **only where both
     edges answer** within the vessel's channel reach — genuinely confined water.
     Open water and a single bank nearby are left alone, so a plain open-water Go-To
     is never bent toward a channel that isn't there. The reach is buffer-scaled, and
     `planning.channel_reach_m` may **widen** it for a big boat in a wide fairway; it
     is a maximum, never a substitute, so an override *below* the buffer-scaled
     default cannot narrow the search.

   **Where the lane lets go.** A channel does not end at its last buoy, and neither
   may the lane — releasing at the final mark cuts back across the fairway exactly
   where converging traffic expects the vessel to stand on. So the centerline is
   **extended** along its own terminal axis before the lane is built on it, and the
   full quarter-width offset is held right through that extension, **entering and
   leaving alike**. How far: as far as the **charted channel** continues, or **one
   full channel width** past the final pair — whichever reaches further, capped so a
   dredged area running well beyond the buoyage cannot drag the lane along water the
   marks never claimed. Two separate channels with a gap between them stay separate.

   A **lone buoy is not a wall.** Marks are kept clear (don't hit a buoy) but never
   bound the channel on their own — you may pass either side of a mark. Only
   *paired* marks define a fairway.

   **Safety first, every time.** The lane is *spliced into* the ENC-routed path, so
   the routing that gets the boat out of a basin or around a breakwater is preserved
   — the lane only replaces the stretch running along the channel. The offset is the
   largest that keeps the boat in **clear water**, rate-limited so the track eases in
   and out where one side is shoal. Every leg is clearance-checked; if a leg cannot
   be routed the lane is **abandoned entirely** and the plain routed path is used.
   A leg that can be routed only the long way round — more than twice the search's
   own way between the same two points, plus 200 m — takes the search's own way there
   instead (a lane leg 89 m long was once patched round the land, 10.6 km). A boat
   starting or arriving **inside the buffer** is led out of the water she lies in
   without a splice, as long as the leg does not close on what she lies beside; past
   that water the leg is checked like any other, so a pile or a dolphin a few meters
   beyond her berth is not waved through with it. In a set, the standoff's re-gate lets
   that water come as near as the buffer (the law the route has already passed), and
   routes a patch out of her start, or into her goal, at that endpoint's own clearance,
   so it neither hooks round her nor jumps to the far side of a point of land. A leg
   into or out of an endpoint inside the margin never runs through a keep-out: where
   the only way in at the standoff would, the route is found at the buffer and the
   plan says it runs inside the standoff.
   And every shipped route is **flyable**: a splice seam can fold a reversal a few
   meters long — a turn no hull can make, which a vessel answers by orbiting the
   waypoint — so the producer prunes any such fold whose neighbors connect clear (a
   mark's run gives way at its ends; its pass point never does).
   The clear-water condition means a corner that exists to dodge an obstacle stays.
   The console never plans a leg it has not verified. Survey coverage lines and
   teardrop turns are never offset (planned geometry). The track is resampled at a
   fixed spacing and lightly smoothed, and generated Go-To / RTH / Transit waypoints
   draw as unlabeled diamonds.

   **The banner says what was ridden, and how much of it** — for example *"Rule 9:
   right of center in the charted channel; channel lane, centerline to port; 7 marks
   left to starboard, 6 marks left to port"*. Each part is claimed only where it
   stands on the route that ships (after the smoothing, the gate and, in a set, the
   standoff re-gate): the chart's lane where the finished route crosses its water
   more than half way over (and not at all where most of that water was crossed short
   of it), the pair lane, the banks' lane and the buoyed reach's lane (*"right of
   center in the buoyed channel"*) only where their moves lie outside water the chart
   owns — the last only where it was kept — and the marks counted where the finished
   route leaves them. The
   Intent card says how many of the buoys kept to starboard were passed close —
   *"(5 of the 6 buoys kept to starboard passed close)"* — rather than claiming it of
   every one. A mark on
   its wrong hand is said as that — *"1 mark NOT left on the proper hand"*. **PARTIAL**
   is said when a stretch was handed back to the router, a second buoyed channel was
   neither kept mark by mark nor ridden by the chart, or the charted water was ridden
   less than half way across for more than a few samples. A banner claiming
   keep-right over a route that is not keeping right is worse than no banner: it is a
   claim you would otherwise have checked yourself.

   **A maneuver is laned as it always was.** The way round a contact, the way back
   onto a line and the way back onto station are a few hundred meters of avoidance,
   not a passage up a channel: no chart lane, no marks.

   **Offshore marks are kept off their dangers, not followed (2026-10-12).** A
   lateral mark whose direction of buoyage cannot be read, with no channel about it, is
   an **offshore mark**: it guides a vessel away from the danger beside it rather than
   down a constrained path. The route keeps each one **between her and the charted
   danger beside it** (a rock, a shoal below her floor, land), on whichever hand that
   puts it, at its whole berth (30 m at the DriX's 5 m buffer, even where her route already
   passes on its safe side) and never close - where the water gives her less, the banner
   and the Intent card say the mark was passed inside its berth; it is no channel's edge and makes no
   buoyed reach. A mark of another name more than 1.5 km along her route no longer gives
   a single its direction, since singles that far apart are each numbered for their own
   danger. On a Go-To past Thacher Island off Rockport the route had run 90 m outside
   Oak Rock Buoy 2 and Thacher Island Buoy 1; it now passes between them, with Oak Rock 2
   its berth to starboard. The banner and the Intent card count offshore marks apart
   from the Rule 9 marks ("2 offshore marks kept between her and their dangers"), and
   one NOT so kept is always said (`tests/offshore_marks.js`).

   **Deep water first (2026-10-12).** The chart is an excellent source of data but can be
   wrong, so a passage (a Go-To, an RTH, a transit, the leg into a survey) is planned
   first keeping **2 m of water over her depth floor and 50 m off charted rocks and shoal
   soundings**. A charted depth band counts as that shallow only when it is no wider than
   **10 m** (2026-10-13): a coastal chart's 0-18.2 m band runs from the shoreline to the
   10-fathom line, its 0 is the shore, and read by it a Go-To off Biddeford Pool went
   970 m round water whose soundings beside the line were 15.5 m and deeper; inside such a band the shoal
   soundings and rocks still get their 50 m. Today's floor and buffer are used only on stretches with no deeper way
   (none within half again the distance, or 1 km more), and where a deeper way would put
   a buoy on its wrong hand: a buoy outranks the chart's margin. Each such stretch is
   said on the banner ("deep water first: 1.34 km with the margin not kept (1 with no deeper
   way, 1 for a buoy)") and listed with its position on the Intent card, as a
   warning where it lies between her start and her end - and **marked on the chart**
   (2026-10-13): a wide orange band over the route (it reads yellow-orange over pale water),
   labeled **MARGIN NOT KEPT** with its length and why, drawn while she has it ahead of her.
   The margin not kept is the 2 m over the floor and the 50 m off rocks and shoal soundings;
   the floor and the buffer still are, and most of the stretch may be well deeper. (Until
   2026-10-14 it said "at her floor", which read as water at her floor's depth.) Where she starts or ends in
   shallower water she leaves it the short way; the hold point is unchanged, and the
   clearance guard never sees the margin. On the Go-To past Thacher Island the route now
   passes between Oak Rock Buoy 2 and Thacher Island Buoy 1 clear of the 5.4-9.1 m patch,
   and over that whole 61 km Go-To the water within the margin fell from 2,981 m in six
   stretches to 1,340 m in two, for a route 1.0 % longer. Maneuvers (the way round a
   contact, back onto a line or onto station) and a survey's own lines are laid as before
   (`tests/deep_first.js`).

   **Open water first (2026-10-14).** Planned close in, a passage threads islands, ledges
   and shoals by the shortest clear way - technically good, but the chart may carry a
   positional error or miss a rock. So a passage leg of **3 km or more** (a Go-To, an RTH,
   Continue, the leg out to a survey and into each later one, a drawn transit's legs, every
   section of a long passage) is searched over the whole water between its ends, each meter
   costing more the nearer it runs to a charted danger out to a **1 km berth** (500 m, then
   250 m, where the widest is past the cap), and pulled into long straight legs that never
   come nearer a danger than the search ran. It is taken where it cuts the route's exposure
   by 10% or more at no more than twice its length - safety before efficiency - and
   otherwise the close-in route stands exactly. **The buoys help**: a buoyed or charted
   channel, the water round a red or green mark and along the reach between two marks of
   one channel, and the water round a safe-water buoy are safer water, so a marked channel
   is taken over an unmarked gap; an isolated-danger buoy is kept clear; and a buoy's own
   nearness never pushes the route off the channel it marks. And a **buoy outranks open
   water**: where the wider way would leave a mark on its wrong hand that the close-in route
   keeps, the close-in way is kept past that mark (open water either side), or the close-in
   leg is planned. The search uses only water the
   chart was read over, and the page reads the chart over that wider water before it plans
   ("reading the chart over the open water round the way there"). The banner and the Intent
   card say the berth and what it added or saved ("open water first: a 1.00 km berth off
   charted dangers where the water allows, 3.70 km shorter than the close-in route");
   **Open water** under Route rules (First / Off) turns it off. **Ends first (2026-10-14):** the
   search's grid grows with the leg - 152 m cells on his 120 km Go-To from a Portland wharf, where
   every cell within 900 m of her was blocked and the search could not start ("no open-water
   path", the threading route shipped, whatever chart was read). A harbor end is now searched on a
   fine grid of its own (27 m), every exit into open water offered to the leg's search with what
   reaching it cost, so the way out is the one that does the whole leg best; and the spine never
   cuts a corner nearer a hazard than the path it straightens. That Go-To, replayed on his charts:
   132.2 km against 128.6, 4.8 km of it within 250 m of a charted danger against 22.7 km (10.4 km
   within 500 m against 55.3), 16 turns against 29. Open water's own route keeps 56.6 m or more off
   every danger; the Rule 9 lane through Hussey Sound's buoyed channel then passes a shoal at its
   edge 22 m off. The banner says how far each harbor end was planned in detail. Plan passage's coarse route
   and the fuel monitor's way home keep the same berth. His Go-To from Castine to the Fox
   Islands Thorofare now runs down the open bay west of North Haven, as his drawing did:
   38.5 km against 42.5, 2.6 km of it within 250 m of a charted danger against 19.3 km, no
   turn against 41 (replayed with ends first, 2026-10-14). Across 13 Go-Tos in his four areas
   (Penobscot, Casco, the Piscataqua, Cape Ann - his own two and eleven more across the same
   waters) it was taken on 12 (Shoals to Rye kept: no safer way), and the routes ran 8.3 km
   within 250 m of a charted danger instead of 71.3 km (0.9 km within 100 m instead of 13.7),
   with 28 turns instead of 113 and no buoy on its wrong hand instead of one, for 5.1% more
   distance in all - from 10% shorter (Castine) to 30% longer (Gloucester
   to Rockport, outside Thacher Island). `tests/open_water.js`; the Go-Tos in his own waters:
   `node tools/open_water_missions.js --charts <his chart cache>`.

   > **History.** This replaced two earlier designs that both rode the *wrong side of
   > the buoys* on the water: a color buoy lane that inferred direction from IALA
   > numbering, and a geometric keep-right that measured its offset by probing for the
   > channel edges. Measuring from a **paired-buoy centerline** instead is what made it
   > hold. Retired with them, and not currently implemented: standing on past a channel
   > mouth by the channel's own width, and steering through the outermost buoy gate.
   > On 2026-10-03 his Go-To up the Piscataqua kept right only where there were buoy
   > pairs; the chart's channel and the single marks came first and fourth in the
   > order above on 2026-10-04.

2. **Behaviours (no survey plan needed).** Beyond a survey/search plan, the command
   bar drives one-off autonomy behaviours, all available once **Armed**:
   - **Go-To** — the card's **Go-To** tab (click a point or type it, then **Go**; it
     shows the bearing, range and time first), or right-click the chart; the boat
     drives there (around obstacles) and holds. A Go-To from the chart menu fills the tab's
     latitude and longitude with its point (2026-10-14), before it is commanded - so a refused
     one leaves the point there for **Go**.
   - **Transit** — the card's **Transit** tab, draw a single- or multi-segment line, then **Follow**; the
     boat drives the line clear of obstacles and station-keeps at the end.
   - **Hold** — station-keep at the present position.
   - **RTH** — Return-to-Home: drive to the home point (auto-set at launch, or **Set
     Home**) and station-keep.

3. **Arm** — comes up **SAFE**. `Arm` confirms an operator is on the RC with Sw A
   forward. Every actuating command is gated behind arming.
4. **Upload → Start** — push the plan to the boat, then start the run. An upload never
   changes what the boat is doing: under way on a plan it is refused (Hold or Stop first);
   station-keeping or paused, the plan is **staged** and the boat carries on until Start. With no
   position fix Upload refuses; with the chart model not loaded it asks first (in the simulator
   too) and keeps an UNROUTED banner up. A plan goes whole or not at all: one whose routed path
   is longer than the console's waypoint limit is blocked before anything is sent, and the
   banner gives both numbers (the console used to keep the first 1000 waypoints and drop the
   rest). The transit is
   routed clear of obstacles at Upload, which never re-orders the plan (see *How the plan
   becomes the route the boat runs*, above); **completion** (the Path planning card's End of plan) sets what happens
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

   **Fuel, and the point she must turn for home (2026-10-11).** The block carries two
   more rows. **Fuel** (Battery on an electric hull) is the projected fuel for the rest of
   the mission and what she will have left at its end, or at home when the run ends in an
   RTH: each leg at the speed the plan flies it (survey, turn, transit), its time over the
   ground in the set now running, its burn at the speed through the water, by the hull's
   own burn law, the one the simulator burns by. **RTH point** is the level at which she
   must turn for home to arrive with **20% of her tank**: the fuel home from where she is,
   by water at the transit speed, plus that reserve. When the plan would bring her down to
   it, the row says how far ahead ("reached in 3.2 km"). When she reaches it the console
   **alerts** (banner, alerts card, history and the session log's `fuel_rth`) and **shifts
   the mission to RTH**: once per crossing, from the supervising window, and an RTH you
   then change stands. Reached while she cannot be sent (disarmed, E-STOP, the guard's
   in-extremis escape) it is said, and she is sent the frame she can be. The reserve is a
   fraction of the TANK, not of what is aboard, as the Fuel planner and the Transit
   Calculator take it. The DriX's burn is MEASURED (the Fuel planner's laws); BEN's and the
   Z-Boat's are ESTIMATES until there are measurements. A battery's empty, for a mission,
   is its factory low-voltage alarm (the Z-Boat's 23 V, at which the maker says to bring
   her back to shore), not its gauge's 0%, and the Z-Boat's drain is fitted to the maker's
   guide: 90 minutes from full to that alarm at survey speed.

   The water distance home is a field built once per home and chart model in a **Web
   Worker** (`static/js/home_field.js`): the RTH planner is far too slow to ask from every
   point of a mission, and the clearance guard shares the page's thread. It runs a little
   short of the planner's route, which keeps right in channels; the reserve covers that.
   Until it is built, or where it cannot reach her, the rows say **straight line**. In the
   simulator, the chart menu's **Set fuel to the RTH point** puts the tank just below it,
   to rehearse the alert and the shift home (`/api/cmd/energy {level}`, sim only). **While she is
   armed and running it asks first** (2026-10-16): it sat directly under *Clear test contacts*, and
   a click meant for that row during an AIS rehearsal set the fuel and sent her home mid-survey. It
   is set apart by a separator now, and the history names it (it was logged "Unlimited energy off").

   **Home along the passage, not the straight line (2026-10-12).** The field covers only the chart
   box round her, so on a passage, with home tens or hundreds of km off, the monitor measured the
   straight line home: her RTH point too low wherever a headland stands between, and a full tank
   said to reach a home it does not. Now, past the field, when a passage on the plan has home at
   one end and she is near it, her way home is measured **along the passage**, back to it and its
   sections home: the way her RTH goes home along it (the same answer, `passageHome`, as the RTH
   button). Its fuel is summed stretch by stretch, each in the set along its own direction
   (`fuel.js pathEnergy`). The rows, the pill and the alert say "along the passage". The straight
   line is left only where nothing better is known (no passage, she far off it, a ROC's home, home
   at neither end), and it says why. The 50 km in-range test is the straight line still: it is the
   test the automatic RTH is refused by. Live (scratch console, DriX): from the end of section 1
   of a passage offshore of New Castle, "home 19.99 km along the passage" against a 19.25 km
   straight line (the harbor approach's turning points). `tests/fuel_rth.js` 10-10e.

   **The coarse home field: by water past the chart box, passage or none (2026-10-12).** With no
   passage leading home, the distance past the field was still the straight line - an RTH point too
   late wherever land stands between. Now, while she is within the 50 km the monitor sends her home
   in and the field round home does not reach her, the console reads the chart along the way between
   home and her (the corridor read, with each tile's planning grid; tiles already read answer at
   once) and searches outward from home over those grids in the coarse worker, at the coarse
   planner's own costs (~100 m cells, a blocked cell crossed only in home's own 4 km circle, unread
   water never entered, no corner cut, knight's moves so open water is within ~3% of straight). Her
   distance home is then read off it: **"by water (coarse grid)"**. The order is the field round
   home, the coarse grid, the passage, the straight line; the straight line says when the coarse
   grid is being read or why its build failed. It is built in the background, again at once when
   home or her floor moves, and a failed build keeps the field it had and is tried again after a
   minute. Live (scratch console, DriX): off Plum Island with home in Gloucester Harbor, the far side
   of Cape Ann, "home 34.67 km by water (coarse grid)" against a 24.51 km straight line - round the
   Cape, the Annisquam cut shut at her 3.15 m floor; 4 tiles, the search 0.1-0.2 s.
   `static/js/coarse.js` coarseHomeField / coarseHomeDistM, `tests/fuel_rth.js` 10f, 11-11h.

   **Home out of range: an alert at 20%, nothing commanded (2026-10-11, diesel hulls only).** On a
   diesel hull the automatic RTH applies only while home is **in range**: within the 50 km the console
   will route a return, and near enough that a full tank gets her there with the 20% reserve.
   Otherwise (a passage, work from a visiting harbor with home the far end of one, or no home set)
   the second row is labeled **Low fuel** and watches 20% of the tank itself: when she comes down to
   it the console alerts once (banner, alerts card, history, `fuel_rth` with `watch: "alert"`) so you
   can find a port to refuel, and commands nothing; she carries on with what she was doing. The rule
   is decided from where she is, for the monitor and for every step of the card's projection alike. A
   boat alerted out of range that then comes into range already below its RTH point is not sent home
   on top of the port you chose; once refueled, the RTH point applies again. Before this the RTH point
   applied at any range: with home at the far end of a passage it sits near or above a full tank, so
   the console read LOW FUEL at or soon after the start and sent an RTH that it then refused past
   50 km. The chart menu's rehearsal row reads **Set fuel to the low-fuel alert** while home is out
   of range. **A battery-powered hull is not for long-range work** (Andy's call) and keeps the RTH
   point at any range: with home out of its reach the console reads LOW FUEL and sends her home, and
   an RTH past 50 km is refused with "Set Home where she is".

   **A survey broken off for a return home, and Continue (2026-10-11).** When an RTH takes her
   off a survey under way (the fuel RTH above, or your own RTH press) the console records where
   she broke off: the survey, the line, how far along it and which way she was running it, the
   rest of the survey she still had to fly, and the fuel aboard. A paused survey's point is the
   one taken at the press of Pause, not where she has drifted since. The record is banked only
   once she has taken the RTH, and kept with the plan (`mission.breaks`, saved and loaded with
   it), so a page reloaded or a console restarted while she is refueled still has it. Each
   survey keeps its newest; the plan keeps three. The end-of-plan RTH records nothing (nothing
   was left to fly), and neither does an RTH from a hold. **Continue** then appears beside
   **Start**. It routes her from wherever she is to her line **100 m back** from where she broke
   off, on the side she came from and never past the line's start, so the new coverage overlaps
   the old; then she flies the rest of the survey and End of plan. The point and the rest come
   from the record, not the plan, so an edit made meanwhile does not change what she completes.
   A fuel break-off waits until she is **refueled** (her level 2% of the tank above what it was
   when she broke off): until then the button is grayed and its tip says what she has aboard;
   once she is, a **REFUELED** banner says the survey can be continued and the button flashes.
   A vessel that reports no level leaves that to you. Continue asks first, routes the way in
   round the keep-outs, uploads, starts a fresh run and then spends the record. If the way in
   cannot be routed, the point is one the keep-out model would hold her off, the upload or the
   Start does not take, or she was commanded meanwhile, nothing more is sent and the record is
   kept. It is live while she is stopped or holding (at home, after the RTH), not while she is
   under way. With more than one survey broken off, a selector beside it picks which; the **×**
   drops the selected record. This is not the survey table's **Continue S*n* ▶**, which releases
   a held survey. Session log: `survey_break`, `survey_continue`, `survey_break_drop`.
5. **Pause / Stop / E-STOP** — Pause holds the next waypoint; Stop aborts the
   plan; the command E-STOP latches motors to zero and disarms. Link-loss also
   halts commanding automatically and surfaces the boat's own failsafe.

   **Another website cannot command the console.** Every POST must be labeled
   `Content-Type: application/json`, or it is refused `415` in words and logged: a web page
   on any site can make a browser send a form or a `text/plain` body without asking, but it
   must ask before sending JSON, and the console never says yes. The console's own pages
   label every POST JSON. **A stop is never refused:** Stop, Pause and an E-STOP *latch* are
   honored whatever they are labeled (a `curl` without `-H` labels its body a form), and an
   E-STOP body that cannot be read or does not say *off* **latches** — only `"on": false`
   (or `0`) releases, and a release must be JSON. It used to read a garbled E-STOP as a
   release.

   **An E-STOP the vessel does not take still latches the console** — disarmed, idle, the
   flag set — and the note says the vessel did not take it (use the RC transmitter); a
   release the vessel does not take leaves it latched, and says so. The console used to set
   the flag before telling the vessel, so a refused latch left it armed with its run under
   way, and a refused release cleared the flag on a boat nobody had released.

   **None of them leaves a boat station-keeping behind your back.** Stop, E-STOP and a
   disarm end the hold along with the run, and the console's routed way back onto station
   (the re-approach) is accepted only while a run is under way — so nothing can restart a
   boat you have stopped. A station-keeping boat that is paused and resumed goes back to
   keeping station under the run it was on: an in-extremis escape stays an escape, and never
   becomes a run the end-of-plan Return-to-Home chains from. And Start on a plan that has
   already run to its end runs it again from the first waypoint, rather than setting off on
   whatever heading the boat had.

   **A console that has stopped is never shown as a live one.** Every telemetry frame runs the
   clearance guard, the speed governor and the end-of-plan chain, and the console's telemetry loop
   produces the frames - and a failure in either used to be invisible: the page caught and dropped
   every error, and a dead loop left the link dot green over readouts that no longer moved. Now no
   frame for 2 s while the console is streaming reads **TELEMETRY STALE** (the dot red, the pill
   `stale`); a page that fails to process three frames says **CONSOLE FAULT**, naming the error and
   logging it once; and the console's loop survives its own faults and reports them on the state
   (`loop_fault`: the latest error, a count and when it began) as **CONSOLE FAULT** too. A fault
   comes down only after 2 s without a failure, so one that fails on every other frame is a fault,
   not a flicker.

   **A page and a console of different versions say so.** The page and its modules are read from
   disk on every request, but the console's own program only when it starts - so a refresh after an
   update, while the console ran, paired a new page with the old program, and controls quietly did
   nothing. The console now reports the version it started from and the version on disk, and serves
   the page with the version it was read at. A top-bar pill says **RESTART CONSOLE** when the program
   on disk has changed since the console started (or the console is too old to report a version), and
   **RELOAD PAGE** when the console was restarted with a version this page was not loaded from. A
   checkout that only rewrites line endings is not a new version.

   **Pause is a toggle, and it flashes until it is answered.** A held run is a boat
   sitting in the tide with the prop stopped and a hole growing in its coverage, so the
   one control that ends it says so: while paused the button reads **RESUME** and blinks
   (a steady amber under `prefers-reduced-motion` — the state is a safety readout, not
   decoration). Pressing it again resumes; so does Start, which has always been enabled
   while paused, and both go through the same path so the behaviour cannot depend on which
   button you reach for.

   **Resuming closes the hole.** A pause is not a freeze: the boat is set by wind and
   stream while it waits, and picking the plan up from wherever it drifted to would butt
   two runs of coverage together at an angle with a gap between them. So if the pause
   happened on a coverage line, the resume rejoins that line **twelve boat lengths behind
   the point the button was pressed** — 92.5 m on the 7.7 m ASV, 22.8 m on the 1.9 m launch,
   because what a hull needs to settle and to lay down overlap scales with the hull — and
   runs forward through it, so the new coverage overlaps the old before it reaches the gap.
   That is the lead-in's argument answered at a different moment.

   The mark is taken at the **press**, never re-derived (re-reading the position on resume
   would return the drift). The direction to back up in is read off the route, not assumed,
   because backing the wrong way would drive the boat into water never surveyed. Backing
   past the start of the run is clamped to the run. The plan's remainder is **amended**
   rather than re-uploaded — an upload resets the waypoint index and would re-run the survey
   from its first line — and the amendment is made while still paused, before the run is
   released, so the boat never makes way under the old plan. A way back that is not clear
   gives up the *backtrack*, not the resume, and says so.

   **And the run continues at low speed until you release it** — **RELEASE LOW** on the
   guard bar, which stays up for as long as the latch holds (2026-09-28), or any of the three
   role selectors, including selecting `low` yourself. The governor stands down
   meanwhile, so it cannot re-assert the role's speed in the act of carrying the instruction
   out; the Intent card and the clearance chip both say the hold is on. A pause off a
   coverage line — mid-turn, on the approach, between regions — gets the low speed but no
   backtrack, because there is no line to back down.

   **Resume from here** (2026-09-26) picks the survey up at a point *you* choose. While the run
   is paused — and only then — the chart's right-click menu carries **Resume from here**:
   right-click a committed survey line and the click is snapped to the nearest point ON that
   line (within the same 14 pixels *What is this line?* uses), the key beside the row naming
   the line and how far along it the point is. Choosing it routes the vessel to that point
   with the same planner Go-To flies, at the guard's standoff, and then runs the line **in the
   direction the plan runs it**, then the rest of the plan from there — a line still ahead
   skips what lay between, a line already flown is run again from the point. The direction is
   read off the route aboard, never assumed, so a line the route does not run is refused in
   words (a resumed remainder holds only the lines still to fly). The remainder is **amended**
   while still paused, exactly as the pause resume does. **The speed is the governor's, not a
   LOW hold:** the transit to the point is flown at the transit speed and the line at the survey
   speed, as after Upload and Start — the pause resume holds LOW because it backs a drifted
   boat a few meters down her own line, whereas this is a chosen re-entry whose way in can be
   long (on the live check the LOW it first shipped with crawled at 0.85 kn over the ground
   against a 0.76 kn set, seven minutes for 200 m). Select LOW yourself if you want the survey
   slow; a LOW hold you had already set stands. A way in the router cannot find, or a point the
   keep-out model would hold the vessel off, refuses before anything is sent; a boat paused
   **on a hold with nothing banked** (she was holding at a Go-To point) is refused in words,
   because a held plan cannot be amended — a survey the guard holds goes a different way, next;
   and a run that stopped being paused during the routing — an escape, a Resume in another
   tab — sends nothing, because the plan it would amend is no longer the one she is on.

   **Resume from here while the guard holds the survey** (2026-09-27). When the guard has
   stopped a survey it can hand back — for a contact or a charted feature — the row is live
   too, whether or not you pressed Pause: the remainder is **re-uploaded** from the point you
   choose (the plan aboard is the hold point, so there is nothing to amend), the way in is routed
   round the charted keep-outs **and the AIS contacts**, at the standoff, and the governor has the
   throttle. A pause on that hold no longer spends the banked survey. A point on the **near side**
   of the contact she is holding for is refused in words — the line from there runs into her
   and she would only be stopped again — with the time left before the console routes round
   her itself; see the AIS layer above for what it does then. **A frame that starts a motion cannot
   also end it** (2026-09-27): the state the console pushes on the Start of a staged plan describes
   the plan just applied (index zero, not holding), and the end-of-plan chain never fires on the
   frame that moved the run counter — on Andy's console the held resume's Start was answered
   seven milliseconds later by a chained Return-to-Home read off the old hold's 1/1.

   **Route round a contact** (2026-09-27). Right-click the contact herself — running, paused or
   held — and choose *Route round <name>*; on the held bar, *ROUTE ROUND HER NOW*. See the
   AIS layer above; the simulator's *Place a test contact here* is how to rehearse it. The way
   in to any resume's rejoin point is a fly-through target now, not a berth (2026-09-27).

   **Every speed the console commands is checked against the speed the vessel reports**
   (`commandSpeed` / `speedReconcile`): re-sent after a second of disagreement, with a banner
   after three tries. A resume whose LOW is refused does not start - it says so and, off a
   guard hold, puts the boat back on station.

   **The clearance guard has the same resume.** If the guard STOPS a survey rather than the
   operator, the guard's own bar keeps the unflown remainder and offers **RESUME SURVEY AT
   LOW SPEED**, which goes back down the line exactly as this one does - see the clearance
   guard's ladder above. Pause is the operator's hole; that one is the console's.

   **And after an AIS contact, the console resumes it itself** (2026-09-25). A survey stopped
   or steered clear for a contact comes back on its own once the contact is clear of the line,
   100 m back down it over water already run — see the AIS layer above. The operator's
   RESUME on the bar still works the whole time, and either spends the held remainder.
   Two things every resume needed and now has: **a remainder of a line is that line** — the
   leg from the rejoin point to the line's end used to match no line, so the rest of the
   coverage was flown and timed as a turn — and **the swing onto a line is a turn**: while
   the vessel is steering for a line's end and the hull is not yet on it (the reversal at a
   rejoin point, a hop arriving at an angle), the governor flies the turn speed, not the
   transit speed.

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

**What the console keeps on disk, and the room left.** Nothing is ever deleted. The console
MEASURES - at start and every 30 minutes, on its own thread - what `logs/` and
`charts/` occupy on the drive and what they hold (on a drive with large allocation units,
thousands of small chart tiles occupy several times their content, and the on-disk figure is
the one a folder's Properties shows as "size on disk"), how much of `logs/` is older than 30
days, and the room left on the drive the plan, the session log and the chart cache are written
to. It prints one `[storage]` line at start, and again only when a drive goes low or recovers,
and publishes the measurement as `storage` in `/api/state`. With under 2 GB free on a drive it
writes to, the page raises **⚠ DISK SPACE LOW** once - the room left, the drive, what writes
there, and what the two folders occupy - and keeps a **⚠ DISK LOW** pill on the top bar for as
long as it lasts (hover it for the whole warning; the banner slot is shared, and the next
banner can take it within seconds). The session log records `storage_low` / `storage_ok`. A
folder that is a link or junction is measured and named by the drive it leads to
(`tests/storage_watch.py`, `tests/storage_banner.js`).

**Old recordings are compressed, and that is the only retention there is.** On the same thread,
a session recording older than 30 days is gzipped in place: `asv_<ts>.jsonl` becomes
`asv_<ts>.jsonl.gz` and keeps its own date. Measured on a real `logs/`: 118 recordings, 309.6 MB
to 8.9 MB, about 35x. **It is still the same record, and it still opens the same way** -
`/api/logs` lists it under its own name at the size of the RECORD, the playback view picks it and
plays it with no idea it was ever compressed, and outside the console any gzip tool reads it
(`gzip -d`, 7-Zip, `gzip.open` in Python). The original is removed ONLY after the compressed copy
has been written, read back and compared byte for byte; a failure at any step leaves the
recording exactly as it was and says so on stderr. The recording being written now is never
touched, nor is anything in `logs/` that is not a session recording. A pass compresses at least
one recording and then stops after 30 seconds, carrying on at the next check, and prints and logs
what it did (`logs_compressed`). **`--no-log-compress`** turns it off - and the readouts then say
so, rather than claiming a policy the console no longer has. **The chart cache is not capped**:
it is what lets an area already seen plan with the network down (`tests/log_compress.py`).

**`--state-dir DIR`** keeps this console's own state - the plan (`mission.json` and its backups),
`comms_config.json`, `ports.json`, `roc_config.json` and `logs/` - in DIR instead of beside the
program. Every test that starts a console passes a temp folder this way
(`tests/lib/console_state.py`), so running the suites or committing never writes your own plan,
settings or logs; `tests/state_dir.py` fails if a suite starts a console without one, and if a
suite leaves a temp folder behind - a crash included. A suite that ends in `os._exit` removes its
folders by hand: `os._exit` skips `atexit`, so a cleanup registered there never ran
(`tests/speed_knots.py` had left one folder in your temp folder per run).

**`--mission PATH`** keeps this console's **plan** at PATH instead of `mission.json` - its
`.bak1..5` history beside it - and everything else where it would be. It wins over `--state-dir`
for the plan alone, as `--ports-config` and `--roc-config` do for theirs, so a second console can
run a copy of a plan, or a rehearsal a fixture, without touching yours; a PATH whose folder does not
exist yet is given the folder (`tests/state_dir.py` 4-4c).

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

**And how old it is.** The water level, the weather and the surface current each carry their
**age**. The WATER LVL row reads `+0.19 m · 11 min`, timed from the station's own observation
(a live level is normally 5–17 minutes old); the wind row gives the age of its oldest buoy
report — a buoy whose last report is over 2 hours old is left out of the blend while a fresher
one is in reach (when none is, they are all used and the note says so), and the buoys are polled
every 10 minutes; and the current, which is recomputed every minute, shows an age once it is more than
5 minutes old. A water level **older than 25 minutes is not applied to charted depths** — it is
shown ghosted with its age, and routing falls back to chart datum, as for a remote one. The
monitors behind these readings no longer stop on an error: a failed update is named in the
row's tooltip and the last reading stands, aging, until a new one arrives. And when no current
forecast can be had, the row says why (the port's model does not cover this position, say)
rather than "no cycle cached yet".

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
| **Quick Start** | first-time users | Running it, a first commanded behavior, a first survey — about twenty minutes |
| **Operations Manual** | operators | Safety model, the display, chart awareness, every behavior, planning depth, contingencies, checklists, glossary |
| **Technical Manual** | engineers | Architecture, the vessel-configuration system, subsystems, the HTTP API, formats, constants, extension recipes |
| **Development Guide** | contributors | How the project is built and verified: testing philosophy and its failure modes, recurring defect shapes, worked case studies, extension recipes |

All four are **generated** from scripts in `tools/`, sharing one formatting module
(`tools/docx_kit.js`). **Never hand-edit a document** — edit its script and rebuild:

```
cd tools && npm install && node build_docs.js
```

Each generator is standalone (`build_quickstart.js`, `build_ops_manual.js`,
`build_tech_manual.js`, `build_dev_guide.js`) if you only want to rebuild one.

Then, from the repository root, check what was built:

```
python tests/docs_valid.py
node tests/spelling.js
python tests/sanitization.py
```

**Review reports** are dated Markdown files beside the set - `docs/review-2026-10-16.md` is the
2026-10-16 bug and reliability review, `docs/review-2026-10-18.md` the 2026-10-18 review of the updates
since it - each with a Word rendering made from it:

```
node tools/review_to_docx.js docs/review-2026-10-16.md
```

The Markdown is the source; edit it and rerun, never the `.docx`. `docs_valid.py` checks the four
manuals by name (`asv-simulator-*.docx`); `sanitization.py` reads a report's `.docx` with the rest.

`docs_valid.py` asks whether each document will open — every part well-formed and
declared, every relationship resolving — and whether its content reached it;
`spelling.js` holds the builders to American spelling, the only place a spelling fix
survives the next rebuild; `sanitization.py` keeps the vendor's name out of the code,
the builders and the generated documents. **No PDF is made**, and none is needed to
confirm a change: the rebuilt text reads straight out of the `.docx` (python-docx).

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
node tests/berth_grant.js
```

The **launch grant** — leaving a berth, and the only place in this console where the
clearance ladder is deliberately given less authority than it has everywhere else. A boat a
person has just placed alongside a pier is in extremis *by construction*: the look-ahead
returns zero time-to-entry from inside a buffer before any threshold is consulted, so the
ladder reaches its steering rung with no number weighed and answers a boat lying safely at a
dock by commanding an escape at the hull's highest speed out of a slip. There is nothing to
tune, because nothing was read. What changes instead is the keep-out **model** the ladder is
asked about: the console records the launch as one point at the one instant it can be sure of
it, works out at plan time the way *out* of it along the planner's own route, and while the
boat is on that checked way out it assesses against a model with the launched-against features
removed. `static/js/guard.js` is not modified at all, and check 1 asserts that rather than
claiming it. Four things must hold together for a single frame's suppression — the feature
must be one of those that makes the launch uncertifiable *and* of a kind a person on a float
could have certified (a wreck, a channel buoy, a dredged area and a restricted area never
qualify, and the operator cannot name them either); the boat must be inside the corridor,
whose half-width is the hull's own scale and deliberately carries no reference to the
operator's buffer; the grant must not have ended; and the depth half needs the vessel
reporting its slowest speed, with a missing key failing closed. Giving ground ends it
outright, with a give that scales to the water she has actually made — a flat five metres
could never arm at the berth this was measured on, which had under a metre. Running out of
time, or making no ground at all, does something different and the difference is the design:
she is **stopped** and the standing-down **continues**, because the console does not steer a
boat off a berth a person deliberately put her on. Only the ends that genuinely restore the
ladder hold its steering rung for twenty announced seconds first, with a live count and two
opposite answers to it. Throughout, the clearance the operator reads, the alarm, the escape
search and the one clear-water figure the vessel acts on without further check are all on the
**true** model and are never inflated.

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
the turn shape is chosen from the **active vessel's** minimum turn radius. It also guards
the **junction seam**: a routed inter-line transit whose first waypoint folds back against
the line end in less water than any hull can turn in (a reversal knot — the boat orbits
trying to capture it) is pruned where the transit is built, kept when an obstacle genuinely
forces it, and reported to the operator rather than shipped silently.

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
of which look like zero keep-outs — never read as the same thing. The seabed's gaps are
counted from the model (so a gap the structures toggle has switched off isn't claimed). A
refused check warns, and an extract replaced by another fetch while the check waits is
not the one the model is built from. A box wider than the server will extract is not asked for, so the
model of the water already read survives it, and an extract the server refused is named in
the server's own words.

```
node tests/chart_box.js
```

**Chart box** — that a route is judged against the box the chart was read over (every point at
least 100 m inside every edge) and refused when it is not, with no route left in the refusal
for a caller to fly by mistake. On a miniature world, a wall of land the small extract only
half holds, the router shown that half goes round the wrong end, through land it was never
shown; the page's own loop reads the chart over that route and plans the right way round.
It also checks that a read too wide for the server is never asked for, that a command whose
own target cannot be read is refused without planning, that a read which fails leaves the model
up, that the hold disc stays inside the water read, and that every command path plans through
the loop and refuses before it draws or sends anything. (The Transit's, the Upload's and the
end-of-plan RTH's refusals are driven in `command_result.js` and `pause_resume.js`.)

```
node tests/skin_gaps.js
```

**Seabed gaps** — that a hole in one depth area is a gap, and so is a gap *between* two
of them that neither has as a hole (the Z-shaped float's own topology). It also checks
that a hole filled by land, a dredged area, an unsurveyed area or a floating dock is not
a gap, whatever way the rings are wound. A pier drawn over a hole does not fill it. A hole
reaching outside the extract is not judged, and a partial extract is refused. Gaps
touching at one corner stay separate from every starting vertex. A gap becomes a keep-out
with its own kind and follows the structures toggle.

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
refresh, and follow a plan edited on the Waypoints tab).

```
node tests/survey_lead.js
```

**Lead-in / lead-out** — the seam the extension opens: that a lead is *distance or
duration* and a duration converts at the **survey** speed and no other; that it is clipped
against the chart like any other flown water, comes back short rather than crossing a
keep-out, and only counts the stretch reachable along the line; that it is applied after
the minimum-line and strike filters and before the turns; and that a lead is never counted
as coverage — the line lengths, the card's line length and the `surveying` flag all still
mean coverage, while the speed role stays `survey` across both boundaries. The seam is
driven end to end in `survey_transit_roles.js` (15–15e) and at the strike midpoint in
`strike_run.js` (24b–24e).

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
known ranges, so it tests the console rather than today's real traffic. And that a console
started with no radius flag opens at the shipped 5 nm (9.26 km), which the card's field
shows as 5, and that a blank field goes back to that default. And that a passage's floor
(`floor_km`) widens the range for the poll that asks, never moving the setting.

```
node tests/speed_zones.js
python tests/speed_zone_sources.py
```

**Speed zones**: that the chart's own speed text is read (the right whale areas' 10 kn for
65 ft and over in each of NOAA's spellings, a "5 knot speed limit", the Kittery regulated area
by its citation), that a zone binds a hull only by its length rule, that it allows the fastest
speed at or under its limit and the slowest for a rule with no number, and that the real speed
governor lowers to it before the zone, holds it until she is clear by her length, gives her
commanded speed back, never raises her, and stands aside for the guard. And that each state's
records are read as its law says (Florida, North Carolina, Maryland, DC), paged, cached, served
stale when a service is down and merged into the chart without ever failing it. And New
Hampshire's and Maine's shore rules. Each holds at its own distance, in its own state's water
only: New Hampshire's counts docks and Maine's does not. The Piscataqua's federal channel is
exempt only between R2 and R12; shallow side channels, a channel 5 km off the buoys' line and one
1 km past R12 are not. New Hampshire's bridges are zones. Massachusetts': 150 ft of each kind of
marina, launch and float as the chart publishes them, and not of a pier, a ferry terminal or an
uncategorized shoreline construction; inside a marina's own area; headway in every channel in
its water, not in one named as an anchorage, not in a channel's hole; its bridges; headway at
6 mph at most. Where a state line is unread, that state's rules apply in its box, never in water
another state's line was read for. The shore index matches brute force. A zone she is
slowing for stays held as her slowing shortens the lead; that last one was found live, where the
page said "Clear of speed zone" of water she had not reached. The governor is driven past an
island and through a channel. And the state boundaries are clipped to the chart, cached a
month, named unread when never read, and asked for only where each state's box reaches.

```
node tests/ui_split.js
```

**UI split** — that every selector the two-window bridge names still resolves against the
page (a stale one fails silently: a panel just stops mirroring), and that the vessel-status
card stays on the chart window — not mirrored into the controls window, and not stripped
from the chart either.

```
node tests/survey_blocks.js
```

**Surveys in the plan** — that a plan saved before surveys were kept loads as one survey, S1;
that a sound plan is kept as it is, and one whose grouping does not hold is run as one survey
with the reason given; that Add to plan makes each pattern a survey numbered one past the
highest the plan holds, never a number handed out before, and tags exactly what it put in the
plan; and that dragging a waypoint keeps its survey and its turn flag.

```
node tests/ink_reads.js
```

**Chart reads kept and merged** — that a pier two chart reads both found counts once, and one
only a coarse read found is kept; that water already read is recognized; that a plan too big
for one read is cut into boxes that each fit and between them hold the whole route; and that
an Upload reads its box (or its transits leg by leg) and then each survey's own water, while a
Go-To reads its one box as before.

A pre-commit hook runs all of them automatically whenever anything but Markdown is staged, and
blocks the commit if an invariant regresses. It used to run only for a list of covered paths, and
that list had drifted: a commit touching only `currents.py`, a vessel file or `ports.default.json`
ran nothing - so now only Markdown and git's own metadata files skip it. A suite that hangs is
stopped after 10 minutes and blocks the commit as timed out, every suite has its own line of
failure advice, and the suites that read a console's output count a real exception - a traceback,
or a route that raised - rather than any line that happens to contain "Error". The hook is
versioned in `.githooks/`; **enable it once per clone**:

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
