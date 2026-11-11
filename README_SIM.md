# ASV Simulator Console — Simulation Mode

Full description and operating instructions for **sim mode** (`--sim`) — the
built-in, hardware-free way to run, learn, and validate the entire console.

Sim mode is the console's default development and rehearsal environment. It drives
the **complete** UI and command flow — chart, survey planning, arming, upload,
run control, live telemetry, battery, autonomy state, comms card — from a software
model of the boat, so **no ASV, no radio, and no reverse-engineered VCU
protocol are required**. It is faithful where it can be (the run-control state
machine and safety gates are the *same code paths* the real link will use) and
honest where it can't (it is a plausible model, not the real vehicle).

---

## 1. Quick start

```bash
cd D:\Claude\ASV
python asv_console.py --sim
```

- Opens the console in Edge at **http://localhost:8791/** and auto-connects the
  simulator. (`--browser chrome` / `--browser none` to change or suppress this.)
- A **Quick Start** card appears on first launch (reopen any time with the `?`
  button). Nothing is required but Python 3 standard library — no `pip install`.
- The console always comes up **SAFE** (disarmed): telemetry flows immediately,
  but nothing is commanded until you explicitly arm.

Headless (no browser, e.g. for API/testing):

```bash
python asv_console.py --sim --browser none --port 8791
```

---

## 2. What the simulator models (`SimVcu`)

A model of the ASV + Autonomous Control Module good enough to exercise every
screen and command:

Every hull-specific number (speeds, turn rate, look-ahead, windage, energy, planning
defaults) comes from the active vessel profile, `vessels/<id>.json`; the default is the
**DriX H-8 with the EM712 gondola**. The figures quoted in the table below are the
**Z-Boat 1800 HS**'s (`zboat_1800hs`, ~1.9 m × 0.75 m, battery), unless a row says otherwise.

| Aspect | Behavior |
|---|---|
| **Position** | Starts at **≈42.1371 N, −80.0874 W** (Presque Isle Bay, Erie PA — operator-set launch point), heading 090°. Integrates lat/lon along heading at the current speed. |
| **Waypoint autonomy** | **Line-following** (look-ahead LOS ~3 m): the boat tracks the survey/transit line between waypoints (pulling out cross-track error) rather than steering point-to-point, turn rate ≤ **60°/s** (nimble small boat). It advances onto the next leg when it passes the waypoint along-track or comes within the **approach radius** (GUI "Appr m", default ~1 m) — following the line to ~1 m of each turn; applies live to a running sim. Ends per the plan's **completion** mode (stop / loiter / repeat). |
| **Completion / behaviors** | Station-keeps (holds) at the end of a Go-To / RTH / Hold / Transit / Loiter run; loops on Repeat. On **RTH** (the default) the sim HOLDS at the last waypoint and the console chains the real ENC-routed Return-to-Home — so with no console attached the boat stays safely on station instead of running home on an unrouted straight line. |
| **Speed** | Target set by the plan's speed key — **Low 1.5 kn / Survey 3.0 kn / High 6.0 kn** (manual: survey ≈ 2.8–3.5 kn). Accelerates/decelerates smoothly (≤ 1.5 kn/s) — except a commanded CUT on a hull with a measured slow-down (the DriX's `maneuvering.slowdown`), which is flown in gear: a 3.3 s dead time, then a decay toward her 3.65 kn idle (7 → 4 kn in ~43 m / 15.5 s), the same step the console's corner walk takes (`speed_step_kn` / coast.js `speedStep`). A stop stays on the ramp. |
| **Arrival radius** | From the plan, clamped 1–50 m (default **2 m**, ~1 boat length). |
| **Environment** | **Real wind + sea state push the boat off course** (see §2a) — a steady crab plus a gust-driven wander the line-follower steers out. Pitch/roll are driven by the real sea. |
| **Battery** | Starts **26.5 V**, drains continuously — light at idle, heavier under thrust (up to ~High-speed rate). Feeds the battery gauge + alarm banding (see §5). |
| **Telemetry rate** | The Engine ticks the link at **4 Hz** and pushes state to the browser over SSE (`/events`). |

The simulator reacts to `upload / start / pause / stop / estop` exactly as the
real run-control flow will, so what you rehearse in sim is the real procedure.

### 2a. Environmental simulator (sim only)

On the first GPS fix the console locates **real-time weather** near the vessel —
the nearest **NOAA NDBC buoys** — and interpolates their **wind** (speed/direction)
and **sea state** (significant wave height / period / direction) to the boat
(inverse-distance weighted; refetched every 20 min / on a large move). When no buoy
reports waves (e.g. winter, when Great Lakes buoys are pulled) it **estimates the
sea from the wind**; offline it goes calm.

`SimVcu` turns that into forces on the boat:

- **Wind** acts on the boat's projected **windage silhouette** — the effective
  cross-section it presents to the *apparent* wind (max broadside, min bow/stern-on),
  `F = ½·ρ_air·Cd·A_eff·V_rel²`.
- **Waves** add a mean **drift** (set) in the wave direction plus an oscillatory
  **yaw** at the wave period (the busy-rudder feel in a beam sea).
- Together they produce a steady **leeway** (the boat crabs — heading ≠ course made
  good) and, because the wind is **gusty**, a slowly-varying set the autopilot keeps
  chasing → a **natural slight wander**. The gusts' **size is the buoys' own**: each
  buoy's peak gust (NDBC `GST`) over its mean (`WSPD`) is blended like the wind, and
  the simulated gusts top out at that factor on the mean (up to twice it). Their
  **timing** and the slow **veer** are the sim's own, since a buoy reports only its
  period's peak; with no gust reported the sim uses a default (a peak of 1.33x the
  mean). Until 2026-10-09 every gust was the default. The effect is **moderate and capped**: the
  boat still holds the line in normal conditions and only struggles in genuinely
  rough seas.
- The **water's density** is the water's own (since 2026-10-09; it was fresh water,
  1000 kg/m³, at every port): salinity from a NOAA CO-OPS station within 25 km - or 0
  in the Great Lakes, else an estimated 35 PSU - and temperature from the nearest
  station or weather buoy, by the UNESCO EOS-80 equation. It sets the hull's drag and
  the wave drift; between fresh and salt water the wind-driven drift differs by about
  1%. The card's **Density** row says which parts were measured.
- The line follower rejects the disturbance like a real autopilot: **crab
  feedforward** (it measures its own drift — COG vs heading — and points the bow
  upwind by the drift triangle) plus a slow **cross-track integral trim**. So the
  boat *visibly crabs* but its ground track rides the line itself, not a parallel
  offset of it.

The **SOG** readout is the *true speed over ground* — it includes this set, so it
reads higher than the commanded speed with a following wind, lower into a head wind,
and stays non-zero when the boat is **paused and drifting** with the motors off.

It's **sim only** (a real boat feels the real weather, so `RealVcu` is untouched).
The vessel-status card shows **Wind / Sea / Set·crab**, which is where the effect is
read. There is no ENV card: **disable** the forcing (deterministic clean tracking) or
**manually override** wind/sea for demos and tuning over the API — `POST /api/env`
with `enabled:false`, any of the wind/sea fields, or `auto:true` to restore live buoys.
Note: a *plausible force model, not validated seakeeping*.

---

## 3. The command flow (identical in sim and on real hardware)

The **Engine** owns the authoritative C2 state and enforces the safety gates; the
link (sim or real) only obeys. Order matters:

```
   Arm ──▶ Upload ──▶ Start ──▶ (Pause ⇄ Start) ──▶ Stop / Complete
    │                                                    │
    └────────────── Disarm / E-STOP (any time) ◀─────────┘
```

1. **Arm** — enables commanding. Refused if not connected or if E-STOP is latched.
   On arm, the console reminds you to confirm the RC **Autonomy switch (Sw A)** is
   forward (the real boat only accepts autonomy commands then).
2. **Upload** — sends the current plan (from `mission.json`: waypoints + arrival
   radius + speed + completion) to the VCU, first **routing the transit clear of ENC
   obstacles** (the approach from the boat to the first waypoint, and any transit
   between lines). Requires **armed**, no E-STOP, and ≥ 1 waypoint.
3. **Start** — begins the survey/search run. Requires **armed**, a **plan uploaded**,
   no E-STOP. **Completion** (command bar) sets the end behavior: *RTH* (chain the
   ENC-routed Return-to-Home and station-keep at home — the default), *Complete* (stop),
   *Loiter* (station-keep at the last waypoint), or *Repeat* (loop the route).
   The chain is not a survey feature: a **Go-To** or **Transit** under *RTH* holds at its
   endpoint for a moment and then returns home too. The vessel-status card's **Mission**
   block says so up front — *End mode* reads **RTH** for the whole run, and only reads it
   when the return can actually happen (a home is set, armed, no E-STOP, the run does end,
   and the route home was not refused).
4. **Pause** — holds position, keeps the next waypoint active; **Start** resumes.
5. **Stop** — aborts the run plan (reverts to the first waypoint; re-upload/Start
   to run again).
6. **E-STOP** — latches a command-side motor cut and force-disarms. The UI states
   plainly that this is **not** the true failsafe — the **RC transmitter E-stop /
   Sw A is** (see §6). Release E-STOP to arm again.

**Plan-free behaviors** (armed, no survey plan): **Go-To** (click a point → drive
there + hold), **Transit** (`TRAN`, draw a line → **Follow**), **Hold** (station-keep
here), **Return-to-Home** (drive to home + hold; home auto-set at launch or via **Set
Home**). All are routed clear of the ENC nogo model, or refuse an unreachable target.
When a route is refused, the console **names and highlights the specific
obstruction** on the chart — pulsing the offending feature red and dropping an ✕
marker at the exact blocked spot:

- **Go-To / RTH** — says whether the *target itself* sits in a nogo (e.g. "target
  sits in water shallower than 2.5 m" / "a dock / pier" / "the shoreline" / "a
  restricted area") or the target is clear but *boxed in* (the first crossing along
  the direct path is marked).
- **Survey Upload, Transit Follow, Punch Out** — when one or more legs can't be
  routed clear, each blocked leg is highlighted and the banner names the feature(s)
  it hit (e.g. *"2 transit(s) blocked by land and water shallower than 2.3 m — UPLOAD
  BLOCKED"*), so you can see exactly which obstacle stopped which leg.

Each gate that blocks a command returns a clear reason (HTTP **409** on the API),
e.g. *"ARM before uploading a plan"*, *"add at least one waypoint first"*.

---

## 4. Autonomy & link states

Shown in the top bar and the vessel-status card:

- **safe** — connected but disarmed (default). No commands will actuate.
- **armed** — armed, no run active.
- **auto** — running an autonomous survey / search / transit.
- **hold** — station-keeping (Go-To / RTH / Hold / Transit arrived, or a Loiter run).
- **paused** — paused mid-run.
- **e-stop** — command E-STOP latched.
- **failsafe** — telemetry lost for **12 ticks (~3 s)**; the Engine auto-disarms,
  stops commanding, and surfaces the boat's own failsafe (motors 0, steering
  straight) with *"Take the RC."* — link-loss is always resolved toward safe.

Run states: `idle · running · paused · stopped · complete`.

---

## 5. Energy model (battery or diesel fuel)

The energy model comes from the **active vessel** (`power.type`), and the sim
depletes it live so you can watch the gauge band change on a long run.

**The energy override** (click the BATT/FUEL pill; it turns magenta) reports the
tank as full and stops the sim's drain. It is the console's setting and outlives the
boat it was clicked on: every new sim boat is told (Reset, Spawn here, a vessel or
port switch, a reconnect), so it stays on until the pill is clicked again. While it
is on the low-fuel monitor is off: no RTH point, no LOW FUEL alert, no automatic RTH
(2026-11-10; before that a Reset silently dropped the hold while the gauge still read
full). A stretch recorded under it reads full, with nothing used.

**Battery vessels** (`power.type: "battery"` — `zboat_1800hs`)
report a voltage that sags with load, banded from `power.battery_v`. For
`zboat_1800hs`:

| | Voltage | Meaning |
|---|---|---|
| Full (start) | **26.5 V** | ~26–27 V at rest |
| **Warn / alarm** | **23.0 V** | low-voltage alarm — bring the boat back |
| Critical | 20.0 V | approaching loss of control |
| Empty | 18.0 V | complete failure (steering fails first) |

**Fuel vessels** (`power.type: "fuel"` — both DriX profiles and `ben_cworker4`) report
**fuel % plus live endurance (h) and range (nm)** at the current speed instead of a
voltage. The sim burns from `power.fuel`: `burn ≈ idle + (full − idle)·(v/vmax)^exp` L/h,
with warn/crit reserve bands. The DriX's blocks are the Fuel planner's measured laws
(250 L; 1.05→7.21 L/h, exp 2.77 with the EM2040 gondola; 1.05→5.96 L/h, exp 1.62 with the
EM712), where they used to reproduce Exail's published endurances. Her 24 V lithium service
battery powers hotel/payload loads only and isn't the propulsion energy source, so it isn't
modeled as the endurance limit. BEN's block is her 100 L tank (Andy's figure) and a 5.0 L/h
full-throttle burn derived from it and her 20 h of survey at 5.5 kn; her burn below full
throttle (idle 1.0 L/h, exponent 3) is still a guess.

> **Caveat carried from the manual:** on the real boat, battery voltage is
> telemetered to the **RC transmitter**, and it is not yet confirmed to be on the
> VCU data link. Sim shows a live number so the gauge is exercised; on real
> hardware this reading may instead be *"battery: on RC"* until confirmed.

---

## 6. Full walkthrough — GUI (sim)

1. **Launch:** `python asv_console.py --sim`. The boat appears and starts
   reporting position/heading/speed/battery. State is **SAFE**.
2. **Plan a survey:** click **SURV**, then three points — start corner (A),
   opposite/diagonal corner (B), and a spacing/direction point (C). Parallel lines
   fill the box automatically (boustrophedon). Drag A/B/C to adjust; **Add to plan**.
   *(Or **WPT** to place individual waypoints.)*
3. **Punch Out (optional):** trim the lines to ENC-clear water; each line-to-line
   reversal becomes a smooth turn, and the lines shorten a touch to give it room.
   Every turn is built at a radius the boat can **hold** at the run speed: a plain
   **semicircle** where the spacing is at least twice that radius, otherwise a
   **teardrop** that loops at the boat's own minimum radius and swings further
   outboard. If the spacing forces teardrops the readout and banner say by how much it
   is short, how far the loops reach past the line ends, and what spacing (or speed)
   would restore a semicircle — a big ASV on tight lines is the usual cause. Where not
   even the teardrop fits clear of the keep-outs the reversal falls back to a straight
   hop and the banner flags it as **untrackable**, not merely routed. Turns also may
   not swing into a **navigation channel** the survey lines do not enter (lines drawn
   beside a channel keep their loops out of it; a survey drawn inside a channel keeps
   using it) — a refusal names and outlines the channel and quotes the standoff needed. Turn waypoints
   (reversals + arc) draw **unlabeled** — the line's own `L#` label identifies it —
   and arcs use a coarse (~3 m) point spacing, so a wide survey keeps only a handful
   of waypoints per turn.
4. **Set run params:** arrival radius, the transit speed (whole knots, the hull's own range), and **completion**
   (RTH / Complete / Loiter / Repeat; RTH is the default) in the command bar.
4b. **(Optional) Set a ROC as HOME:** open **ROC**, click **+ Shore** or **+ Ship**,
   then click the chart to place it. Set its recovery offset (range + bearing; a ship's
   is normally *relative* to its course, i.e. astern) and, for a ship, its heading and
   speed. **Confirm** it, then pick its HOME radio. A confirmed ship steams, so HOME
   becomes a **moving** point and Return-to-Home chases it — a mothership recovery,
   exercisable with no hardware. If the ship outruns the ASV the card says so: the
   closing rate is computed against the **active vessel's** top speed.
5. **Arm → Upload → Start.** Upload routes the transit to the survey clear of
   obstacles (green path). Watch the boat drive the survey, the waypoint counter
   advance (`wp x / N`), the track paint, and the battery drain.
6. **Try a behavior:** with the boat Armed, click **Go-To** and pick a point, or
   `TRAN` → draw a line → **Follow**, or **RTH** — each drives clear of the nogo and
   station-keeps at the end. No survey plan needed.
7. **Rehearse safety:** hit **Pause**/**Start**, **Stop**, and **E-STOP**; note how
   the autonomy state and banners respond. Disconnect/reconnect to see the
   **failsafe** link-loss path.

---

## 7. Full walkthrough — headless API (curl)

Every control is a POST; state is readable at `/api/state` (or streamed at
`/events`). Useful for testing without a browser. Assuming `--port 8791`:

```bash
# plan lives in mission.json (waypoints, arrival_radius_m, speed) - set it in the
# GUI, or write it directly. Then:
curl -s -X POST localhost:8791/api/cmd/arm    -H "Content-Type: application/json" -d '{"on":true}'
curl -s -X POST localhost:8791/api/cmd/upload
curl -s -X POST localhost:8791/api/cmd/start
curl -s localhost:8791/api/state | python -m json.tool     # run, autonomy, wp x/N, telemetry
curl -s -X POST localhost:8791/api/cmd/pause
curl -s -X POST localhost:8791/api/cmd/start               # resume
curl -s -X POST localhost:8791/api/cmd/stop
curl -s -X POST localhost:8791/api/cmd/estop  -H "Content-Type: application/json" -d '{"on":true}'
curl -s -X POST localhost:8791/api/cmd/estop  -H "Content-Type: application/json" -d '{"on":false}'
```

Command endpoints: `/api/connect` · `/api/disconnect` · `/api/cmd/arm` ·
`/api/cmd/upload` · `/api/cmd/start` · `/api/cmd/pause` · `/api/cmd/stop` ·
`/api/cmd/estop` · `/api/cmd/rth` · `/api/cmd/goto` · `/api/cmd/transit` ·
`/api/cmd/hold` · `/api/cmd/reapproach` · `/api/cmd/escape` · `/api/cmd/amend` ·
`/api/cmd/sethome` · `/api/cmd/approach`. The behavior commands (`goto`/`rth`/`transit`) accept an ENC-aware
`{route:[…]}` computed by the browser; `upload` accepts one too. **Every holding command
also accepts `hold_clear_m`** — the radius round the hold point the browser certified clear
of the keep-out model. The sim re-approaches DIRECT inside that disc (a chord of a clear
disc is clear); set beyond it, it takes the way off and reports `hold_wants_route`, and the
browser answers with `/api/cmd/reapproach {route, hold_clear_m}` — a routed way back that
keeps the run's behavior. With no `hold_clear_m` at all (no browser, no model) the direct
re-approach stays, as a Go-To with no route drives direct. While holding, `status` carries
`hold` (the point), `off_station_m`, `hold_clear_m` and `hold_wants_route`.

**A hold point needs WORKING MARGIN, not merely to be outside the buffer.** The browser
sizes it from the live set: the water the drift moves the boat through while the guard is
deciding (the ladder's own `HOLD_S` budget), floored at hull scale. A target with less than
that — even one that is technically clear — is moved to the nearest berth that has it, and
where the geometry offers a choice the berth is taken DOWN-SET of the hazard, so residual
drift carries the boat off the structure and the station-keeping correction is made heading
into the set. Measured at Eastport, 2026-09-03: HOME had **1.47 m** of clear water, was not
blocked, was used as it stood, and the boat reached 1.74 m from it at 6.07 kn.

**COMING IN ON THE DRIFT.** A Go-To or Return-to-Home that ends at a berth also carries
**`coast_from_m`** — the range at which to stop the prop and let hull drag plus the set carry
her the rest of the way. The vessel then sheds way under quadratic drag (`v(x) = v0·e^(-x/Lc)`,
one length per hull) instead of the engine's flat ramp, publishes `drifting`, and hands back
to powered control at one knot. Measured on the same berth: powered arrival 4.00 kn / 2,922 J,
drift-in 0.73 kn / 97 J — a **30× cut in the energy that reaches the pier**.

`Lc` comes from a **measurement a mariner can take**, `maneuvering.coast` in the vessel file:
run up to `from_kn` in slack water, stop the prop, and log the distance to `to_kn`. It cannot
be derived from anything else the profiles hold — mass is absent from two of the three hulls
and prose-only in the third, and the leeway constants are lateral (used fore-and-aft they give
the DriX a 1.6 m stopping distance). **A vessel with no coast block does not coast at all**,
which is the shipped default for two of the three. The DriX's is MEASURED (2026-10-03, from her
own Aug 2026 logs: 40.3 m from 6 to 2 kn with the clutch in neutral, Lc 36.7 m) and says so in
its own `source` string. Note that this is the PROP-OUT coast: the AIS guard's slow-down to LOW is
flown in gear and is a different law (`maneuvering.slowdown`, coast.js `slowRun`), and since
2026-10-03 the sim flies it too: a commanded cut on that hull holds her speed for the dead time and
then decays toward her idle speed (`speed_step_kn`), where it used to come down on the engine's ramp
several times faster than the real boat.

**`/api/cmd/amend {route, note}`** DEVIATES A RUNNING PLAN: it replaces the unflown
remainder and keeps everything else — the flown prefix, the waypoint index, the behavior,
the run. It exists because every other commanded motion goes through `upload`, which resets
the index to zero, so the only way to change a running plan was to start it again from
waypoint one — which is why the clearance guard could only ever slow or stop. `wp_total` may
grow: a deviation that splices in a via point really does make the plan one waypoint longer.
Refused, in words, when there is no running plan to amend, when the vessel is
station-keeping, or when the route is malformed. **An amendment ends a drift-in and does not
re-arm it** — the coast runs only where the safety ladder is silent, and a hull with the prop
off cannot take a deviation at all.

**THE LOOK-AHEAD FOLLOWS THE PLAN.** The run-time ladder is now `clear → edge → slow → hold
→ helm`, and its projection walks the ROUTE from the boat's actual position and heading, at
the hull's own turn rate, with the drift added at every step. It used to extrapolate the
present ground velocity in a straight line for up to 45 s — a manoeuvre nobody intends to
make — while every planner here clips or routes to the buffer edge and then TURNS, so a plan
was correct precisely when it grazed the buffer and the guard alarmed 40–60 m before that
same edge. Measured at a pier, 5 m buffer, dead calm, no set at all: a correctly punched
survey line was **stopped with 33 m of its own certified water still to run**, and a routed
Go-To was held **39 m short of its own turn**. A false hold is not a harmless pause — it takes
the way off a hull the tide is already setting, and it destroys the run.

**`edge`** is the new first rung: where an entry is predicted and there is open water
alongside, the console amends the track by the smallest offset that puts the whole projected
path clear, verified by re-projecting it at a buffer LARGER than the one that triggered it
(so one answer holds instead of chattering), into water at least the buffer plus its own
margin. It goes where the trouble is — on a routed detour usually a corner two or three
waypoints ahead — and **the console may move a corner, never a destination**. Its authority
is bounded by `edgeCapM(buf)` = max(3×buffer, 15 m), which is also the per-episode budget.
Measured live at New Castle NH over 1,324 real keep-out zones, at a corner a DriX cannot turn
at: **slow → edge, moving the corner 5.0 m to starboard into 12.4 m of water**; for a hull
that can make the turn, **slow → clear**, nothing commanded at all.

**PROCEED** is the operator's override, on the guard bar. It suppresses exactly the two rungs
that impede the boat — the slow-down and the hold — and nothing else: not the alarm, not the
clearance readout, not a deviation (that IS forward progress), and not the helm. It is one
decision about one situation, recorded in the session log, and it lapses on its own three
ways: when the episode ends, when the clearance falls materially below what the operator
looked at, and the moment the situation goes in extremis.

**`/api/cmd/escape`** is the in-extremis clearance guard's OWN manoeuvre (the helm rung of
the run-time ladder, `static/js/guard.js`) — never the operator's, and structurally distinct
from `goto` for exactly one reason: it sets `behavior` to `"escape"`, not `"goto"`, so its
arrival can never be mistaken for an ordinary commanded run by the end-of-plan RTH chain.
A Go-To-shaped escape used to arrive, hold, and — because the operator's standing End of
Plan setting is untouched by an emergency — immediately re-fire the chained Return-to-Home,
sending the boat straight back toward whatever it had just been steered clear of (measured
live at Eastport, 2026-09-03: escape, chained RTH nine seconds later, a second escape three
seconds after that). Taking the helm is meant to buy the operator's attention: an escape
holds at the point it reaches and waits — nothing chains from it, and the operator
re-commands when ready.
Data: `/api/state` · `/events` (SSE) · `/api/mission` ·
`/api/enc?bbox=…` (ENC features) · `/api/chartinfo?bbox=…` (chart-source metadata:
ENC cells + zone-of-confidence polygons, for the Chart source card) ·
`/api/waterlevel` · `/api/env` (sim wind/sea +
POST override/enable/refresh). A blocked gate returns **409** with the reason.

**Live telemetry (position, heading, SOG/COG, battery, attitude) is nested under
the `status` key of `/api/state`**, alongside the top-level C2 state
(`armed`/`run`/`behavior`/…).

**Vessel profiles:** `GET /api/vessel` returns the active vessel (full parameters
for the UI) plus the `available` list; `GET /api/vessels` returns just the list;
`POST /api/vessel {"id":"…"}` switches the active vessel — allowed only when
disarmed, not e-stopped, and idle (otherwise **409**), and it respawns the sim
boat with the new physics. A vessel switch and a port switch (`POST /api/ports`) are
each the *same* power-cycle as Reset (`Engine.power_cycle`, 2026-11-11): a fresh
`SimVcu` at the spawn, SAFE, no plan or home - Home is re-seeded at her first fix, the
ROC that owned it released and the launch grant dropped. Before, both only reconnected,
and Home stayed where the old boat had it - at the old base, after a port switch.

**Click-to-spawn:** `POST /api/cmd/spawn {"lat":…,"lon":…}` places the sim boat at a
point (**Spawn here** on the chart's right-click menu, at the point the menu was opened
over — there is no longer a toolbar button to arm first). The server
runs the *same* power-cycle as Reset with a spawn override, so a fresh `SimVcu` comes
up there — full energy, SAFE, no plan or home, and a new `boot_id`. **That id is what
drops the trail**, and the browser now tests it on *every* frame rather than once per page
load: the clear lands on the frame reporting the new boot, so a stale fix from the old
link — one arrives ~160 ms after the command, measured — is wiped instead of being joined
to the new position by a line. The boat is never teleported while live; placing it is a re-boot, which is why
a real link refuses it (**409**), as it does for a bad or out-of-range lat/lon. The
active vessel's configured spawn (`vessels/<id>.json` — Erie for `zboat_1800hs`, Lewes
for `drix08`) is untouched and comes back on the next start or vessel switch.

```bash
curl -s localhost:8791/api/vessel | python -m json.tool          # active + available
curl -s -X POST localhost:8791/api/vessel -d '{"id":"ben_cworker4"}'  # switch (must be safe/idle)
```

---

## 8. Command-line flags

| Flag | Default | Purpose |
|---|---|---|
| `--sim` | off | Auto-connect the simulator at start. |
| `--host` | `127.0.0.1` | Web UI bind address. |
| `--port` | `8791` | Web UI port. |
| `--browser` | `edge` | `edge` / `chrome` / `default` / `none`. |
| `--vessel ID` | `drix08` | Active vessel profile from `vessels/<id>.json` (hull/speeds/turn/battery/…). |
| `--vcu HOST` | — | Auto-connect to a **real** VCU (serial-over-IP) instead of sim. |
| `--transport` | `tcp` | `tcp` (serial-over-IP) or `serial` (COM port) for a real VCU. |
| `--vcu-port` | `4001` | Real-VCU port. |
| `--fetch-charts "LAT,LON,RADIUS_KM"` | — | Pre-cache NOAA ENC tiles for offline use, then exit. |
| `--zooms` | `8-16` | Zoom range for `--fetch-charts`. |
| `--no-log` | off | Disable the session recorder (see §9). Recording is on by default. |

---

## 9. Session recording

Every run — sim **or** real — is recorded to `logs/asv_<timestamp>.jsonl`, an
append-only, line-delimited JSON event stream created fresh each server launch.
The built-in **playback** viewer replays it (see `README_PLAYBACK.md`). Since
2026-11-05 the file describes the whole mission, not only its motion and its
commands: which hull, which base, which build, the plan on disk, what the link was
actually given, each run's start and end, the environment, every sensor's targets,
and the 4 Hz frames round a safety event.

Each line is `{"t": epoch, "iso": "...", "kind": "...", ...}`. `iso` is the
console's local time with no offset; the `manifest` record names the zone. Because
it taps the HTTP and Engine layers (not `SimVcu`), the mechanism is identical for
the sim and a real VCU link. It is best-effort — a logging failure never disturbs
the C2 path — and line-buffered, so a crash or hard kill still leaves a complete,
valid file. Every number the console itself writes is finite: a `NaN` line is
one playback cannot read, and it skips it. A command body and a page post are
written as they arrived; a browser never sends a `NaN`, but a hand-made POST can.
`logs/` is gitignored.

**What a session writes.**

| Kind | What it is for | When it is written |
|---|---|---|
| `session_start`, `manifest`, `port`, `vessel`, `mission` | What this session IS. `manifest`: the build fingerprint and git commit (read from `.git` by file, never by running git), Python and the platform, the console's time zone and UTC offset, the mode, every parsed flag (any whose name reads as a secret left out, a URL's user:password removed), where its state lives (relative to the app, `<app>/...`, or to the home folder, `~/...`: no account name in a shared recording), the AIS and current setup, and `prev`, the recording this one continues (the newest other file of THIS console's port that served, read from its tail: did it end cleanly, was a run under way). `port`: the base's entry, where the sim spawns, the current model in force. `vessel`: the profile, a digest of its file, and what the console derived from it (minimum depth, speed steps, wind and hull areas). `mission`: the plan on disk with its revision and digest, or why it could not be read. | Once, right after `session_start`, in that order. `port` and `vessel` again on every switch; `mission` again after every wake. |
| `connect` / `disconnect` / `session_end` | Lifecycle markers that bracket each boat session. | As they happen. |
| `command` | One per POST the console receives (arm, upload, start/pause/stop, E-STOP, goto/hold/rth/transit, amend, re-approach, sethome, approach, connect/disconnect, mission edits, settings) with its input `body` and HTTP outcome `code` (so a rejected **409** gate is recorded too), the tab that sent it (`client`, the first 8 characters of its `X-ASV-Client` header), when it arrived (`rx_t`) and how long it took (`ms`). A body's `password` is masked. The supervisor heartbeat, chart-corridor reads and the page's own event posts are not commands and are not written here. | Every POST. |
| `mission_saved` | A saved plan's new revision and digest, and how many waypoints, lines and surveys it holds. The body is in the command. | After every successful `/api/mission` save. |
| `plan_loaded` | What the link was actually GIVEN: the route (to 6 dp, with its digest; a route over 5,000 points by its digest and length only), the arrival and approach radii, the speed, the completion, the hold disc, staged or not, and the `run_seq` in force when it was loaded (an upload is flown by the next run: Start begins it). It covers the routes the console builds itself, which no command body carries: an upload from the saved plan, a hold at her fix, a direct Go-To or RTH, the escape, an amend's splice. An RTH chase's re-target is `behavior: rth_chase`. | On every upload, route and amend; a chase's re-target at most every 10 s. |
| `run_start` / `run_end` | Each run with a start and an end: `run_id` (`<session>:<run_seq>`), behavior, completion, speed, vessel; at the end the state it reached (or `superseded` by the next commanded motion, or `session_end`), the duration, the distance sailed, the waypoint reached and the energy used. A late frame of an earlier `run_seq` neither ends the run nor opens one again. | When a run begins and when it ends, from the Engine, page or no page. |
| `state` | A full snapshot of what the browser sees over SSE, less the four environment blocks (the `env` stream carries them). | On every salient transition (armed/run/behavior/link/note/wp…) and at least every 10 s. |
| `telemetry` | A slim motion sample: position, heading, COG, SOG, the speed key and target, battery or fuel, holding, laps, the set applied (`env_set_kn` / `env_set_deg` and its source), crab, pitch, roll, distance off station, drifting, and in the sim `forcing` (the wind as applied, the leeway and the stream apart, the sea, the water density). A field the link does not report is left out. | ~1 Hz between snapshots. |
| `env` | The environment: the `env` (wind and sea), `water`, `current` and `density` blocks; each nearby NDBC buoy's own row (wind, gust, sea, pressure, air and water temperature, dew point, visibility, each with its own time); and where the tide and current stations are. Every record carries all four blocks; `changed` names the ones that changed; `full` marks the forced write at start and after a wake. A current recomputed with the same answer writes its block alone (`resampled`) every 60 s, so its age is said again. | On a change of VALUE, looked at no more than once a second. Ages, fetch stamps and page links are not values; a monitor error is. In full at the first snapshot after start and after every wake. |
| `targets` / `track_info` | Every registered target sensor's picture round the boat, written by the console whether or not a page is open. Built in: `ais` (the AIS service's contacts within the display range — a passage's widened range while a chart page polls with it, and for 30 s after — or the whole lake on a Great Lake, plus any test contacts) and `roc` (the ROC set). `targets` carries the sensor's health, the ids it holds sorted by range from the boat (no cap), the rows that changed (`id`, the report time `obs_t`, lat, lon, sog, cog, hdg, nav; a heading not reported is null, never 0) and who is `gone`. `track_info` carries each track's particulars: name, class, feed, size, and the rest of what the sensor serves. A new sensor is one `register_target_sensor` call. | Each sensor every 10 s. A row when a track first appears, when it moves, when its report is 60 s past the last row, and on a keyframe (every 10 minutes, and the first record after start and after every wake). A sensor holding nothing writes on a change and on a 60 s heartbeat. `track_info` on first sight, on a change, and for every track after a wake. |
| `incident` | The 4 Hz frames round a safety event, in one record: `cols` names each frame's fields (time, position, heading, COG, SOG, waypoint, run, autonomy, behavior, set, hold, speed, avoiding), `frames` holds the 60 s before and the 30 s after the last trigger inside it (at most 120 s after the first), `triggers` what fired, and `cut` when the log going quiet closed it early. A trigger is an E-STOP, autonomy going to failsafe or e-stop, a telemetry loop fault, a supervisor stand-down, or one of the page's own events: `avoiding`, `ais_avoid`, `ais_around`, `guard_override`, `guard_low`, `hold_disc`, and a `berth_grant` whose guard took the helm. A trigger inside an open window joins it and extends it. After a wake the first frame seeds the edges: a state that arose while quiet fires nothing. | 30 s after the last trigger (at most 120 s after the first); a window still open at session end, or when the log goes quiet, is written as it stands. |
| `client:<kind>` | What only the page knows, posted to `/api/logevent` and written once, with `_tab` (the posting tab, as `client` above): the nogo readout, History rows, the guard bar's rung and reason (`guard`), the run's activity, the LINES table every 30 s while running and at the run's end (`lines`, `survey_lines`; each row with `done`, the share of its coverage actually run), and page stalls and sleeps (with `role`: the chart window or the controls window). From the SUPERVISING tab only, each on its own change: `model` (the keep-out model's identity: band, box, depth floor, buffer, the enforce toggles, the water level it was built at, its counts), `chart_ink` (the structures read off the chart image, and `folded`: whether the model took them in), `ais_model` (the AIS keep-outs the guard was handed, each ring in lat/lon; each post names every contact held, `ids`, and carries only the contacts that changed — a ring when she joined or her keep-out moved, at most every 10 s — with a keyframe, `key`, of every ring every 10 minutes and at every wake) and `guard_level` (the guard's rung, keyed on the contact by her MMSI, at most twice a second). | On change, or on the slow tick named. |
| `log_quiet` / `log_resume`, `supervisor_*`, `storage_*`, `loop_fault`, `spawn` … | The console's own events. | As they happen. |

**Quiet.** When the sim boat has sat home and idle for 10 minutes, the console
writes `log_quiet` and stops the ROUTINE records — `state`, `telemetry`, `env`,
`targets`, `track_info`, `incident` and the page's `client:*` — until a mission is
planned or saved or the boat is commanded (`log_resume`). The lifecycle records
still land: commands, the session's description, `plan_loaded`, a run's end. A
reader may start at `log_resume`: the next snapshot is full, the environment is
written in full, each sensor's first record is a keyframe with every track's
particulars, the plan on disk is written again, and the page posts what it holds
again. It is the file that stops, never the simulation.

**What is NOT recorded.**

- **A real link's wind, sea and density.** The console has no such feed on a real
  link (those blocks read off), and `forcing` is the sim's alone. The water level
  and the current are recorded in both modes.
- **Raw AIS reports.** The record holds the AIS service's merged picture round the
  boat, asked every 10 s, not the position reports or aisstream's static reports
  themselves. A contact the service holds with no position yet (heard only by a
  static report) is not in it; her particulars are recorded once they reach a
  contact that has one. Only the display range is asked (a passage's widened range while a chart page
  polls with it): a contact beyond it is not recorded.
- **The charted keep-out zones themselves.** `client:model` records the model's
  identity, not its polygons. The chart ink and the AIS keep-out rings are recorded.
- **Anything no page posted.** The page's streams need an open console page, and
  the four model streams the supervising one. With none open there are none.
- **Secrets the console knows by name.** A command body's `password` is masked.
  The AIS key and the feeds' notes are left out of every record. A ROC's GPS
  host and port are left out of the `targets` stream, not out of the file: a
  full `state` snapshot carries the ROC set with its `gps` block, as it always
  has, and the command that attached the feed carries them in its body. The manifest's copy of the flags leaves out any flag whose name
  reads as a secret (a name filter, not a whitelist), and its AIS URL is written
  without its user:password. The command line in `session_start` is redacted by
  the same rule: a secret-named flag's value is `<redacted>`, and a URL's
  user:password is removed. `/api/logs` serves no command line (an older
  recording carries its own raw). A credential under a flag name the filter does
  not catch is still in the file: keep credentials off the command line.

Inspect the latest recording (kinds histogram):

```bash
python -c "import json,collections,glob; f=sorted(glob.glob('logs/*.jsonl'))[-1]; \
c=collections.Counter(json.loads(l)['kind'] for l in open(f,encoding='utf-8')); \
print(f, dict(c))"
```

**Playback.** These recordings are replayed by the built-in **playback viewer** at
**`/playback`** (link in the live console's top bar) — the boat drives her track
on the chart among every sensor's targets, commands and transitions scroll on a
timeline, and the Session, Vessel, Mission, Environment, Runs, Lines, Targets and
History cards read the record at the cursor, with play/pause, speed and a
scrubber; read-only. See **`README_PLAYBACK.md`**.

---

## 10. What sim mode does NOT do (honest boundaries)

- **It is not the real VCU protocol.** `SimVcu` is a plausible model, not the
  serial control link wire format. The real link (`RealVcu`) is a Phase-0 stub: it
  opens the transport but **refuses every command** (raising an error rather than
  sending an uncertain frame) until the protocol is captured from a live ASV
  Control ↔ boat session (see `PLAN.md` §8).
- **No live manual driving.** The console is autonomous-only by design; live
  manual control stays on the **RC transmitter** (the RC remains master).
- **ENC routing is a planning aid, not certified.** Behaviors route clear of
  *charted* ENC obstacles; ENC scale/currency varies and there may be uncharted
  hazards, so the operator still verifies the routed path (and the Start confirm
  asks). With no ENC coverage the console routes direct and warns.
- **The RC is the true failsafe.** Sim's E-STOP and link-loss handling are honest
  rehearsals, but on the water the RC transmitter's E-stop and Sw A are the
  authoritative safety controls — never the browser.

---

See **`README.md`** for the overall project, **`README_PLAYBACK.md`** for the
session-playback viewer, **`PLAN.md`** for phasing and the protocol-capture plan,
and **`CLAUDE.md`** for implementation notes.
