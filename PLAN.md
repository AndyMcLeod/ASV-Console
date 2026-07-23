# ASV Navigation & Command Console — Plan

Browser-only command-and-control (C2) for the **survey ASV**,
built as a variation of a companion `/nav` page. Home: `D:\Claude\ASV\`.
Same architecture: single-file stdlib-Python
server + vanilla-JS browser UI, no pip.

---

## 1. What already exists vs. what "operate the ASV" adds

The companion `/nav` page (`D:\Claude\companion\static\nav.html`, served by
`the companion console`) is today a **situational-awareness + mission-planning** display:

- Slippy NOAA-ENC chart, live ASV position/track, heading vector.
- Swath coverage ribbon + colour-coded soundings (from the 837B sonar).
- **Mission plan already implemented**: waypoints + auto-generated parallel survey
  lines, XTE-to-nearest-line helper, persisted server-side (`mission.json`).
- Vessel-status card: Speed / Heading / Pitch / Roll / Depth + a COMMS row
  (Ubiquiti airOS WiFi bullet or Starlink) driven by `CommsMonitor`.
- Live data pushed to the browser over **SSE (`/events`)**; plan saved via
  `POST /api/mission`. This is a clean read-only-plus-planning tool.

**It does not command the boat.** The ASV console adds the *control* half:
arm/disarm, upload a route plan, Start/Pause/Stop an autonomous survey,
return-to-home, e-stop, a live manual-drive control, and the safety-critical
telemetry (battery voltage, autonomy state, waypoint progress, failsafe).

The mission-planning UI we'd otherwise have to build **is already done** — the big
lift is the command channel to the boat and the safety model around it.

---

## 2. The ASV control architecture (from the manual)

Three parts to the boat's own control system (Ch. 8):

| Element | Role |
|---|---|
| **RC Transmitter** (Hitec, 2.4 GHz FHSS, ≤1200 m) | Primary manual control + E-stop path. Has **"Autonomy" switch (Sw A)**: forward = autonomous (RC disabled); back = manual (RC instantly takes over). This is the master safety override. Also carries the **battery low-voltage alarm**. |
| **Vessel Control Unit (VCU)** | All nav electronics. Accepts robotic commands via **RS-232 on the EXPANSION port** (25-pin D-sub). Drives the two 24 V brushless outdrives + steering servo. |
| **Vehicle Control Unit (VCU)** | Plugs into the VCU expansion port. Runs the dynamic + motor-control algorithms; takes **desired heading + speed**; fuses GPS + gyro/magnetometer. Talks to shore over one radio-modem channel. |

The vendor **ASV Control** Windows app is the shore side we're replacing:
it uploads a `*route-plan` waypoint route plan, issues Start/Pause/Stop, and offers
**manual Xbox-joystick drive** — all over an RS-232 link to the VCU.

**VCU serial ports (Ch. 8 "Changing Baud Rates"):**
- Serial **A → VCU (CCM)**: 115 200 (internal; do not touch).
- Serial **B → GPS**: matches GPS NMEA baud.
- Serial **C → GUI (shore)**: **115 200, 8 data bits, no parity** — *this is the
  link the browser console speaks.* Radio Channel A, 115 200 bps.

So a browser-only console = a Python bridge that opens **serial control link** (either a
physical/virtual COM port on the RS-232 radio, **or** a TCP socket when the link
is serial-over-IP via the Ethernet radio / WiFi bullet / Starlink) at 115 200 8N1,
speaks the VCU protocol, and relays to the browser over HTTP/SSE — exactly the
`RealHead` pattern companion already uses for the sonar, with the same
`--transport {tcp,serial}` abstraction.

---

## 3. The central constraint: proprietary protocol + RC override

Two things gate this project:

1. **The VCU serial control link protocol is proprietary and undocumented.** The manual
   describes *what* ASV Control does (upload `route-plan`, Start/Pause/Stop, stream
   GPS/heading/speed telemetry, manual joystick) but not the wire format — no
   opcodes, no `route-plan` layout, no telemetry framing. This is the same class of
   problem companion solved for the Imagenex sonar, and it will decide the timeline.
   Paths to the protocol, best first:
   - **Capture live serial** between the real ASV Control app and the boat/VCU
     (com0com/port-mirror or an RS-232 tap) during upload + a short run. This
     yields the `route-plan` bytes and the runtime opcodes directly.
   - **Sample `route-plan` files** saved by ASV Control / HYPACK ("Save zrp")
     — decode statically like companion did with `.83P`. (Andy has ASV surveys in
     `OneDrive\ASV\`; check for `route-plan`/`.log` there.)
   - **Vendor spec** from , if obtainable.
   Until we have at least one of these, the command path is **spec-blocked**; the
   display/telemetry-decode/mission-planning half can proceed on captured or
   simulated data.

2. **The RC transmitter is the master, and must stay that way.** Sw A on the RC
   overrides everything; the manual is emphatic that an operator monitors at all
   times and keeps the RC on (it carries the battery alarm). The browser console
   is **additive shore-side C2, never a replacement for the RC**. Every command
   path must degrade safely to "RC operator takes over."

   The browser also **cannot drive the RC's own 2.4 GHz link** — that's a physical
   handheld. Browser "manual drive" therefore goes over the *data radio to the VCU*
   (the same channel ASV Control's Xbox mode uses), which the manual notes is
   **longer range** than the RC but is *not* the failsafe-guaranteed path.

---

## 4. Proposed architecture

```
  Browser (ASV console, vanilla JS)
     │  HTTP + SSE  (localhost)
     ▼
  asv_console.py  (stdlib Python server)
     ├── VcuLink        ← serial control link to the VCU (COM port OR TCP serial-over-IP)
     │     • telemetry decode  → SSE /events state
     │     • command encode     ← POST /api/cmd/*
     ├── CommsMonitor   ← reuse companion's WiFi(airOS)/Starlink prober verbatim
     ├── Mission store  ← reuse mission.json + waypoint/line model
     └── Tile cache     ← reuse companion charts/ + NOAA fill-on-miss
```

- **Reuse wholesale from companion:** the slippy-map engine, tile cache/`fetch_tile`,
  mission model + `/api/mission`, `CommsMonitor` (WiFi/Starlink), SSE plumbing,
  and the whole visual system (CSS vars, topbar/pills/cards). The ASV page is a
  **fork of `nav.html`** with a command layer added, not a rewrite.
- **New `VcuLink` class** mirrors `RealHead`: connect/disconnect, a background RX
  thread that parses VCU telemetry into the SSE `state`, and command methods that
  encode serial control link frames. Includes a **`SimVcu`** (like `SimHead`) so the whole UI
  + safety logic is testable with **zero hardware** — essential given the boat and
  protocol aren't on the bench.
- **Transport abstraction** (`--transport {serial,tcp}`) so the same link works
  over the RS-232 radio (COM) or over IP (Ethernet radio / WiFi / Starlink),
  matching the manual's serial-over-Ethernet / virtual-COM story.

---

## 5. C2 feature set (mapped to ASV Control + the existing nav page)

**Planning (already built — reuse):** waypoints, parallel survey-line generator,
XTE. Add: import `.log`/`.b84` line/border files; per-waypoint **arrival radius**
and **speed (Low/Survey/High)** and a **Start-point line-up** — the fields the
`route-plan` needs (Ch. 8).

**Route upload:** "Save/Export `route-plan`" from the current mission + **Upload** to the
VCU, with the vendor's **Lock-before-upload** interlock and a transfer-progress
indicator ("Run Plan Uploaded Successfully").

**Autonomous run control:** **Arm** (confirm Sw A is in autonomous), **Start /
Pause / Stop**, live **waypoint counter / progress**, active-leg highlight (the
nav page already highlights the active line), autopilot-status readout.

**Manual drive (data-radio path, optional/Phase 3):** on-screen virtual joystick
**and** browser **Gamepad API** (a real USB gamepad = the Xbox-mode equivalent) →
continuous heading+speed / differential-thrust frames. Hard-gated behind an
explicit "TAKE MANUAL" arm step and a dead-man (release → neutral).

**Safety controls:** big **E-STOP** (command-side motor cut) + a persistent banner
that the **RC E-stop/Sw A is the true failsafe**; **Return-to-Home**; connection-loss
behaviour surfaced (the boat's own failsafe: ASV = motors to 0 / straight).

**Telemetry into the status card:** add **Battery voltage** (the manual's #1 safety
gauge — starting 26–27 V, alarm 23 V, servo fails ~18 V) with the alarm threshold
and colour bands; **autonomy state** (Manual / Auto / RC-override / Failsafe);
**waypoint progress**; keep Speed/Heading/Pitch/Roll/Depth + COMMS.
*Caveat to verify:* battery voltage is telemetered to the **RC transmitter**; whether
it's also on the VCU data link is unconfirmed — if not, battery stays an RC-only
readout and the console shows "battery: on RC" rather than a live number.

---

## 6. Safety model (non-negotiable)

- **RC transmitter is master.** UI states this permanently; nothing in the browser
  can disable Sw A or the RC E-stop.
- **Arm/disarm gates** on every actuating command (Upload, Start, Manual, E-stop).
  Two-step confirm on Start and on entering Manual.
- **Dead-man** on manual drive: no fresh input within N ms → neutral/zero thrust.
- **Link-loss = safe:** on serial control link dropout, stop issuing commands and show the
  boat's own failsafe expectation; never auto-resume.
- **Never auto-command on load.** The console comes up read-only; commanding
  requires explicit operator arming each session.
- **Sim-first.** All command logic validated against `SimVcu` before a byte
  reaches a real VCU; every command clamped before encoding (companion's "must not
  wedge the head" rule, applied to "must not wedge the boat").

---

## 7. Phased build

- **Phase 0 — Scaffold.** Copy the companion server skeleton into `asv_console.py`;
  fork `nav.html` → `asv.html`; strip sonar-only bits; reuse map + mission +
  comms. `SimVcu` emits fake GPS/heading/speed so the page lives immediately.
  *No protocol needed.*
- **Phase 1 — Telemetry (read-only C2).** Decode VCU→shore telemetry (from a live
  capture or spec) into the SSE state; battery + autonomy + waypoint progress in
  the status card. Boat position now real; still no commands sent.
- **Phase 2 — Autonomous route control.** `route-plan` export + Upload; Start/Pause/Stop
  with the Lock interlock and arming gates. The core deliverable.
- **Phase 3 — Manual drive (optional).** Gamepad/virtual-joystick over the data
  radio, dead-man + arm-gated.
- **Phase 4 — Field hardening.** Range/latency behaviour, link-loss drills,
  offline chart prep, docs (`CLAUDE.md` + `README.md`), private GitHub repo like
  the sibling projects.

Phases 0–1 and all planning work can proceed **now**; Phase 2's command bytes are
gated on obtaining the VCU protocol (§3).

---

## 8. Decisions locked (2026-07-20)

1. **VCU protocol: none yet → sim-first.** Build against `SimVcu` with a clean
   `VcuLink` seam; the `route-plan` encoder and command opcodes stay stubbed/pluggable
   until a **live serial capture** of ASV Control ↔ boat (or sample `route-plan`
   files) lands. Everything else is built and validated in sim. Plan a capture
   session as the Phase-2 unblock.
2. **Primary link: serial-over-IP → default `--transport tcp`.** Ethernet radio /
   WiFi bullet / Starlink carrying serial control link as TCP (PortServer-style). Keep the
   `serial` COM transport as a secondary option in the abstraction.
3. **Autonomous-only.** No live browser manual-drive. Console scope = route upload
   + Start/Pause/Stop + telemetry + safety. **Phase 3 is dropped**; live manual
   driving stays on the RC transmitter (simpler, safer, and the RC stays master).

### Immediate next step — Phase 0 deliverable (no hardware, no protocol)
`asv_console.py` + `static/asv.html`, forked from companion: reuse the map, tile
cache, mission model, and `CommsMonitor`; add the `VcuLink`/`SimVcu` seam emitting
fake GPS/heading/speed/battery/autonomy over SSE; add the C2 chrome (arm/disarm,
Upload/Start/Pause/Stop wired to stubs, E-STOP banner, battery + autonomy in the
status card) — all driven by the simulator so the console is fully interactive
day one. Runs: `python asv_console.py --sim`.
