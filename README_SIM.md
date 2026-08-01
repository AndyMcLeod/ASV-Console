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

Defaults are scaled for the real boat — a **~2 m × 0.75 m** survey ASV-class ASV
for short surveys in constrained waters — not a large survey vessel.

| Aspect | Behaviour |
|---|---|
| **Position** | Starts at **≈42.1371 N, −80.0874 W** (Presque Isle Bay, Erie PA — operator-set launch point), heading 090°. Integrates lat/lon along heading at the current speed. |
| **Waypoint autonomy** | **Line-following** (look-ahead LOS ~3 m): the boat tracks the survey/transit line between waypoints (pulling out cross-track error) rather than steering point-to-point, turn rate ≤ **60°/s** (nimble small boat). It advances onto the next leg when it passes the waypoint along-track or comes within the **approach radius** (GUI "Appr m", default ~1 m) — following the line to ~1 m of each turn; applies live to a running sim. Ends per the plan's **completion** mode (stop / loiter / repeat). |
| **Completion / behaviours** | Station-keeps (holds) at the end of a Go-To / RTH / Hold / Transit / Loiter run; loops on Repeat. |
| **Speed** | Target set by the plan's speed key — **Low 1.5 kn / Survey 3.0 kn / High 6.0 kn** (manual: survey ≈ 2.8–3.5 kn). Accelerates/decelerates smoothly (≤ 1.5 kn/s). |
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
  chasing → a **natural slight wander**. The effect is **moderate and capped**: the
  boat still holds the line in normal conditions and only struggles in genuinely
  rough seas.
- The line follower rejects the disturbance like a real autopilot: **crab
  feedforward** (it measures its own drift — COG vs heading — and points the bow
  upwind by the drift triangle) plus a slow **cross-track integral trim**. So the
  boat *visibly crabs* but its ground track rides the line itself, not a parallel
  offset of it.

The **SOG** readout is the *true speed over ground* — it includes this set, so it
reads higher than the commanded speed with a following wind, lower into a head wind,
and stays non-zero when the boat is **paused and drifting** with the motors off.

It's **sim only** (a real boat feels the real weather, so `RealVcu` is untouched).
The vessel-status card shows **Wind / Sea / Set·crab**; the **ENV** toolbar button
opens a panel to **disable** it (deterministic clean tracking) or **manually override**
wind/sea for demos and tuning (blank = live buoy; *Auto* restores live; ↻ refetches).
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
   no E-STOP. **Completion** (command bar) sets the end behaviour: *Complete* (stop),
   *Loiter* (station-keep at the last waypoint), or *Repeat* (loop the route).
4. **Pause** — holds position, keeps the next waypoint active; **Start** resumes.
5. **Stop** — aborts the run plan (reverts to the first waypoint; re-upload/Start
   to run again).
6. **E-STOP** — latches a command-side motor cut and force-disarms. The UI states
   plainly that this is **not** the true failsafe — the **RC transmitter E-stop /
   Sw A is** (see §6). Release E-STOP to arm again.

**Plan-free behaviours** (armed, no survey plan): **Go-To** (click a point → drive
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

**Battery vessels** (`power.type: "battery"` — e.g. `zboat_1800hs`, `example_usv_4m`)
report a voltage that sags with load, banded from `power.battery_v`. For the
default `zboat_1800hs`:

| | Voltage | Meaning |
|---|---|---|
| Full (start) | **26.5 V** | ~26–27 V at rest |
| **Warn / alarm** | **23.0 V** | low-voltage alarm — bring the boat back |
| Critical | 20.0 V | approaching loss of control |
| Empty | 18.0 V | complete failure (steering fails first) |

**Fuel vessels** (`power.type: "fuel"` — the diesel `drix08`) report **fuel % plus
live endurance (h) and range (nm)** at the current speed instead of a voltage. The
sim burns from `power.fuel`: `burn ≈ idle + (full − idle)·(v/vmax)^exp` L/h, with
warn/crit reserve bands. The DriX's block (250 L, 0.8→10.4 L/h, exp 3.5) reproduces
Exail's published endurances (~10 d @ 4 kn, ~7 d @ 7 kn, 24 h @ 14 kn; ~1,000 nm
range). Its 24 V lithium service battery powers hotel/payload loads only and isn't
the propulsion energy source, so it isn't modeled as the endurance limit.

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
3. **Punch Out (optional):** trim the lines to ENC-clear water; the turns become
   smooth **teardrops** (radius-clamped to what the boat can hold at the run speed —
   tighter spacing/higher speed falls back to a straight hop) and the lines shorten a
   touch to give the turns room. Turn waypoints (reversals + teardrop arc) draw
   **unlabeled** — the line's own `L#` label identifies it — and the arc uses a
   coarse (~3 m) point spacing, so a wide survey keeps only a handful of waypoints per
   turn.
4. **Set run params:** arrival radius, speed (Low/Survey/High), and **completion**
   (Complete / Loiter / Repeat) in the command bar.
5. **Arm → Upload → Start.** Upload routes the transit to the survey clear of
   obstacles (green path). Watch the boat drive the survey, the waypoint counter
   advance (`wp x / N`), the track paint, and the battery drain.
6. **Try a behaviour:** with the boat Armed, click **Go-To** and pick a point, or
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
`/api/cmd/hold` · `/api/cmd/sethome` · `/api/cmd/approach`. The behaviour commands
(`goto`/`rth`/`transit`) accept an ENC-aware `{route:[…]}` computed by the browser;
`upload` accepts one too. Data: `/api/state` · `/events` (SSE) · `/api/mission` ·
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
boat with the new physics.

**Click-to-spawn:** `POST /api/cmd/spawn {"lat":…,"lon":…}` places the sim boat at a
point (the **Spawn** button arms this, and the next chart click sends it). The server
runs the *same* power-cycle as Reset with a spawn override, so a fresh `SimVcu` comes
up there — full energy, SAFE, no plan or home, and a new `boot_id` (which drops the
trail). The boat is never teleported while live; placing it is a re-boot, which is why
a real link refuses it (**409**), as it does for a bad or out-of-range lat/lon. The
active vessel's configured spawn (`vessels/<id>.json` — Erie for `zboat_1800hs`, Lewes
for `drix08`) is untouched and comes back on the next start or vessel switch.

```bash
curl -s localhost:8791/api/vessel | python -m json.tool          # active + available
curl -s -X POST localhost:8791/api/vessel -d '{"id":"example_usv_4m"}'  # switch (must be safe/idle)
```

---

## 8. Command-line flags

| Flag | Default | Purpose |
|---|---|---|
| `--sim` | off | Auto-connect the simulator at start. |
| `--host` | `127.0.0.1` | Web UI bind address. |
| `--port` | `8791` | Web UI port. |
| `--browser` | `edge` | `edge` / `chrome` / `default` / `none`. |
| `--vessel ID` | `zboat_1800hs` | Active vessel profile from `vessels/<id>.json` (hull/speeds/turn/battery/…). |
| `--vcu HOST` | — | Auto-connect to a **real** VCU (serial-over-IP) instead of sim. |
| `--transport` | `tcp` | `tcp` (serial-over-IP) or `serial` (COM port) for a real VCU. |
| `--vcu-port` | `4001` | Real-VCU port. |
| `--fetch-charts "LAT,LON,RADIUS_KM"` | — | Pre-cache NOAA ENC tiles for offline use, then exit. |
| `--zooms` | `8-16` | Zoom range for `--fetch-charts`. |
| `--no-log` | off | Disable the session recorder (see §9). Recording is on by default. |

---

## 9. Session recording (for a future playback mode)

Every run — sim **or** real — is recorded to `logs/asv_<timestamp>.jsonl`, an
append-only, line-delimited JSON event stream created fresh each server launch.
It captures two interleaved streams in time order, the substrate a later
**playback** mode will replay:

- **Commands / settings / actions** — one `command` record per POST the console
  receives (arm, upload, start/pause/stop, E-STOP, goto/hold/rth/transit,
  sethome, approach, connect/disconnect, mission edits, comms + water-level
  settings) with its input `body` and HTTP outcome `code` (so a rejected **409**
  gate is recorded too). Passwords are redacted.
- **Telemetry / state** — the same snapshots the browser sees over SSE: a full
  `state` record on every salient transition (armed/run/behavior/link/note/wp…)
  plus a slim `telemetry` sample (position, heading, COG, SOG, battery) at ~1 Hz
  in between, so playback can reconstruct the boat's actual track.

Each line is `{"t": epoch, "iso": "...", "kind": "...", ...}`. Because it taps the
HTTP and Engine layers (not `SimVcu`), the mechanism is identical for the sim and
a real VCU link. It is best-effort — a logging failure never disturbs the C2 path
— and line-buffered, so a crash or hard kill still leaves a complete, valid file.
Lifecycle markers `session_start` / `connect` / `disconnect` / `session_end`
bracket each boat session. `logs/` is gitignored.

Inspect the latest recording (kinds histogram):

```bash
python -c "import json,collections,glob; f=sorted(glob.glob('logs/*.jsonl'))[-1]; \
c=collections.Counter(json.loads(l)['kind'] for l in open(f,encoding='utf-8')); \
print(f, dict(c))"
```

**Playback.** These recordings are replayed by the built-in **playback viewer** at
**`/playback`** (link in the live console's top bar) — the boat drives its track on
the chart, commands and transitions scroll on a timeline, with play/pause, speed
and a scrubber; read-only. See **`README_PLAYBACK.md`**.

---

## 10. What sim mode does NOT do (honest boundaries)

- **It is not the real VCU protocol.** `SimVcu` is a plausible model, not the
  serial control link wire format. The real link (`RealVcu`) is a Phase-0 stub: it
  opens the transport but **refuses every command** (raising an error rather than
  sending an uncertain frame) until the protocol is captured from a live ASV
  Control ↔ boat session (see `PLAN.md` §8).
- **No live manual driving.** The console is autonomous-only by design; live
  manual control stays on the **RC transmitter** (the RC remains master).
- **ENC routing is a planning aid, not certified.** Behaviours route clear of
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
