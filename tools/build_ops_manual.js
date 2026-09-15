// Build: ASV Simulator - Operations Manual (operators)
//
// GENERATED - edit this script and rebuild; never hand-edit the docx.
//   cd tools && npm install && node build_ops_manual.js
// Writes ../docs/asv-simulator-operations-manual.docx (path is script-relative).
//
// AUDIENCE: the person at the console with a vessel in the water. It answers "what do I
// press, what will happen, and how do I know it worked" - not "how is it built", which is
// the technical manual's job. Where the two overlap, this one states the OPERATIONAL
// consequence and leaves the mechanism to the other.
//
// BRAND-FREE BY RULE - see docx_kit.js.
const { P, H1, H2, H3, B, B2, CODE, TBL, SP, NOTE, TITLE, write } = require("./docx_kit");

const c = [];

c.push(TITLE("ASV Simulator"));
c.push(P("Operations Manual — planning, commanding and monitoring an autonomous surface vessel", { size: 24, color: "2e5f8a" }));
c.push(P("For the operator at the console. Covers the safety model, the display, chart awareness, every commanded behavior, survey and search planning, mission execution, contingencies, and session review. The console drives a simulated vessel and a real one identically, so everything here applies to both — the differences are called out where they exist.", { italics: true }));
c.push(SP());

c.push(H1("Contents"));
[
  "1  Before you start — what this console is, and is not",
  "2  The safety model",
  "3  Starting the console",
  "4  Reading the display",
  "5  Choosing the vessel",
  "6  Chart awareness and the keep-out model",
  "7  Environment, tide and the water level",
  "8  Direct behaviors — Go-To, Transit, Hold, Return-to-Home, Set Home",
  "9  Planning a survey",
  "10  Search patterns",
  "11  Running a mission",
  "12  Remote Operations Centers and a moving HOME",
  "13  Contingencies — what goes wrong and what to do",
  "14  Session recording and playback",
  "15  Working across your screens",
  "16  Checklists and quick reference",
  "17  Glossary",
].forEach(t => c.push(B(t)));

// 1 ---------------------------------------------------------------------------
c.push(H1("1  Before you start — what this console is, and is not"));
c.push(P("This is a SHORE STATION. It plans work, sends commanded motion to the vessel, and shows you what the vessel reports back. It is deliberately ADDITIVE to the vessel's own control chain: it cannot touch the radio-control transmitter's autonomy switch, it cannot override the vessel's own emergency stop, and it never assumes command it has not been explicitly given."));
c.push(P("It also drives a full simulator of the same vessel. The simulated vessel follows waypoints with the same guidance law, drains the same energy model, and is pushed off track by real wind and wave observations — so a mission can be rehearsed end to end, against the real chart of the real operating area, before anything gets wet. Everything in this manual works the same way in both modes. Three controls are simulator-only and are marked as such."));
c.push(H2("1.1  What the console will not do for you"));
c.push(B("It will not decide that a plan is SAFE. It routes clear of what the chart knows about. The chart does not know about the workboat that moored there this morning."));
c.push(B("It will not act on a chart it does not have. With no chart coverage it says so, plainly, and drives direct — see 6.4."));
c.push(B("It will not recover the vessel for you if the radio link fails. It stops commanding and surfaces the vessel's own failsafe. The transmitter is the recovery tool."));
c.push(B("It will not guess. Every refusal names its reason and highlights the offending feature on the chart. A refusal is information, not an obstacle to work around."));
c.push(NOTE("CAUTION", "Nothing in this manual replaces a competent operator watching the vessel. Charted data is a planning aid with a known confidence (6.3) and a known age. Keep eyes on the water."));

// 2 ---------------------------------------------------------------------------
c.push(H1("2  The safety model"));
c.push(P("Four rules govern everything the console can do. They are not configurable, and no procedure in this manual asks you to work around them."));
c.push(H2("2.1  The transmitter is master"));
c.push(P("The radio-control transmitter holds the autonomy switch and the true emergency stop. The console is downstream of both. If the transmitter takes manual control, commanded motion stops mattering; if the transmitter's emergency stop is used, the vessel stops regardless of anything on screen. The console's own E-STOP is a COMMAND-SIDE cut — it is genuinely useful and it is not the last line of defense."));
c.push(H2("2.2  The console comes up SAFE"));
c.push(P("On connection the console is read-only. It shows position, heading, speed, energy and link state, and it will not actuate anything. The autonomy pill reads SAFE. Every command that could move the vessel is gated behind an explicit ARM, and arming is a deliberate act that reminds you to confirm the transmitter's autonomy switch is forward."));
c.push(H2("2.3  Link loss resolves toward safe"));
c.push(P("If telemetry stops arriving for roughly three seconds the console auto-disarms, stops commanding, and reports the vessel's own failsafe behavior — motors to zero, steering straight. It NEVER auto-resumes when the link returns. Recovering an autonomous run after a dropout is an operator decision, taken with eyes on the vessel."));
c.push(H2("2.4  A refusal is a result"));
c.push(P("When a commanded motion cannot be planned clear of the keep-out model, the console refuses it, names the reason in plain language, and pulses the offending feature on the chart with a cross. It does not silently plan something else, and it does not quietly degrade to a straight line without saying so. If you see a refusal, the answer is to change the plan, relax a keep-out deliberately, or accept manual control — not to retry until it takes."));
c.push(TBL(["Safety state", "What it means", "How you leave it"], [
  ["`safe`", "Connected, disarmed. Nothing will actuate.", "Arm"],
  ["`armed`", "Commanding enabled, no run active.", "Command a behavior, or disarm"],
  ["`auto`", "Running an autonomous survey / search / transit.", "Pause, Stop, or let it finish"],
  ["`hold`", "Station-keeping — arrived at a point, or a loiter.", "Command something else"],
  ["`paused`", "Mid-run, holding the next waypoint.", "Start resumes; Stop aborts"],
  ["`e-stop`", "Command-side motor cut latched, force-disarmed.", "Clear E-STOP, then re-arm"],
  ["`failsafe`", "Telemetry lost ~3 s. Auto-disarmed, vessel failsafe surfaced.", "Take the transmitter"],
], [1500, 5560, 2300]));

// 3 ---------------------------------------------------------------------------
c.push(H1("3  Starting the console"));
c.push(H2("3.1  Launching"));
c.push(CODE([
  "python asv_console.py --sim                 # simulator, opens a browser",
  "python asv_console.py --sim --single-window # simulator, one window only",
  "python asv_console.py --vcu <host>          # a real vessel over the control link",
  "python asv_console.py --sim --vessel <id>   # start on a specific vessel profile",
  "python asv_console.py --sim --browser none  # headless (testing)",
]));
c.push(P("The console serves its interface on a local web port and opens it for you. By default it opens FOUR windows — a chart window, a controls window, a tide window and a weather window, the last two showing the official NOAA pages for the water-level station and the weather buoy nearest the vessel — all covered in section 15. `--single-window` keeps the console itself in one window; `--no-tide-window` and `--no-weather-window` skip the third and fourth."));
c.push(H2("3.2  Useful start-up options"));
c.push(TBL(["Option", "Effect"], [
  ["`--vessel <id>`", "Start on a named vessel profile instead of the default"],
  ["`--port <n>`", "Serve the interface on a different port"],
  ["`--single-window`", "Do not open the separate controls window"],
  ["`--ais-radius-km <n>`", "Traffic display + subscription radius (default 50; widen where receiver coverage is sparse)"],
  ["`--no-ais-service`", "Do not start the traffic provider"],
  ["`--no-log`", "Do not record the session"],
  ["`--fetch-charts \"LAT,LON,RADIUS_KM\"`", "Pre-cache chart tiles for an operating area before going offline"],
], [2600, 6760]));
c.push(NOTE("BEFORE A JOB", "If the operating area has poor connectivity, pre-cache the chart with `--fetch-charts` while you still have a network. The keep-out model and the chart display both come from cached data once fetched."));
c.push(H2("3.3  First-run orientation"));
c.push(P("A Quick Start card opens the first time, and afterwards from the `?` button in the lower-left corner. The console remembers your window layout, card positions and display toggles between sessions."));
c.push(P("Saved card positions are always kept on the chart. If you place a card near the edge on a large display and later open the console in a smaller window, it is drawn at the nearest position that keeps it fully visible instead of off the edge where you could not reach it. Your saved position is not overwritten — widen the window again and the card returns to exactly where you put it. If a card ever appears to be missing, reloading the page brings it back. The CONTROLS WINDOW’S cards keep the same promise: a card whose saved position falls outside a smaller window is drawn at the nearest reachable spot — grip and resize handle on screen — while its saved position is preserved for the larger display it was set on. Dragging a card re-places it for good."));
c.push(P("OPENING A CARD NEVER CHANGES WHAT YOU ARE DRAWING. A card — `LINES`, `AIS`, `SRC`, `ROC` — is a thing to look at, not a tool: opening one leaves the chart tool you had selected (`WPT`, `SURV`, `BND`, `SRCH`, `TRAN`) selected, and its panel open, so you can check HOME or a contact mid-layout and carry straight on. Arming a ROC PLACEMENT with `+ Shore` or `+ Ship` is the exception, and deliberately so: the next click on the chart has to mean “put it here”, so it takes over from the tool you were using."));

// 4 ---------------------------------------------------------------------------
c.push(H1("4  Reading the display"));
c.push(H2("4.1  The chart"));
c.push(P("A slippy nautical chart centered on the vessel. `+` / `−` zoom; drag to pan; BOAT re-centers and keeps the vessel centered as it moves. The vessel draws as a filled marker with a heading line. Its track paints behind it and persists across a page refresh within a session — it is dropped when the simulator is power-cycled, because that track belongs to a run that no longer exists."));
c.push(P("RIGHT-CLICK ANYWHERE ON THE CHART for a menu of the point commands. Its header shows the position you clicked, and this is where GO-TO, SPAWN and SET HOME now live — they are no longer on the command bar, because each was a two-step control (arm a button, then click the chart) and the menu already carries the point."));
c.push(TBL(["Row", "Does"], [
  ["Measure distance", "The chart ruler — click, move, click. See 4.5"],
  ["Clear measurements", "Removes every measurement drawn"],
  ["Go-To here", "Drives to the clicked point and station-keeps (8.1). Needs ARMED, no E-STOP"],
  ["Set Home here", "Moves HOME to the clicked point (8.5). Needs a live link; warns if the point is a keep-out"],
  ["Spawn here", "Simulator: places the vessel at the clicked point (8.6)"],
  ["Copy position", "Puts the clicked coordinate on the clipboard"],
], [2100, 7260]));
c.push(P("A row that cannot act right now is grayed and SAYS WHY beside itself — `arm first`, `no link`, `sim only`. The menu is a shortcut past the arming STEP, never past the arm GATE: the rules are the same ones the safety model applies everywhere else, and they are checked as the menu opens, so a row closes the moment an E-STOP is latched."));
c.push(P("Escape closes the menu, as does clicking elsewhere. A click that closes the menu does nothing else, so you cannot dismiss it and place something by accident."));
c.push(H2("4.2  The top status bar"));
c.push(P("Always visible, and the fastest read on the vessel:"));
c.push(TBL(["Field", "Meaning"], [
  ["link dot + text", "Connection mode and health"],
  ["autonomy pill", "SAFE / ARMED / AUTO / HOLD / E-STOP — the safety state from 2.4"],
  ["`POS`", "Position"],
  ["`SOG`", "Speed over ground"],
  ["`HDG` / `COG`", "Heading, and course actually made good. They differ by the crab angle when wind or sea sets the vessel off its bow line."],
  ["`HOME→`", "Bearing and range from HOME to the vessel"],
  ["`PITCH` / `ROLL`", "Attitude"],
  ["`BATT` or `FUEL`", "Energy remaining. Which one appears depends on the vessel. Clicking the pill toggles the energy OVERRIDE — the gauge reports full and, in the simulator, the drain/burn stops; the pill shows magenta while it is on. A testing aid, applied in every mode, running or not, connected or not."],
  ["`WPT`", "Waypoint progress through the uploaded route"],
  ["`DIST`", "The distance display unit — click to switch every LONG distance between kilometers and nautical miles (persisted). See the note below for what deliberately does not follow it."],
  ["`TIME`", "Local · UTC"],
], [1900, 7460]));
c.push(NOTE("DISTANCE UNITS", "The DIST pill changes DISPLAY only — every stored and transmitted value stays metric, so nothing about the mission, the vessel files or the wire changes with it. It applies to LONG distances: route lengths, distance remaining, HOME range, off-track distance and tide-station distances. Three families deliberately do NOT follow it: SHORT distances (line spacing, buffers, draft, depths and the LINES table) always read in meters, because 25 m of spacing is an unusable 0.0135 nm; chart-tile soundings stay in feet, as charted; and the AIS card always reads nautical miles, whatever the pill says. In the two-window layout the choice applies to both windows at once."));
c.push(H2("4.3  The vessel-status card"));
c.push(P("The detailed read, in one card: autonomy, speed, heading, course, bearing and range from home, attitude, wind, sea state, environmental set and crab, energy, water level, the keep-out model state, and a communications signal bar. Drag its header to move it; close it with the `×` and bring it back with the VESSEL pill."));
c.push(H3("4.3.1  The RUN block"));
c.push(P("While any run is planned or active, a RUN block appears in the same card — one readout that covers EVERY commanded run, whether it is a survey, a search, a Go-To, a transit or a return home:"));
c.push(TBL(["Row", "Reads"], [
  ["Type", "The behavior running"],
  ["Waypoint", "Progress along the uploaded route, or the planned count before Upload"],
  ["Length", "Total routed run length, including the approach"],
  ["To end", "Distance and time remaining, from live speed when moving"],
  ["End mode", "WHERE THIS RUN LEAVES THE VESSEL — see 11.5"],
  ["Run time", "Elapsed, estimated remaining, percent complete"],
  ["Survey / Approach", "Estimated coverage time and transit-in time from the last Punch Out"],
  ["status line", "Plain language: running with percent, paused, loading, arrived, drifting, or the end state"],
], [1900, 7460]));
c.push(H2("4.4  Banners and the note line"));
c.push(P("A banner across the chart reports what a command actually did — the route it planned, how many waypoints, whether it rode a channel lane, and any warning attached to it. The note line under the status bar carries the vessel's own last message. READ THE BANNER AFTER EVERY COMMAND. It is where the console tells you it degraded something."));
c.push(P("Where a route rides a channel lane, the lane always YIELDS to the nogo model: if the buoyed fairway’s geometry would cross a charted obstruction — a seawall the channel hugs, a pier inside the fairway line — the route detours around it and rejoins the lane, and every leg of the shipped plan passes the same clearance test the obstacle search uses. If no lawful lane is possible, the plan falls back to the plain obstacle-clear route and the banner drops its Rule 9 note rather than claim a lane that was abandoned."));
c.push(H2("4.5  Measuring on the chart"));
c.push(P("Right-click and choose MEASURE DISTANCE, then click a point, move the pointer, and click again. The line follows the pointer as you move, and the reading runs ALONG it — distance and true bearing — so you read it without taking your eye off the leg you are measuring. Lay down as many as you need: the tool stays armed and finished measurements stay on the chart until you clear them."));
c.push(P("The distance follows the DIST unit on the top status bar, exactly like every other long distance on the console: switch to nm and every measurement on the chart converts with it. Anything under a kilometer reads in meters in both modes. The bearing is TRUE, in three digits."));
c.push(P("To clear them: press Escape, or right-click and choose CLEAR MEASUREMENTS. Escape works through them one layer at a time — first a half-drawn line, then the finished measurements, then the tool itself — so a single press never takes more than you were looking at. DRAGGING STILL PANS THE CHART while the tool is armed, so you can measure across water wider than the screen."));
c.push(NOTE("A MEASUREMENT IS YOURS, NOT THE VESSEL'S", "The ruler is an annotation and nothing more. It is drawn in magenta — the color a paper chart reserves for the mariner's own markings, and the one color on this display that is never a plan — so it can never be confused with something the vessel will drive. Measurements are not uploaded, not saved with the mission, not sent to the vessel, and not written to the session record. They disappear when you reload the page."));

// 5 ---------------------------------------------------------------------------
c.push(H1("5  Choosing the vessel"));
c.push(P("The console models a specific vessel, and almost everything downstream depends on which one: speeds, turn rate, how tight a turn a survey can ask for, how much energy is left, how deep the water must be before it is navigable, and how far off charted structures the vessel plans."));
c.push(P("Pick the active profile from the vessel selector in the top bar. THE SWITCH IS GATED: it is only allowed when disarmed and with no run in progress. In the simulator the vessel respawns at the new profile's own operating area."));
c.push(NOTE("WHY IT MATTERS", "Selecting a vessel changes the keep-out model. The minimum navigable depth is that vessel's own draft plus its under-keel clearance — so a deep-draught vessel refuses water a shallow-draught one crosses without comment. Never plan against one profile and run against another."));

// 6 ---------------------------------------------------------------------------
c.push(H1("6  Chart awareness and the keep-out model"));
c.push(H2("6.1  Layers"));
c.push(TBL(["Toggle", "Shows"], [
  ["`CHRT`", "Charted features fetched for the operating area — shoreline, structures, depth areas, hazards, marks"],
  ["`NOGO`", "The keep-out overlay: everything commanded motion will refuse to cross"],
  ["`AREA`", "The survey-area boundary polygon"],
  ["`AIS`", "Nearby traffic, with an openable table"],
  ["`SRC`", "The chart's own title block and survey confidence"],
], [1400, 7960]));
c.push(H2("6.2  What the keep-out model contains"));
c.push(P("Built automatically on the first position fix, and re-extracted as the vessel moves out of the area it was built for. It contains charted land and shoreline; docks, piers and other structures; charted hazards — wrecks, obstructions, awash rocks — carrying their real extent rather than being treated as pin-pricks; and any water shallower than THIS vessel's floor, corrected for the live water level."));
c.push(P("Every commanded motion plans clear of it: Go-To and Return-to-Home route around it or refuse an unreachable target, survey and search legs clip out of it, and the transit to the survey plus every inter-line transit are routed clear at Upload."));
c.push(H3("6.2.1  Reading the Nogo row"));
c.push(P("The vessel-status card's Nogo row names which of four situations you are in. They are NOT interchangeable:"));
c.push(TBL(["Reads", "Means"], [
  ["`reading chart… 6 s`", "An extract is in progress. The seconds count up, so a chart service that has stopped answering does not look like one that is merely slow."],
  ["`334 zones · floor 2.3 m`", "Model built. The floor is this vessel's own. Hover for a breakdown by kind — structures, shoreline, hazards, shallow water, land, marks."],
  ["`clear — none charted`", "The chart WAS read and there is genuinely nothing to avoid here."],
  ["a reason, in amber", "There is NO model. Every route will be direct and unverified."],
], [2400, 6960]));
c.push(NOTE("THE DISTINCTION THAT MATTERS", "“Clear water” and “no chart” both mean zero keep-outs and mean opposite things. Only one of them is safe to plan against. The row is amber for the other."));
c.push(H2("6.3  Survey confidence — the SRC card"));
c.push(P("The chart's answer to a paper chart's title block: which cell you are in, its scale band, the depth datum and the live correction being applied, and — the part a printed title block cannot give you — the zone of confidence UNDER THE VESSEL RIGHT NOW, with the survey dates behind it, re-evaluated as the vessel moves. Poor confidence classes are flagged amber as you enter them."));
c.push(P("EVERY CHART IN VIEW IS LISTED, one per line, broadest scale first, with its usage band spelled out beside it. The cell the vessel is actually in is marked with a bullet and named underneath in words. This matters because a survey routinely spans several cells: the sheet you are floating on says nothing about the scale, survey dates or currency of the ones your lines are about to run over. Where several charts of different scales overlap the same water, the one named as the vessel's is the LARGEST-SCALE cell covering it — the sheet you are bound to navigate by — and the card says how many cover the vessel in total. If the vessel is inside none of the listed cells, the card says that too rather than promoting a neighbor."));
c.push(NOTE("UNITS", "The rendered chart image prints soundings in FEET. Everything the console computes, logs and displays — the depth floor, corrected depths, the keep-out model — is in METERS. The card states both. This is a property of the chart service, not an error."));
c.push(H2("6.4  Keeping right in channels"));
c.push(P("Every TRANSIT — Go-To, Return-to-Home, a drawn transit line, the approach leg into a survey, the routed transits between survey lines, search-pattern transits, and any obstacle detour — rides a lane offset to STARBOARD of the channel centerline, about a quarter of the channel width in from the edge, so the centerline always stays to port. Opposing traffic therefore passes port to port. It works both in marked channels and in unmarked confined water, and the banner reports when a plan rode the lane. Survey coverage lines and the turns between them are never offset — they are the work, not a transit."));
c.push(H2("6.5  Traffic"));
c.push(P("`AIS` overlays nearby vessels as triangles pointing along their course and colored by type, with an openable table sorted nearest-first giving range, bearing and speed. This is SITUATIONAL AWARENESS ONLY — commanded motion does not avoid traffic. Coverage depends on the data source: it is crowd-sourced in places and genuinely sparse in some operating areas, and an empty table can mean an empty sea or no receiver nearby. The table says which."));
c.push(P("RANGE. The traffic card has a range control in NAUTICAL MILES — the same unit the contact list reports each vessel's range in. It is a FILTER on an area the service has already collected, not a new subscription — so widening it is instant, and it will not go beyond what was collected (the control snaps back if you ask for more). The row beside it reads something like “3 of 6 in 81 nm”, so you can tell an empty sea from a view you narrowed yourself. ON A GREAT LAKE THE CONTROL DOES NOT APPLY: the area is the whole lake and every contact is shown, and the card says so rather than appearing to ignore you."));
c.push(NOTE("STARTING UP", "The two command-line flags that set the AIS area are still in kilometers and say so in their names — --ais-radius-km sets what the card opens showing, --ais-collect-km how wide an area the service subscribes to. The card converts for display, so a default of --ais-radius-km 50 opens the control at 27 nm."));
c.push(P("AN EMPTY CARD TELLS YOU WHICH KIND OF EMPTY. If the service is tracking traffic but all of it lies beyond your range, the card reads “none within 27 nm · nearest 44 nm of 94 tracked” — the feed is healthy and the answer is to widen the range. If it reads “no vessels in 27 nm yet”, nothing is being tracked anywhere in the collected area at all. That is not necessarily a fault either: the public AIS feed is assembled from volunteer shore receivers, and some waters simply have no receiver near them. Measured at the Lewes base, where the feed was healthy and tracking 94 vessels with the closest 44 nm away — nothing in the lower Delaware Bay was reported at all. Where local traffic matters, feed the console a receiver of your own — see MANY FEEDS below — which runs alongside the public feed."));
c.push(P("AND A THIRD KIND, which is neither: if the feed itself reports a fault — an invalid API key, a connection limit — the layer status shows the upstream’s own message, for example “aisstream: Api Key Is Not Valid”, instead of “connected”. An error the upstream names is never displayed as a quiet sea; if you see one, the fix is at the key or account, not the chart."));
c.push(P("MANY FEEDS, ONE PICTURE. The layer can run several sources at once and always shows ONE merged picture — a vessel reported by two feeds is one triangle, not two. Add a local receiver (an RTL-SDR running AIS-catcher or rtl-ais) with --ais-nmea udp:10110, repeatable for several receivers at once; add OpenCPN, relaying everything it aggregates, with --ais-opencpn 10110 after enabling an Output network connection (TCP, port 10110) in its Connections options; an AISHub member account joins with --ais-source auto,aishub once its username is set (setx AISHUB_USER ...; membership requires contributing a feed). Naming an endpoint enables its source by itself. Each feed keeps its own health in the table's status line, and one dead feed beside a live one reads as a note, not an outage — the layer only calls itself in error when EVERY feed is failing. A slow feed can never drag a live one backwards: a polled report older than the position already shown is discarded, though its vessel name and type still fill in."));

// 7 ---------------------------------------------------------------------------
c.push(H1("7  Environment, tide and the water level"));
c.push(H2("7.1  The water level is part of the safety model"));
c.push(P("Charted depths are referenced to a datum, not to the water that is there now. The console fetches the live level from public tide stations and ADDS it to charted depths before deciding what is too shallow. That correction is not a readout — it changes which water the vessel will enter. It is kept current: as the level changes during a run, the keep-out model is rebuilt, so water and charted rocks that a falling tide makes too shallow come back into the model the routes and the clearance guard use."));
c.push(H2("7.2  How far away is the tide you are using"));
c.push(P("A tide gauge reports the level near ITS OWN station. The console interpolates the nearest few and bands the result by distance to the nearest contributing one:"));
c.push(TBL(["Band", "Shown as", "Applied to depths?"], [
  ["local", "Normal", "Yes"],
  ["far", "Ghosted and italic — indicative only", "Yes"],
  ["remote", "Heavily ghosted, amber, stated plainly", "NO — routing falls back to chart datum"],
], [1400, 4960, 3000]));
c.push(P("A reading from another stretch of coast is shown so you can see what it says, and is not allowed to credit the vessel with depth nobody has measured here. An operator's manual override is always applied and never ghosted — it is your number."));
c.push(NOTE("RESIDUAL RISK", "The chart datum is a LOW-water reference, so when no correction is applied, charted depths are conservative — except when the real tide is BELOW datum, where they become optimistic. If you are working a big negative tide, set the water level manually."));
c.push(H2("7.3  When the tide service cannot be reached"));
c.push(P("The console keeps asking the public tide service for the level, and simply falls back to chart datum when it cannot get one — the conservative direction. The WATER LVL row on the vessel-status card is where you see what is being applied, and the chart-source card states the correction together with the datum it corrects to."));
c.push(P("A failure at the far end therefore costs you the correction, not the run. If you need one while the service is down, enter the water level by hand — a manual override is always applied, and it is the answer for a big negative tide."));
c.push(NOTE("NOT A VESSEL FAULT", "A tide failure is an outage at a public data service, not a problem with the boat. The console keeps running and simply falls back to chart datum for depth decisions, which is the conservative direction. If you need a correction while the service is down, enter the water level by hand — a manual override is always applied."));
c.push(H2("7.4  Wind and sea"));
c.push(P("Real wind and wave observations from nearby public buoys push the SIMULATED vessel off track. THERE IS NO ENVIRONMENT CARD — it has been removed. What the weather is DOING to the vessel is reported on the vessel-status card, which is what you steer by: WIND (speed and the direction it blows FROM), SEA (height, period and direction), and SET / CRAB — the resulting drift and the angle the vessel is holding into it to stay on the line."));
c.push(NOTE("SIMULATOR ONLY", "Environmental forcing is a property of the simulator. Against a real vessel the observed conditions are still reported, but nothing the console does changes how the vessel behaves — the water does that."));
c.push(P("The forcing can still be overridden or switched off, but over the API only (`POST /api/env` with any of the wind and sea fields, or `enabled:false` for a deterministic calm run). Nothing on screen changes it any more, which is deliberate: it is a rehearsal control, not a helm control."));

// 8 ---------------------------------------------------------------------------
c.push(H1("8  Direct behaviors"));
c.push(P("These need no survey plan. All of them require ARM, and all of them route clear of the keep-out model."));
c.push(H2("8.1  Go-To"));
c.push(P("RIGHT-CLICK the point and choose GO-TO HERE. The vessel drives there, around anything in the way, and station-keeps on arrival. The banner reports whether the route was direct or routed and how many waypoints it used. If no clear route exists the command is REFUSED and the blocking feature is highlighted."));
c.push(P("THE POINT YOU PICK IS WHERE THE VESSEL WILL HOLD, so it is treated as a hold point and not merely a destination. A point inside a keep-out — on a pier, on the shore, in water too shallow for the hull — is not refused: the vessel holds OFF it, at the nearest clear water in any direction, with the whole circle it is allowed to wander clear of the buffer, and the banner and the Intent card say what the point sat in and how far off it the vessel will hold. Only a point with no clear water within the search range is refused. The vessel is also told how much clear water there is round its hold point: inside that circle it comes straight back when the tide sets it off station; set BEYOND it, it takes the way off rather than drive a blind bearing back, and the console plans a routed return through the same planner as everything else. The vessel card says SET OFF STATION while that is happening."));
c.push(P("The row is grayed until the vessel is armed and clear of E-STOP, and says so beside itself — it is a shortcut past the old two-step (arm a toolbar button, then click the chart), never past the arm gate."));
c.push(H2("8.2  Transit"));
c.push(P("Press `TRAN` and click the chart to lay down a single- or multi-segment line, then `Follow`. Useful when you want the vessel to take a specific path rather than the one the router would choose. `Undo` removes the last point; `Clear` discards the line. The drawn line is a guide, not a guarantee — each leg is still routed clear of keep-outs, and the vessel keeps right in channels. The LAST point is where the vessel holds, and is held off a keep-out exactly as a Go-To point is (8.1)."));
c.push(H2("8.3  Hold"));
c.push(P("Station-keeps at the present position. The immediate answer to “stop where you are but stay under command”. The vessel is told how much clear water it has where it stopped, so a hold beside a structure re-approaches straight only within that water (8.1)."));
c.push(H2("8.4  Return-to-Home"));
c.push(P("Drives to HOME on a routed path and station-keeps there. HOME is set automatically at the first fix, moved by SET HOME HERE on the chart menu (8.5), or taken from a Remote Operations Center (section 12) — in which case it can be MOVING, and the return chases it. A HOME set at a berth, on a pier or on the shore is HELD OFF: the return ends at the nearest clear water to it and the banner says so (8.1). Only a HOME the vessel cannot reach clear of the keep-out model at all is refused: that is why 8.5 asks you to read the banner when you place one."));
c.push(H2("8.5  Set Home"));
c.push(P("Right-click the chart and choose SET HOME HERE. HOME moves to the point you clicked. Right-clicking over the vessel itself is how you make the vessel's own position HOME — do that at the launch point, before arming, unless HOME is coming from a Remote Operations Center."));
c.push(P("The command refuses when no link is up. It also still captures the vessel's own reported fix if it is ever called without a point, and refuses THAT when the link has produced no fix yet — a HOME taken from stale telemetry is a place the boat is not."));
c.push(NOTE("CHECK WHERE YOU PUT IT — RETURN-TO-HOME DRIVES THERE",
  "HOME is not a label, it is a destination. A HOME on land, inside a charted structure, or in water too shallow for this vessel is a return that will be REFUSED — and you will find that out mid-mission, at the moment it is least useful. The console checks the point you choose against the same keep-out model every behavior routes by and WARNS on the banner if it is not water the vessel can sit in; it does not stop you, because the point you picked is the point you asked for. Read that banner. If you want HOME on a dock, a tender or a ship, place a Remote Operations Center instead (section 12): those are confirmed before they take effect, and a ship-borne one lets HOME move."));
c.push(H2("8.6  Simulator-only controls"));
c.push(TBL(["Control", "Does"], [
  ["SPAWN HERE (chart menu)", "Right-click a point to place the vessel there — a clean slate where you choose"],
  ["`Reset`", "Power-cycle the simulator: full energy, back at the profile's spawn, plans cleared, SAFE"],
  ["energy pill", "Click to report energy as full and stop the drain, for rehearsing a long mission quickly"],
], [1500, 7860]));

// 9 ---------------------------------------------------------------------------
c.push(H1("9  Planning a survey"));
c.push(H2("9.1  The three-click pattern"));
c.push(P("Press `SURV`, then click three times:"));
c.push(B("The START CORNER of the area."));
c.push(B("The OPPOSITE (diagonal) corner."));
c.push(B("A third point that sets the LINE SPACING — its distance from the start — and the LINE DIRECTION — its bearing."));
c.push(P("Parallel lines fill the box automatically as a lawnmower route. The line COUNT is derived from width divided by spacing; you never type it. All three control points stay draggable and the pattern regenerates live."));
c.push(H3("9.1.1  Moving the whole pattern"));
c.push(P("A crosshair grip sits at the center of the pattern, labeled `move`. Dragging it translates every control point by one delta, so the pattern moves with its shape, spacing and direction preserved EXACTLY. Use it when the pattern is right but positioned wrong — redrawing by hand will not reproduce the same spacing. The corner handles win where the two overlap, so reshaping a small pattern stays possible."));
c.push(H2("9.2  Adjusting the pattern"));
c.push(TBL(["Control", "Effect"], [
  ["Align (Start / Center / Finish)", "Where the leftover margin across the area goes"],
  ["Spacing m", "Type to force a spacing instead of setting it by the third click"],
  ["Direction°", "Type to rotate the whole pattern to a bearing, keeping spacing and box"],
  ["Line len / Width / Lines", "Derived readouts — what the current pattern actually is"],
], [2400, 6960]));
c.push(H2("9.3  Constraining the area"));
c.push(P("`BND` draws an arbitrary boundary polygon: click to drop points, click the first point to close it. Survey lines clip to that polygon rather than the rectangle. `AREA` hides or shows it — it still clips while hidden."));
c.push(H2("9.4  Depth limits for coverage"));
c.push(P("`Min depth` and `Max depth` in the survey panel are COVERAGE limits — do not survey shallower or deeper than this. They are separate from the navigability floor, which every behavior always avoids and which you cannot survey your way around. Blank maximum means deep water is fine."));
c.push(H2("9.5  Punch Out"));
c.push(P("`Punch Out` trims the pattern to water the vessel can actually work: it fetches the chart for the survey area and clips every line out of land, structures, hazards and water outside your depth limits. It reports what it did, and this is the point at which a plan becomes trustworthy."));
c.push(P("Punch Out also EXCLUDES A NAVIGATION CHANNEL where a survey spans across one — a coverage line that runs outside, into the channel and out again gets a gap there. A survey contained entirely within a channel is unaffected, and normal transits still cross it."));
c.push(P("THE TURNS FOLLOW A STRICTER RULE: a reversal turn may only use channel water that the survey lines themselves occupy. If your lines run BESIDE a charted channel — or were clipped out of one — the loops that connect them are not allowed to swing into it, even where the water is deep and the channel is not an enforced keep-out. A row of charted pilings will NOT stop a turn on its own (piles are charted as individual points tens of meters apart, and a loop can pass lawfully between them), so the channel boundary itself is the line that is held. A survey drawn INSIDE the channel keeps full use of it, and routed transits between separated survey regions may still cross the channel as ordinary navigation."));
c.push(H3("9.5.1  What Punch Out tells you about the turns"));
c.push(P("The reversal at the end of each line has to be a turn the VESSEL CAN HOLD at the plan speed. Where the line spacing is wide enough it is a simple half-circle. Where it is tighter than the vessel's own minimum radius, the console builds a teardrop loop instead, which reaches further past the line ends — and it reports that excursion, along with the spacing a simple turn would need, and the spacing needed at low speed."));
c.push(NOTE("READ THIS ONE", "If even a teardrop cannot fit clear of the keep-outs, the reversal falls back to a straight hop between the line ends and the banner calls it UNTRACKABLE. That is a plan defect, not a working turn: at that spacing the vessel is being asked to reverse in a radius it cannot hold. Widen the spacing, or drop the plan speed."));
c.push(P("When a reversal is refused because its loop would enter a navigation channel, the banner says so in those words, the offending channel is OUTLINED on the chart with the blocked spot marked, and the banner quotes how much clear water the turns need beyond the line ends. The remedies are listed in the banner: end the lines that far from the channel, widen the spacing, slow the plan — or, if the channel itself is meant to be covered, draw the survey into it."));
c.push(H2("9.6  Editing the plan before Upload"));
c.push(P("`WPT` mode edits a punched plan directly on the chart:"));
c.push(TBL(["Gesture", "Does"], [
  ["Drag a waypoint", "Moves it; its line endpoint follows"],
  ["Click a waypoint", "Deletes it"],
  ["SHIFT-click a survey line", "Deletes that line and its endpoints"],
  ["Click open water", "Adds a waypoint"],
], [2600, 6760]));
c.push(H2("9.7  The LINES table"));
c.push(P("`LINES` opens a per-line table: length, planned time at the plan speed, and — once running — the ACTUAL time accrued on each line. Actuals are keyed to the leg the vessel is genuinely on, so a transit across or alongside a line does not bank time against it. The table is written into the session record when the run ends."));
c.push(H2("9.8  Committing"));
c.push(P("`Add to plan` commits the lines and waypoints. The plan persists on the server, so a browser refresh does not lose it. `CLR PLAN` clears it. Each time the plan's lines or waypoints change, the previous plan is kept beside it in the console folder — mission.json.bak1 is the newest, back to mission.json.bak5 — so a plan cleared or overwritten by mistake can be recovered. The plan also carries a revision: if it was changed from another tab or window after this page loaded it, this page's next save is refused and a banner says PLAN NOT SAVED - reload the page to pick up the newer plan before editing again. Any other save that fails is also said, and is tried again with your next change."));
c.push(P("Committing removes the draggable pattern overlay, but THE CARD KEEPS DESCRIBING THE PLAN — spacing, direction, line length, across-plan width and line count stay on it through Upload and across a page refresh, so you can check what you are about to run. The figures are read back off the committed lines, so if you edit the plan in `WPT` mode they describe what the plan now IS. They clear when the plan does, with `CLR PLAN`."));
c.push(P("The survey panel's own `Reset` discards only a pattern you are part-way through drawing. A plan already committed is untouched, and the card goes back to describing it."));

// 10 --------------------------------------------------------------------------
c.push(H1("10  Search patterns"));
c.push(P("`SRCH` builds a canned search around a datum you click. Three patterns, each with its own parameters:"));
c.push(TBL(["Pattern", "Parameters", "Use"], [
  ["Expanding box", "Heading, turn direction, leg step, legs", "Datum known, drift small — work outward from the last known position"],
  ["Sector", "Radius, sectors, rotation", "Datum known, good detection range — repeated passes through the center"],
  ["Parallel", "Heading, lane length, spacing, lanes", "Large area, uncertain datum — systematic coverage"],
], [1700, 3200, 4460]));
c.push(P("Legs clip to the keep-out model exactly as survey lines do. `Add to plan` commits the pattern, and from that point it runs as a plan like any other."));

// 11 --------------------------------------------------------------------------
c.push(H1("11  Running a mission"));
c.push(H2("11.1  Run parameters"));
c.push(TBL(["Field", "Sets"], [
  ["`Arr m`", "Arrival radius uploaded with the route — how close counts as reaching a waypoint"],
  ["`Appr m`", "Approach radius — how closely the vessel follows the line before turning onto the next leg. Applies live."],
  ["`Buf m`", "Keep-clear buffer off every charted structure and shallow. Lower it to thread tight water; raise it for more standoff. Re-routes live."],
  ["Speed", "Low / Survey / High, from the vessel's own profile"],
  ["End of plan", "What happens when the plan finishes — see 11.5"],
], [1400, 7960]));
c.push(NOTE("SPEED APPLIES IMMEDIATELY", "Changing the speed selector commands the vessel THERE AND THEN, mid-run included — it does not wait for the next Upload. Speed over ground will follow within a few seconds. The RUN block's Speed row shows the speed the VESSEL reports it is running to, so you can confirm the command landed rather than assuming it; if that row ever disagrees with the selector, the row is the one moving the vessel. The console checks this itself: a speed it commanded that the vessel has not taken within about a second is sent again, and after three tries a warning goes up — THE VESSEL IS NOT TAKING THE SPEED COMMAND. A resume that cannot get the low speed does not start, and says so."));
c.push(NOTE("CHANGING SPEED RE-PLANS THE TURNS", "Speed is an input to the plan, not a label on it: the minimum radius the vessel can hold scales with it, and so does the shape of every line-to-line reversal. Change it and the console recalculates — turns, durations, per-line times. If the plan is already COMMITTED it cannot rebuild the turn waypoints, so it re-checks the spacing against the new speed and tells you when speeding up has put a reversal beyond what the vessel can hold. Slowing down is always safe."));
c.push(NOTE("THE BUFFER HAS A FLOOR", "The vessel's own profile sets a minimum buffer. A plan saved against a smaller vessel cannot quietly give this one less standoff than its profile demands. You can always widen it by hand."));
c.push(H2("11.2  The sequence"));
c.push(B("`Arm` — enables commanding. Confirm the transmitter's autonomy switch is forward."));
c.push(B("`Upload` — pushes the plan to the vessel, first routing the approach and every inter-line transit clear of obstacles. Needs armed, no E-STOP, at least one waypoint. Uploading never changes what the vessel is doing: while it is under way on a plan, Upload is unavailable — Hold or Stop first; while it is station-keeping or paused, the new plan waits for Start and the vessel stays where it is. If the chart model has not loaded, Upload asks before sending the plan unrouted — in the simulator too — and keeps a warning up that the approach and transits were not checked and the clearance guard is not watching the track. A plan goes whole or not at all: if its routed path has more waypoints than the console accepts, Upload is blocked before anything is sent, and the warning gives both numbers."));
c.push(B("`Start` — begins the run. Needs armed, a plan uploaded, no E-STOP. It is also live while the vessel is station-keeping with a newly uploaded plan waiting: Start is what sends it on that plan."));
c.push(B("Monitor — waypoint progress, the RUN block, the track, energy, and the water."));
c.push(H2("11.3  Pause, Stop, E-STOP"));
c.push(TBL(["Control", "Does", "Recover by"], [
  ["`Pause`", "Holds position, keeps the next waypoint active. A vessel that was station-keeping goes back to it when resumed.", "`Start` resumes"],
  ["`Stop`", "Aborts the run and reverts to the first waypoint", "Re-Upload and Start"],
  ["`E-STOP`", "Latches a command-side motor cut and force-disarms", "Clear E-STOP, then re-arm"],
], [1300, 5060, 3000]));
c.push(P("Stop, E-STOP and a disarm each end station-keeping along with the run: nothing the console does afterwards will set the vessel moving again until you command it. Start on a plan that has already run to its end runs it again from its first waypoint."));
c.push(H2("11.4  What you should be watching"));
c.push(B("THE WATER, first. Everything below is secondary to that."));
c.push(B("The RUN block's status line and percent — the fastest read on whether the run is progressing."));
c.push(B("Energy, against the distance still to run. The card gives endurance and range for fuelled vessels."));
c.push(B("The communications bar. A degrading link is visible before it is lost."));
c.push(B("The Nogo row, if the vessel is transiting into an area the model was not built for — it re-extracts, and says so."));
c.push(H2("11.5  End of plan — where the run leaves the vessel"));
c.push(P("The `End of plan` selector decides what happens when a plan finishes:"));
c.push(TBL(["Setting", "At the end of the plan"], [
  ["RTH", "Return to HOME on a routed path and station-keep there — the default"],
  ["Complete", "Stop"],
  ["Loiter", "Station-keep at the last waypoint"],
  ["Repeat", "Loop the route until you Stop"],
], [1400, 7960]));
c.push(P("With RTH selected, THE RETURN ALSO HAPPENS AT THE END OF A GO-TO OR A TRANSIT, not only at the end of a survey. The RUN block's End mode says so for the whole run rather than only once the return begins, so you can confirm before the run ends where the vessel is going to finish."));
c.push(P("The setting is LIVE from the moment you change it — the end-of-plan return gates on it continuously, so switching to RTH part-way through a run arms a return, and switching away from it disarms one. What waits for the next Upload is the behavior the vessel itself falls back on at its last waypoint with no console attached."));
c.push(NOTE("WHEN IT WILL NOT SAY RTH", "End mode only promises a return the vessel can actually make. With no HOME set, disarmed, E-STOP latched, on a Repeat run that never ends, or after a return that was routed and refused, it reads what the vessel will really do instead. Believe it."));

// 12 --------------------------------------------------------------------------
c.push(H1("12  Remote Operations Centers and a moving HOME"));
c.push(P("`ROC` tracks the place the vessel is operated from, and lets you make it HOME. Two kinds:"));
c.push(B("SHORE — a fixed position. Its ARRIVAL POINT is offset from it by a range and bearing you enter, which is how you put the recovery point at the ramp rather than at the antenna."));
c.push(B("SHIP (mothership) — a position that MOVES. Its offset is normally measured from the ship's own course, so “so many meters astern” stays astern as she turns."));
c.push(H2("12.1  Place, edit, confirm"));
c.push(P("Click `+ Shore` or `+ Ship`, then click the chart to place it. While STAGED it is editable and CANNOT be HOME. Set its position, its recovery offset, and for a ship its heading and speed, then Confirm — which activates it and starts a ship steaming. Selecting Hold reverts it to staged."));
c.push(H2("12.2  Removing one, and what survives a restart"));
c.push(P("`Remove` on a ROC row deletes it immediately — the row goes and the registry is written straight away. THE LIST YOU SEE THIS SESSION IS NOT BOUNDED: place as many operations centers as the work needs. What is bounded is what COMES BACK. Only the three most recently placed survive a restart, so the card cannot fill up with the leftovers of every session that went before it; if one of them is HOME it is always among the three, because losing it would quietly move where Return-to-Home goes."));
c.push(NOTE("IF THE CARD EVER OPENS FULL OF STRANGERS", "It will now trim itself to the three most recent on the next start — you do not have to delete anything by hand. A long list is also slow to edit: every change re-sends and re-draws the whole list, so with a very long one a Remove can take about a second to appear, which looks exactly like a button that does not work."));
c.push(H2("12.3  A moving recovery"));
c.push(P("With a ship selected as HOME, Return-to-Home CHASES it: the console re-aims the vessel at the current arrival point as the ship moves. A moving recovery point is driven DIRECT rather than routed, because a detour computed against a point that has since moved is worse than useless."));
c.push(NOTE("CHECK THE CLOSING SPEED", "A return only converges if the vessel can actually overhaul the ship. The card computes the closing rate against THIS vessel's top speed and says plainly when the ship is uncatchable. A mothership one vessel overhauls easily is one a slower vessel never reaches."));

// 13 --------------------------------------------------------------------------
c.push(H1("13  Contingencies"));
c.push(H2("13.1  The link drops mid-run"));
c.push(P("The console auto-disarms and stops commanding after roughly three seconds without telemetry, and reports the vessel's own failsafe. TAKE THE TRANSMITTER. The console will not auto-resume when the link returns; recovering the run is your decision, made with eyes on the vessel. The session record captures the dropout."));
c.push(H2("13.2  A command is refused"));
c.push(P("The reason is named and the blocking feature is pulsed on the chart with a cross. Options, in order of preference: re-plan around it; move the target; widen or narrow the buffer deliberately; or take manual control. Do not repeat the command hoping for a different answer — the model has not changed."));
c.push(H2("13.3  The plan will not route"));
c.push(B("Check the Nogo row. If it reads amber, there is no model — see 13.4."));
c.push(B("Check the buffer. A tight marina may need a smaller one; the vessel's own floor still applies."));
c.push(B("Check the vessel. A deep-draught profile refuses water a shallow one crosses."));
c.push(B("Check the water level band. A remote reading is not applied, so charted depths are being used raw."));
c.push(H2("13.4  No chart coverage"));
c.push(P("The console says so and routes DIRECT. Every leg is then unverified. Either work manually, pre-cache the chart for the area, or accept the risk explicitly and keep the vessel in sight."));
c.push(H2("13.5  Energy running low"));
c.push(P("The energy readout bands as it depletes, and fuelled vessels report endurance and range. Decide against the distance still to run and the distance HOME — not against the percentage. A return is a routed transit and may be considerably longer than the straight-line range shown."));
c.push(H2("13.6  The turn is reported untrackable"));
c.push(P("See 9.5.1. The plan is asking the vessel to reverse inside a radius it cannot hold. Widen the line spacing or lower the plan speed and Punch Out again."));
c.push(H2("13.7  Something on the card looks stale"));
c.push(P("The water level updates on the tide service's own cadence, not instantly — a station change can leave the previous value standing for a few minutes, which is why the reading is banded by distance. Traffic type information also lags, because vessels broadcast their static data on a slow cycle."));

// 14 --------------------------------------------------------------------------
c.push(H1("14  Session recording and playback"));
c.push(P("Every session is recorded automatically unless you disable it. The record is one event per line: every command and setting the console received with its outcome, interleaved with a telemetry trace of the same state the display was showing — a full snapshot on every transition and a regular position, heading, speed and energy sample in between. It is append-only and written line by line, so a crash or a hard kill still leaves a complete record up to that moment. It works identically in simulation and against a real vessel."));
c.push(H2("14.1  Reviewing a session"));
c.push(P("Open the playback view from the top bar. It replays any recording on the same chart: the vessel drives its recorded track, the plan and commanded routes appear as they were sent, and a timeline lists every command and state transition — rejected ones in red — with play, pause, speed control and a scrubber. It is READ-ONLY; nothing in playback can command a vessel."));
c.push(P("Use it for post-mission review, for showing a client what was covered, and for working out what actually happened when something surprised you."));

// 15 --------------------------------------------------------------------------
c.push(H1("15  Working across your screens"));
c.push(P("By default the console opens a CHART window and a CONTROLS window. Put the chart on one screen and the controls on the other and the chart is left clean. The two stay in step automatically; the chart window remains where you draw. In the controls window each panel becomes a draggable, resizable card and the layout is remembered between sessions."));
c.push(H2("15.1  The tide and weather windows"));
c.push(P("A THIRD window opens on the NOAA Tides and Currents page for the water-level station nearest the vessel — the official record, live, alongside the console rather than inside it. YOU DO NOT CHOOSE THE STATION: it is whichever one the vessel's own GPS position selects, so moving the boat to another stretch of coast opens a different station without anything being configured. It waits for a fix before opening, because until the vessel reports a position there is no nearest station to open."));
c.push(P("A FOURTH window does the same for the WEATHER: the NOAA NDBC page for the buoy nearest the vessel, whose wind and wave observations are what push the simulated vessel off track. Same rule again — the buoy is chosen by the vessel's position, not configured, and the window waits for a fix before opening."));
c.push(NOTE("EACH PAGE SHOWS ONE STATION; THE READING MAY USE THREE", "Both the depth correction and the wind and sea forcing are inverse-distance blends of up to three stations within range, weighted by the SQUARE of distance — so a station four times further away counts a sixteenth as much. Each window shows the PRIMARY, the nearest one actually reporting. Where the primary is close and the others far, the blend is effectively that one station; where they are comparable it is genuinely mixed, and the page is then one voice of three. The console prints the full blend with each station's share when it opens the window, and the chart-source card lists the water contributors in its Correction tooltip, marking a blended reading `idw`."));
c.push(NOTE("THE NEAREST BUOY MAY NOT BE THE ONE YOU EXPECT", "At the Lewes base the nearest weather buoy is LWSD1 at Lewes itself, 3.7 km away, taking 95.5% of the weight — not Brandywine Shoal (BRND1) 22.3 km off, which contributes 2.6%. Check which station the console actually opened before reading a value off a page you chose by name."));
c.push(P("Every card on the chart window can be RESIZED by dragging its bottom-right corner, and each remembers the size you gave it. Widen the vessel-status card to read the keep-out breakdown, or pull the traffic table taller when the sea is busy."));
c.push(P("They can also be MOVED, by dragging the header strip along the top of the card — the vessel-status card, the survey settings, the survey-lines table, the AIS traffic table, the chart-source card and the ROC list. Each remembers where you put it, so a layout you arrange once comes back next session. A card's close `×` is not a drag grip: clicking it closes the card rather than starting a move."));
c.push(P("A CARD CANNOT GROW PAST THE SCREEN, in either direction. A card sized by its own contents — the traffic table with a busy sea, or the lines table with a long plan — stops at a height that still fits the display and scrolls inside itself from there, with its header staying put at the top so you always know what you are reading. The size you drag is capped the same way. This is a display limit only: the size you asked for is remembered, so the same profile on a larger screen gives you the larger card back."));
c.push(P("Lists that update on their own — the AIS traffic table above all — are updated IN PLACE rather than redrawn. Scrolling down the list to read a distant contact does not throw you back to the top when the next update lands, and text you are part way through selecting, an MMSI you mean to copy, survives it. Only the values that actually changed are rewritten."));
c.push(P("The VESSEL-STATUS CARD stays on the chart window and is not duplicated into the controls window — one card, one place to look. The top status bar keeps its own quick read of position, speed, heading, energy and time, so the chart window alone tells you everything about the vessel."));
c.push(P("If the controls window is closed, everything returns to the chart window automatically and a pill appears to reopen it — the console is never left without its controls. `--single-window` skips the second window entirely; `--no-tide-window` and `--no-weather-window` skip the third and fourth. Closing either of those costs nothing: they are external pages, not part of the console, and the depth correction and the wind forcing they illustrate carry on regardless."));

// 16 --------------------------------------------------------------------------
c.push(H1("16  Checklists and quick reference"));
c.push(H2("16.1  Pre-mission"));
c.push(B("Correct vessel profile selected, and it matches the vessel in the water."));
c.push(B("Chart cached for the operating area; Nogo row reports a built model, not amber."));
c.push(B("Survey confidence checked for the working area — poor classes flagged."));
c.push(B("Water level band checked; manual override set if the reading is remote or the tide is below datum."));
c.push(B("HOME set at the launch point, or a Remote Operations Center confirmed and selected."));
c.push(B("Buffer, arrival and approach radii appropriate for the water."));
c.push(B("End of plan set deliberately."));
c.push(B("Plan punched out and reviewed — no untrackable turns, coverage where you expect it."));
c.push(B("Energy sufficient for the run PLUS the return."));
c.push(B("Transmitter operator present, autonomy switch understood."));
c.push(H2("16.2  Running"));
c.push(B("Arm, and confirm the transmitter's autonomy switch is forward."));
c.push(B("Upload. Read the banner — it says what was routed and what was degraded."));
c.push(B("Start. Confirm the RUN block shows the run progressing and End mode reads what you intended."));
c.push(B("Watch the water; scan the card."));
c.push(H2("16.3  After"));
c.push(B("Confirm the vessel is where you expect it and station-keeping or stopped."));
c.push(B("Disarm."));
c.push(B("Review the LINES actuals against plan."));
c.push(B("Keep the session record if the job needs evidence of coverage."));
c.push(H2("16.4  Controls at a glance"));
c.push(TBL(["Button", "Does"], [
  ["`BOAT`", "Keep the chart centered on the vessel"],
  ["`WPT`", "Edit a punched plan on the chart"],
  ["`SURV`", "Three-click survey pattern"],
  ["`BND`", "Survey-area boundary polygon"],
  ["`SRCH`", "Search patterns"],
  ["`TRAN`", "Draw and follow a transit line"],
  ["`AREA` / `CHRT` / `NOGO`", "Show or hide the boundary, chart features, keep-out zones"],
  ["`AIS`", "Traffic overlay and table"],
  ["`ROC`", "Operations centers and HOME"],
  ["`LINES`", "Per-line planned versus actual table"],
  ["`SRC`", "Chart source and survey confidence"],
  ["`CLR`", "Clear the displayed track"],
  ["`?`", "Quick start card"],
  ["right-click", "Chart menu at that point — measure, Go-To here, Set Home, Spawn here, copy position (4.1)"],
  ["`Esc`", "Close the chart menu; then the half-drawn measurement; then all measurements; then the tool"],
], [2100, 7260]));

// 17 --------------------------------------------------------------------------
c.push(H1("17  Glossary"));
c.push(TBL(["Term", "Meaning"], [
  ["Approach radius", "How closely the vessel follows a line before turning onto the next leg"],
  ["Arrival radius", "How close to a waypoint counts as having reached it"],
  ["Buffer", "Clearance the vessel keeps off every charted keep-out when routing"],
  ["Crab angle", "Difference between heading and course made good, caused by wind and sea"],
  ["Datum (chart)", "The low-water reference charted depths are measured from"],
  ["Datum (search)", "The position a search pattern is built around"],
  ["End mode", "Where the run in progress will leave the vessel"],
  ["HOME", "The return point. Fixed, or moving if it comes from a ship"],
  ["Keep-out / nogo", "Charted water or feature that commanded motion will not cross"],
  ["Lawnmower / boustrophedon", "Parallel survey lines run alternately in opposite directions"],
  ["Punch Out", "Clipping a survey pattern to chart-clear, in-depth water"],
  ["Station-keep", "Hold position actively against wind and current"],
  ["Teardrop turn", "A looping reversal used where the line spacing is tighter than the vessel's minimum turn radius"],
  ["Zone of confidence", "The charted survey quality under the vessel"],
], [2400, 6960]));

write("asv-simulator-operations-manual.docx", c);
