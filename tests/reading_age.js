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
for (const id of ["#v_water", "#sp_water_note", "#sp_water", "#v_wind", "#v_sea", "#v_set", "#v_current", "#v_rho"]) els[id] = el();
const world = { $: (s) => els[s], waterTrust, WATER_STALE_S, document: { activeElement: null },
                fmtDist: (m) => Math.round(m / 1000) + " km" };
// eslint-disable-next-line no-eval
// ⚠ setTip is the ONE door a runtime tooltip goes through (2026-09-23): the suppression
// works by REMOVING the title attribute while hovered, so a direct write re-arms the native
// tip under the pointer. Stubbed to the plain write here - what this suite is about is the
// TEXT, and ui_tooltips owns the hover behavior itself.
function setTip(el, text){ if(el) el.title = text; }
const page = eval("(function(){ \"use strict\"; const $ = world.$, waterTrust = world.waterTrust, WATER_STALE_S = world.WATER_STALE_S,"
  + " document = world.document, fmtDist = world.fmtDist; let roseEnv = null, roseCur = null, roseSet = null;\n"   // (roseSet: the rose's SET arrow, 2026-10-08)
  + decl("^const CURRENT_AGE_SHOW_S = [^;]*;") + "\n"
  + ["fmtAge", "monitorErrTxt", "dirTxt", "updateWaterUI", "updateEnvUI", "currentBasisTxt", "updateCurrentUI", "updateDensityUI"].map(grab).join("\n")
  + "\nreturn { fmtAge, updateWaterUI, updateEnvUI, updateCurrentUI, updateDensityUI, CURRENT_AGE_SHOW_S, roseSet: () => roseSet }; })()");

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
page.updateEnvUI(env({ wind: { speed_kn: 4.8, dir_from_deg: 310, gust_kn: 6.4, gust_factor: 1.333 } }), {});
const windGust = { row: els["#v_wind"].textContent, tip: els["#v_wind"].title };
check("6. the wind row says how old the buoy reports are, and both weather tooltips name it as the oldest in the blend; "
      + "none under a manual override or with the simulator's weather off; a failed update is in the tooltip",
      () => wind.row === "4.8 kn @ 310° · 50" + NB + "min" && /Observed 50\u00a0min ago \(the oldest buoy report in the blend\)/.test(wind.tip)
            && /Observed 50\u00a0min ago/.test(wind.sea) && windManual === "4.8 kn @ 310°" && windOff === "-- (sim only)"
            && /The last update failed: KeyError: 'WSPD'/.test(windErr),
      () => "row '" + wind.row + "'; manual '" + windManual + "'; off '" + windOff + "'");
// 6d. THE WATER'S DENSITY (2026-10-09): measured, estimated, and off
page.updateDensityUI({ ok: true, rho: 1021.71, estimated: false, age_s: 12 * 60, obs_t: 1,
  salinity: { psu: 29.02, source: "measured", name: "Seavey Island", dist_km: 2.6 },
  temp: { c: 13.3, source: "measured", name: "Seavey Island", dist_km: 2.6 } });
const rhoMeas = { row: els["#v_rho"].textContent, tip: els["#v_rho"].title, col: els["#v_rho"].style.color };
page.updateDensityUI({ ok: true, rho: 1022.17, estimated: true, age_s: null,
  salinity: { psu: 35, source: "estimate", note: "no CO-OPS salinity station within 25 km - open ocean assumed" },
  temp: { c: 28.7, source: "buoy" } });
const rhoEst = { row: els["#v_rho"].textContent, tip: els["#v_rho"].title, col: els["#v_rho"].style.color };
page.updateDensityUI({ ok: false, source: "off", note: "sim only" });
const rhoOff = els["#v_rho"].textContent;
check("6d. the density row reads the water's density and its age, names where its salinity and temperature were "
      + "measured, marks an estimate with ~ and the warning color and says which half is estimated, and reads sim only off",
      () => rhoMeas.row === "1021.7 kg/m\u00b3 \u00b7 12" + NB + "min" && /salinity 29\.02 PSU measured at Seavey Island/.test(rhoMeas.tip)
            && /temperature 13\.3 \u00b0C measured at Seavey Island/.test(rhoMeas.tip) && rhoMeas.col === ""
            && rhoEst.row === "1022.2 kg/m\u00b3 ~" && /salinity 35 PSU ESTIMATED/.test(rhoEst.tip)
            && /from the weather buoys/.test(rhoEst.tip) && /warn/.test(rhoEst.col) && rhoOff === "-- (sim only)",
      () => "measured '" + rhoMeas.row + "'; estimated '" + rhoEst.row + "' (" + rhoEst.col + "); off '" + rhoOff + "'");
// 6g. THE BUOYS' GUST (2026-10-09): on the row as "G", and the tooltip says what it is - or that none was reported
check("6g. a measured gust reads on the wind row (4.8 G6.4 kn) and the tooltip names it as the buoys' peak gust; "
      + "with none reported the row has no G and the tooltip says the sim's own default size is in use",
      () => windGust.row === "4.8 G6.4 kn @ 310° · 50" + NB + "min" && /the buoys' own peak gust \(NDBC GST\)/.test(windGust.tip)
            && /No gust reported: the sim's gusts use its default size/.test(wind.tip) && !/ G/.test(wind.row),
      () => "row '" + windGust.row + "'; tip '" + windGust.tip.slice(0, 160).replace(/\n/g, " ") + "'");

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

// 7s. A CYCLE READ FROM NOAA'S S3 COPY SAYS SO (2026-10-09, ofs_s3.py): the model server was down
page.updateCurrentUI(cur({ via: "s3" }));
const curS3 = els["#v_current"].title;
page.updateCurrentUI(cur());
const curThredds = els["#v_current"].title;
check("7s. a reading whose cycle came from NOAA's S3 copy says so in its tooltip; one from the model server does not",
      () => /cycle t \(read from NOAA's S3 copy - its model server was down\)/.test(curS3) && !/S3/.test(curThredds),
      () => "s3 tooltip '" + curS3.replace(/\n/g, " ").slice(0, 200) + "'");
// 7r. A MODEL THE STATIONS REJECT IS SAID TO BE LEFT OUT (2026-10-09, stream_fusion.fuse): the console's model_note,
//     as the readout at New Castle words it - the stations alone, at full weight, and no "Model gomofs" line
page.updateCurrentUI(cur({ source: "NOAA predictions", tag: null, w_stations: 1.0, model: null,
  stations: [["PIR0702", "Fort Point", 312, 1.0]],
  model_note: "gomofs left out here - the 7 NOAA stations within 15 km where it has water reject its fit (no fit with a gain of 0.4 to 2.5)" }));
const curRej = els["#v_current"].title;
check("7r. where the stations reject the model the tooltip names the stations alone and says why the model is not in it",
      () => /NOAA tidal current predictions: Fort Point .* \(100%\)/.test(curRej)
            && /No model in it: gomofs left out here - the 7 NOAA stations within 15 km where it has water reject its fit/.test(curRej)
            && !/Model gomofs, cycle/.test(curRej) && !/weight/.test(curRej),
      () => "tooltip '" + curRej.replace(/\n/g, " ").slice(0, 300) + "'");
// 7b. THE FUSED READING SAYS WHAT IT WAS BUILT FROM (2026-10-07, stream_fusion.py): the NOAA prediction stations with
//     their distance and share, and the model with the gain and lag that calibrated it - while an OFS-only reading's
//     tooltip still names the model and its cycle (7 above).
page.updateCurrentUI(cur({ source: "NOAA predictions + dbofs calibrated", tag: null, w_stations: 0.37,
  stations: [["PIR0710", "General Sullivan Bridge", 1000, 0.8], ["ACT0791", "Dover Point, west of", 1500, 0.2]],
  model: { label: "dbofs", gain: 1.3, lag_s: 720, calibrated_by: 2 } }));
const fusedTip = els["#v_current"].title;
check("7b. a fused reading's tooltip names the prediction stations with distance and share, and the model with its "
      + "calibration and weight",
      () => /NOAA tidal current predictions: General Sullivan Bridge .* off \(80%\), Dover Point, west of .* off \(20%\)/.test(fusedTip)
            && /model dbofs, calibrated to 2 stations \(gain 1\.30, lag \+12 min\), weight 63%/.test(fusedTip)
            && !/cycle \?/.test(fusedTip) && els["#v_current"].textContent === "0.45 kn @ 120°",
      () => "tooltip '" + fusedTip.slice(0, 220) + "'");

// 8. THE SET SAYS WHERE IT CAME FROM (2026-09-29): on a link that reports none the console fills in the tidal-stream
//    FORECAST under the boat (with_forecast_set), and the row says so - it is what the guard is using, and it is not
//    the whole set (the wind's leeway is not in it). The vessel's own set reads as it always did.
page.updateEnvUI(env(), { env_set_kn: 1.2, env_set_deg: 45, env_set_src: "stream" });
const setFc = { row: els["#v_set"].textContent, tip: els["#v_set"].title };
page.updateEnvUI(env(), { env_set_kn: 1.75, env_set_deg: 272 });
const setOwn = { row: els["#v_set"].textContent, tip: els["#v_set"].title };
check("8. the SET row says when it is the tidal-stream FORECAST the console filled in - and that the leeway is not in it - and reads as the vessel's own set otherwise",
      () => /^1\.20 kn @ /.test(setFc.row) && /stream forecast/.test(setFc.row) && /FORECAST of the tidal stream/.test(setFc.tip)
            && /leeway is not in it/.test(setFc.tip)
            && /^1\.75 kn @ /.test(setOwn.row) && !/forecast/.test(setOwn.row) && /The set the vessel reports/.test(setOwn.tip),
      () => "forecast row '" + setFc.row + "'; own row '" + setOwn.row + "'");

// 9. THE ROSE'S SET IS THE SET ROW'S (Andy, 2026-10-08: "the set arrow on the compass rose is gone. bring it back",
//    then "Set and current both"). The chart rose draws the vessel's SET as its own arrow beside the current's, and it
//    is fed from the very frame and fields the SET row is written from - so the two cannot disagree, which is what the
//    rose's old "set" (really the current forecast) did. Where the console filled in the forecast, it carries that too.
page.updateEnvUI(env(), { env_set_kn: 1.75, env_set_deg: 272 });
const rsOwn = page.roseSet();
page.updateEnvUI(env(), { env_set_kn: 1.2, env_set_deg: 45, env_set_src: "stream" });
const rsFc = page.roseSet();
check("9. the chart rose's SET arrow is fed the SET row's own value, frame by frame - and knows when it is the filled-in forecast",
      () => rsOwn && rsOwn.kn === 1.75 && rsOwn.deg === 272 && rsOwn.src == null
            && rsFc && rsFc.kn === 1.2 && rsFc.deg === 45 && rsFc.src === "stream",
      () => "own " + JSON.stringify(rsOwn) + "; forecast " + JSON.stringify(rsFc));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
