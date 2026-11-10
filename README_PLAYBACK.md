# ASV Simulator Console — Playback Mode

Replay any recorded session on the same chart the live console uses: watch the
boat drive her track among the targets every sensor reported, see commands fire
on a timeline, and read the vessel, the mission and the environment at any
instant. Playback is **read-only** — a review tool that reconstructs a run from
its recording. It can never command a boat.

It is the consumer of the **session recorder** (see `README_SIM.md` §9): every run
writes an append-only JSONL log to `logs/asv_<timestamp>.jsonl`; playback reads
those files back. A recording made before the mission record (2026-11-05) still
plays; §6 says what it lacks.

---

## 1. Open it

Start the console as usual, then browse to **`/playback`**:

```
python asv_console.py --sim            # (or a real --vcu session)
# then open  http://localhost:8791/playback
```

- There's a **▶ Playback** link in the live console's top bar.
- Playback doesn't need a boat connected — it only reads `logs/`. You can review
  a session at the dock, or a past run any time.
- The recording is selected from the drop-down (newest first). Each option names
  the session timestamp, the vessel, where it ran, the mode (SIM / REAL), the HTTP
  port of the console that wrote it, and the file size, so a recording a test
  console on another port left in the same `logs/` can be told from yours. A field
  the file does not carry is left out.
- **Where it ran** is the bases its runs started at, in order (`Castine → New
  Castle`), and for a session with no run, every base it was at. It is NOT the
  base the console booted at: the console starts at the base it last had, so an
  overnight Eastport survey from a console that booted at Pago Pago was listed as
  "pago pago" and looked like a missing recording (2026-11-10). A session written
  since then says where it ran in a `session_summary` record at shutdown; one that
  did not shut down cleanly, or is older, is named by where its first run started
  (a base it moved to after that run is not shown). A recording older than
  2026-11-05 is named by its starting base, as before.
- **Deep link.** `/playback?file=asv_<ts>.jsonl&t=<s>` opens that recording at that
  moment. `t` is seconds into the recording, or an epoch time. The address bar
  follows the cursor whenever you pause, step, scrub, restart or click a row, so
  copying it sends someone else the moment you are looking at.

---

## 2. What you see

| Element | Shows |
|---|---|
| **Chart + track** | The same NOAA-ENC slippy map as the live console, with the boat's **traveled track** (cyan) drawn up to the playback cursor. Inside an incident window (§4) the track runs on the 4 Hz frames the guard acted on. |
| **Boat marker** | The vessel (yellow) at the cursor time, its **position interpolated** between samples and a heading stick. Follows the cursor smoothly during play. With **ENV** on, a **rose** at the boat: the wind as a needle from where it blows, the sea from where it runs, and the current and the set applied as arrows toward where they push her. |
| **Plan overlay** | The plan in force at the cursor: the **plan on disk** (faint and dotted while it is not being flown), the **survey lines** and **boundary**, and the **route the boat was flying**. `H` marks the home point; an RTH chase draws its moving target. Toggle with **PLAN**. |
| **Targets** | Every sensor's contacts at the cursor: AIS and the ROCs today, and a sensor added later with no change to playback. Each contact is drawn by the live chart's own rules: the glyph, the hull to scale once it is bigger on screen than the glyph, and a dashed disc for a ship that has not said which way she lies; a speed stalk only while she is under way; her name from zoom 12; dimmed when her report is over 3 minutes old. Each has a trail of her last 10 minutes. ROCs are squares, with their heading and arrival point. When the AIS sensor has no record recent enough at the cursor, the chart says so. Toggle with **TGT**. |
| **What the guard saw** | The keep-out model's extent (a dashed box), the structures read off the chart image (drawn even while **Land / shore / docks** was off and kept them out of the model; the timeline row then says NOT folded), and the AIS keep-outs the guard was handed: solid for a contact at rest, dashed for one under way, bold for one in the guard's reach. During an avoidance the contact it was avoiding is ringed and named **AVOIDING**. Toggle with **KO**. |
| **Stations** | Where the tide gauge, the current station and the buoys the environment came from are (square, diamond, triangle), named from zoom 11. Shown with **ENV**. |
| **Session card** | The vessel and her hull (length, beam, draft, minimum depth, power), the base and its current model, the mode, the console's build and git commit, the console's clock zone, and the recording this one continues, with whether that one ended cleanly. It follows a vessel or port switch. |
| **Vessel card** | State at the cursor: position, heading, COG, SOG, speed commanded against speed made good, energy by what she burns (fuel liters and percent, or battery volts and percent), pitch / roll, the hold (HOLDING or DRIFTING, distance off station, the clear radius), autonomy, behavior, waypoint x/N, and the console note. |
| **Mission card** | Wind, sea, set/crab, current, water level, the nogo readout, comms, run time, survey and approach estimates, the supervising tab, the guard's level, the Intent line and the guard bar — each as the live console showed it at the cursor. |
| **Environment card** | All of the environment, aged at the cursor: wind (with gust, source and stations), sea, the set applied (with crab and source), the sim's own **forcing** (the wind as applied, the leeway and the stream apart, the sea and the water density; sim only), current (with its model and stations), water level (datum, method, station, surge), water density, and each nearby buoy's own report (pressure, air and water temperature, dew point, visibility, wind, waves). The header says which source it read. |
| **Runs card** | Every run in the recording: when it started, the behavior, duration, distance, energy used, waypoints, and how it ended (complete, stopped, superseded by the next command, still running when the recording ends). The run at the cursor is highlighted; **click a run to jump to its start**. |
| **Lines / Targets / History cards** | The per-line plan-vs-actual table (with the transits between coverage regions under it); every contact held at the cursor, nearest first, with her range and her CPA / TCPA by the live card's own function (a ship not under way is worded "not under way", never given a course), and each sensor's health; and the History rows up to the cursor, newest first. |
| **ENV strip** | Along the bottom, the whole recording at a glance: wind and gust, the set applied and the current (knots), wave height and the water level (meters). The cursor is the yellow line. Shown with **ENV** when the recording has the data. |
| **Event timeline** | Every **command / setting / action** (ARM, UPLOAD, START, STOP, E-STOP, Go-To/Hold/RTH/Transit, AMEND, RE-APPROACH, ESCAPE, plan edits, settings…) with the tab that sent it, every **state transition**, the mission record's own entries (MANIFEST, VESSEL, PORT, PLAN ON DISK, PLAN SAVED, PLAN LOADED, RUN START / RUN END, INCIDENT), each change of the guard's level, and every other record kind, in time order. A **rejected (409) command is shown in red** with its reason. The streams (the track, the environment, the targets, the AIS keep-outs) get no row each. The current event highlights and auto-scrolls as playback advances; **click any row to jump to it**. Toggle with **EVTS**. |
| **Session pills** (top) | Mode (sim / real), total duration, operator command count, fix count. An older recording's copies of the page's own event posts are not counted as commands. |

---

## 3. Transport controls

Along the bottom:

- **⏮ Restart**, **▶ / ⏸ Play-Pause**, and a **speed** selector (0.5× … 60×).
- A **scrubber** for the whole session; drag it to scrub (this pauses playback).
- A clock: elapsed `mm:ss / total`, plus the cursor's time on the **console's
  clock and in UTC**, each labeled (`14:03:22 console (UTC-05:00) · 19:03:22 UTC`).
  It is never your own computer's zone: a console in New York and a mission off
  Honolulu are read by the console's clock.

**Keyboard:** `Space` play/pause · `←` / `→` step 2 s (hold `Shift` for 10 s) ·
`Home` / `End` jump to start / end.

**Map:** drag to pan, wheel to zoom, **BOAT** keeps the vessel centered, **TRK** /
**PLAN** / **TGT** / **KO** / **ENV** / **EVTS** toggle the layers.

---

## 4. How it reconstructs the run

Playback parses the JSONL log ONCE into indexes, each sorted by time, and resolves
every one at the cursor time `t` by binary search, so a long field recording plays
as smoothly as a short one:

- **Track / boat** — every `state` and `telemetry` record that carries a GPS fix,
  and every frame of an `incident` record, becomes a point; the boat position at
  `t` is **linearly interpolated** between the two bracketing fixes, and the track
  is every fix up to `t`. A field a sample does not carry (an incident frame has no
  battery) is carried from the sample before it.
- **Vessel state and cards** — the last record at or before `t`: the full `state`
  snapshot (armed / run / autonomy / behavior / completion / note / home, comms,
  the supervisor), the page's own `client:*` posts (`nogo`, `history`, `guard`,
  `guard_level`, `activity`, `lines` every 30 s while running, `survey_lines` at the
  end), and the mission record's `manifest`, `vessel` and `port` for the Session
  card. The waypoint comes from the latest sample that carried one.
- **Environment** — the `env` stream, read per block (wind and sea, water, current,
  density) and **aged at the cursor**: a reading written 10 minutes old reads 11
  minutes old a minute later. A recording with no `env` stream reads the blocks off
  its state snapshots instead. A reading that goes away (the environment switched
  off, a current no longer computed) is a gap in the ENV strip, not its last value
  held on.
- **Targets** — one model for every sensor. A `targets` record says who the sensor
  held and the rows that changed; `track_info` gives each contact's particulars. A
  contact is shown while the sensor's last record holds her and that record is
  recent enough to still be the traffic (75 s; the recorder writes every 10 s, and a
  60 s heartbeat when it holds nothing). Between two reports she moves along the
  straight line by her report time; two reports more than 3 minutes apart, or either
  side of a gap in her membership, are held, not joined. Which way she points is
  the live page's own function (`aisMotion`, from `static/js/ais_keepout.js`), and
  her CPA the live card's (`cpa`, from `static/js/targets.js`). An older recording's
  `ais` records and the ROCs in its state snapshots are read into the same model.
- **What the guard saw** — the last `client:model`, `client:chart_ink` and
  `client:ais_model` at or before `t`. The AIS model is recorded as changes (each
  record names every contact held and carries the ones that changed, with a
  keyframe every 10 minutes and at every wake); playback makes each record whole
  once, at load, and marks one read before a contact's ring was recorded as
  partial. An avoidance episode opens on the page's own
  record of it (`client:ais_avoid`, `client:ais_around`, `client:avoiding`) and ends
  the ways the page ends one: `client:ais_return`, the supervisor no longer
  avoiding (the way a slow avoidance, a way round her under way, ends), a failed
  way round, a command that hands the boat a new plan or stops her (not the
  avoidance hold's own hold command), a disconnect, or the session end. What the
  cursor cannot show (no traffic record, an avoidance whose contact is not held,
  a BLIND or STALE model) is said on the Targets card.
- **Plan overlays** — the plan on disk from its `mission` record (at boot and after
  every wake), then each `/api/mission` save. The route is the console's own
  `plan_loaded` record: what the link was actually given, including the routes the
  console builds itself (an RTH, a hold, an escape, a re-approach). A recording
  without them takes the route in each `upload` / `goto` / `transit` / `rth` /
  `amend` / `reapproach` command; an upload with no route flies the plan on disk. An
  amend replaces the plan from the waypoint it was spliced at, the waypoints
  already flown kept. A `stop` / `estop` parks the route: none is drawn until the
  next accepted Start flies it again, and a new plan replaces it. So the plan **evolves on the map as the operator built
  and commanded it**.
- **Runs** — `run_start` and `run_end`, paired by run id. A run whose start came
  before the recording began starts its `dur_s` before its end.
- **Every other kind** in the file — `spawn`, `log_quiet` / `log_resume`,
  `supervisor_*`, `storage_*`, `loop_fault`, page stalls … — lands on the event
  timeline with a one-line digest, so nothing recorded is dropped.

Because the recorder taps the HTTP + Engine layers (not `SimVcu`), the exact same
playback works for a **sim** session and a **real VCU** session.

---

## 5. Endpoints (read-only)

Playback adds three GET routes; none of them can change console state:

| Route | Returns |
|---|---|
| `GET /playback` | The playback page. |
| `GET /api/logs` | Newest-first list of recordings: `{name, size, mtime}`, and the picker's labels, read from the head of each file (never the whole file): `port`, `mode`, `vessel` and `base`, and `places`, the names of the bases its runs started at (the live recording's from the console's own logger; another's from the `session_summary` in its last 64 KB, else from its head as far as its first run). The command line is read, not served (an older recording carries its own raw). An older recording is labeled from its `session_start` command line and first `connect`. |
| `GET /api/log?file=asv_<ts>.jsonl` | The raw JSONL of one recording. The filename is validated to a bare `asv_*.jsonl` basename inside `logs/` (no path traversal). |

---

## 6. Limits (honest boundaries)

- **Read-only.** Playback issues no commands and shares no state with the live
  Engine — by design, it's safe to open during an active session.
- **Only what was recorded.** Client-only planning that never hit the server (a
  survey pattern you shaped but never saved, the live water layer) isn't in the
  log, so it isn't drawn. Nor are the charted keep-out zones themselves: **KO**
  draws the model's extent, the chart ink and the AIS keep-outs, not the ENC
  polygons. The boat track, the plan on disk and every saved edit, the routes the
  link was given, the targets, the environment and all state/commands are.
- **The guard's records come from the supervising chart window.** The keep-out
  model, the chart ink, the AIS keep-outs and the guard's level are posted by the
  chart page that supervised; the nogo readout, the LINES table and the guard bar
  by any open console page. With none open, those cards and layers are empty for
  that stretch.
- **The telemetry trace is throttled** to a full snapshot per transition and at
  least every 10 s, plus a ~1 Hz motion sample (see `README_SIM.md` §9). Only inside
  an incident window (60 s before a safety trigger to 30 s after the last) are the 4 Hz
  frames kept. Elsewhere, motion between samples is interpolated, not recorded.
- **Targets are recorded every 10 s, within the display range** — a passage's
  widened range only while a chart page polls with it. A contact the AIS service
  held with no position yet is not in the record.
- **A real-link session has no wind, sea, density or forcing.** The console has no
  such feed on a real link. The water level and the current are recorded in both
  modes.
- **Older recordings show less.** A recording from before 2026-11-05 has no Session
  card beyond the vessel named on its command line, no Runs list, no routes the
  console built itself, no guard model, its environment from the 10 s snapshots with
  their ages as written, its AIS only while a page was polling (cut to the
  freshest reports, so in a busy harbor the ships with the oldest reports, often
  moored alongside her, can be missing), and its clock zone worked out from its own
  timestamps.
- **A very long route.** A route the link was given with more than 5,000 points is
  recorded by its digest and length only; playback then draws the route the command
  sent, if one came within 5 s, else none.
- **Pointing needs the page's module.** Playback points each contact with the live
  page's own `static/js/ais_keepout.js`. Opened where that module cannot load, it
  falls back to the same rule written out, less the berth rule (a ship lying along
  her berth).
- **Chart tiles.** Auto-fit caps at ~z16 (the ENC tile ceiling); a very short or
  stationary run shows as a small extent — zoom/pan as needed. Tiles come from the
  same cache the live console uses.

---

See **`README.md`** for the project overview, **`README_SIM.md`** (§9) for the
recorder that produces these logs and every record kind it writes, and
**`CLAUDE.md`** for implementation notes.
