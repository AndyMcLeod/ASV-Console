// tests/reading_age.js - every reading on the card says how old it is (review #13, 2026-09-14).
//
// The water level, the weather and the surface current each came from a background monitor that could die
// and leave its last reading standing - still marked ok - and nothing on the card said when any of them was
// taken. The console now sends `age_s` (and `monitor_error` when the last update failed), and the rows say
// it: the water level always, with the survey panel's note; the wind with its oldest buoy report; the
// current only once it is older than CURRENT_AGE_SHOW_S, because it is recomputed every minute. A water
// level past WATER_STALE_S is marked NOT APPLIED - the gate itself is tests/water_trust.js 16-21, and the
// server half is tests/reading_age.py.
// DRIVEN: the page's own updateWaterUI, updateEnvUI, updateCurrentUI, fmtAge and monitorErrTxt, with the
// real waterTrust from static/js/chart.js and the card's elements stubbed.
//
//   node tests/reading_age.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 17 mutations RUN in a scratch clone against this suite and water_trust.js together, 17/17 caught:
//   a water level never stale -> water_trust 17, 18; here 3, 4     stale AT the limit -> water_trust 16
//   a stale level applied anyway -> water_trust 17, 18             the manual exemption lost for age -> water_trust 19
//   any age value read as a number -> water_trust 20               a far band rescues a stale level -> water_trust 18; here 4
//   the water row shows no age -> 2, 3, 5                          a stale level not marked -> 3
//   the note drops the age reason -> 3, 4                          a failed update never said -> 5, 6, 7
//   the wind row shows no age -> 6                                 an age shown with the sim weather off -> 6
//   the current's age always shown -> 7                            the current's age never shown -> 7
//   hours without their minutes padded -> 1                        the tooltip says nothing of the age -> 3
//   an age's spaces break -> 1-7
//
// NOTE: the page's script is <script type="module">, which runs STRICT - so the functions under test are
// evaluated strict here too.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
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

// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes through it.
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const { WATER_STALE_S, waterTrust } = require(process.env.CHART_JS || "../static/js/chart.js");

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
  const m = H.match(new RegExp(re, "m"));
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("Every reading on the card says how old it is:");

const el = () => ({ textContent: "", title: "", value: "", placeholder: "", style: {} });
const els = {};
for (const id of ["#v_water", "#sp_water_note", "#sp_water", "#v_wind", "#v_sea", "#v_set", "#v_current"]) els[id] = el();
const world = { $: (s) => els[s], waterTrust, WATER_STALE_S, document: { activeElement: null },
                fmtDist: (m) => Math.round(m / 1000) + " km" };
// eslint-disable-next-line no-eval
const page = eval("(function(){ \"use strict\"; const $ = world.$, waterTrust = world.waterTrust, WATER_STALE_S = world.WATER_STALE_S,"
  + " document = world.document, fmtDist = world.fmtDist; let roseEnv = null, roseCur = null;\n"
  + decl("^const CURRENT_AGE_SHOW_S = [^;]*;") + "\n"
  + ["fmtAge", "monitorErrTxt", "dirTxt", "updateWaterUI", "updateEnvUI", "updateCurrentUI"].map(grab).join("\n")
  + "\nreturn { fmtAge, updateWaterUI, updateEnvUI, updateCurrentUI, CURRENT_AGE_SHOW_S }; })()");

const station = (extra) => Object.assign({ ok: true, offset_m: 0.19, datum: "MLLW", method: "idw3", data_kind: "observed",
  name: "Eastport", source: "station", stations: [{ name: "Eastport", dist_km: 1.2, offset_m: 0.19 }], monitor_error: null }, extra);

// 1. fmtAge - with no-break spaces inside an age, so a narrow row wraps before it rather than through it
const NB = "\u00a0";
check("1. an age reads in whole minutes, then hours and minutes, and its spaces do not break",
      () => page.fmtAge(20) === "<1" + NB + "min" && page.fmtAge(11 * 60 + 10) === "11" + NB + "min"
            && page.fmtAge(65 * 60) === "1" + NB + "h" + NB + "05" + NB + "min",
      () => [20, 670, 3900].map(page.fmtAge).join(" / "));

// 2. a fresh water level
page.updateWaterUI(station({ age_s: 11 * 60 }));
const fresh = { row: els["#v_water"].textContent, note: els["#sp_water_note"].textContent, op: els["#v_water"].style.opacity };
check("2. a live water level says its age on the row and in the survey panel's note, and is applied (no datum mark, "
      + "full opacity)",
      () => fresh.row === "+0.19 m · 11" + NB + "min" && / · 11\u00a0min old$/.test(fresh.note) && fresh.op === 1,
      () => "row '" + fresh.row + "'; note '" + fresh.note + "'; opacity " + fresh.op);

// 3. a stale water level
page.updateWaterUI(station({ age_s: 42 * 60 }));
const stale = { row: els["#v_water"].textContent, tip: els["#v_water"].title, note: els["#sp_water_note"].textContent,
                op: els["#v_water"].style.opacity, it: els["#v_water"].style.fontStyle, col: els["#v_water"].style.color };
check("3. a water level past WATER_STALE_S is marked as not applied - ghosted, italic, in the caution color - and its "
      + "tooltip and note say how old it is and that routing uses chart datum",
      () => stale.row === "+0.19 m · 42" + NB + "min ⚠ (datum)" && stale.op === 0.45 && stale.it === "italic"
            && stale.col === "var(--warn)" && /READING IS 42\u00a0min OLD/.test(stale.tip) && /NOT being applied to charted depths/.test(stale.tip)
            && / — 42\u00a0min old; NOT applied to depths \(using chart datum\)$/.test(stale.note),
      () => "row '" + stale.row + "'; opacity " + stale.op + "; note '" + stale.note.slice(-60) + "'");

// 4. remote and stale: both reasons
page.updateWaterUI(station({ age_s: 42 * 60, stations: [{ name: "Erie", dist_km: 800, offset_m: 0.19 }] }));
const both = els["#sp_water_note"].textContent;
check("4. a reading both remote and stale gives both reasons in one sentence",
      () => / — 800 km away, NOT the local tide, 42\u00a0min old; NOT applied to depths \(using chart datum\)$/.test(both),
      () => "'" + both.slice(-90) + "'");

// 5. manual, and a failed update
page.updateWaterUI(station({ source: "manual", age_s: null }));
const manual = els["#v_water"].textContent;
page.updateWaterUI(station({ age_s: 16 * 60, monitor_error: "KeyError: 'lng'" }));
const errTip = els["#v_water"].title;
check("5. a manual override shows no age; a failed update is in the tooltip, naming the error, while the reading stands",
      () => !/min/.test(manual) && /The last update failed: KeyError: 'lng'/.test(errTip) && /the reading above is the last one it had/.test(errTip)
            && els["#v_water"].textContent === "+0.19 m · 16" + NB + "min",
      () => "manual row '" + manual + "'; tooltip tail '" + errTip.slice(-110).replace(/\n/g, " ") + "'");

// 6. the weather
const env = (extra) => Object.assign({ ok: true, enabled: true, source: "buoy", wind: { speed_kn: 4.8, dir_from_deg: 310 },
  sea: { hs_m: 0.09, tp_s: 2.9, dir_from_deg: 310 }, age_s: 50 * 60, monitor_error: null }, extra);
page.updateEnvUI(env(), {});
const wind = { row: els["#v_wind"].textContent, tip: els["#v_wind"].title, sea: els["#v_sea"].title };
page.updateEnvUI(env({ source: "manual", age_s: null }), {});
const windManual = els["#v_wind"].textContent;
page.updateEnvUI(env({ source: "off", age_s: 50 * 60 }), {});
const windOff = els["#v_wind"].textContent;
page.updateEnvUI(env({ monitor_error: "KeyError: 'WSPD'" }), {});
const windErr = els["#v_wind"].title;
check("6. the wind row says how old the buoy reports are, and both weather tooltips name it as the oldest in the blend; "
      + "none under a manual override or with the simulator's weather off; a failed update is in the tooltip",
      () => wind.row === "4.8 kn @ 310° · 50" + NB + "min" && /Observed 50\u00a0min ago \(the oldest buoy report in the blend\)/.test(wind.tip)
            && /Observed 50\u00a0min ago/.test(wind.sea) && windManual === "4.8 kn @ 310°" && windOff === "-- (sim only)"
            && /The last update failed: KeyError: 'WSPD'/.test(windErr),
      () => "row '" + wind.row + "'; manual '" + windManual + "'; off '" + windOff + "'");

// 7. the current
const cur = (extra) => Object.assign({ ok: true, source: "gomofs", tag: "t", speed_kn: 0.45, set_deg: 120, projected_h: 0,
  age_s: 40, monitor_error: null }, extra);
page.updateCurrentUI(cur());
const curFresh = { row: els["#v_current"].textContent, tip: els["#v_current"].title, col: els["#v_current"].style.color };
page.updateCurrentUI(cur({ age_s: page.CURRENT_AGE_SHOW_S + 5 * 60 }));
const curOld = { row: els["#v_current"].textContent, col: els["#v_current"].style.color };
page.updateCurrentUI({ ok: false, note: "gomofs does not cover this position", monitor_error: "RuntimeError: boom", age_s: null });
const curErr = els["#v_current"].title;
check("7. the current - recomputed every minute - shows its age only once it is past CURRENT_AGE_SHOW_S, in the caution "
      + "color; the tooltip always says when it was computed; and a failed update is said even when there is no reading",
      () => curFresh.row === "0.45 kn @ 120°" && curFresh.col === "" && /Computed <1\u00a0min ago/.test(curFresh.tip)
            && curOld.row === "0.45 kn @ 120° · 10" + NB + "min" && /warn/.test(curOld.col)
            && /The last update failed: RuntimeError: boom/.test(curErr),
      () => "fresh '" + curFresh.row + "'; old '" + curOld.row + "' " + curOld.col + "; not-ok tooltip '"
            + curErr.replace(/\n/g, " ").slice(0, 120) + "'");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
