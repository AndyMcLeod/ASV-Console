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
// TEETH (verified by mutation, not assumed): average the distances instead of taking the
// minimum and 6 fails. Drop the manual exemption and 4 fails. Swap the two thresholds and
// 2 and 8 fail.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

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

// eslint-disable-next-line no-eval
eval(grabDecl("WATER_FAR_KM") + "\n" + grabDecl("WATER_REMOTE_KM") + "\n" + grab("waterTrust"));

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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
