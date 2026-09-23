// tests/target_cpa.js - CPA / TCPA, the hull footprint, and the two integration faults
// that made both of them silently useless in the page.
//
// Andy, 2026-09-02: *"Add and recalculate CPA/TCPA as needed especially after a maneuver.
// ... Build the resultant vessel icon to match the relative size and/or have those data
// attached to the icon to read on cursor hover."*
//
// CPA is the closest two vessels will come on present course and speed; TCPA is when.
// They are the two numbers a collision judgement is built on and the console had neither.
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
const { cpa, velocityEN, hullBox, KN_TO_MS, MIN_REL_SPEED_MS } =
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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
