// tests/turn_channel.js - survey turns may only use channel water the survey's
// own coverage lines occupy (the TURN WATER rule).
//
// WHY THIS EXISTS. On 2026-08-07 Andy's live survey at Lewes generated end-of-line
// turns that arced up to 34 m INTO the dredged navigation channel, crossing a
// charted row of pilings mid-reversal. Every layer was individually "correct":
//
//   * the dredged channel is only a keep-out when the operator enforces
//     "Dredged / restricted" - off by default, or no boat could ever transit one;
//   * channelSpanKeepouts only fires when a coverage LINE crosses the channel
//     out->in->out, and Andy's lines ran PARALLEL to it - and it only clips lines;
//   * the pilings are charted as individual Pile_point features ~60 m apart, so
//     the turn's legClear sweep lawfully threaded BETWEEN their keep-out disks
//     while crossing the pile ROW as a real-world barrier.
//
// So the turns validated clean against water the plan was never meant to enter.
// The rule that closes it: channel polys (dredged areas + buoy-gate fairway
// corridors) that contain NO sample of any CLIPPED coverage line are keep-outs
// for the turns, the reversal straight-hop check and the serpentine ordering
// (koTurn). Routed region-hop transits keep plain `ko` - crossing a channel to
// reach the other side is lawful navigation under channelLaneRoute/gateLegClear.
// An intentional in-channel survey still turns inside the channel: its lines
// occupy the poly, so the poly is granted.
//
//   node tests/turn_channel.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// Replayed against the ACTUAL logged plan (38 lines, 2026-08-07 session log) with the
// real Lewes ENC extract: old keep-outs generated 30 turns with 68 arc points inside
// the channel; with koTurn the 3 channel-crossing reversals refuse (named "a
// navigation channel") and 0 arc points remain inside. The checks below rebuild the
// class hermetically - a synthetic channel + pile row, no network, no ENC cache.
//
// TEETH (verified by mutation, with the checks each one produces):
//     punchOut hands the turns plain `ko` again (the shipped fault)     -> 10
//     channelTurnKeepouts grant inverted (!entered -> entered)          -> 2, 4
//     channelTurnKeepouts neutered (always [])                          -> 2, 8, 9
//     teardropTurn refusal loses its failing chord (seg)                -> 7
//     legSafe checks `ko` instead of `koTurn`                           -> 11
//     reversal routeAround/lane fall back to `ko` (koHere dropped)      -> 12
//     the nNoTurn banner stops naming/highlighting the channel          -> 13, 14
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one - building a world, eval-ing page code, awaiting a fetch - and a throw there
// would kill the process before a single FAIL line printed. "No FAIL lines" and "the
// process died" are indistinguishable to anything reading stdout, so a mutation that
// crashes this suite would score as SURVIVED. Report it instead, in the normal format.
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

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { azTo, distTo, fromEN, llEN, planeFrame } = require("../static/js/geodesy.js");
const { bbOf, dSeg, eachPath, eachPoint, eachRing, inBB, pinp, segSamplesEN } = require("../static/js/geometry.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
const { HAZ_UNKNOWN_EXTENT, MARK_TAIL, blocked, blockedInfo, buildKeepouts, channelPolys, depthExcluded, firstBlockAlong, hazExtent, legClear, markId, markSystems, nogoKind, pairGates } = require("../static/js/chart.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
const { channelTurnKeepouts } = require("../static/js/passage.js");
const { arcPts, teardropTurn } = require("../static/js/turns.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
const { nogo } = require("../static/js/state.js");

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try {
    ok = !!(typeof cond === "function" ? cond() : cond);
    note = typeof detail === "function" ? detail() : detail;
  } catch (e) { ok = false; note = "THREW: " + e.message; }
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

// ---- pull the REAL page functions --------------------------------------- //
let code = "const M_PER_DEG_LAT = 111320;\n" +
  "let waterOffset = 0; const NOGO_MIN_DEPTH_M = 2.3, WRECK_CLEAR_MARGIN_M = 0.5;\n";
// MARK_TAIL and HAZ_UNKNOWN_EXTENT are REQUIRED from chart.js above; the sandbox is
// handed the real values rather than a second copy parsed out of the source.
code += "const MARK_TAIL = " + MARK_TAIL.toString() + ";\n";
code += "const HAZ_UNKNOWN_EXTENT = new Set(" + JSON.stringify([...HAZ_UNKNOWN_EXTENT]) + ");\n";
{ const m = H.match(/(?:const|let) WRECK_RADIUS_M[^;]*;/); if (m) code += m[0] + "\n"; }
// arcPts and teardropTurn are a MODULE now (2026-08-20) and are REQUIRED above -- a
// rename fails at load rather than resolving to a stale copy. The eval below still
// builds the sandbox the remaining page-sourced helpers need.
eval(code);

// ---- synthetic world ----------------------------------------------------- //
// EN metres around ref; +n = north. A dredged channel rectangle SOUTH of the
// survey (y in [-120,-20], x in [-150,250]) with a row of Pile_point hazards
// along its north edge every 60 m - the Lewes geometry, distilled.
// A FRAME, not a bare point: buildKeepouts and channelPolys take the core bodies now,
// and those convert through `frame.toEN`. planeFrame still carries lat/lon, so the same
// value keeps working as the `ref` fromEN/llEN below want -- which is the property that
// let the console switch without touching its ~70 conversion call sites.
const ref = planeFrame({ lat: 38.79, lon: -75.157 });
const ll = (e, n) => fromEN(e, n, ref);
const ringLonLat = pts => [pts.map(([e, n]) => { const p = ll(e, n); return [p.lon, p.lat]; })];

const chanRing = [[-150, -20], [250, -20], [250, -120], [-150, -120], [-150, -20]];
const feats = [
  { role: "dredged", cls: "Dredged_Area", props: {},
    geometry: { type: "Polygon", coordinates: ringLonLat(chanRing) } },
];
for (const x of [-35, 25, 85, 145, 205]) {
  const p = ll(x, -20);
  feats.push({ role: "hazard_point", cls: "Pile_point", props: {},
               geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
}
const enf = { land: true, depth: true, haz: true, area: false };
const dr = { min: 2.3, max: 0 };
const buffer = 3;
const ko = buildKeepouts(ref, enf, dr, feats);

const chanPoly = () => channelPolys(ref, feats, ko.marks);
const inChan = p => { const q = llEN(p.lat, p.lon, ref);
  for (const c of chanPoly()) if (inBB(q, c.bb, 0) && pinp(q, c.ring)) return true; return false; };

// two N-S coverage lines EAST-side, ending 20 m north of the channel; 30 m apart,
// minR 20 -> the reversal is a teardrop reaching ~39 m south of the line ends.
const L1 = [ll(70, 300), ll(70, 0)];    // heading S into the turn
const L2 = [ll(100, 0), ll(100, 300)];  // heading N out of it
const linesBeside = [L1, L2];
const minR = 20;

console.log("TURN WATER — turns may only use channel water the survey lines occupy:");

// 1. the channel is not in the default keep-outs (that is WHY this rule exists:
//    with "Dredged / restricted" off, nothing else stands between a turn and it)
check("1. a dredged channel is NOT a default keep-out (enf.area off) and the piles ARE",
      () => !ko.polys.length && ko.points.length === 5,
      () => "polys " + ko.polys.length + ", points " + ko.points.length);

// 2. lines BESIDE the channel forbid it to turns
const forb = channelTurnKeepouts(linesBeside, ref, feats, ko.marks);
check("2. lines beside the channel -> the poly is turn-forbidden, named 'a navigation channel'",
      () => forb.length === 1 && forb[0].kind === "a navigation channel",
      () => JSON.stringify(forb.map(f => f.kind)));

// 3. GEOMETRY SANITY for everything below: the teardrop for this pair really does
//    swing into the channel (else checks 5-6 would pass vacuously)
const E = L1[1], F = L2[0];
const hE = azTo(L1[0], L1[1]), hF = azTo(L2[0], L2[1]);
const tOpen = teardropTurn(E, F, hE, hF, ref, ko, buffer, minR);
check("3. THE SHIPPED FAULT, alive when ungated: against plain ko the loop GENERATES, " +
      "THREADS the charted pile row, and its arc enters the channel",
      () => tOpen.pts && tOpen.pts.some(inChan),
      () => tOpen.pts ? tOpen.pts.filter(inChan).length + " arc points inside" : "refused: " + tOpen.why);

// 4. an in-channel survey keeps its water: a line INSIDE the poly grants it
check("4. a coverage line INSIDE the channel -> nothing is forbidden (the grant)",
      () => channelTurnKeepouts([[ll(-100, -70), ll(200, -70)]], ref, feats, ko.marks).length === 0);

// 5. the same turn against koTurn refuses
const koTurn = { ...ko, polys: [...ko.polys, ...forb] };
const tGated = teardropTurn(E, F, hE, hF, ref, koTurn, buffer, minR);
check("5. the same loop against koTurn REFUSES (why: nogo)",
      () => !tGated.pts && tGated.why === "nogo",
      () => "why " + tGated.why);

// 6/7. the refusal names its blocker
check("6. the refusal carries its failing chord (seg)",
      () => Array.isArray(tGated.seg) && tGated.seg.length === 2);
check("7. firstBlockAlong on that chord names 'a navigation channel'",
      () => { const fb = firstBlockAlong(tGated.seg[0], tGated.seg[1], ref, koTurn, buffer);
              return fb && fb.info.kind === "a navigation channel"; });

// 8. REFUSAL PAIRED WITH ACCEPTANCE: the identical reversal with sea room (lines
//    ending 100 m further north) is accepted under the same koTurn
const A1 = [ll(70, 300), ll(70, 100)], A2 = [ll(100, 100), ll(100, 300)];
const tClear = teardropTurn(A1[1], A2[0], azTo(A1[0], A1[1]), azTo(A2[0], A2[1]), ref, koTurn, buffer, minR);
check("8. the same reversal with sea room still turns under koTurn",
      () => !!tClear.pts && !tClear.pts.some(inChan),
      () => tClear.pts ? tClear.kind : "refused: " + tClear.why);

// 9. the spanning case feeds POST-CLIP segments, which stop outside the channel,
//    so the crossed channel is turn-forbidden too; and the grant is PER POLY -
//    occupying one channel does not grant a disjoint one
const clippedSpan = [[ll(70, 300), ll(70, -17)], [ll(70, -123), ll(70, -300)]];
const feats2 = feats.concat([{ role: "dredged", cls: "Dredged_Area", props: {},
  geometry: { type: "Polygon", coordinates: ringLonLat([[300, -20], [500, -20], [500, -120], [300, -120], [300, -20]]) } }]);
check("9. post-clip spanning segments forbid the crossed channel; per-poly grant " +
      "(a line in poly A leaves disjoint poly B forbidden)",
      () => channelTurnKeepouts(clippedSpan, ref, feats, ko.marks).length === 1 &&
            channelTurnKeepouts([[ll(-100, -70), ll(200, -70)]], ref, feats2, ko.marks).length === 1);

// ---- the CALLER (a pure helper proves nothing about who calls it) -------- //
const P = grab("punchOut");
// The turn builder is `turnWithRetry` since 2026-08-31 (the ladder: outboard, inboard,
// then both again at the slow radius). Pinned to the ARGUMENT rather than to the function
// name, because what this check is really about is that a turn is validated against
// koTurn - the channel-restricted turn water - and never against the looser `ko` that a
// genuine region hop may use.
check("10. punchOut hands the TURNS koTurn, and derives it from the CLIPPED lines",
      () => /turnWithRetry\(Ap, Bp, hE, hF, ref, koTurn,/.test(P) &&
            P.includes("channelTurnKeepouts(clipped, ref, nogo.features, ko.marks)"));
// 10b. AND EVERY RUNG OF THE LADDER GETS THE SAME MODEL. A retry that quietly fell back to
// a looser keep-out set would be worse than no retry at all: it would find a turn exactly
// where the first attempt had correctly refused one. turnWithRetry takes ONE ko and hands
// it down unchanged - the only things that vary between rungs are the side and the radius.
{
  const T = require("fs").readFileSync(
    require("path").join(__dirname, "..", "static", "js", "turns.js"), "utf8");
  const s = T.indexOf("export function turnWithRetry");
  const body = s < 0 ? "" : T.slice(s, T.indexOf("\n}", s) + 2);
  const calls = body.match(/teardropTurn\([^)]*\)/g) || [];
  check("10b. every rung of the turn ladder is validated against the SAME keep-out model",
        () => calls.length === 1 &&
              /teardropTurn\(E, F, hE, hF, ref, ko, buf, t\.minR, maxHalfM, t\.side\)/.test(calls[0]),
        calls.length + " teardropTurn call(s) in turnWithRetry: " + (calls[0] || "none"));
}
check("11. punchOut's legSafe (serpentine adjacency + the reversal straight hop) walks koTurn",
      () => /const legSafe=[\s\S]{0,500}?koTurn, buffer\)\) return false/.test(P));
check("12. a refused REVERSAL that falls to routing stays out of the channel " +
      "(koHere = antiParallel ? koTurn : ko), while region hops keep ko",
      () => P.includes("const koHere = antiParallel ? koTurn : ko;") &&
            P.includes("routeAround(Ap,Bp,ref,koHere,buffer)") &&
            /channelLaneRoute\(\[Ap,\.\.\.around,Bp\], ref, koHere, buffer, \{lane:false\}\)/.test(P));
// 12b. ⚠ AND THAT CALL NO LONGER RIDES THE RULE 9 LANE (2026-08-31). It is a hop between
// two lines of a SURVEY PATTERN, and Andy: "while running various survey patterns the rule
// should not be considered." The CALL stays, because the three stages after the lane -
// smooth, the per-leg keep-out gate, and the knot prune this very loop depends on - have
// nothing to do with Rule 9 and a pattern needs all of them. `lane:false` skips the lane,
// not the pipeline; dropping the call instead would trade a safety re-check for a legal
// correction, which is the wrong way round.
check("12b. ... and it does NOT ride the Rule 9 lane, while keeping the gate and the prune",
      () => /\{lane:false\}/.test(P) && P.includes("pruneJunctionKnots("),
      "lane:false keeps smoothTrack / gateLegClear / pruneStitch and skips only the offset");
check("13. the nNoTurn banner HIGHLIGHTS the blockers (setViolations, not clearViolation)",
      () => /else if\(nNoTurn\)\{ setViolations\(turnBlocks\);/.test(P));
check("14. the banner and the hint NAME the channel (open-looking water needs naming)",
      () => P.includes("a navigation channel the survey lines do not enter") &&
            P.includes("refused by a navigation channel"));

console.log(ran + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
