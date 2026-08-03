// Build: ASV Simulator - Technical Manual (engineers & programmers)
//
// THE MANUAL IS GENERATED - edit THIS script and rebuild; never hand-edit the docx.
// If the docx is hand-edited in Word anyway: diff that text against the generated
// version (paragraph extraction), fold the edits INTO this script (mark them as the
// author's), then rebuild.
//
//   cd tools && npm install && node build_tech_manual.js
//
// Writes ../docs/asv-simulator-technical-manual.docx (path is script-relative).
//
// BRAND-FREE BY RULE. This console is the generic, vendor-neutral sibling: the onboard
// controller is a VCU, and no vendor or model name appears in the console core or in
// this manual's description of it. Vessel FILES may name real vessels - that is data,
// not branding - so a vessel table quoting a real hull is fine and a "the X console"
// framing is not. Keep it that way when extending this script.
// Shared building blocks. Extracted 2026-08-02 when the document set grew to four
// generators; this manual's output is byte-identical across that extraction.
const { P, H1, H2, H3, B, B2, CODE, TBL, SP, TITLE, write } = require("./docx_kit");

// ---- content ---------------------------------------------------------------
const c = [];

c.push(TITLE("ASV Simulator"));
c.push(P("Technical Manual — architecture, subsystems, API and extension guide", { size: 24, color: "2e5f8a" }));
c.push(P("A browser-based command console and high-fidelity simulator for autonomous surface vessels. Vendor-neutral by design: the console core models no particular hull, and every vessel-specific parameter lives in a per-vessel configuration file.", { italics: true }));
c.push(SP());

c.push(H1("Contents"));
[
  "1  Introduction and document set",
  "2  System architecture",
  "3  Repository layout",
  "4  Vessel configuration — the single source of truth",
  "5  Server reference (asv_console.py)",
  "6  Client reference (static/asv.html)",
  "7  Behaviors, the nogo model and ENC-aware routing",
  "8  Survey planning and turn geometry",
  "9  Remote Operations Centers and moving HOME",
  "10  HTTP API reference",
  "11  Data formats and persistence",
  "12  Configuration and constants",
  "13  Development practice and verification",
  "14  Known limitations and roadmap",
  "15  Extension guide",
].forEach(t => c.push(B(t)));

// 1 -------------------------------------------------------------------------
c.push(H1("1  Introduction and document set"));
c.push(P("The ASV Simulator is a single-operator command console for an autonomous surface vessel, plus a simulator faithful enough to rehearse a whole mission against real chart data before any hardware is involved. It plans surveys and search patterns on a live nautical chart, routes every leg clear of charted hazards, drives the vessel through an autopilot model that responds to real wind and sea state, and records the session for replay."));
c.push(P("The console is deliberately GENERIC. It models no particular manufacturer's vessel: the onboard controller is referred to throughout as a `VCU` (vessel control unit), and every hull, propulsion, maneuvering, power and planning parameter is read from a vessel configuration file rather than compiled in. Adding a new vessel is a data change, not a code change — see chapter 4."));
c.push(H2("1.1  Document set"));
c.push(P("Four GENERATED documents plus the repository's own notes. The generated set shares one formatting module and is rebuilt with a single command; never hand-edit a generated document."));
c.push(TBL(["Document", "Audience", "Covers"], [
  ["Quick Start (generated)", "First-time users", "Running it, a first commanded behaviour, a first survey, in about twenty minutes"],
  ["Operations Manual (generated)", "Operators", "Safety model, display, chart awareness, every behaviour, planning depth, contingencies, checklists"],
  ["This manual (generated)", "Engineers, programmers", "Architecture, subsystems, API, formats, constants, extension recipes"],
  ["Development Guide (generated)", "Contributors, maintainers", "How the project is built and verified: testing philosophy, defect shapes, case studies, extension recipes"],
  ["`README.md`", "Operators, new readers", "What it is, running it, and a walkthrough of every feature"],
  ["`README_SIM.md`", "Operators", "The simulation model, command flow, endpoints, mission walkthrough"],
  ["`README_PLAYBACK.md`", "Operators", "Session recording and the read-only playback view"],
  ["`CLAUDE.md`", "Maintainers", "Design decisions, durable gotchas, and the session log"],
], [2400, 2100, 4860]));
c.push(SP());
c.push(P("Rebuild the whole generated set with `cd tools && node build_docs.js`. Each generator is standalone and can be run on its own; the shared formatting lives in `tools/docx_kit.js`."));
c.push(P("Design documents — `PLAN.md`, `ASV_BEHAVIORS_PLAN.md`, `ENC_PUNCHOUT_PLAN.md` — record intent for individual subsystems and are historical rather than normative."));

// 2 -------------------------------------------------------------------------
c.push(H1("2  System architecture"));
c.push(P("Three processes, one browser, and no framework. The console is stdlib-only Python serving a single self-contained HTML page; the only child processes are optional services."));
c.push(CODE([
  "  browser (static/asv.html)          the whole UI: chart, planning, command bar",
  "     |  HTTP + SSE (/api/state)",
  "  asv_console.py                     server: engine, mission store, ENC, water, env",
  "     |  VcuLink (SimVcu | RealVcu)",
  "  the vessel                         simulated, or a real VCU over TCP/serial",
  "",
  "  ais_service.py    (child)          AIS traffic provider, proxied at /api/ais",
  "  gps_sim.py        (child)          NMEA-0183 GPS stream for a ROC position feed",
]));
c.push(H2("2.1  The honest seam"));
c.push(P("`VcuLink` is the interface between the console and the vessel. `SimVcu` implements it fully — hull dynamics, autopilot, power model, waypoint following. `RealVcu` implements the same interface and REFUSES every command with a clear error, because the wire protocol for a real controller is not implemented. This is deliberate: an unimplemented real link that silently accepted commands would be far more dangerous than one that says so."));
c.push(H2("2.2  Where logic lives"));
c.push(P("Route planning, chart clipping and survey geometry run in the BROWSER, not the server. The client owns the ENC feature set and computes every route against it, then uploads the finished waypoint list. One consequence matters and is easy to trip over: a raw `POST /api/cmd/upload` with no `route` bypasses ENC routing entirely, because the routing code is client-side JavaScript. Scripted headless missions must therefore either supply a pre-routed path or stay in open water."));
c.push(H2("2.3  Single-file by decision"));
c.push(P("The server is one Python file and the client is one HTML file. This is a settled decision, not an accident: it keeps deployment to a copy, keeps the whole system greppable, and removes the build step. The sibling console split its routing into a separate `routing.js`; this one deliberately did not, and the regression harnesses extract functions directly out of `static/asv.html` on that assumption."));

// 3 -------------------------------------------------------------------------
c.push(H1("3  Repository layout"));
c.push(TBL(["Path", "Purpose"], [
  ["`asv_console.py`", "The server: HTTP + SSE, Engine, VcuLink/SimVcu/RealVcu, mission store, ENC fetch, water level, environment, vessel configuration, session recorder"],
  ["`static/asv.html`", "The entire client: chart, planning, routing, behaviors, all cards"],
  ["`static/playback.html`", "Read-only session playback view"],
  ["`roc_tracks.py`", "Remote Operations Center tracking, GPS ingest and moving HOME"],
  ["`gps_sim.py`", "NMEA-0183 GPS data-stream simulator (TCP server or UDP)"],
  ["`ais_service.py`", "Standalone AIS traffic provider, started as a child process"],
  ["`vessels/*.json`", "One self-contained configuration per modeled vessel"],
  ["`tests/`", "Headless regression harnesses (stdlib Node / stdlib Python)"],
  ["`tools/`", "Documentation generators (this manual)"],
  ["`charts/`", "Chart tile and ENC caches (generated at runtime, not versioned)"],
  ["`logs/`", "Session recordings (JSONL) and child-process logs"],
], [2600, 6760]));

// 4 -------------------------------------------------------------------------
c.push(H1("4  Vessel configuration — the single source of truth"));
c.push(P("This chapter describes the architectural feature that most distinguishes this console: it studies ASV behaviour across vessel TYPES, so no vessel parameter may be hardcoded anywhere."));
c.push(P("Every hull, windage, propulsion, maneuvering, autopilot, power, planning and spawn value for a modeled vessel lives in exactly one place — `vessels/<id>.json`. The server validates it at load, publishes it to module globals, and serves it to the client at `GET /api/vessel`. Server and client therefore agree by construction."));
c.push(H2("4.1  Lifecycle"));
c.push(B("`load_vessel(id)` reads `vessels/<id>.json`."));
c.push(B("`validate_vessel(v)` checks it against a field schema. A missing or mistyped field fails the load with a clear, path-pointed error — a bad file never runs with placeholder physics."));
c.push(B("`apply_vessel(v)` publishes the values to the module globals that `SimVcu`, the mission store and the planners read."));
c.push(B("The client's `loadVessel()` fetches `/api/vessel` and mirrors the same values into its own constants (speeds, turn rate, nogo buffer, minimum navigable depth, search-pattern sizes) and the energy gauge."));
c.push(P("`--vessel <id>` selects the vessel at start. `POST /api/vessel {id}` switches it live; the switch is gated on disarmed and idle, returns 409 otherwise, and respawns the simulated vessel at the new vessel's spawn point."));
c.push(H2("4.2  The staleness rule"));
c.push(P("EVERY value derived from the vessel must be re-derived inside `apply_vessel()`. A constant computed once at import goes stale the moment the operator switches vessel in the top-bar picker, and the resulting bug is subtle — the console keeps running, with one subsystem quietly modelling the previous hull. Historic instances: the underwater lateral area used for leeway drag, and the ROC recovery standoff."));
c.push(H2("4.3  Schema"));
c.push(TBL(["Block", "Fields", "Drives"], [
  ["`hull`", "`loa_m`, `beam_m`, `above_water_h_m`, `draft_m`, `wind_cd`, `hull_cd`", "Windage silhouettes, leeway drag, minimum navigable depth, ROC recovery standoff"],
  ["`propulsion`", "`speeds_kn.{low,survey,high}`", "Plan speeds, ETA estimates, turn radius, moving-HOME closing check"],
  ["`maneuvering`", "`max_turn_rate_deg_s`, `approach_m`, `lookahead_m`, `arrival_radius_m`", "Minimum turn radius, survey turn geometry, waypoint following"],
  ["`autopilot`", "`xte_ki_deg`, `xte_i_max_deg`", "Cross-track integral term under a steady sideways push"],
  ["`power`", "`type` = `battery` (voltage sag) or `fuel` (litres, burn curve)", "Endurance, range, the console's energy gauge"],
  ["`planning`", "`nogo_buffer_m`, `under_keel_clearance_m`, optional `channel_reach_m`, `roc`, `search`", "Keep-out buffer, depth floor, channel lane reach, ROC defaults, search sizes"],
  ["`spawn`", "`lat`, `lon`", "Where the simulated vessel comes up"],
], [1500, 3700, 4160]));
c.push(SP());
c.push(P("The minimum navigable depth is DERIVED, not declared: `draft_m + under_keel_clearance_m`. A deep-draft vessel therefore treats more water as nogo automatically, and the client re-extracts the chart on a vessel switch so the keep-out model follows."));
c.push(H2("4.4  Adding a vessel"));
c.push(P("Write `vessels/<id>.json` with every required field, start with `--vessel <id>`, and confirm the load message. There is no code to change. If a new subsystem needs a vessel-dependent value, add the field to the schema with a SENSIBLE DERIVED FALLBACK so that vessel files written before the field existed continue to load — see the ROC recovery standoff in chapter 9 for the pattern."));

// 5 -------------------------------------------------------------------------
c.push(H1("5  Server reference (asv_console.py)"));
c.push(H2("5.1  Engine"));
c.push(P("`Engine` owns the link, the armed/e-stop state, the run state machine and the telemetry loop. It ticks the link, absorbs telemetry into a state snapshot, and pushes that snapshot to every SSE subscriber. It also resolves HOME on every tick (chapter 9) and drives the moving-HOME chase."));
c.push(P("Run states are `idle`, `running`, `paused` and `complete`. Behaviors are `survey`, `goto`, `rth`, `transit` and `hold`. Completion modes are `rth`, `complete`, `loiter` and `repeat`."));
c.push(H3("5.1.1  End-of-plan setting versus run completion"));
c.push(P("Two different things, deliberately kept in two different places. The END-OF-PLAN SETTING is the operator's persistent choice of what happens when a survey or search PLAN finishes; it is owned by the mission store and read through a cached accessor that every mission read and write refreshes. NO ENGINE METHOD WRITES IT. The RUN COMPLETION is what the run currently in progress does at its own end — a Go-To, return-to-home, hold or transit all station-keep at their endpoint, so a Go-To legitimately runs as “loiter”."));
c.push(P("They were one field once. Because a Go-To correctly set that field to loiter, commanding one silently overwrote the operator's end-of-plan selection: the command bar still showed the selection while the console acted on loiter, and the end-of-plan return-to-home chain, which gates on that value, was disarmed until the next plan start re-read the mission. Both values are now published on the state, the client reads the setting for the selector and the chain and the run value for the mode readout, and the selector mirrors the server's setting so the two cannot drift apart unnoticed."));
c.push(H3("5.1.2  ... and the END ACTION, which is what the operator asked"));
c.push(P("Neither field answers the question the cards are actually being read for: WHERE DOES THIS RUN LEAVE THE BOAT? The link holds at the last waypoint for both “loiter” and “rth”, and “rth” only becomes a return home because the CLIENT chains one on seeing that hold. So a Go-To or transit under End of Plan = RTH reported run completion “loiter” and every readout said the boat would stay at its endpoint — right up to the moment it turned for home. Each field was accurate about itself and wrong about the boat."));
c.push(P("`endAction()` in the client is the third value, and the only one the cards show. It is the run's own completion, upgraded to “rth” when the end-of-plan chain will fire, and downgraded from “rth” to “loiter” when it cannot: the chain needs a home, arming, no E-STOP, a run that actually ends (a repeat run laps forever and a complete run stops rather than holding), the LIVE setting rather than the frozen uploaded one, and a route home that was not refused. A card that promises a return the boat is not going to make is worse than one that never mentioned it."));
c.push(P("The chain is a one-shot per commanded run, and what re-arms it is the boat being UNDER WAY — not a run starting. The console lets a second Go-To be commanded while the first is still running, so the run state never leaves “running” and an idle-to-running edge never fires; that second run inherited a spent chain and held at its endpoint indefinitely. Invisible until the cards began naming the end state, at which point one sat there advertising a return home for five minutes."));
c.push(H2("5.2  SimVcu"));
c.push(P("The simulator: waypoint following by look-ahead line-of-sight guidance, a yaw-rate-capped heading response, a speed model, and a power model that is either battery voltage sag or diesel fuel burn depending on the vessel file. Wind and sea state from the environment monitor push it off track, and the guidance answers with a crab feedforward plus a cross-track integral term, the way a real autopilot does."));
c.push(H2("5.3  Supporting services"));
c.push(B("`CommsMonitor` — the radio link status readout."));
c.push(B("`WaterLevel` — real-time water level from public tide stations, ADDED to charted depths so the nogo model reflects the tide now, not the chart datum."));
c.push(B("`EnvMonitor` — real wind and wave observations near the vessel, feeding the simulator's environmental forcing. Simulation only."));
c.push(B("`RocTracker` — Remote Operations Centers and HOME selection (chapter 9)."));
c.push(B("`SessionLogger` — append-only JSONL recording of every command, setting and telemetry sample."));

// 6 -------------------------------------------------------------------------
c.push(H1("6  Client reference (static/asv.html)"));
c.push(P("One page, one classic script scope, no build step. It owns the slippy chart, the ENC feature set, all planning geometry, all route search, and every card."));
c.push(H2("6.1  Cards"));
c.push(TBL(["Card", "Purpose"], [
  ["Survey (`SURV`)", "Three-click survey pattern, spacing/direction, Punch Out, Add to plan"],
  ["Survey area (`BND`)", "Arbitrary boundary polygon that clips the pattern"],
  ["Search (`SRCH`)", "Canned search patterns: expanding box, sector, parallel track"],
  ["Transit (`TRAN`)", "Draw and follow a route with no survey plan"],
  ["Vessel status", "Live telemetry, water level, nogo, comms — and the MISSION block: one readout for every commanded run (type, waypoint progress, routed length, time to end, end mode, run time, status), shown only while there is a run to describe"],
  ["ROC · HOME", "Remote Operations Centers, recovery offsets, and HOME selection"],
  ["Environment (`ENV`)", "Wind and sea state, live or overridden"],
  ["Chart source (`SRC`)", "The ENC cell and zone-of-confidence under the vessel"],
  ["Survey lines (`LINES`)", "Per-line planned versus actual run times"],
  ["AIS", "Nearby traffic from the AIS service"],
], [2200, 7160]));
c.push(H2("6.2  Multi-monitor split"));
c.push(P("The console can run as two windows: a chart window and a controls window (`?panel=controls`), talking over a same-origin BroadcastChannel. The chart window is the single source of truth and owns all logic; the controls window renders no application logic, mirrors the control DOM, and forwards gestures back so every existing handler runs exactly once."));
c.push(P("CONSEQUENCE FOR NEW UI: every interactive element needs a stable, unique `id`. The bridge forwards controls by id, so an id-less control is inert in the controls window. Handlers should key off class or `data-*` attributes so they stay id-agnostic."));

// 7 -------------------------------------------------------------------------
c.push(H1("7  Behaviors, the nogo model and ENC-aware routing"));
c.push(P("Every behavior is chart-aware and arm-gated. Nothing moves the vessel until the operator arms."));
c.push(H2("7.1  The nogo model"));
c.push(P("Chart features are fetched from public electronic navigational chart services and reduced to keep-outs: shoreline, docks and piers, charted hazards, obstructions, and any water shallower than the vessel's derived minimum navigable depth. Charted depths are corrected by the live water level first. The result is a shared model that every behavior plans against, dilated by the vessel's nogo buffer."));
c.push(H3("7.1.1  Reporting the model's state"));
c.push(P("The vessel-status readout NAMES THE STATE rather than printing a count: reading the chart (with the elapsed seconds, so a chart service that has stopped answering does not look like a slow first fetch), a zone count with the vessel's own depth floor and a breakdown by keep-out kind, clear water, or the reason there is no model. The last two are the pair that matters. “The chart was read and there is nothing to avoid here” and “nothing has been checked, so every route is direct and unverified” both present as zero keep-outs and mean opposite things; only the second is a warning, and the readout must not let them look alike."));
c.push(P("Every state is derived from values the model already holds — whether an extract is in flight, whether a successful extract has ever landed, the reason recorded when one did not, and the keep-out counts — so there is no separate display state to drift out of step with what the behaviors route against."));
c.push(H2("7.2  Trusting the water level"));
c.push(P("Charted depths are corrected by the live water level before anything is classified as too shallow, so that correction is part of the safety model rather than a readout. A tide gauge reports the water level near ITS OWN station, and the console interpolates the nearest few \u2014 but if the nearest is hundreds of kilometres away, the number is another coast's tide."));
c.push(P("The reading is therefore banded by the distance to the nearest contributing station. Within a few tens of kilometres it is treated as local and applied normally. Further out it is applied but shown GHOSTED, because tidal range and phase drift materially over that distance. Beyond the remote threshold it is shown ghosted with an explicit warning and NOT APPLIED AT ALL: routing falls back to chart datum, exactly as it does when there is no data. Crediting the vessel with depth nobody has measured in that area is the same failure mode as trusting a charted symbol without its extent."));
c.push(P("The nearest station decides the banding, not the average of the contributors: an interpolation dominated by a close station is still local, and averaging would both discredit good readings and let two distant stations either side average into a falsely local one. An operator's manual override is always applied and never ghosted \u2014 it is their own number."));
c.push(H2("7.3  Charted hazards have an extent"));
c.push(P("A wreck symbol on a chart is a POSITION, not a size. The casualty beneath it can be a hundred metres long, and the electronic chart says nothing about its extent or which way it lies. Treating such a feature as a bare point and relying on the nogo buffer for clearance models a wrecked ship as a buffer-wide dot — a route then only has to miss the charted position by the buffer to validate clear."));
c.push(P("So hazards whose extent the chart does not give — wrecks, hulks, obstructions and awash rocks — carry an intrinsic radius, defaulting to 50 m and configurable per vessel, and the buffer is added ON TOP of it as the margin it was always meant to be. Objects that genuinely are point-sized, such as piles, buoys and beacons, are unaffected."));
c.push(P("Where the chart gives a sounding OVER the hazard, and that sounding — corrected to the live water level, exactly as depth areas are — clears the vessel's own navigability floor with margin, the vessel can pass over it and the hazard collapses back to a point. THE ABSENCE OF A SOUNDING MEANS UNKNOWN, and unknown takes the full berth rather than the benefit of the doubt."));
c.push(P("Both clearance paths honour this, and both must: the exact leg check that validates a planned path, AND the occupancy raster the route search runs over. If only the exact check knew about the extent, the search would plan straight through the hazard and the leg would simply fail — the vessel would get a refusal instead of a detour. A sized hazard also draws the circle the router keeps out of, so the operator can see why a route swings wide instead of reading a bare symbol as the whole danger."));
c.push(H2("7.4  Route search"));
c.push(B("Direct: an exact clearance check on the straight leg. If clear, done."));
c.push(B("`routeAroundSeg` — a fine sectioned search over a rasterized occupancy grid."));
c.push(B("Escalating swing regions when the detour leaves the search window — the grid coarsens, but the raster OVER-approximates keep-outs, so any coarse solution is genuinely clear and is then refined leg by leg."));
c.push(B("Fine-escape composition when a tight basin closes over the start or the goal: generate open-water escape candidates around the pinched end, route to one, then escalate from open water."));
c.push(P("The whole ladder runs under a time budget. An exhausted budget or a genuine absence of any clear path is reported as unroutable and refused, with the obstruction named. The console never plans a leg it has not verified."));
c.push(H2("7.5  The channel lane (COLREGS Rule 9)"));
c.push(P("In a narrow channel or fairway the vessel keeps to the starboard side. The lane is a purely geometric rule: offset to starboard of the channel centreline, half way out to the edge on that side — a quarter of the full width in from the edge. Buoy COLOUR is never an input; it falls out, because lateral marks sit on fixed sides. Opposing traffic therefore passes port to port."));
c.push(P("This applies to every mode — go-to, return-to-home, transit, the survey approach leg, inter-line transits, search transits and any routed detour. Survey coverage lines and generated survey turns are NEVER offset: they are planned geometry and must be run as planned."));

// 8 -------------------------------------------------------------------------
c.push(H1("8  Survey planning and turn geometry"));
c.push(H2("8.1  Pipeline"));
c.push(P("A three-click pattern (start corner, opposite corner, then a spacing and direction point) generates parallel lines filling the box. A centre MOVE GRIP translates every anchor by one delta, so the whole pattern moves with shape, spacing and direction preserved exactly. An optional boundary polygon clips the lines. Punch Out then trims everything to chart-clear water:"));
c.push(B("Clip every line to nogo-clear water, sampling at buffer resolution."));
c.push(B("Re-order the result so each obstacle-free region is run as its own serpentine and no leg is numbered through a keep-out."));
c.push(B("Shorten each segment at both ends to settle on-line and leave turning room."));
c.push(B("Generate a turn at every line-to-line reversal (below)."));
c.push(B("Route the remaining transits: straight if clear, else around the obstacle with the channel lane applied, else flag them."));
c.push(H2("8.2  Turn geometry"));
c.push(P("Every generated turn is built at a radius the vessel can actually HOLD at the plan speed — derived from the vessel file's maximum turn rate, with a margin for line-following overshoot. There are two shapes, and both are validated against the nogo model before use."));
c.push(TBL(["Shape", "When", "Geometry"], [
  ["Semicircle", "Line offset ≥ 2 × minimum radius", "One 180° arc of radius half the offset, bulging outboard; reaches exactly that radius past the line ends"],
  ["Teardrop", "Line offset < 2 × minimum radius", "Three tangent circles AT the minimum radius: a short arc away from the next line, a >180° loop over the top, a short arc onto the line"],
], [1500, 2800, 5060]));
c.push(SP());
c.push(P("DECOUPLING THE TURN RADIUS FROM THE LINE SPACING is the point of the second shape. A large, slow-turning vessel may need more radius than half the line spacing can ever supply; before the teardrop existed, such a vessel got no turn at all and the plan fell back to a straight hop between anti-parallel line ends — which is a 180° reversal at half the spacing, precisely the radius that had just been rejected as unflyable, only now unmodelled."));
c.push(P("The teardrop costs outboard water: up to roughly 2.75 times the minimum radius past the line ends, against one radius for the semicircle. Punch Out therefore reports the actual excursion, the spacing a plain semicircle would need at the plan speed, and the spacing needed at low speed, so widening the lines or slowing down stays the operator's decision. Where even the teardrop cannot fit clear of the keep-outs, the reversal falls back to a straight hop and the banner marks it UNTRACKABLE rather than clear."));
c.push(P("At exactly twice the minimum radius the teardrop's middle circle degenerates and the two shapes are the same semicircle, so the families agree on their shared boundary."));

// 9 -------------------------------------------------------------------------
c.push(H1("9  Remote Operations Centers and moving HOME"));
c.push(P("The operational paradigm: humans command the vessel from one or more Remote Operations Centers. A ROC has a position and a telemetry link. Two kinds exist and a mission may use both."));
c.push(B("SHORE ROC — near the launch harbour, or anywhere. A usually fixed point. The real launch and recovery point is OFFSET from the antenna by an operator-entered range and bearing."));
c.push(B("SHIP ROC (mothership) — aboard a vessel near the mission area. A MOVING point. Recovery happens at a range and bearing FROM the ship, so the offset bearing is normally taken RELATIVE to the ship's course."));
c.push(H2("9.1  Arrival point"));
c.push(P("Each ROC's arrival point is its position walked out along its offset. A `true` offset is a compass bearing; a `relative` offset is measured from the ship's course, so “50 m astern” stays astern as the ship turns. The operator selects one ROC as HOME; the Engine resolves it every telemetry tick, so when HOME is a ship it MOVES and return-to-home chases it."));
c.push(H2("9.2  Lifecycle"));
c.push(P("PLACE → EDIT → CONFIRM. A ROC is created by clicking the chart and comes up STAGED: its position, and for a ship its heading and speed, are edited while it sits still. CONFIRM makes it ACTIVE — a shore ROC becomes a usable HOME anchor, a ship starts steaming. HOLD stops a ship and returns it to STAGED. Only an ACTIVE ROC may be selected as HOME; the gate is a safety property, not decoration."));
c.push(H2("9.3  The chase"));
c.push(P("While a return-to-home follows a ROC, the run loop re-aims the vessel at the ROC's current arrival point, re-issuing a fresh single-waypoint plan only once the point has drifted past about half the arrival radius. This reuses the link's own waypoint following rather than introducing a separate pursuit controller. Any command that leaves the return-to-home run clears the chase."));
c.push(P("A ROC home is driven direct rather than by a chart-routed detour, because a detour computed to a moving recovery point would be stale by the time the vessel arrived."));
c.push(H2("9.4  Vessel-dependent behaviour"));
c.push(P("Two ROC values are derived from the active vessel and re-derived on a live vessel switch:"));
c.push(B("RECOVERY STANDOFF — the default astern offset for a new ship ROC scales with the hull (six lengths, with a small-boat floor) and may be overridden outright by `planning.roc.ship_recovery_m`. A fixed distance cannot serve both a two-metre vessel and a twenty-metre one."));
c.push(B("CLOSING CHECK — a return-to-home against a moving mothership only converges if the vessel can overhaul it. The console subtracts the ship's speed from the vessel's best speed and reports the closing rate; below a small margin the recovery point is marked unreachable and the run note says so. The same mothership speed is routine for a fast vessel and impossible for a slow one, so this cannot be a constant."));
c.push(H2("9.5  Position sources"));
c.push(P("A ROC position arrives three ways, all funnelling into one feed path: manually from the card, pushed by any external process to the API, or read from a real NMEA-0183 GPS stream over TCP or UDP. Sentences are checksum-verified and a void fix is rejected — a GPS feed is untrusted input. `gps_sim.py` is a faithful stand-in emitter for use when no hardware is present, and the console can spawn one per ROC automatically."));

// 10 ------------------------------------------------------------------------
c.push(H1("10  HTTP API reference"));
c.push(P("JSON in, JSON out. Command endpoints are refused unless the console is armed, and every refusal names its reason."));
c.push(TBL(["Endpoint", "Method", "Purpose"], [
  ["`/api/state`", "GET", "Current state snapshot"],
  ["`/events`", "GET (SSE)", "Live state stream"],
  ["`/api/vessel`", "GET / POST", "Active vessel configuration; POST switches vessel (gated disarmed + idle)"],
  ["`/api/vessels`", "GET", "Available vessel configurations"],
  ["`/api/connect`, `/api/disconnect`", "POST", "Attach or detach the VCU link"],
  ["`/api/cmd/arm`, `/api/cmd/estop`", "POST", "Arm gate and command e-stop"],
  ["`/api/cmd/upload`, `/api/cmd/start`, `/api/cmd/pause`, `/api/cmd/stop`", "POST", "Run control"],
  ["`/api/cmd/goto`, `/api/cmd/rth`, `/api/cmd/transit`, `/api/cmd/hold`", "POST", "Behaviors"],
  ["`/api/cmd/sethome`, `/api/cmd/spawn`, `/api/cmd/reset`, `/api/cmd/energy`", "POST", "Home, simulator placement, power-cycle, energy"],
  ["`/api/roc`", "GET / POST", "ROC registry, lifecycle, GPS attachment, HOME selection, position push"],
  ["`/api/mission`", "GET / POST", "Persisted mission plan"],
  ["`/api/enc`, `/api/chartinfo`", "GET", "Chart features and the cell / confidence under the vessel"],
  ["`/api/waterlevel`, `/api/tide`, `/api/env`", "GET / POST", "Water level, tide, environment"],
  ["`/api/ais`", "GET", "Nearby traffic, proxied from the AIS service"],
  ["`/api/logs`, `/api/logevent`", "GET / POST", "Session recordings and event injection"],
], [3400, 1500, 4460]));
c.push(SP());
c.push(P("`/api/roc` takes an `op` field: `add`, `update`, `offset`, `motion`, `confirm`, `hold`, `gps_attach`, `gps_detach`, `remove`, `select_home`, `clear_home`, `feed`. Every op returns the fresh snapshot so a client stays in sync without a second request. `feed` is the external position push — any GPS bridge or ship navigation system can post to it."));

// 11 ------------------------------------------------------------------------
c.push(H1("11  Data formats and persistence"));
c.push(TBL(["File", "Format", "Contents"], [
  ["`mission.json`", "JSON", "The committed plan: waypoints, survey lines, speed, arrival radius, completion mode, buffer"],
  ["`roc_config.json`", "JSON", "ROC definitions, placements and lifecycle state"],
  ["`vessels/<id>.json`", "JSON", "One vessel's complete configuration (chapter 4)"],
  ["`logs/*.jsonl`", "JSONL", "Append-only session recording: every command, setting, state transition and telemetry sample"],
  ["`charts/`", "Tiles + JSON", "Chart tile and ENC feature caches, regenerated at runtime"],
], [2300, 1400, 5660]));
c.push(SP());
c.push(P("Recordings are the input to the playback view, which replays a session read-only on the same chart: the vessel drives its recorded track, plans and commanded routes appear as they were sent, and a timeline lists every command and state transition including the refused ones."));

// 12 ------------------------------------------------------------------------
c.push(H1("12  Configuration and constants"));
c.push(P("Vessel-specific values are NOT listed here — they live in the vessel file (chapter 4). What follows is console-level."));
c.push(TBL(["Constant", "Default", "Meaning"], [
  ["Web port", "8791", "Console UI"],
  ["`NOGO_RADIUS_M`", "5000 m", "Operating-area half-extent; re-extract after 0.6 × travel"],
  ["`NOGO_MIN_DEPTH_M`", "vessel-derived", "Draft + under-keel clearance; water shallower is nogo"],
  ["`NOGO_BUFFER_M`", "vessel-derived", "Shared keep-clear buffer, operator-adjustable"],
  ["AIS display radius", "50 km (5–500)", "Also scales the upstream subscription; the two must move together"],
  ["Telemetry rate", "4 Hz", "Engine tick and SSE push"],
  ["Turn arc sampling", "~3 m", "Waypoint spacing along a generated survey turn"],
  ["ROC link thresholds", "5 s / 15 s", "Fresh → stale → lost for a live-fed ROC"],
], [2600, 1900, 4860]));

// 13 ------------------------------------------------------------------------
c.push(H1("13  Development practice and verification"));
c.push(H2("13.1  Regression harnesses"));
c.push(P("Fourteen regression suites guard behaviour that has bitten repeatedly. All run with no server and no third-party dependencies, and the pre-commit hook runs every one of them whenever a source they cover is staged."));
c.push(TBL(["Harness", "Guards"], [
  ["`node tests/buoy_lane.js`", "The Rule 9 channel lane: which side of a channel the vessel rides, marked and unmarked, both directions, and that a lone buoy is not treated as a wall"],
  ["`node tests/turn_geometry.js`", "Survey turns: shape selection, the minimum radius held along the WHOLE path, exit alignment, outboard excursion, and nogo refusal paired with its clear-water twin"],
  ["`python tests/roc_tracks.py`", "ROC arrival geometry, the staged/active HOME gate, moving HOME, NMEA validation, and that every vessel-derived default tracks the vessel"],
  ["`python tests/completion_modes.py`", "The operator's end-of-plan SETTING versus the completion of the run in progress: that a behaviour can never change the setting, and that a plan run adopts it. Drives a real console over the API."],
  ["`node tests/water_trust.js`", "That a live water level from a distant tide station is flagged as such rather than shown as if it were local, and that the nearest contributing station decides the banding."],
  ["`node tests/wreck_clearance.js`", "Charted point-hazard extent: that a wreck keeps a route off it in BOTH the exact check and the search raster, that a charted sounding over it is honoured and tide-corrected, that point-sized marks are unaffected, and that the vessel's buffer floor holds"],
  ["`node tests/end_action.js`", "That the cards name where the run leaves the vessel: an end-of-plan return-to-home shows on a Go-To, a transit and a survey alike from the START of the run; that it is not promised when the chain cannot fire; and that the one-shot re-arms for a run commanded while the vessel is already under way"],
  ["`node tests/nogo_readout.js`", "The keep-out readout's state: that it stops reporting “reading” once the extract has landed (driven end to end through the real refresh path, because the fault was statement ORDER, not wording), and that “clear water” and “no chart at all” — both of which are zero keep-outs — never read as the same thing"],
  ["`node tests/pattern_move_grip.js`", "That the survey pattern’s whole-move grip is both REACHABLE (hit test, corners still winning ties so a small pattern stays reshapeable) and VISIBLE — it is drawn last, above the vessel marker that used to cover it completely, since the vessel sits at the centre of a survey box more often than not"],
  ["`node tests/survey_card.js`", "That a committed survey plan is still described on the planning card rather than blanking when its pattern anchors are dropped, and that the figures are DERIVED from the committed lines - self-validating on parallelism, so a non-parallel search pattern is not given a meaningless spacing"],
  ["`node tests/speed_recalc.js`", "That the plan speed is treated as an INPUT: changing it recalculates the turn geometry, durations and per-line times, and a plan already committed - whose turn waypoints cannot be rebuilt - is re-checked against the minimum turn radius the new speed implies"],
  ["`python tests/live_speed.py`", "That a commanded speed change REACHES the vessel rather than only the readout: with the vessel under way, speed over ground follows the command in both directions. Drives a real console and lets the vessel accelerate, because accepting the command proves nothing"],
  ["`python tests/ais_range.py`", "That the traffic display range filters a wider collected subscription as a true range circle rather than a bounding box, is clamped to what was collected, and is never applied on an enclosed lake where the whole lake is shown. Runs against a stub provider at known ranges"],
  ["`node tests/ui_split.js`", "That every selector the two-window bridge names still resolves against the page - a stale one fails silently, with a panel simply ceasing to mirror - and that the vessel-status card renders on the chart window only, neither mirrored into the controls window nor stripped from the chart"],
], [2700, 6660]));
c.push(SP());
c.push(P("Enable the hook once per clone with `git config core.hooksPath .githooks`."));
c.push(H2("13.2  How these harnesses work, and how they break"));
c.push(P("The browser-side harnesses EXTRACT the real functions out of `static/asv.html` by brace matching and run them in Node against synthetic worlds. This tests the shipping code rather than a copy — but it also means the harness ENUMERATES the functions it extracts, so it breaks silently when the code under test gains a new dependency. Treat “harness crashed” exactly as loudly as “check failed”: a suite that cannot run protects nothing, and a suite that prints success while testing dead code is worse than none at all."));
c.push(H2("13.3  Tests with teeth"));
c.push(P("A check that cannot fail is not a check. Every harness in this repository has been verified by MUTATION: deliberately breaking the behaviour under test and confirming the specific assertions fail. Where a test asserts that something is refused, it is paired with a case proving the same input is ACCEPTED under valid conditions — otherwise a function that refused everything would pass."));
c.push(H2("13.4  What static checks cannot catch"));
c.push(P("A clearance check on a PLANNED path does not catch FOLLOW OVERSHOOT. An idealised arc can validate perfectly clear and still be tighter than the vessel can hold, in which case the vessel overshoots outboard — into the very keep-out the arc was hugging. Turn geometry must therefore be verified with a live simulation run sampling vessel-versus-nogo at zero buffer, not with geometry alone. This is why the minimum turn radius exists."));

// 14 ------------------------------------------------------------------------
c.push(H1("14  Known limitations and roadmap"));
c.push(B("`RealVcu` command and telemetry codecs are unimplemented by design. The console is a simulator; the real link refuses honestly rather than pretending."));
c.push(B("The simulator caps yaw RATE, not radius, so the modelled minimum turn radius grows linearly with speed. Real hulls hold a roughly constant minimum radius. The cap is calibrated at survey speed, which is where surveys are planned, and is pessimistic at high speed."));
c.push(B("Raw API command and upload calls with no supplied route BYPASS chart-aware routing, because routing is client-side. Rehearse through the interface, or place raw waypoints in open water."));
c.push(B("Chart scale and currency vary. The console is a planning AID and says so in a banner; it is not hydrographically certified, and the operator remains responsible for the plan."));
c.push(B("Traffic data comes from a crowd-sourced network with real coverage gaps. A quiet area is reported as “connected, no vessels reporting” rather than as an error, because those are different conditions."));

// 15 ------------------------------------------------------------------------
c.push(H1("15  Extension guide"));
c.push(H2("15.1  Adding a vessel"));
c.push(P("Write `vessels/<id>.json`. No code changes. See chapter 4."));
c.push(H2("15.2  Adding a behavior"));
c.push(P("Add the command endpoint to the server, a method on `Engine` that builds a route and calls the shared run-route path, and a client function that plans the route against the nogo model before uploading it. Reuse the existing route search and channel lane rather than adding a parallel mechanism — a behavior that routes its own way will diverge from every other behavior the first time the router improves."));
c.push(H2("15.3  Adding a vessel-dependent value"));
c.push(P("Put the field in the vessel schema with a derived fallback so older vessel files still load, read it in `apply_vessel()` so a live switch re-derives it, mirror it to the client through `/api/vessel` if the browser needs it, and add a regression assertion that the value actually CHANGES between two different vessels. That last step is what catches a value that was wired up but never re-derived."));
c.push(H2("15.4  Adding UI"));
c.push(P("Give every interactive element a stable unique id (the multi-monitor bridge forwards by id), key handlers off class or `data-*`, register any new pop-out card in the bridged-selector list and the card-title map, and rebuild card rows only when the underlying SET changes — rebuilding on every telemetry frame will clobber a field the operator is typing into."));
c.push(H2("15.5  House rules"));
c.push(B("No hardcoded vessel constants. Ever. The vessel file is the single source of truth."));
c.push(B("Keep the console core vendor-neutral. Vessel files may name real vessels; the console may not."));
c.push(B("Never weaken the safety model: arm-gating, e-stop, link-loss failsafe and the refusal-with-a-reason contract."));
c.push(B("Update the relevant README in the same change as the behaviour it documents, and rebuild this manual from its script."));

// ---- document --------------------------------------------------------------
write("asv-simulator-technical-manual.docx", c);
