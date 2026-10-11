// tests/target_cpa.js - CPA / TCPA, the hull footprint, and the two integration faults
// that made both of them silently useless in the page.
//
// Andy, 2026-09-02: *"Add and recalculate CPA/TCPA as needed especially after a maneuver.
// ... Build the resultant vessel icon to match the relative size and/or have those data
// attached to the icon to read on cursor hover."*
//
// CPA is the closest two vessels will come; TCPA is when. They are the two numbers a
// collision judgement is built on and the console had neither. The contact runs on its
// present course and speed; our boat does too (checks 1-11), unless she is being steered
// along a route - then she is walked along it, every turn and every leg's own speed, and
// holds at its end (checks 12-21; Andy, 2026-10-10: "CPA/TCPA should be computed from
// current range on the ASV planned route, projecting both vessels' speed and course").
//
// ⚠ "RECALCULATE AFTER A MANOEUVRE" IS A PROPERTY OF THE DESIGN, NOT A FEATURE. `cpa()` is
// a pure function of the kinematics handed to it, so there is no stored value to go stale
// and no manoeuvre-detector to miss one. Check 6 is that property stated as a test: change
// either vessel's course and the answer changes with it, because it was never cached.
//
//   node tests/target_cpa.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ⚠⚠ TWO OF THESE CHECKS EXIST BECAUSE THE MATHS WAS RIGHT AND THE READOUT WAS NOT. The
// module below passed every kinematic case first time, and the console still showed
// nothing useful:
//
//   * `aisCpa` read `asv.sog` / `asv.cog`. THE BOAT'S TRACK IS NOT ON `asv` - that object
//     carries position and drawn heading; speed and course over ground are `sog_kn` and
//     `cog_deg` on `S.status`. So every CPA came back null and the row simply never
//     appeared, which reads exactly like "nothing is closing". (check 10)
//   * `cpaText` called `fmtDist(cpaM/1000)`. fmtDist TAKES METRES. Every closest approach
//     under a kilometre rendered as **"0 m"** - a 434 m pass displayed as a collision.
//     (check 11)
//
// Neither is visible from this module's own numbers; both were found by reading the live
// tip against the computed values. That is why the last two checks reach into the page.
//
// ⚠ AND BOTH OF THOSE CHECKS FAILED ON THEIR FIRST RUN AGAINST THE FIXED SOURCE - because
// the fix carries a comment explaining the bug, and the comment names `asv.sog` and
// `fmtDist(c.cpaM/1000)`, which is exactly what the check was grepping for. A source-shape
// check whose pattern occurs in its own subject's prose matches the prose. They strip line
// comments before matching now.
//
// TEETH - five mutations RUN against a sidecar copy:
//   CPA sign flipped (a past approach reported as future) -> 1, 2, 3, 4b, 6
//   holding-station guard removed (divide by ~zero)       -> 4
//   hull box centred instead of anchored on the antenna   -> 7
//   aisCpa reads asv.sog again                            -> 10
//   cpaText divides by 1000 again                         -> 11
// ... and nine more against the route (2026-10-10, each on a scratch copy of static/ and tests/):
//   she runs straight on her first leg (turns ignored)    -> 13, 14, 15, 18
//   every leg at the first leg's speed                    -> 14, 20
//   no hold at her last waypoint                          -> 17
//   the FIRST closest approach, not the least             -> 18
//   a closest approach in the PAST along her route        -> 16
//   aisCpa never asks for her route                       -> 19
//   cpaTrack ignores the set                              -> 20
//   cpaTrack runs every leg at the role she is in now     -> 20
//   the TCPA cell shows -0s for an opening contact        -> 21

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
const { cpa, cpaAlong, routeTrack, velocityEN, hullBox, KN_TO_MS, MIN_REL_SPEED_MS } =
  require("../static/js/targets.js");
const { fmtDist } = require("../static/js/units.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

// A nautical mile of latitude, from the WGS84 meridian scale at 42°N — stated here rather
// than taken from the module, so the fixture geometry is not built out of the thing under
// test. (It differs from the module's spherical frame by ~0.7%, which is why the tolerances
// below are in percent and not in millimetres.)
const M_PER_DEG_LAT_42 = 111041.0;
const NM = 1852;
const OWN = { lat: 42.0, lon: -70.0 };
const northOf = (m) => ({ lat: 42.0 + m / M_PER_DEG_LAT_42, lon: -70.0 });
const near = (a, b, pct) => Math.abs(a - b) <= Math.abs(b) * pct + 1e-9;

console.log("CPA / TCPA — the closest two vessels will come, and when:");

// ── 1-3. THE KINEMATIC CASES, each with an answer known without the code ────────────
{
  // Head-on: we are stopped, a ship 1 NM north runs due south at 10 kn. They must meet.
  // TCPA = 1852 / (10 × 0.514444) = 360.0 s exactly.
  const r = cpa({ ...OWN, sog: 0, cog: 0 }, { ...northOf(NM), sog: 10, cog: 180 });
  check("1. head-on: CPA is zero and TCPA is range / closing speed",
        () => r.cpaM < 1 && near(r.tcpaS, 360, 0.02) && r.closing,
        "cpa " + r.cpaM.toFixed(1) + " m, tcpa " + r.tcpaS.toFixed(1) + " s (want ~0 m, 360 s)");

  // The same ship running AWAY. The closest approach is BEHIND us in time, and saying so
  // is the point: reporting a past CPA as though it were ahead is the one wrong answer
  // that reads exactly like a working alarm.
  const o = cpa({ ...OWN, sog: 0, cog: 0 }, { ...northOf(NM), sog: 10, cog: 0 });
  check("2. a contact drawing away reports a NEGATIVE tcpa and closing=false",
        () => o.tcpaS < 0 && !o.closing,
        "tcpa " + o.tcpaS.toFixed(1) + " s, closing=" + o.closing);

  // Overtaking, both under way: we make 5 kn north, a ship 2 NM astern makes 15 kn north.
  // Closing at 10 kn over 2 NM -> 720 s.
  const ot = cpa({ ...OWN, sog: 5, cog: 0 },
                 { lat: 42.0 - 2 * NM / M_PER_DEG_LAT_42, lon: -70.0, sog: 15, cog: 0 });
  check("3. overtaking: only the RELATIVE motion counts, not either speed alone",
        () => ot.cpaM < 1 && near(ot.tcpaS, 720, 0.02),
        "cpa " + ot.cpaM.toFixed(1) + " m, tcpa " + ot.tcpaS.toFixed(1) + " s (want ~0 m, 720 s)");
}

// ── 4-5. WHAT HAS NO CPA, AND WHY SAYING SO BEATS INVENTING ONE ─────────────────────
{
  // TCPA divides by |V|². Two vessels holding station on each other have a relative speed
  // made of report jitter, and dividing by it yields enormous times from millimetres.
  const held = cpa({ ...OWN, sog: 0, cog: 0 }, { ...northOf(500), sog: 0, cog: 0 });
  check("4. two vessels holding station have a RANGE but no time — tcpa is null, not huge",
        () => held.tcpaS === null && near(held.cpaM, 500, 0.02) && !held.closing,
        "tcpa " + held.tcpaS + ", cpa " + held.cpaM.toFixed(0) + " m");
  // Pair the refusal with its acceptance, or "returns null" passes for a function that
  // never computes anything.
  const moving = cpa({ ...OWN, sog: 0, cog: 0 }, { ...northOf(500), sog: 6, cog: 180 });
  check("4b. ... while the same pair with one under way DOES get a time",
        () => moving.tcpaS != null && moving.tcpaS > 0,
        "tcpa " + (moving.tcpaS == null ? "null" : moving.tcpaS.toFixed(0) + " s"));

  const noTrack = cpa({ ...OWN, sog: 0, cog: 0 }, { ...northOf(500), sog: null, cog: null });
  check("5. a contact reporting no track gets no CPA at all — null, never a zero",
        () => noTrack === null && velocityEN(null, null) === null && velocityEN(5, null) === null,
        "a zero velocity would assert the vessel is STOPPED, which is a different claim");
}

// ── 6. THE MANOEUVRE PROPERTY ───────────────────────────────────────────────────────
// Nothing is cached, so a course change by EITHER vessel changes the answer immediately.
// This is what Andy asked for ("recalculate ... especially after a maneuver") and it needs
// no manoeuvre detector — the only way to get a stale CPA here is to stop calling.
{
  const own = { ...OWN, sog: 6, cog: 0 };
  const tgt = { ...northOf(NM), sog: 10, cog: 180 };
  const before = cpa(own, tgt);
  const theyTurn = cpa(own, { ...tgt, cog: 90 });        // target hauls off to the east
  const weTurn = cpa({ ...own, cog: 90 }, tgt);          // we haul off instead
  check("6. a manoeuvre by EITHER vessel changes the answer, with nothing cached",
        () => before.cpaM < 1 && theyTurn.cpaM > 200 && weTurn.cpaM > 200,
        "steady " + before.cpaM.toFixed(0) + " m -> they turn " + theyTurn.cpaM.toFixed(0)
          + " m, we turn " + weTurn.cpaM.toFixed(0) + " m");
}

// ── 7-9. THE HULL FOOTPRINT ─────────────────────────────────────────────────────────
// AIS dimensions are referenced to the GNSS ANTENNA, not the hull centre: A forward to the
// bow, B aft, C to port, D to starboard. On a big ship with the bridge aft that offset is
// most of the hull, so a box centred on the reported position puts the bow in the wrong
// water. EVER DIADEM's real figures, from the published AIS conformance sentence.
{
  const b = hullBox({ length: 295, beam: 32, dim: { a: 225, b: 70, c: 1, d: 31 } });
  check("7. the hull is sized from AIS and drawn about the ANTENNA, not about the middle",
        () => b.lengthM === 295 && b.beamM === 32 && b.toBowM === 225 && b.toSternM === 70
              && b.toPortM === 1 && b.toStbdM === 31 && b.exact,
        "295 x 32 m with the antenna " + b.toBowM + " m from the bow — centring it would "
          + "put the stem " + (b.toBowM - b.lengthM / 2) + " m from where it is");
  const partial = hullBox({ length: 100 });
  check("8. a PARTIAL report still sizes the icon, and says it is not exact",
        () => partial && partial.lengthM === 100 && partial.beamM > 0 && !partial.exact
              && partial.toBowM === 50,
        "length only -> " + partial.lengthM + " x " + partial.beamM.toFixed(1)
          + " m, antenna assumed amidships");
  check("9. all-zero dimensions are AIS for NOT AVAILABLE, so there is no box to draw",
        () => hullBox({}) === null
              && hullBox({ dim: { a: 0, b: 0, c: 0, d: 0 } }) === null,
        "a zero-metre hull would draw as a dot and read as a real reading");
}

// ── 10-11. THE PAGE WIRING — where the maths was right and the readout was not ──────
{
// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
  const RAW = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");
  // ⚠ CODE ONLY. Both of these checks failed on their first run against the FIXED source,
  // because the fix carries a comment explaining the bug - and the comment names
  // `asv.sog` and `fmtDist(c.cpaM/1000)`, which is exactly what the check was grepping
  // for. A source-shape check whose pattern appears in its own subject's prose will match
  // the prose. Strip line comments before matching, the way enc_roles.js reads ENC_ROLES.
  // ⚠ THIS FILE IS CRLF (checked out with core.autocrlf=true). The OUTER match already
  // absorbs a trailing \r into `l` (only \n is excluded from [^\n]), but the INNER
  // .replace(/\/\/.*$/,"") could never reach past it: `.` excludes \r too, and `$` with
  // no /m flag demands the true end of `l`, one character beyond where `.*` could stop -
  // so the strip silently no-op'd and the comment (with its "asv.sog" prose) survived.
  // [^\n]* in the inner pattern needs no $ at all: it already runs to the true end of `l`.
  const decomment = (t) => t.replace(/^[^\n]*\/\/[^\n]*$/gm, (l) => l.replace(/\/\/[^\n]*/, ""));
  const H = decomment(RAW);
  const fn = H.slice(H.indexOf("function aisCpa("), H.indexOf("function cpaText("));

  // ⚠ THE BOAT'S TRACK IS ON S.status, NOT ON asv. Reading asv.sog/asv.cog yields
  // undefined, cpa() correctly returns null, and the CPA row silently never renders -
  // which on a collision readout means "nothing is closing".
  check("10. aisCpa takes OUR speed and course from the telemetry that carries them",
        () => /sog_kn/.test(fn) && /cog_deg/.test(fn) && !/asv\.sog/.test(fn) && !/asv\.cog/.test(fn),
        /asv\.sog/.test(fn) ? "reading asv.sog — that field does not exist, so every CPA is null"
                            : "reads S.status.sog_kn / cog_deg");

  // ⚠ fmtDist TAKES METRES. Dividing by 1000 first made every sub-kilometre CPA render
  // as "0 m". Asserted against the real formatter rather than by matching source text, so
  // it is the OUTPUT that is pinned.
  check("11. a sub-kilometre CPA renders as real metres, not as zero",
        () => fmtDist(434) === "434 m" && fmtDist(434 / 1000) === "0 m"
              && !/fmtDist\(c\.cpaM\s*\/\s*1000\)/.test(H),
        "fmtDist(434)=" + fmtDist(434) + " but fmtDist(434/1000)=" + fmtDist(434 / 1000)
          + " — the second is what shipped, and a 434 m pass read as a collision");
  check("11b. ... and above a kilometre it follows the operator's own unit",
        () => /km|nm/.test(fmtDist(1272)),
        "fmtDist(1272) = " + fmtDist(1272));
}

// ── 12-18. ALONG HER ROUTE (Andy, 2026-10-10: "CPA/TCPA should be computed from current range on the ASV planned
// route, projecting both vessels' speed and course ... the ASV path should be known through the whole mission barring
// avoidance maneuvers"). Each answer is worked here by hand, in meters east/north of her, and built into lat/lon with
// this file's own meridian scale - not the module's frame.
{
  const KN = 0.514444, COS42 = Math.cos(42 * Math.PI / 180);
  const at = (e, n) => ({ lat: 42.0 + n / M_PER_DEG_LAT_42, lon: -70.0 + e / (M_PER_DEG_LAT_42 * COS42) });
  const lay = (pts, ms) => routeTrack(pts.map(([e, n]) => at(e, n)), ms);
  const ship = (e, n, ms, cog) => ({ ...at(e, n), sog: ms / KN, cog });
  const f1 = (x) => (x == null ? "null" : x.toFixed(1));
  // 12. A straight route is the straight projection: east 3 km at 3 m/s; a ship 1500 m east and 600 m north of her
  // runs south at 2 m/s. R = (1500 - 3t, 600 - 2t), least at 13t = 5700: t = 438.5 s, 332.8 m apart.
  const tgt12 = ship(1500, 600, 2, 180);
  const a12 = cpaAlong(lay([[0, 0], [3000, 0]], [3]), tgt12), s12 = cpa({ ...at(0, 0), sog: 3 / KN, cog: 90 }, tgt12);
  check("12. along a STRAIGHT route she is where the straight projection puts her: the same CPA and TCPA",
        () => near(a12.cpaM, 332.8, 0.02) && near(a12.tcpaS, 438.5, 0.02) && near(a12.cpaM, s12.cpaM, 0.01)
              && near(a12.tcpaS, s12.tcpaS, 0.01) && a12.closing && a12.along === true,
        "along " + f1(a12.cpaM) + " m in " + f1(a12.tcpaS) + " s; straight " + f1(s12.cpaM) + " m in " + f1(s12.tcpaS)
          + " s (want 332.8 m, 438.5 s)");
  // 13. HER ROUTE TURNS: east 600 m, then north 600 m, at 3 m/s; a ship lying stopped 600 m east and 300 m north.
  // Her route runs through it: 0 m at (600 + 300) / 3 = 300 s. On her present course (east) it is 300 m off at 200 s.
  const L = [[0, 0], [600, 0], [600, 600]], moored = ship(600, 300, 0, 0);
  const a13 = cpaAlong(lay(L, [3, 3]), moored), s13 = cpa({ ...at(0, 0), sog: 3 / KN, cog: 90 }, moored);
  check("13. HER ROUTE TURNS: a ship lying on the leg after the turn is passed at 0 m in 300 s - not 300 m off in "
        + "200 s, where her present course would put it",
        () => a13.cpaM < 3 && near(a13.tcpaS, 300, 0.02) && near(s13.cpaM, 300, 0.02) && near(s13.tcpaS, 200, 0.02),
        "along " + f1(a13.cpaM) + " m in " + f1(a13.tcpaS) + " s; present course " + f1(s13.cpaM) + " m in " + f1(s13.tcpaS) + " s");
  // 14. ... AT EACH LEG'S OWN SPEED: the leg after the turn at 1.5 m/s - 200 + 300 / 1.5 = 400 s.
  const a14 = cpaAlong(lay(L, [3, 1.5]), moored);
  check("14. ... and each leg is run at its OWN speed: the leg after the turn at half speed puts the pass at 400 s",
        () => a14.cpaM < 3 && near(a14.tcpaS, 400, 0.02), f1(a14.cpaM) + " m in " + f1(a14.tcpaS) + " s (want 0 m, 400 s)");
  // 15. A SHIP UNDER WAY: 600 m east and 600 m north, running south at 1.5 m/s. After her turn (t = 200 s) she is at
  // (600, 3(t - 200)), the ship at (600, 600 - 1.5 t): they meet at 4.5 t = 1200, t = 266.7 s. On her present course
  // R = (600 - 3t, 600 - 1.5t), least at 11.25 t = 2700: 240 s, 268.3 m.
  const crossing = ship(600, 600, 1.5, 180);
  const a15 = cpaAlong(lay(L, [3, 3]), crossing), s15 = cpa({ ...at(0, 0), sog: 3 / KN, cog: 90 }, crossing);
  check("15. A SHIP UNDER WAY meets her on the leg after the turn: 0 m in 267 s (her present course says 268 m in 240 s)",
        () => a15.cpaM < 4 && near(a15.tcpaS, 266.7, 0.02) && near(s15.cpaM, 268.3, 0.02) && near(s15.tcpaS, 240, 0.02),
        "along " + f1(a15.cpaM) + " m in " + f1(a15.tcpaS) + " s; present course " + f1(s15.cpaM) + " m in " + f1(s15.tcpaS) + " s");
  // 16. OPENING: a ship 300 m astern running away west at 2 m/s while she runs east - the range only grows. Along her
  // route there is no past: the CPA is the range now, at 0 s, not closing.
  const a16 = cpaAlong(lay([[0, 0], [600, 0]], [3]), ship(-300, 0, 2, 270));
  check("16. OPENING along her route: the range only grows, so the CPA is the range now, at 0 s, and not closing",
        () => !a16.closing && a16.tcpaS === 0 && near(a16.cpaM, 300, 0.02) && near(a16.rangeM, 300, 0.02),
        f1(a16.cpaM) + " m at " + f1(a16.tcpaS) + " s, closing=" + a16.closing);
  // 17. AFTER HER LAST WAYPOINT SHE HOLDS THERE: east 300 m at 3 m/s (there at 100 s); a ship 300 m east and 500 m
  // north runs south at 2 m/s and reaches her end point at 250 s - while she waits on it.
  const a17 = cpaAlong(lay([[0, 0], [300, 0]], [3]), ship(300, 500, 2, 180));
  check("17. ... AND HOLDS AT HER LAST WAYPOINT: a ship crossing her end point after she has reached it passes 0 m off "
        + "at 250 s (with her route stopped at 100 s it would read 300 m)",
        () => a17.cpaM < 3 && near(a17.tcpaS, 250, 0.02), f1(a17.cpaM) + " m in " + f1(a17.tcpaS) + " s");
  // 18. THE CLOSEST OVER THE WHOLE MISSION, NOT THE FIRST: a survey line east 1000 m at 5 m/s, 100 m north, and back
  // west. A stopped ship 500 m east and 150 m north is 150 m off on the first line at 100 s and 50 m off on the second
  // at 200 + 20 + 100 = 320 s.
  const a18 = cpaAlong(lay([[0, 0], [1000, 0], [1000, 100], [0, 100]], [5, 5, 5]), ship(500, 150, 0, 0));
  check("18. THE CLOSEST OVER THE WHOLE MISSION: 50 m on the second survey line at 320 s, not 150 m on the first at 100 s",
        () => near(a18.cpaM, 50, 0.03) && near(a18.tcpaS, 320, 0.02), f1(a18.cpaM) + " m in " + f1(a18.tcpaS) + " s");
  // 18b. ... and what has no answer says so: a contact with no track, a route with a leg it cannot run.
  check("18b. ... a contact reporting no track gets no CPA along her route either, and a route with a leg of no speed "
        + "is no clock (the straight projection stands in)",
        () => cpaAlong(lay(L, [3, 3]), { ...at(600, 300), sog: null, cog: null }) === null
              && lay(L, [3, 0]) === null && lay([[0, 0]], []) === null && lay(L, [3, 3]) !== null);
}

// ── 19-21. THE PAGE'S OWN FUNCTIONS, run against stubs ─────────────────────────────────────────────────────────────
{
  const RAW = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8");
  const grabFn = (name) => {
    const start = RAW.indexOf("function " + name + "(");
    if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
    let k = RAW.indexOf("{", RAW.indexOf(")", start)), depth = 0;
    for (;;) { const c = RAW[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
    return RAW.slice(start, k + 1);
  };
  const G = require("../static/js/geodesy.js"), { groundVel } = require("../static/js/guard.js");
  // 19. aisCpa: ALONG HER ROUTE when cpaTrack has one, her present course and speed when it has none
  const mkCpa = new Function("S", "asv", "cpaTrack", "cpaAlong", "cpaOf", grabFn("aisCpa") + "\nreturn aisCpa;");
  const along = (tr) => ({ along: true, tr }), straight = () => ({ along: false });
  const S0 = { status: { sog_kn: 5, cog_deg: 90 } }, asv0 = { lat: 42, lon: -70, hdg: 90 }, v0 = { lat: 42.01, lon: -70, sog: 3, cog: 180 };
  const r19a = mkCpa(S0, asv0, () => "TRACK", along, straight)(v0), r19b = mkCpa(S0, asv0, () => null, along, straight)(v0);
  check("19. the card's CPA is ALONG HER ROUTE when she is being steered along one, and on her present course and speed "
        + "when she is not",
        () => r19a.along === true && r19a.tr === "TRACK" && r19b.along === false
              && mkCpa(S0, asv0, () => "TRACK", along, straight)({ ...v0, sog: null }) === null,
        "with a route: " + JSON.stringify(r19a) + "; without: " + JSON.stringify(r19b));
  // 20. cpaTrack: the GUARD'S route ahead, each leg at the speed the governor will command on it and the set along it
  const minMs = +(/const CPA_MIN_LEG_MS = ([\d.]+);/.exec(RAW) || [])[1];
  const mkTrack = new Function("S", "asv", "nogo", "guardTrack", "groundVel", "runRoute", "runLegKeys", "V", "roleSpeed",
    "speedRole", "KN_TO_MS", "routeTrack", "let cpaTrackMemo = {key: null, route: null, val: null}; const CPA_MIN_LEG_MS = "
    + minMs + ";\n" + grabFn("cpaTrack") + "\nreturn cpaTrack;");
  const KN = 0.514444, COS42 = Math.cos(42 * Math.PI / 180);
  const at = (e, n) => ({ lat: 42.0 + n / M_PER_DEG_LAT_42, lon: -70.0 + e / (M_PER_DEG_LAT_42 * COS42) });
  const route = [at(0, 0), at(1000, 0), at(1000, 1000)];
  const V = { SPEED_KN: { survey: 4, transit: 8, turn: 3 } };
  const keys = () => (i) => (i === 1 ? "survey" : i === 2 ? "transit" : null);
  const nogo = { frame: G.planeFrame({ lat: 42, lon: -70 }) };
  const run = (setKn, gt) => mkTrack({ status: { sog_kn: 4, cog_deg: 90, env_set_deg: 0, env_set_kn: setKn } }, at(200, 0), nogo,
    gt, groundVel, route, keys, V, () => "turn", () => "turn", KN, routeTrack)();
  const ahead = () => ({ idx: 1, ahead: route.slice(1) });
  const calm = run(0, ahead), set = run(1, ahead), none = run(0, () => null);
  // calm: 800 m at 4 kn = 388.8 s, then 1000 m at 8 kn = 243.0 s (631.8). A 1 kn set to the NORTH: across the first
  // (east) leg she crabs, sqrt(2.0578^2 - 0.5144^2) = 1.9925 m/s -> 401.5 s; along the second it follows her,
  // 4.1156 + 0.5144 = 4.630 m/s -> 216.0 s (617.5).
  const tOf = (tr) => (tr ? tr.pts.map((p) => +p.t.toFixed(1)) : null);
  check("20. her route for the CPA is the GUARD'S route ahead, each leg at the speed the governor will command on it "
        + "(survey 4 kn, then transit 8 kn) and the set along it - and none when the guard has none",
        () => calm && near(calm.pts[1].t, 388.8, 0.01) && near(calm.pts[2].t, 631.8, 0.01)
              && set && near(set.pts[1].t, 401.5, 0.01) && near(set.pts[2].t, 617.5, 0.01) && none === null && minMs > 0,
        "calm " + JSON.stringify(tOf(calm)) + " s (want 0, 388.8, 631.8); 1 kn set north " + JSON.stringify(tOf(set))
          + " s (want 0, 401.5, 617.5); no guard route: " + none);
  // 21. THE READOUTS: opening along her route has no past time to show; the tip says which projection it used
  const { fmtDist: fd } = require("../static/js/units.js");
  const tcpaCell = new Function("tcpaFmt", grabFn("tcpaCell") + "\nreturn tcpaCell;")(new Function(grabFn("tcpaFmt") + "\nreturn tcpaFmt;")());
  const cpaText = new Function("fmtDist", grabFn("cpaText") + "\nreturn cpaText;")(fd);
  const cells = [tcpaCell({ cpaM: 300, tcpaS: 0, closing: false, along: true }), tcpaCell({ cpaM: 300, tcpaS: -84, closing: false }),
                 tcpaCell({ cpaM: 300, tcpaS: 136, closing: true, along: true })];
  const tips = [cpaText({ cpaM: 300, tcpaS: 136, closing: true, along: true }), cpaText({ cpaM: 300, tcpaS: 136, closing: true })];
  check("21. the readouts: OPENING along her route shows no time (her past is not walked), the straight projection's "
        + "past CPA still shows its negative time, and the tip says which projection it is",
        () => cells[0] === "–" && cells[1] === "-84s" && cells[2] === "2m16s"
              && /along her route/.test(tips[0]) && !/along her route/.test(tips[1]),
        "TCPA cells " + JSON.stringify(cells) + "; tips " + JSON.stringify(tips));
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
