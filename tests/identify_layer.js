// tests/identify_layer.js - "What is this line?" names the layer under the click (review #28, 2026-09-15).
//
// Andy, on his own console at Eastport: "This should be a simple survey pattern. What is the story with the line
// heading out to the northwest?", then "there is a line drawn from buoy 7 to buoy 9", then "its a green dashed line
// like a survey line". That is a LAYER question, and answering it by inference cost most of a session - the console
// draws seven things that look like lines and only their colour and dash tell them apart. Whatever that one was, the
// operator should not have to ask twice: the chart answers it now.
//
// ⚠ THE COLOUR CONVENTION IS THE TRAP, so every answer names it: committed survey lines are YELLOW and are what the
// vessel runs; the uploaded route is the ONLY green; the pattern preview is CYAN and is NOT in the plan (review #19);
// a measurement is MAGENTA, the mariner's own ink, never uploaded.
// DRIVEN: the page's own identifyAt / idSegDist / idScreen and sayWhatIsHere, over a fixture chart with every layer
// on it at once, so the ORDER between them is exercised rather than assumed.
//
//   node tests/identify_layer.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 13 sidecar mutations RUN, 13/13 caught:
//   the preview is never identified -> 2, 7            the preview is called part of the plan -> 2, 7
//   the first layer in reach wins, not the nearest -> 5b
//   anything answers however far the click was -> 4, 7 the distance is measured to the line's START -> 1, 2, 3, 5, 6, 7
//   the uploaded route is never identified -> 3        the measurement being drawn is missed -> 6
//   nothing found is answered with silence -> 7        the row is gated on arming, like a command -> 8
//   the committed line no longer names its colour -> 1
//   the keep-outs read as lat/lon again, not in the model's plane -> 3   the model read with the wrong shape -> 3
//   the box skip rejects a keep-out that IS in reach -> 3b
// 2026-09-16, THE RED JOIN (check 9) - 4 more, 4 caught: a red join never identified -> 9; scanned after the preview
//   runs, so a tie at the shared run end names the run -> 9; the reversal and hop wording swapped -> 9; a stale red
//   list answered with no punch on the chart -> 9
// ⚠ THE KEEP-OUT BRANCH WAS WRONG AND THIS SUITE AGREED WITH IT. The model's entries are {pts} / {ring} of {e,n} in
// the console's FLAT PLANE; the first version read them as bare lat/lon arrays, found nothing, said nothing, and the
// fixture had copied its shape from the code rather than from the model. THE LIVE CHECK is what caught it - a grid of
// clicks over New Castle's 1,083 features identified not one of them - and the fixture goes through a real planeFrame
// and real bbOf boxes now. Same family as [[tests-with-teeth]]: a fixture agreeing with the code is not coverage.
// ⚠ "THE FIRST LAYER IN REACH WINS" SURVIVED THE FIRST SWEEP: every fixture had one line in reach at a time, so
// "first" and "nearest" could not differ. Check 5b puts a measurement 2 px under a survey line 4 px away, with the
// survey lines scanned FIRST - the only shape where the two answers differ.
//
// NOTE: the page's script is <script type="module">, which runs STRICT; these functions are evaluated strict here.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const { distTo, azTo, planeFrame, toEN } = require("../static/js/geodesy.js");
const { inBB, bbOf } = require("../static/js/core_geometry.js");   // the model's own box test, not a copy of it

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond);
        note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("The chart says which layer a line belongs to:");

// ── the fixture chart: one degree of longitude is projected flat, so screen pixels are predictable ──
// Every layer carries a line, and three of them are deliberately CLOSE together, because the order between layers is
// the part an operator's question actually turns on.
const LAT = 44.9, LON = -66.99;                  // Eastport, where the question was asked
const PXDEG = 100000;                            // the fixture's projection: 1 degree = 100000 px
const P = (dLat, dLon) => ({ lat: LAT + dLat, lon: LON + dLon });
// a point of the keep-out model, in the flat plane the model is actually built in
const EN = (dLat, dLon) => toEN(P(dLat, dLon), { lat: LAT, lon: LON });
// one keep-out line of the model's real shape: points in the flat plane, with the box the model stores
const koLine = (dLat) => { const pts = [EN(dLat, 0), EN(dLat, 0.01)]; return { pts, bb: bbOf(pts) }; };

const world = {
  mission: { lines: [
    { a: P(0, 0), b: P(0, 0.01) },               // L1, east-west, through the origin
    { a: P(0.001, 0), b: P(0.001, 0.01) },       // L2, 100 px north of it
  ] },
  runRoute: [P(0.002, 0), P(0.002, 0.01)],       // the uploaded route, 200 px north
  patClip: [[P(0.003, 0), P(0.003, 0.01)]],      // the PREVIEW, 300 px north - the Eastport layer
  boundary: [P(0.004, 0), P(0.004, 0.01), P(0.0045, 0.005)],
  boundaryClosed: true,
  measures: [{ a: P(0.005, 0), b: P(0.005, 0.01) }],
  measPend: null,
  track: [P(0.006, 0), P(0.006, 0.01)],
  // ⚠ THE REAL SHAPE: the keep-out model is built in the console's FLAT PLANE and its entries are {pts} / {ring},
  // not bare lat/lon arrays. The first version of this fixture copied the shape from the code under test, so the
  // code read the model wrongly and the suite agreed with it - the live check over New Castle's 1,306 zones, which
  // identified not one of them, is what found it. It goes through a real planeFrame now.
  inBB,
  nogo: {
    frame: planeFrame({ lat: LAT, lon: LON }),
    ko: {
      // WITH their bounding boxes, as the model carries them: identifyAt skips a feature whose box is out of
      // reach, and a fixture without boxes would never exercise the skip (nor its buffer).
      lines: [koLine(0.007), koLine(0.011), koLine(0.013)],
      polys: [{ ring: [EN(0.009, 0), EN(0.009, 0.01), EN(0.0095, 0.005)],
                bb: bbOf([EN(0.009, 0), EN(0.009, 0.01), EN(0.0095, 0.005)]) }],
      points: [],
      // ⚠ A BUOY SYSTEM, because identifyAt could not see this layer at all until 2026-09-23.
      // Same shape the model carries: each chain is a list of marks in the FLAT PLANE.
      sys: [{ port: [EN(0.015, 0), EN(0.015, 0.01)],
              stbd: [EN(0.017, 0), EN(0.017, 0.01)] }],
    },
  },
};
const banners = [];
// The world is built PER FIXTURE: the page reads these as plain bindings, so a world built once and mutated after
// would be a test of the harness rather than of the page (check 6 caught exactly that).
// eslint-disable-next-line no-new-func
const makePage = (W) => new Function("W", "banners", "distTo", "azTo", "\"use strict\";" +
  "const mission = W.mission, runRoute = W.runRoute, patClip = W.patClip, patRed = W.patRed || [], boundary = W.boundary," +
  "      boundaryClosed = W.boundaryClosed, measures = W.measures, measPend = W.measPend, track = W.track," +
  "      nogo = W.nogo, zoom = 15;" +
  // the page's projection, replaced by a flat one so a pixel distance in the checks is a stated number
  "const originPx = () => ({ x: 0, y: 0 });" +
  // the map centre and the model's own bounding-box test: identifyAt skips a keep-out whose box is out of
  // reach, which is what keeps a 1,078-feature model off the main thread (measured live at 210-320 ms without)
  "const center = { lat: " + LAT + ", lon: " + LON + " };" +
  "const inBB = W.inBB;" +
  "const worldPx = (lat, lon) => ({ x: (lon - (" + LON + ")) * " + PXDEG + ", y: -(lat - (" + LAT + ")) * " + PXDEG + " });" +
  "const fmtDist = (m) => Math.round(m) + ' m';" +
  "const lineNo = (k) => k + 1, lineCount = () => mission.lines.length, linePartTxt = () => '';" +
  "const showBanner = (t) => banners.push(t);" +
  decl(/^const IDENTIFY_PX = [^;]*;/m) + "\n" +
  grab("idScreen") + "\n" + grab("idSegDist") + "\n" + grab("identifyAt") + "\n" + grab("sayWhatIsHere") + "\n" +
  "return { identifyAt, idSegDist, sayWhatIsHere };")(W, banners, distTo, azTo);
const page = makePage(world);

const hitAt = (dLat, dLon) => page.identifyAt(P(dLat, dLon));

// 1. the committed survey line, which is what the operator hopes any line is
const l1 = hitAt(0, 0.005);
check("1. a click on a committed survey line names it, numbers it, and says it is the plan - in the colour the "
      + "legend uses",
      () => l1 && l1.layer === "survey" && /COMMITTED survey line — L1 of 2/.test(l1.what)
            && /Yellow/.test(l1.what) && /the vessel will run it/.test(l1.what),
      () => (l1 && l1.what.slice(0, 96)) || "(nothing found)");

// 2. THE EASTPORT LAYER: the preview, which is not in the plan
const prev = hitAt(0.003, 0.005);
check("2. ⚠ THE QUESTION HE ASKED: a click on the pattern preview says it is NOT in the plan, and names both ways out "
      + "- commit it, or clear the anchors",
      () => prev && prev.layer === "preview" && /NOT in the plan/.test(prev.what) && /cyan/.test(prev.what)
            && /ADD TO PLAN/.test(prev.what) && /SURV then RESET/.test(prev.what),
      () => (prev && prev.what.slice(0, 120)) || "(nothing found)");

// 3. every other layer answers as itself
const cases = [
  [0.002, "route", /UPLOADED ROUTE the vessel is running — 2 waypoints, green/],
  [0.004, "boundary", /SURVEY AREA boundary/],
  [0.005, "measure", /MEASUREMENT you drew/],
  [0.006, "trail", /VESSEL'S TRAIL/],
  [0.007, "keepout", /KEEP-OUT the console routes around/],
  [0.009, "keepout", /edge of a KEEP-OUT AREA/],
];
const got = cases.map(([dLat, layer, re]) => {
  const h = hitAt(dLat, 0.005);
  return { want: layer, got: h && h.layer, ok: !!h && h.layer === layer && re.test(h.what) };
});
check("3. the route, the boundary, a measurement, the trail and a keep-out each answer as themselves",
      () => got.every((g) => g.ok), () => got.map((g) => g.want + (g.ok ? " ok" : " -> " + g.got)).join(", "));

// 3b. ⚠ NEAR a keep-out, not ON it. The model's boxes are what keep a thousand-feature model off the main thread
//     (measured live at New Castle: 210-320 ms a click without the skip, 1-36 ms with it), and a keep-out line's own
//     box has ZERO height - so the reach has to be carried into the box test, or every line in the model is skipped
//     for any click that is not exactly on it. A fixture that clicks dead on the line cannot tell those apart.
const nearKo = hitAt(0.00703, 0.005);          // 3 px off the keep-out line: inside IDENTIFY_PX, outside its box
check("3b. a click NEAR a keep-out still finds it - the pixel reach is carried into the model's own box test, and a "
      + "keep-out line's box has no width to spare",
      () => nearKo && nearKo.layer === "keepout" && nearKo.d > 1 && nearKo.d < 14,
      () => nearKo ? nearKo.layer + " at " + nearKo.d.toFixed(1) + " px" : "(nothing found - the box skip ate it)");

// 4. nothing there is said as nothing there, rather than as the nearest thing on the chart
const none = hitAt(0.0005, 0.005);              // 50 px from L1 and 50 px from L2: outside IDENTIFY_PX either way
check("4. a click on open water finds NOTHING rather than reaching for the nearest line - half way between two lines "
      + "is not on either of them",
      () => none === null, () => none ? none.layer + " at " + none.d.toFixed(1) + " px" : "nothing, as required");

// 5. ties go to the nearer line, not to the layer that happens to be tested first
const near2 = hitAt(0.00094, 0.005);            // 6 px from L2, 94 px from L1
check("5. with two lines in reach the NEARER one wins - the answer is about the line under the pointer, not about "
      + "the order the layers are scanned in",
      () => near2 && near2.layer === "survey" && /L2 of 2/.test(near2.what) && near2.d < 7,
      () => near2 ? near2.what.slice(0, 40) + " at " + near2.d.toFixed(1) + " px" : "(nothing found)");

// 5b. ⚠ AND ACROSS LAYERS, which is the case check 5 could not make: a measurement 2 px away under a survey line 4 px
//     away, with the survey lines scanned FIRST. "The first layer in reach" and "the nearest thing" differ only here,
//     and a mutation to the first survived until this fixture existed.
const across = makePage({
  mission: { lines: [{ a: P(0.02, 0), b: P(0.02, 0.01) }] },        // scanned first, 4 px from the click
  runRoute: [], patClip: [], boundary: [], boundaryClosed: false,
  measures: [{ a: P(0.02002, 0), b: P(0.02002, 0.01) }],            // scanned later, 2 px from the click
  measPend: null, track: [], nogo: { ko: { lines: [], polys: [], points: [] } },
}).identifyAt(P(0.02004, 0.005));
check("5b. ... and across LAYERS too: with a measurement 2 px from the click under a survey line 4 px from it, the "
      + "answer is the measurement - the survey lines are scanned first, and scanning order is not an answer",
      () => across && across.layer === "measure" && across.d < 3,
      () => across ? across.layer + " at " + across.d.toFixed(1) + " px" : "(nothing found)");

// 6. a pending measurement - the leg being drawn - answers too, because that is a line on the chart as well
const pend = makePage(Object.assign({}, world, { measPend: { a: P(0.008, 0), b: P(0.008, 0.01) } }))
  .identifyAt(P(0.008, 0.005));
check("6. the half-drawn measurement answers as a measurement - it is on the chart, so it can be asked about",
      () => pend && pend.layer === "measure", () => (pend && pend.what.slice(0, 60)) || "(nothing found)");

// 7. and the row SAYS it, in a banner that stays up
page.sayWhatIsHere(P(0.003, 0.005));
page.sayWhatIsHere(P(0.0005, 0.005));
check("7. the answer is put on the banner - including 'nothing here', which is an answer and not a silence",
      () => banners.length === 2 && /NOT in the plan/.test(banners[0])
            && /Nothing the console drew is within 14 pixels/.test(banners[1]),
      () => banners.map((b) => b.slice(0, 50)).join(" | "));

// 9. A RED JOIN (2026-09-16). Add to plan refuses a punch holding a reversal with no flyable turn, and its note numbers
//    the pair ("runs 3–4") - which only means something if the chart can say which dashed red line that is. The join
//    touches the ends of the runs it joins, so the one scanned first wins a tie AT the shared end: it must be the join.
const redPage = makePage(Object.assign({}, world, {
  patClip: [[P(0.003, 0), P(0.003, 0.01)], [P(0.0031, 0.01), P(0.0031, 0)]],
  patRed: [
    { run: 1, turn: true, why: "nogo", by: "a dock / pier", a: P(0.003, 0.01), b: P(0.0031, 0.01) },
    { run: 4, turn: false, why: "nogo", by: "land", a: P(0.015, 0.02), b: P(0.017, 0.02) },
  ],
}));
const onJoin = redPage.identifyAt(P(0.00305, 0.01));        // on the red reversal, 5 px from either run end
const atEnd = redPage.identifyAt(P(0.003, 0.01));           // exactly on the end it shares with run 1
const onHop = redPage.identifyAt(P(0.016, 0.02));
const noClip = makePage(Object.assign({}, world, { patClip: null,
  patRed: [{ run: 1, turn: true, why: "nogo", by: "a dock / pier", a: P(0.015, 0.02), b: P(0.017, 0.02) }] }))
  .identifyAt(P(0.016, 0.02));
check("9. a RED JOIN in the preview names its runs and what it is: a refused reversal says Add to plan is refused, a "
      + "red hop says Upload tries again - the join wins a tie at the run end it shares, and with no punch there is none",
      () => onJoin && onJoin.layer === "red" && /reversal from run 1 to run 2 has NO FLYABLE TURN/.test(onJoin.what)
            && /enters a dock \/ pier/.test(onJoin.what) && /ADD TO PLAN is refused/.test(onJoin.what)
            && atEnd && atEnd.layer === "red"
            && onHop && onHop.layer === "red" && /RED HOP .* from run 4 to run 5 no way round land/.test(onHop.what)
            && /Upload routes every hop again/.test(onHop.what) && !/refused/.test(onHop.what)
            && noClip === null,
      () => [onJoin, atEnd, onHop].map((h) => (h ? h.layer + ": " + h.what.slice(0, 70) : "(nothing)")).join(" | ")
            + " | stale list, no punch: " + (noClip ? noClip.layer : "nothing"));

// 8. wired into the chart menu, and never gated: it reads, it does not command
check("8. the row is in the chart menu, wired to the point the menu was opened over, and gated on NOTHING - it is "
      + "available with no link, disarmed, and in a view-only tab",
      () => /<div class="cmi" id="cmWhat">/.test(H) && /cmRow\("#cmWhat",\s*ll => sayWhatIsHere\(ll\)\)/.test(H)
            && !/cmGate\("#cmWhat"/.test(H),
      "a question about what is drawn is not a command");

// -- THE BUOY CHAINS ARE ITS OWN INK ---------------------------------------------------
// ⚠⚠ THE ONE THING THIS READOUT MUST NEVER SAY ABOUT A LINE THE CONSOLE DREW IS "nothing".
// drawMarks strokes a GREEN dashed line through the port-hand marks and a RED one through the
// starboard-hand marks, unconditionally, from render(). identifyAt scanned ko.lines and
// ko.polys and never ko.sys - so a green dashed line that looks exactly like a survey line
// answered "Nothing the console drew is within 12 pixels of that point", and the advice was to
// click nearer a line the operator was already on. Andy asked about this line by name.
//
// ⚠ AND THE SIDE IS ASSERTED, not just the hit. The PORT-hand chain is what the Rule 9
// keep-right lane is measured a quarter-width to starboard of, so a readout that found the line
// but named the wrong chain would be worse than one that found nothing.
{
  const port = hitAt(0.015, 0.005);
  const stbd = hitAt(0.017, 0.005);
  check("the green and red dashed BUOY CHAINS can be asked about - the console names its own "
        + "ink, and names which side it is",
        () => port && port.layer === "buoyline" && /PORT-hand/.test(port.what)
              && /CHANNEL/.test(port.what)
              && stbd && stbd.layer === "buoyline" && /STARBOARD-hand/.test(stbd.what),
        () => "port chain: " + (port ? port.layer + " / " + port.what.slice(0, 60) : "NOTHING FOUND")
            + " | stbd chain: " + (stbd ? stbd.what.slice(0, 40) : "NOTHING FOUND"));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
