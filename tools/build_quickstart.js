// Build: ASV Simulator - Quick Start Guide
//
// GENERATED - edit this script and rebuild; never hand-edit the docx.
//   cd tools && npm install && node build_quickstart.js
// Writes ../docs/asv-simulator-quick-start.docx (path is script-relative).
//
// AUDIENCE: someone who has never opened this console and wants a survey running in
// twenty minutes. RUTHLESSLY SHORT BY DESIGN - it is the on-ramp to the operations
// manual, not a summary of it. Every section ends by pointing at the chapter that has
// the depth. Resist adding detail here; add it there.
//
// BRAND-FREE BY RULE - see docx_kit.js.
const { P, H1, H2, B, CODE, TBL, SP, NOTE, TITLE, write } = require("./docx_kit");

const c = [];

c.push(TITLE("ASV Simulator"));
c.push(P("Quick Start — from nothing to a survey running, in about twenty minutes", { size: 24, color: "2e5f8a" }));
c.push(P("Everything here runs against the SIMULATOR, so there is no vessel to damage and nothing to get wet. The console drives a real vessel identically, so what you learn here transfers directly. Section references point into the Operations Manual, which has the depth.", { italics: true }));
c.push(SP());

// ------------------------------------------------------------------
c.push(H1("1  Run it"));
c.push(P("Python 3 and its standard library. No packages to install, no build step."));
c.push(CODE([
  "cd <project>",
  "python asv_console.py --sim",
]));
c.push(P("A browser opens on the console. It also opens a second CONTROLS window — drag that to another screen if you have one, or add `--single-window` to keep everything together."));
c.push(P("The vessel appears on a live nautical chart at its configured operating area, already connected to the simulator. Give it a few seconds: on the first position fix the console fetches the chart for the area and builds its keep-out model."));
c.push(NOTE("WATCH THIS FIRST", "The vessel-status card's Nogo row tells you when the chart is ready. It counts seconds while reading, then reports the zone count and this vessel's depth floor. Do not plan until it has landed. (Ops manual 6.2.1)"));

// ------------------------------------------------------------------
c.push(H1("2  Get your bearings"));
c.push(TBL(["Where", "What it is"], [
  ["Top bar", "Position, speed, heading, energy, and the SAFETY STATE — it reads SAFE until you arm"],
  ["Right-hand card", "The detailed vessel state, plus a RUN block once anything is planned"],
  ["Button column", "Chart layers and planning modes"],
  ["Bottom bar", "Run parameters and the commands"],
  ["`?` bottom-left", "The built-in quick start card"],
], [1800, 7560]));
c.push(P("Zoom with `+` / `−`, drag to pan, `BOAT` re-centers on the vessel. Turn on `NOGO` to see the keep-out zones the vessel will refuse to cross — that overlay is the single most useful thing on screen while you are learning. (Ops manual 4)"));

// ------------------------------------------------------------------
c.push(H1("3  Your first command — a Go-To"));
c.push(P("Nothing moves until you arm. That is the whole safety model in one sentence."));
c.push(B("Press `Arm`. The safety pill changes from SAFE."));
c.push(B("RIGHT-CLICK a point on open water a few hundred meters away and choose GO-TO HERE. The chart's right-click menu is where the point commands live — Go-To, Set Home, Spawn, and the measuring tool. Until you arm, the Go-To row is grayed and tells you why."));
c.push(B("Read the BANNER across the chart. It says whether the route went direct or was routed around obstacles, and how many waypoints it used."));
c.push(P("The vessel drives there, around anything charted in the way, and station-keeps on arrival. Now try clicking a point on the far side of a pier or a shoal — the console will route a way round it, or REFUSE and pulse the offending feature with a cross. A refusal is a result, not a failure. (Ops manual 8.1, 2.4)"));

// ------------------------------------------------------------------
c.push(H1("4  Your first survey"));
c.push(H2("4.1  Draw the pattern"));
c.push(P("Press `SURV` and click three times:"));
c.push(B("The START CORNER of the area you want covered."));
c.push(B("The OPPOSITE (diagonal) corner."));
c.push(B("A third point — its DISTANCE from the start sets the line spacing, its BEARING sets the line direction."));
c.push(P("Parallel lines fill the box immediately. Drag any of the three points to adjust; drag the CROSSHAIR GRIP at the center to move the whole pattern without changing its shape. (Ops manual 9.1)"));
c.push(H2("4.2  Punch it out"));
c.push(P("Press `Punch Out`. The console fetches the chart for the survey area and trims every line out of land, structures, hazards and water outside your depth limits. THIS IS THE STEP THAT MAKES THE PLAN TRUSTWORTHY — read what it reports."));
c.push(NOTE("IF IT SAYS “UNTRACKABLE”", "Your line spacing is tighter than the vessel can turn in at the plan speed. Widen the spacing or drop the speed and punch out again. (Ops manual 9.5.1)"));
c.push(H2("4.3  Commit and run"));
c.push(B("`Add to plan` — commits the lines and waypoints."));
c.push(B("`Upload` — pushes the plan to the vessel, routing the approach clear of obstacles."));
c.push(B("`Start` — the run begins."));
c.push(P("Watch the RUN block: type, waypoint progress, distance and time to the end, percent complete. `LINES` opens a per-line table showing planned against actual time as the run proceeds."));

// ------------------------------------------------------------------
c.push(H1("5  Know where it will end up"));
c.push(P("The `End of plan` selector in the command bar decides what happens when the plan finishes — RTH (return home and station-keep), Complete (stop), Loiter (hold at the last waypoint), or Repeat (loop until you stop it)."));
c.push(P("The RUN block's `End mode` row tells you where THIS run will leave the vessel, from the moment it starts. With RTH selected it says so throughout — and it only says RTH when the return can actually happen. (Ops manual 11.5)"));

// ------------------------------------------------------------------
c.push(H1("6  Stopping"));
c.push(TBL(["Control", "Effect"], [
  ["`Pause`", "Holds position, keeps the next waypoint — `Start` resumes"],
  ["`Stop`", "Aborts the run"],
  ["`E-STOP`", "Command-side motor cut and force-disarm. NOT the vessel's true failsafe — that is the transmitter."],
  ["`Reset`", "Simulator only: power-cycle back to a clean slate"],
], [1300, 8060]));

// ------------------------------------------------------------------
c.push(H1("7  Worth trying next"));
c.push(TBL(["Try", "Why"], [
  ["`SRC`", "The chart's own title block and the SURVEY CONFIDENCE under the vessel. Some water is charted far better than other water."],
  ["Wind / Sea / Set on the vessel card", "Real wind and sea push the simulated vessel off track. Watch SET and the crab angle change as it steers out of the drift."],
  ["Switch vessel", "The picker in the top bar. A different hull changes speeds, turn radius and the depth floor — watch the keep-out model change with it."],
  ["`TRAN`", "Draw a multi-segment transit and Follow it, when you want a specific path rather than the router's."],
  ["`ROC`", "Place a mothership, set it steaming, make it HOME — then Return-to-Home chases a moving recovery point."],
  ["Playback", "Every session is recorded. Replay it on the same chart with a timeline of every command."],
], [1700, 7660]));

// ------------------------------------------------------------------
c.push(H1("8  Where to go from here"));
c.push(TBL(["Document", "For"], [
  ["Operations Manual", "The full operational picture — safety model, every control, planning depth, contingencies, checklists"],
  ["Technical Manual", "Architecture, subsystems, HTTP API, data formats, extension recipes"],
  ["Development Guide", "How the project is built and verified, and the practices that keep it honest"],
  ["`README.md`", "Feature-by-feature tour with the reasoning behind each one"],
], [2400, 6960]));
c.push(NOTE("BEFORE A REAL VESSEL", "Read the Operations Manual's safety model (section 2) and its checklists (section 16) in full. The simulator forgives everything; the water forgives nothing."));

write("asv-simulator-quick-start.docx", c);
