# ASV Simulator Console — Playback Mode

Replay any recorded session on the same chart the live console uses: watch the
boat drive its track, see commands fire on a timeline, and read the vessel state
at any instant. Playback is **read-only** — a review tool that reconstructs a run
from its recording. It can never command a boat.

It is the consumer of the **session recorder** (see `README_SIM.md` §9): every run
writes an append-only JSONL log to `logs/asv_<timestamp>.jsonl`; playback reads
those files back.

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
- The recording is selected from the drop-down (newest first). Each option shows
  the session timestamp and file size.

---

## 2. What you see

| Element | Shows |
|---|---|
| **Chart + track** | The same NOAA-ENC slippy map as the live console, with the boat's **travelled track** (cyan) drawn up to the playback cursor. |
| **Boat marker** | The vessel (yellow) at the cursor time, its **position interpolated** between telemetry samples and a heading stick. Follows the cursor smoothly during play. |
| **Plan overlay** | The **planned survey lines**, **survey-area boundary**, and the **uploaded / commanded route** — reconstructed from the command stream, so they appear/update exactly when they were sent. `H` marks the home point. Toggle with **PLAN**. |
| **Vessel card** (left) | State at the cursor: position, heading, SOG, battery, autonomy, behaviour, waypoint x/N, and the console note. |
| **Mission card** | Wind, sea, set/crab, current, water level, the nogo readout, comms, run time, survey and approach estimates, the supervising tab, the Intent line and the guard bar — each as the live console showed it at the cursor. |
| **Lines / AIS / History cards** | The per-line plan-vs-actual table, the AIS contacts in range (also drawn on the chart, with ROC markers), and the History rows up to the cursor, newest first. |
| **Event timeline** (centre-left) | Every **command / setting / action** (ARM, UPLOAD, START, STOP, E-STOP, Go-To/Hold/RTH/Transit, plan edits, comms/water settings…) and every **state transition**, in time order. A **rejected (409) command is shown in red** with its reason. The current event highlights and auto-scrolls as playback advances; **click any row to jump to it**. Toggle with **EVTS**. |
| **Session pills** (top) | Mode (sim / real), total duration, command count, telemetry-fix count. |

---

## 3. Transport controls

Along the bottom:

- **⏮ Restart**, **▶ / ⏸ Play-Pause**, and a **speed** selector (0.5× … 60×).
- A **scrubber** for the whole session; drag it to scrub (this pauses playback).
- A clock: elapsed `mm:ss / total`, plus the real wall-clock time of the cursor.

**Keyboard:** `Space` play/pause · `←` / `→` step 2 s (hold `Shift` for 10 s) ·
`Home` / `End` jump to start / end.

**Map:** drag to pan, wheel to zoom, **BOAT** keeps the vessel centred, **TRK** /
**PLAN** / **EVTS** toggle the layers.

---

## 4. How it reconstructs the run

Playback parses the JSONL log into three intertwined streams and resolves them at
the cursor time `t`:

- **Track / boat** — every `state` and `telemetry` record that carries a GPS fix
  becomes a point; the boat position at `t` is **linearly interpolated** between
  the two bracketing fixes for smooth motion, and the track is every fix up to `t`.
- **Every card** — the recorder writes a full `state` snapshot at least every 10 s (wind, sea,
  water, current, comms, ROCs, supervisor ride it), `ais` records with the contacts the page
  polled, and the page posts its own card data as `client:*` records on change (`nogo`,
  `history`, `guard`, `activity`, `lines` every 30 s while running, `survey_lines` at the
  end). `cardsAt(t)` resolves each from the **last record at or before `t`**; an AIS snapshot
  older than 60 s is no longer shown as traffic. **Every other kind** in the file — `spawn`,
  `log_quiet` / `log_resume`, `supervisor_*`, `storage_*`, `loop_fault`, page stalls, guard
  events … — lands on the event timeline with a one-line digest, so nothing recorded is dropped.
- **Vessel state** — the **last full `state` snapshot** at or before `t` supplies
  armed / run / autonomy / behaviour / completion / note / home; waypoint index
  comes from the latest `state`/`telemetry` sample.
- **Plan overlays** — the survey lines / boundary come from the last `/api/mission`
  edit before `t`; the drawn route comes from the last `upload` / `goto` / `transit`
  / `rth` route (cleared by a `stop` / `estop`) — so the plan **evolves on the map
  as the operator built and commanded it**.

Because the recorder taps the HTTP + Engine layers (not `SimVcu`), the exact same
playback works for a **sim** session and a **real VCU** session.

---

## 5. Endpoints (read-only)

Playback adds three GET routes; none of them can change console state:

| Route | Returns |
|---|---|
| `GET /playback` | The playback page. |
| `GET /api/logs` | Newest-first list of recordings: `{name, size, mtime}`. |
| `GET /api/log?file=asv_<ts>.jsonl` | The raw JSONL of one recording. The filename is validated to a bare `asv_*.jsonl` basename inside `logs/` (no path traversal). |

---

## 6. Limits (honest boundaries)

- **Read-only.** Playback issues no commands and shares no state with the live
  Engine — by design, it's safe to open during an active session.
- **Only what was recorded.** Client-only planning that never hit the server (a
  survey pattern you shaped but never saved, ENC/nogo overlays, the live water
  layer) isn't in the log, so it isn't drawn. The boat track, the committed plan
  (via `mission` edits / `upload`), commanded routes, and all state/commands are.
- **The telemetry trace is throttled** to a full snapshot per transition plus a
  ~1 Hz motion sample (see `README_SIM.md` §9). Sub-second wiggles between samples
  are interpolated, not recorded verbatim.
- **Chart tiles.** Auto-fit caps at ~z16 (the ENC tile ceiling); a very short or
  stationary run shows as a small extent — zoom/pan as needed. Tiles come from the
  same cache the live console uses.

---

See **`README.md`** for the project overview, **`README_SIM.md`** (§9) for the
recorder that produces these logs, and **`CLAUDE.md`** for implementation notes.
