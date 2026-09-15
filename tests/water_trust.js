// tests/water_trust.js - how far away is the tide we are applying?
//
// Andy saw an ERIE water level in the console while the boat sat at Lewes, ~800 km away.
// That was not a data fault: the console had started on the Erie vessel, the reading was
// correctly LABELLED Erie, and `WaterLevel.update_position` does force a refetch once the
// boat moves more than 3 km. But CO-OPS polls on a ~6 minute cadence, so the previous
// station's value stands in the meantime - and it looks exactly as authoritative as a
// local one. The operator has no reason to go and read the station name on a number that
// is normally trustworthy.
//
// So the readout now earns its confidence by DISTANCE and shows that graphically:
//
//   local  (<= 25 km)  full opacity - the tide around here
//   far    (>  25 km)  ghosted + italic - indicative only; tidal range and phase drift
//                      materially over tens of km of coast
//   remote (>  75 km)  heavily ghosted, warn colour, explicit warning - this is simply
//                      another area's tide
//
// The subtle rule, and the one most likely to regress: THE NEAREST CONTRIBUTING STATION
// DECIDES. The console interpolates several stations, and a blend dominated by a close
// one is still local even with a distant station mixed in. Averaging the distances would
// let one remote station ghost a perfectly good local reading, and - worse - two remote
// stations either side could average to something that looks local.
//
//   node tests/water_trust.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// And (review #13) how OLD it is: past WATER_STALE_S a reading is not applied either - checks 16-21. Their
// mutations are recorded in tests/reading_age.js, which ran them against both suites together.
//
// TEETH (verified by mutation, not assumed): average the distances instead of taking the
// minimum and 6 fails. Drop the manual exemption and 4 fails. Swap the two thresholds and
// 2 and 8 fail. Apply a remote offset to depths anyway and 12 and 15 fail. Gate `far` as
// well as `remote` and 11 fails.
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

const { WATER_FAR_KM, WATER_REMOTE_KM, WATER_STALE_S, effectiveWaterOffset, waterTrust } = require("../static/js/chart.js");
const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return "var " + H.slice(i + kw.length, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}


let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}
const wl = (stations, extra) => Object.assign({ ok: true, offset_m: 1.16, stations }, extra || {});

console.log("Water-level trust — a tide from 800 km away must not look local:");

check("1. a station on the doorstep reads as local",
      waterTrust(wl([{ name: "Lewes", dist_km: 4.2 }])).level === "local",
      "4.2 km");
check("2. a station tens of km off is FAR (indicative, ghosted)",
      waterTrust(wl([{ name: "Cape May", dist_km: 40 }])).level === "far", "40 km");
check("3. THE REPORTED CASE: another coast's station is REMOTE",
      waterTrust(wl([{ name: "Erie", dist_km: 800 }])).level === "remote", "800 km");
check("4. a manual override is the operator's own number — never ghosted",
      waterTrust(wl([{ name: "Erie", dist_km: 800 }], { source: "manual" })).level === "local");
check("5. no usable reading is not a distance problem (the ! mark covers it)",
      waterTrust(wl([{ name: "Erie", dist_km: 800 }], { ok: false })).level === "local");

// 6. The rule that matters. An interpolation dominated by a NEAR station is local, even
// with a distant one blended in. Averaging would ghost a good reading here - and would
// also let two remote stations average into a falsely "local" one (checked below).
check("6. the NEAREST contributing station decides, not the average",
      waterTrust(wl([{ name: "Lewes", dist_km: 4 }, { name: "Erie", dist_km: 800 }])).level === "local",
      "4 km + 800 km blend -> local (mean would be 402 km -> remote)");
check("7. ... and two distant stations cannot average into a false 'local'",
      waterTrust(wl([{ name: "A", dist_km: 90 }, { name: "B", dist_km: 95 }])).level === "remote",
      "90 + 95 km -> remote");

// 8. Thresholds are inclusive at the boundary, so a station exactly at the limit is not
// ghosted by a rounding accident.
check("8. the boundaries are inclusive (exactly at a limit is the kinder band)",
      waterTrust(wl([{ dist_km: WATER_FAR_KM }])).level === "local" &&
      waterTrust(wl([{ dist_km: WATER_REMOTE_KM }])).level === "far",
      WATER_FAR_KM + " km -> local, " + WATER_REMOTE_KM + " km -> far");

// 9. Missing distances must not throw or silently ghost - an older payload without
// dist_km is treated as local rather than crashing the whole status card.
check("9. a payload with no distances degrades safely, it does not throw",
      waterTrust(wl([{ name: "x" }])).level === "local" &&
      waterTrust({ ok: true, offset_m: 1 }).level === "local" &&
      waterTrust(null).level === "local");

// 10-15. GATING THE DEPTH CORRECTION. Showing a distant tide is one thing; APPLYING it to
// the nogo depth floor is another. A remote reading credits the boat with depth nobody has
// measured here - an 800 km tide of +1.16 m makes shallow water look 1.16 m deeper than it
// is, which is the same failure mode as trusting a chart symbol without its size. It is
// still SHOWN (ghosted), but routing falls back to chart datum, exactly as it already does
// when there is no data at all.
check("10. a LOCAL reading is applied to charted depths",
      effectiveWaterOffset(wl([{ dist_km: 4 }])) === 1.16, "4 km -> +1.16 m applied");
check("11. a FAR reading is still applied - indicative, not irrelevant",
      effectiveWaterOffset(wl([{ dist_km: 40 }])) === 1.16, "40 km -> +1.16 m applied");
check("12. A REMOTE READING IS NOT APPLIED - routing falls back to chart datum",
      effectiveWaterOffset(wl([{ dist_km: 800 }])) === 0,
      "800 km -> 0 m (the reading is still shown, ghosted)");
// 13 is the end-to-end consequence of the rule asserted at 4: the manual exemption lives
// in waterTrust() and only there, so breaking it fails BOTH. (An extra guard here would be
// unreachable, and an unreachable guard is one nobody is testing.)
check("13. a manual override is always applied, whatever the station distance",
      effectiveWaterOffset(wl([{ dist_km: 800 }], { source: "manual" })) === 1.16);
check("14. no reading at all is chart datum, as before",
      effectiveWaterOffset({ ok: false, offset_m: 1.16 }) === 0 &&
      effectiveWaterOffset(null) === 0);
// A negative remote offset falls back to datum too. Asserted so the choice is deliberate:
// an unverified reading is not evidence about local water in EITHER direction, and the
// card states plainly that it is not being applied.
check("15. a negative remote offset also falls back to datum",
      effectiveWaterOffset(wl([{ dist_km: 800 }], { offset_m: -0.8 })) === 0,
      "-0.8 m at 800 km -> 0 m");

// 16-21. AND HOW OLD IS IT (review #13, 2026-09-14)? The console's water monitor could die and leave its last
// reading standing - still ok - and the page went on adding it to every charted depth. The reading carries
// `age_s` now, from the station's own observation time; measured across forty sessions a live level is 4.6 to
// 17.1 minutes old. Past WATER_STALE_S it is shown but NOT APPLIED, exactly like a remote one.
const aged = (age_s, extra) => wl([{ dist_km: 4 }], Object.assign({ age_s }, extra || {}));
check("16. a live reading - even one at the limit - is applied; the limit sits above the oldest live level measured",
      effectiveWaterOffset(aged(11 * 60)) === 1.16 && effectiveWaterOffset(aged(WATER_STALE_S)) === 1.16
      && !waterTrust(aged(WATER_STALE_S)).stale && WATER_STALE_S > 17.1 * 60,
      "11 min and " + (WATER_STALE_S / 60) + " min -> +1.16 m applied");
check("17. A STALE READING IS NOT APPLIED - routing falls back to chart datum, whichever way the level was",
      waterTrust(aged(WATER_STALE_S + 1)).stale === true && effectiveWaterOffset(aged(WATER_STALE_S + 1)) === 0
      && effectiveWaterOffset(aged(3600, { offset_m: -0.8 })) === 0,
      "past the limit by 1 s -> 0 m; an hour old at -0.8 m -> 0 m");
check("18. staleness is its own reason: a stale reading keeps its distance band, and the band does not rescue it",
      waterTrust(aged(3600)).level === "local" && waterTrust(aged(3600)).age_s === 3600
      && effectiveWaterOffset(wl([{ dist_km: 40 }], { age_s: 3600 })) === 0,
      "local and stale -> not applied; far and stale -> not applied");
check("19. a manual override is never stale, whatever age the payload carries - it is the operator's own number",
      waterTrust(aged(99999, { source: "manual" })).stale === false
      && effectiveWaterOffset(aged(99999, { source: "manual" })) === 1.16);
check("20. a reading with no age at all - an older console, or an age that is not a number - is not called stale: "
      + "unknown is not old",
      waterTrust(wl([{ dist_km: 4 }])).stale === false && effectiveWaterOffset(wl([{ dist_km: 4 }])) === 1.16
      && waterTrust(aged("99999")).stale === false);
check("21. remote AND stale is still simply not applied",
      effectiveWaterOffset(wl([{ dist_km: 800 }], { age_s: 3600 })) === 0
      && waterTrust(wl([{ dist_km: 800 }], { age_s: 3600 })).level === "remote");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
