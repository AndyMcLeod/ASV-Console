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
round its hold point, so a boat set off station re-approaches direct only inside that
water and is routed back beyond it).

Run it, a
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
the API (`POST /api/env`). A **wind rose** sits on the chart itself — a graduated
compass ring with the wind needle and the speed and from-direction at its centre,
drawn with a transparent background (no card, no chip) and **draggable anywhere on
the chart**; it remembers where you put it and is clamped back into view if the
window shrinks.

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
  coverage line, and nothing else does.** The approach out of the harbour, every reversal
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

**And the recording goes quiet when there is nothing to record.** In the simulator, once the
boat has been home and idle for ten minutes (holding or stopped within 25 m of the home point),
the routine stream — state, telemetry, the page's activity and health rows — stops,
with one `log_quiet` record saying so; commands and lifecycle events still land. Planning a
mission (a plan saved with lines, or uploaded) or commanding the boat (Start, Go-To, RTH,
Transit) writes `log_resume` and the stream is back. The simulation itself keeps running and
the console stays ready; it is the file the rule is about. A real vessel's record never
pauses. `/api/state` carries `log_quiet`; `--log-quiet-s` shortens the wait for a harness
(`tests/log_quiet.py`).

**Intent — what, why, and what next.** The bottom section of the **Mission Status** card,
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
  survey (7.0)`); the **role** that value is for and why (`SURVEY — on coverage line 7 of
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
showing an empty section.

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

**Surface current** (Mission Status card, `Current` row). The console also reads the surface
current **forecast at the boat's own position**, from a NOAA **Operational Forecast
System** — `dbofs` (Delaware Bay) by default, `--currents-ofs` for a hull working
elsewhere. Set is **where the water goes**, degrees true. Unlike the wind rows this is
**not** simulator-only: a real hull sits in real water, and while the simulator invents
the wind, nobody invents the tide. It is a *model prediction*, not a measurement, and a
different question from the **Set / crab** row above it — that is the leeway the boat is
actually fighting. Every way it can fail to be a live reading is stated rather than
dressed up as a number: no cycle cached yet, no model water at that position, or a value
**projected by whole tidal cycles** because no forecast frame covers now (marked `~`,
and refused outright past three cycles). The model fetch runs on a background thread, so
a multi-megabyte download never sits on a request. `GET /api/currents` (`?force=1` to
kick a refresh) serves the same reading headlessly. The **chart's wind rose carries it
too**: a single-headed **sea-blue arrow** riding the ring, pointing where the water goes,
with `set N.NN kn DDD°` beneath the wind's reading. It is a different *shape* from the
wind needle on purpose — wind is named by where it blows **from**, a current's set is
where it **goes**, and two needles differing only in colour is exactly how one gets read
as the other. A projected (estimated) current draws **hollow** and keeps its `~`.

## Run

```
python asv_console.py --sim            # simulator, opens a browser tab
python asv_console.py --sim --browser none --port 8791   # headless, no auto-open
python asv_console.py --sim --vessel example_usv_4m      # start on a different vessel profile
python asv_console.py --sim --single-window               # one window (no controls window)
python asv_console.py --sim --ais-collect-km 250          # collect a wider AIS area (sparse feed coverage)
```

**Windows: `start_sim.bat`** is the same thing for a double-click, and is what a desktop
shortcut should point at. It finds the project from **its own location**, so the repo can be
moved or cloned anywhere without editing it, and resolves the interpreter through `PATH`
rather than a pinned path (the Microsoft Store build of Python lives under a
version-stamped directory, so naming the executable outright breaks at the next upgrade).
It **forwards any extra arguments** to `asv_console.py`, so one launcher also serves a
variant shortcut — `start_sim.bat --vessel example_usv_4m`, or `--port 8792` for a second
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
powershell -ExecutionPolicy Bypass -File tools\make_shortcut.ps1 -Name "ASV Console (4 m USV)" -Arguments "--vessel example_usv_4m"
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
and restored next session. The **Mission Status card stays on the chart window** — it is
not mirrored, because two copies of one card is a second place to look rather than a
second view; the chart window has the card, the top bar has the quick read, and the
controls window is the toolbar. **Every card on the chart window is resizable** —
drag its bottom-right corner; the size is remembered per card, and only a size you
actually changed is stored, so a card's default can still be improved later. If the controls window is closed the toolbar and panels
return to the main window automatically, and a **⏏ Controls** pill appears on the top
bar to reopen it — so the console is never left without its controls. Pass
`--single-window` to skip the second window. A **third window** opens the NOAA
CO-OPS water-levels page for the station nearest the vessel — the station is
derived from the live GPS fix, not configured, and the depth correction behind it
is an inverse-distance blend of up to 3 stations in range (`--no-tide-window` to
skip it). A **fourth window** does the same for weather — the NDBC page for the
nearest buoy, whose wind and waves drive the sim forcing (`--no-weather-window`).

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

Independently of any window, the console **prints which gauge the correction came from and
what it is made of** whenever the station changes — that correction is applied to charted
depths whether or not a browser is open at all.

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

**What each contact carries.** Beyond position, course and speed, every contact carries
the **particulars AIS itself broadcasts**: ship type, **length and beam**, **destination**,
draught, IMO number, call sign and ETA. None of that needs a second service — message 5
(Class A static and voyage) and messages 19 / 24B (Class B) have carried it all along, and
the console simply had not been keeping it. All of it reads on **hover**, and the **icon is
drawn to the hull's true size** whenever the chart is zoomed in far enough to show it,
anchored on the **GNSS antenna** rather than centred: AIS reports the antenna's offsets
within the hull, and on a 295 m ship with the bridge aft, centring the box would put the
stem 77 m from where it actually is. Zoomed out, where a 300 m ship is seven pixels, it
falls back to the standard glyph.

**CPA and TCPA** — the closest the two vessels will come on present course and speed, and
how long until that happens — are shown for every contact with a track. They are recomputed
from the live kinematics every time they are read, so a **manoeuvre by either vessel is
reflected immediately**; there is no cached figure to go stale. A contact already drawing
away says so rather than showing its past closest approach as though it were ahead, and two
vessels holding station on each other report a range with **no** time rather than an
enormous one divided out of report jitter. CPA is a *prediction* on the assumption that both
hold course — an input to a watch, never a substitute for one, and the console reports it
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
and returned in the next, blinking every 8 s. It is held for one update, dimmed and
saying so on hover, then removed on the second consecutive miss; held, never refreshed,
so stale numbers are never shown as live.

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
50 km** at sea: a triangle pointing along each vessel's course, coloured by ship type
(cargo / tanker / passenger / fishing / tug / …), with the name (or MMSI) beside it
and full details on hover — **and** in an **AIS traffic table** (each vessel by
range / bearing / speed / CPA / TCPA, sorted nearest-first) that opens with the layer and
can be
closed to a chip / reopened at will. The table always carries a **status line naming
the live feed and its coverage** — e.g. *connected · aisstream (global) · no vessels in
50 km yet*, or *connected · digitraffic (Finland/Baltic only)* — so an empty list tells
you whether the service is down, still warming up, genuinely quiet, or simply on a feed
that cannot cover where you are. It is **situational awareness only** — subject to
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
`page_asleep` to the session log — so keep the console out of Edge's sleeping tabs
(Settings → System and performance → "Never put these sites to sleep"). A tab that has only
just come back from a silence of its own cannot take supervision on that report
(`tests/supervisor.py`, `tests/supervisor_page.js`).

**Ask the chart what a line is.** Right-click a line → **What is this line?** and the console
names the layer it belongs to: a committed survey line (yellow, with its number, length and
heading), the uploaded route (green, the only green), the **pattern preview** (cyan, *not in the
plan* — ADD TO PLAN commits it, SURV → RESET clears it), a **red join** in that preview (which two
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
   command bar. The plan persists server-side (`mission.json`). Reads and writes are locked and
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

   **The Lines card (`LINES`).** A per-survey-line table: each line's length, its
   planned time at the plan speed, and the actual time once flown (actuals accrue
   while the survey runs and land in the session log, with the turns timed as their
   own components). **A line is the line you drew**: when Punch Out cuts one around a
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
   **Copy position**. Go-To, Set Home and Spawn are **no longer on the command bar**;
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
   the `DIST` pill. Legs accumulate until cleared; `Esc` peels one layer at a time
   (menu → half-drawn leg → all measurements → the tool), and **dragging still pans**.
   Drawn in **magenta** — S-52's colour for the mariner's own information, and the one
   chart colour this console had not spent — because a measurement is an *annotation*:
   it is never uploaded, saved to the mission, sent to the vessel, or logged.

   **Search patterns.** `SRCH` generates a canned search route (à la CCOM's
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
     never re-orders: a `WPT` click adds a waypoint at the **end**, and SHIFT-deleting a
     committed line removes its two ends but **leaves the turns either side** — so the
     boat still travels that line's track, uncounted. Strike the run off *before* Add to
     plan to have the order, the turns and the transits rebuilt around the gap.
   - *Upload* walks the waypoints in order from where the boat is **now**. The
     **approach** is routed clear of the chart and keeps to the starboard side of any
     channel; every other leg keeps its planned track and gets a detour only if it now
     crosses a keep-out (a survey line that needs one is no longer counted as a line —
     punch again instead). A leg with no way through blocks the upload. The boat then
     runs the waypoints strictly in order, turning onto each next leg within the
     approach radius, and the End of plan setting applies at the last one. While it
     runs, a leg is a **survey line** only when it runs between the two ends of a
     committed line; everything else is timed and speed-set as a turn or a transit.

   **Speed is chosen per job, not once for the plan.** A survey run is three different
   things and they do not want the same speed, so the SURV card carries three: **Survey**
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
   points were deleted in `WPT` (nothing re-checks a committed turn): clear it and draw
   it again. And **a punch the water level throws away** — every tide update does, since
   the runs were cut against the old level — now keeps Add to plan refused until Punch
   Out runs again; it used to leave the *un-punched* pattern to be added in its place,
   lines straight through the piers and no turns at all.

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
   **80 m**, the 4 m example USV **25 m**, the 1.3 m Z-Boat **0**.

   **Lead-in and lead-out (the run is longer than the coverage).** The first stretch of
   a survey line is not usable data: coming out of the reversal the steering is still
   settling onto the track and the IMU is still settling with it. The SURV card takes a
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
   - **slow** — entry predicted, and taking the way off would avoid it. Buy time.
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
   And it is **the coverage lines only**: turns reach outboard past the line ends and
   transits go where the router sends them, and both still answer to the plain buffer. A
   plan clipped this way cannot have the helm rung fire *on a line* in that set; it can
   still fire in a turn, on a transit, or if the set rises afterwards.

   **Except where stopping is not a different state.** A boat with no way on — station-keeping
   at the end of a run, engines stopped, being set down onto a pier — has a drift track that
   *is* its ground track, so "take the way off" is not insufficient, it is what she is already
   doing. That case skips both questions and goes to the helm exactly as it always did.

   **And the banner says what was measured.** It used to read *"IN EXTREMIS — being set onto
   a dock / pier"*, which the console had never established: it measures that the drift-only
   projection reaches the feature, never how much of the set is closing it. A set 98.9%
   *parallel* to a pier, closing it at 0.02 kn, produced exactly that sentence. It now quotes
   the projection — and calls it the drift rather than a current, because `current.ok` was
   false at every port in the record and what moves the boat there is the wind and wave
   forcing.

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

   **The guard's own bar, and the two ways past it.** While the guard is intervening, the
   rung, the reason, the clearance and the operator's way through it all sit in one box on
   the chart — a sentence that scrolls past, with the control it refers to somewhere else on
   the page, is how a survey ends up power-cycled. It offers two answers, and only at the
   two rungs that actually impede the boat:

   - **CONTINUE AT LOW SPEED** — keep surveying, slowly. The console stops *stopping* the
     boat for this situation and holds it at the low speed until you change the speed
     yourself.
   - **PROCEED — I have assessed it** — the same, at the speed the run's role calls for.

   Neither one switches the guard off. Both keep the alarm, the clearance readout, the
   deviations where there is water, and the helm in extremis; both are recorded in the
   session log as an operator override; and both lapse on their own three ways — the episode
   ends, it goes in extremis (*"keep going"* was never an answer to *"the water is carrying
   you in"*), or the water gets materially worse than the water you looked at.

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
   low speed until you change it.

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

   **Turn water.** The keep-out set the turns answer to is *stricter* than the one
   transits use: charted channel polygons (dredged areas + buoy-gate fairway
   corridors) that none of the clipped survey lines occupy are keep-outs for the
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

   **Entering a new area downloads *every* published layer.** The extract used to fetch
   only the ~45 classes the keep-out roles named, and that was the wrong trade: a cache
   cannot know what it doesn't contain, so a role added later was invisible to every area
   already cached. The extract now holds all 203 layers the harbour band publishes — the
   named ones role-tagged as before, the rest carried as `extra` — which makes
   classifying a new class a decision about data already on disk rather than a refetch of
   every operating area. `extra` is chart *context* and reaches the keep-out model as
   nothing; `tests/enc_roles.js` check 7 is what keeps it that way, since a harbour where
   those 1,556 features became obstacles would be one solid keep-out. Pre-warm the cache
   for every port in the registry with:

   ```bash
   python tools/warm_enc.py
   ```

   It reports **per role, not just a total**, and that is deliberate: ENCDirect reports
   failure as a normal-looking *empty* layer, so a bare feature count cannot tell a quiet
   harbour from a fetch that half-failed. A coastal extract with soundings but no
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

   The vessel-status card's **Nogo** row names which of four things is true, because they
   are not interchangeable: *reading chart… 6 s* (with the seconds climbing, so a chart
   service that has stopped answering doesn't look like a slow first fetch), *334 zones ·
   floor 2.3 m* (the depth floor is **this vessel's** — draft + under-keel clearance — and
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

   > offset to **starboard of the channel centreline**, half way out to the edge on
   > that side — a **quarter of the channel width in from the edge**.

   So the **centreline always stays to port**. Outbound that puts the green marks to
   starboard; inbound it puts the red ones there ("red right returning") — but
   **colour is never an input to the calculation**. It falls out, because lateral
   marks sit on fixed sides. Which side is "starboard" comes from the **direction of
   travel**, so the two directions ride opposite halves of the same channel and
   opposing traffic passes **port-to-port**.

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

   **What defines the channel geometrically.** Two sources, one rule:

   * **Marked channels** — each port-hand buoy is paired with its nearest
     starboard-hand buoy; the pair midpoints, in number order, are the centreline,
     and half the pair spacing is the local half-width. The console picks the
     channel by the **longest stretch of the routed path that actually runs along
     it**, so a channel merely passed nearby is ignored.
   * **Unmarked, channel-like water** — a basin exit, a canal, a cut between banks.
     The centreline comes from **the water's own edges**: the console looks out both
     sides and takes the middle of what it finds. This engages **only where both
     edges answer** within the vessel's channel reach — genuinely confined water.
     Open water and a single bank nearby are left alone, so a plain open-water Go-To
     is never bent toward a channel that isn't there. The reach is buffer-scaled, and
     `planning.channel_reach_m` may **widen** it for a big boat in a wide fairway; it
     is a maximum, never a substitute, so an override *below* the buffer-scaled
     default cannot narrow the search.

   **Where the lane lets go.** A channel does not end at its last buoy, and neither
   may the lane — releasing at the final mark cuts back across the fairway exactly
   where converging traffic expects the vessel to stand on. So the centreline is
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
   And every shipped route is **flyable**: a splice seam can fold a reversal a few
   metres long — a turn no hull can make, which a vessel answers by orbiting the
   waypoint — so the producer prunes any such fold whose neighbours connect clear.
   The clear-water condition means a corner that exists to dodge an obstacle stays.
   The console never plans a leg it has not verified. Survey coverage lines and
   teardrop turns are never offset (planned geometry). The track is resampled at a
   fixed spacing and lightly smoothed, and generated Go-To / RTH / Transit waypoints
   draw as unlabelled diamonds.

   **The banner says how much of the route was laned, not just that some of it was.**
   Only one buoy system is laned per leg, so a route down two successive channels
   rides the second on its centreline rather than to starboard of it. A plan whose
   lane was interrupted — a second channel left un-laned, or a stretch handed back to
   the router — reports **PARTIAL** rather than a clean Rule 9 transit. A banner
   claiming keep-right over a route that is not keeping right is worse than no
   banner: it is a claim you would otherwise have checked yourself.

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
4. **Upload → Start** — push the plan to the boat, then start the run. An upload never
   changes what the boat is doing: under way on a plan it is refused (Hold or Stop first);
   station-keeping or paused, the plan is **staged** and the boat carries on until Start. With no
   position fix Upload refuses; with the chart model not loaded it asks first (in the simulator
   too) and keeps an UNROUTED banner up. A plan goes whole or not at all: one whose routed path
   is longer than the console's waypoint limit is blocked before anything is sent, and the
   banner gives both numbers (the console used to keep the first 1000 waypoints and drop the
   rest). The transit is
   routed clear of obstacles at Upload, which never re-orders the plan (see *How the plan
   becomes the route the boat runs*, above); **completion** (command bar) sets what happens
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

   **And the run continues at low speed until you change it** (any of the three role
   selectors releases it, including selecting `low` yourself). The governor stands down
   meanwhile, so it cannot re-assert the role's speed in the act of carrying the instruction
   out; the Intent card and the clearance chip both say the hold is on. A pause off a
   coverage line — mid-turn, on the approach, between regions — gets the low speed but no
   backtrack, because there is no line to back down.

   **Every speed the console commands is checked against the speed the vessel reports**
   (`commandSpeed` / `speedReconcile`): re-sent after a second of disagreement, with a banner
   after three tries. A resume whose LOW is refused does not start - it says so and, off a
   guard hold, puts the boat back on station.

   **The clearance guard has the same resume.** If the guard STOPS a survey rather than the
   operator, the guard's own bar keeps the unflown remainder and offers **RESUME SURVEY AT
   LOW SPEED**, which goes back down the line exactly as this one does - see the clearance
   guard's ladder above. Pause is the operator's hole; that one is the console's.

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
settings or logs; `tests/state_dir.py` fails if a suite starts a console without one.

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
known ranges, so it tests the console rather than today's real traffic.

```
node tests/ui_split.js
```

**UI split** — that every selector the two-window bridge names still resolves against the
page (a stale one fails silently: a panel just stops mirroring), and that the vessel-status
card stays on the chart window — not mirrored into the controls window, and not stripped
from the chart either.

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
