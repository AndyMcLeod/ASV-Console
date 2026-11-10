// tests/playback_mission.js - playback describes the WHOLE mission, and stays fast doing it (2026-11-05).
//
// Andy, 2026-11-05: "Look at the logging function(s) and add in data that fully describes any given mission."
// The console now records what boat, where, on what build and whose clock (manifest / vessel / port), the plan on disk
// (`mission`) and every plan it hands the link (`plan_loaded`), each run's start and end, and the 4 Hz frames round a
// safety event (`incident`). The replay reads them into a Session card, a Runs list, the plan overlay and the track -
// all from indexes built once and binary-searched, so an 80 MB recording plays as smoothly as a short one.
//
// DRIVEN: the page's own functions (tests/lib/playback_world.js), applyAt among them against a fake DOM.
//   1   the Session card: vessel and hull, port, mode, build and git, the console's zone, the file it continues
//   2   the session follows a vessel switch; an old log names the hull from its command line
//   3   the clock: the console's time and UTC, labeled; the zone from the manifest, else from the records' own clock
//   4   runs: paired by run_id, a run_end with no start, a run still going; how each ended; the run at the cursor
//   5   the plan timeline (no plan_loaded): the plan on disk first; upload, amend and reapproach replace the route; a
//       rejected command does not; stop clears it; an upload with no route flies the plan on disk
//   6   with plan_loaded: the console's own route, not the page's request; a long one borrows the command's; the chase
//   7   an incident's 4 Hz frames are the track inside its window (fields they lack carried), and one timeline row
//   8   the lifecycle kinds each have their timeline row and say what they are
//   9   NOTHING LINEAR PER FRAME: cardsAt, applyAt, planAt, wpAt, sessionAt read no record of EVENTS
//   10  lastBefore is a binary search; a 130,000-record log opens (no Math.min spread)
//   11  the timeline highlight touches only the rows that changed
//   12  applyAt writes the Vessel card by what she burns, commanded vs made good, pitch/roll, the hold
//   13  the deep link and the picker's label
//   14  an AMEND splices at its index, the flown prefix kept; with no prefix, the tail numbered from it (`off`), and the
//       chart colors waypoints passed by the route's own numbering                                    (review 2026-11-05)
//   15  a stop PARKS the route; the next accepted Start flies it again (a refused one does not); a new plan replaces it
//   16  the suite wrote nothing
//
//   node tests/playback_mission.js      # exit 0 = pass, 1 = fail
"use strict";
const fs = require("fs");
const PW = require("./lib/playback_world.js");

// crash guard: a death outside a check() is REPORTED, not silent (turn_geometry.js 30)
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

// ⚠ THIS SUITE WRITES NOTHING: every fs write is counted, and check 14 asserts none happened
let writes = 0;
for (const k of ["writeFileSync", "appendFileSync", "mkdirSync", "mkdtempSync", "renameSync", "rmSync", "unlinkSync", "writeFile", "appendFile"]) {
  const orig = fs[k];
  if (typeof orig === "function") fs[k] = function () { writes++; return orig.apply(this, arguments); };
}

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
const near = (a, b, eps) => a != null && b != null && Math.abs(a - b) <= (eps || 1e-9);
// EVENTS handed to the page as a Proxy that counts every read of a record (or its length) - how check 9 sees a scan
function counted(arr) {
  const c = { n: 0 };
  const p = new Proxy(arr, { get(t, k, r) { if (k === "length" || (typeof k === "string" && /^\d+$/.test(k))) c.n++; return Reflect.get(t, k, r); } });
  return { p, c };
}

// ── the log ─────────────────────────────────────────────────────────────────────────
const t0 = 1790300000, LAT = 21.3, LON = -157.87;
const P = (i) => ({ lat: LAT + 0.001 * i, lon: LON });
const EV = [
  { t: t0, kind: "session_start", pid: 1, argv: ["--sim", "--vessel", "ben_cworker4"] },
  { t: t0 + 0.1, kind: "manifest", mode: "sim", tz: { name: "EST", utc_offset_s: -18000 },
    build: { fingerprint: "abc123def", git: { head: "25690c3aa1b2c3d4", branch: "master" } },
    prev: { name: "asv_20261105-055000.jsonl", ended_clean: false, run: "running", behavior: "survey", wp_index: 3, wp_total: 40, armed: true } },
  { t: t0 + 0.2, kind: "vessel", why: "boot", id: "ben_cworker4", profile: { name: "C-Worker 4", hull: { loa_m: 5.5, beam_m: 1.75, draft_m: 0.66 }, power: { type: "fuel" } },
    derived: { min_nav_depth_m: 1.2 } },
  { t: t0 + 0.3, kind: "port", why: "boot", port: { id: "honolulu", name: "Honolulu", ofs: "pacioos", lat: LAT, lon: LON } },
  { t: t0 + 1, kind: "mission", why: "boot", rev: 3, mission: { waypoints: [P(1), P(2), P(3)], lines: [{ a: P(1), b: P(2) }] } },
  { t: t0 + 1.5, kind: "connect", mode: "sim" },
  { t: t0 + 20, kind: "command", path: "/api/cmd/upload", body: { route: [P(10), P(11)] }, code: 200, client: "8a29303bffff" },
  { t: t0 + 40, kind: "command", path: "/api/cmd/amend", body: { route: [P(20), P(21)], note: "AIS way round" }, code: 200 },
  { t: t0 + 60, kind: "command", path: "/api/cmd/reapproach", body: { route: [P(30)], hold_clear_m: 20 }, code: 200 },
  { t: t0 + 70, kind: "command", path: "/api/cmd/goto", body: { lat: LAT, lon: LON, route: [P(99)] }, code: 409, error: "refused" },
  { t: t0 + 80, kind: "command", path: "/api/cmd/stop", body: {}, code: 200 },
  { t: t0 + 90, kind: "command", path: "/api/cmd/upload", body: {}, code: 200 },
  { t: t0 + 100, kind: "command", path: "/api/mission", body: { waypoints: [P(5), P(6)], lines: [] }, code: 200 },
  { t: t0 + 101, kind: "mission_saved", rev: 4, sha256: "x", n_wpts: 2, n_lines: 0, n_surveys: 0 },
  { t: t0 + 50, kind: "run_end", run_id: "r0", run_seq: 0, run: "stopped", note: "operator stop", behavior: "goto", dur_s: 40, dist_m: 310 },
  { t: t0 + 120, kind: "run_start", run_id: "r1", run_seq: 1, behavior: "survey", completion: "rth", wp_total: 40, speed_key: "survey", vessel_id: "ben_cworker4" },
  { t: t0 + 720, kind: "run_end", run_id: "r1", run_seq: 1, run: "complete", note: "", behavior: "survey", dur_s: 600, dist_m: 2345, wp_index: 40, wp_total: 40,
    energy: { kind: "fuel", unit: "L", start: 31.5, end: 30.266, used: 1.234 } },
  { t: t0 + 800, kind: "run_start", run_id: "r2", run_seq: 2, behavior: "rth", wp_total: 3 },
  { t: t0 + 850, kind: "vessel", why: "switch", id: "drix08_em712", profile: { name: "DriX 8", hull: { loa_m: 7.7, beam_m: 0.9, draft_m: 1.9 }, power: { type: "fuel" } } },
];
// the 1 Hz trace on the half second, a fueled hull holding station
for (let s = 2; s <= 900; s++)
  EV.push({ t: t0 + s + 0.5, kind: "telemetry", run: "running", wp_index: Math.min(40, Math.floor(s / 20)),
            status: { lat_deg: LAT, lon_deg: LON, heading_deg: 90, cog_deg: 95, sog_kn: 3, energy_type: "fuel", fuel_l: 31.5, fuel_pct: 62, fuel_state: "ok",
                      speed_key: "survey", speed_target_kn: 4.0, pitch_deg: 1.2, roll_deg: -0.8, holding: true, off_station_m: 2.3, hold_clear_m: 15,
                      battery_v: 26.1 } });
// an incident: the 4 Hz frames round an AIS hold (A11), 60 s before and 30 s after
const COLS = ["t", "lat", "lon", "hdg", "cog", "sog", "wp_index", "run", "autonomy", "behavior", "env_set_kn", "env_set_deg", "holding", "hold_clear_m", "speed_key", "speed_target_kn", "avoiding"];
const frames = [];
for (let ft = 330; ft <= 420; ft += 0.25) frames.push([t0 + ft, LAT + 0.001, LON + (ft - 330) * 1e-6, 90, 95, 2.5, 16, "running", "auto", "survey", 0.3, 120, true, 15, "low", 2.0, true]);
EV.push({ t: t0 + 421, kind: "incident", trigger: "ais_avoid", triggers: ["ais_avoid", "guard_low"], fired: [[t0 + 390, "ais_avoid"], [t0 + 395, "guard_low"]],
          cols: COLS, frames, pre_s: 60, post_s: 30 });
EV.sort((a, b) => a.t - b.t);

console.log("Playback describes the whole mission, from indexes built once:");
const dom = PW.fakeDom();
const CE = counted(EV);
let w = null, err = null;
try { w = PW.world(CE.p, { window: {}, $: dom }); } catch (e) { err = e; }
check("0. the page's own functions evaluate over a log with every mission-record kind", () => !err && !!w, () => err ? "THREW " + err.message : EV.length + " records");
if (!w) { console.log("\n1 CHECK(S) FAILED"); process.exit(1); }
const F = w.fn, G = () => w.g();

// 1. THE SESSION CARD
const s1 = F.sessionAt(t0 + 300);
check("1. the Session card: the hull with its numbers, the port and its current model, the mode, the build and git, the console's zone, "
      + "and the recording this one continues (it ended without a session end, armed, at wp 3/40)",
      () => s1.vessel === "C-Worker 4 · ben_cworker4 · 5.50 x 1.75 m · draft 0.66 m · min depth 1.20 m · fuel" && s1.port === "Honolulu · OFS pacioos"
            && s1.mode === "SIM" && s1.build === "abc123def · master · 25690c3aa1" && s1.tz === "EST · UTC-05:00"
            && s1.prev === "Continues asv_20261105-055000.jsonl (ended WITHOUT a session end, running survey, wp 3/40, armed)",
      () => JSON.stringify(s1));

// 2. A VESSEL SWITCH; AN OLD LOG
const s2 = F.sessionAt(t0 + 860);
const wOld = PW.world([{ t: t0, kind: "session_start", argv: ["--sim", "--vessel", "ben_cworker4"] }, { t: t0 + 1, kind: "connect", mode: "sim" }]);
const sOld = wOld.fn.sessionAt(t0 + 5);
check("2. the session follows a vessel switch (DriX 8 after +850, the C-Worker before); an old log with no vessel record names the hull from its command line",
      () => s2.vessel.startsWith("DriX 8 · drix08_em712") && F.sessionAt(t0 + 849).vessel.startsWith("C-Worker 4") && sOld.vessel === "ben_cworker4 (from the command line)"
            && sOld.build === "—" && sOld.prev === "",
      () => JSON.stringify({ after: s2.vessel, old: sOld.vessel }));

// 3. THE CLOCK
const hms = (s) => new Date(s * 1000).toISOString().slice(11, 19);
const T = t0 + 3600;
const isoLog = [{ t: t0, kind: "session_start", iso: new Date((t0 - 14400) * 1000).toISOString().slice(0, 19) }];
const tzIso = PW.world(isoLog).g().PB.tz;
check("3. the clock is the console's AND UTC, labeled - the manifest's zone (UTC-05:00), else read off the records' own `iso` (UTC-04:00); "
      + "no zone at all prints UTC alone",
      () => F.fmtClock(T, G().PB.tz) === hms(T - 18000) + " console (UTC-05:00) · " + hms(T) + " UTC"
            && tzIso && tzIso.offset_s === -14400 && tzIso.from === "iso" && F.fmtClock(T, null) === hms(T) + " UTC",
      () => F.fmtClock(T, G().PB.tz) + " | iso-derived " + JSON.stringify(tzIso));

// 4. RUNS
const R = G().PB.runs;
check("4. runs: r0's end with no start began dur_s before it; r1 paired by run_id and ended COMPLETE with its distance, fuel and waypoints; "
      + "r2 still running at the end; the run at the cursor (r1 at +300, none at +760, r2 at +880)",
      () => R.length === 3 && R[0].run_id === "r0" && near(R[0].t0, t0 + 10) && R[1].run_id === "r1" && near(R[1].t0, t0 + 120) && near(R[1].t1, t0 + 720)
            && F.runText(R[1]) === "SURVEY · 10:00 · 2.35 km · fuel 1.2 L · wp 40/40 · COMPLETE"
            && F.runText(R[0]) === "GOTO · 0:40 · 310 m · STOPPED — operator stop" && /still running when the recording ends$/.test(F.runText(R[2]))
            && F.runIdxAt(t0 + 300) === 1 && F.runIdxAt(t0 + 760) === -1 && F.runIdxAt(t0 + 880) === 2,
      () => R.map((r) => r.run_id + ": " + F.runText(r)).join(" | "));

// 5. THE PLAN TIMELINE, NO plan_loaded
const rt = (wf, s) => { const p = wf.planAt(t0 + s); return p.route ? p.route.map((q) => Math.round((q.lat - LAT) * 1000)).join(",") : "none"; };
const want5 = { 2: "none", 30: "10,11", 50: "10,20,21", 65: "30", 75: "30", 85: "none", 95: "1,2,3", 105: "1,2,3" };
const got5 = Object.keys(want5).map((s) => [s, rt(F, +s)]);
check("5. the plan timeline: the plan on disk from its `mission` record (its line drawn before any edit); upload, AMEND and REAPPROACH "
      + "each replace the route - an AMEND from the waypoint it was sent at (an old log names no splice_at: the trace's wp_index, "
      + "1 at +40, so the 10 already passed stays ahead of 20,21); a rejected Go-To does not; stop clears it; an upload with no route flies the plan on disk, and a later "
      + "edit of the plan does not move the route being flown",
      () => got5.every(([s, v]) => v === want5[s]) && F.planAt(t0 + 2).mission.lines.length === 1 && F.planAt(t0 + 50).note === "AIS way round"
            && F.planAt(t0 + 105).mission.waypoints.length === 2,
      () => got5.map(([s, v]) => "+" + s + " " + v).join("; "));

// 6. plan_loaded
const EVB = [
  { t: t0, kind: "session_start" },
  { t: t0 + 20, kind: "command", path: "/api/cmd/upload", body: { route: [P(10), P(11)] }, code: 200 },
  { t: t0 + 20.2, kind: "plan_loaded", behavior: "survey", name: "survey", staged: false, n: 3, route: [[LAT + 0.041, LON], [LAT + 0.042, LON], [LAT + 0.043, LON]] },
  { t: t0 + 39, kind: "command", path: "/api/cmd/goto", body: { lat: LAT, lon: LON, route: [P(50), P(51)] }, code: 200 },
  { t: t0 + 40, kind: "plan_loaded", behavior: "goto", name: "goto", n: 6000, route_sha: "abc" },
  { t: t0 + 60, kind: "plan_loaded", behavior: "rth_chase", run_seq: 2, target: { lat: LAT - 0.01, lon: LON }, moved_m: 12.4 },
  { t: t0 + 80, kind: "command", path: "/api/cmd/amend", body: { route: [P(70)] }, code: 200 },
];
const wB = PW.world(EVB), FB = wB.fn;
check("6. with plan_loaded the console's OWN route is drawn, not the page's request (+30: its 3 points); a route too long to record "
      + "borrows the command's beside it (+50: the Go-To's); the RTH chase marks its target and keeps the route; a command alone moves nothing",
      () => rt(FB, 30) === "41,42,43" && rt(FB, 50) === "50,51" && rt(FB, 65) === "50,51" && FB.planAt(t0 + 65).chase && near(FB.planAt(t0 + 65).chase.lat, LAT - 0.01)
            && rt(FB, 85) === "50,51"
            && wB.g().MARKS.some((m) => m.lab === "PLAN LOADED" && m.det === "survey · survey · 3 wpts")
            && wB.g().MARKS.some((m) => m.lab === "PLAN LOADED" && m.det === "RTH chase · home moved 12 m"),
      () => [30, 50, 65, 85].map((s) => "+" + s + " " + rt(FB, s)).join("; "));

// 7. THE INCIDENT
const hi = G().FIXES.filter((f) => f.hi);
const f1 = F.fixAt(t0 + 350.1), fa = frames.find((f) => near(f[0], t0 + 350)), fb = frames.find((f) => near(f[0], t0 + 350.25));
const wantLon = fa[2] + (fb[2] - fa[2]) * (0.1 / 0.25);
const incRow = G().MARKS.find((m) => m.ev && m.ev.kind === "incident");
check("7. an incident's 361 frames are high-rate fixes inside its window (the boat at +350.1 is between the 4 Hz frames, not the 1 Hz "
      + "trace); a field the frames lack (fuel) is carried from the fix before; ONE timeline row, at the moment it fired",
      () => hi.length === 361 && near(f1.lat, LAT + 0.001, 1e-12) && near(f1.lon, wantLon, 1e-12) && f1.fuel_l === 31.5 && f1.etype === "fuel"
            && incRow && near(incRow.t, t0 + 390) && incRow.lab === "INCIDENT · AIS AVOID" && incRow.det === "ais_avoid, guard_low · 361 frames"
            && G().MARKS.filter((m) => m.ev && m.ev.kind === "incident").length === 1,
      () => hi.length + " frames; +350.1 at lat " + (f1.lat - LAT).toFixed(4) + ", fuel " + f1.fuel_l + "; row " + (incRow && incRow.lab + " @ +" + (incRow.t - t0)));

// 8. LIFECYCLE ROWS
const lab = (k) => { const m = G().MARKS.find((x) => x.ev && x.ev.kind === k); return m ? m.lab + ": " + m.det : "none"; };
check("8. the lifecycle kinds each have a timeline row that says what they are",
      () => lab("manifest") === "MANIFEST: SIM · abc123def · master · 25690c3aa1 · continues asv_20261105-055000.jsonl"
            && lab("vessel") === "VESSEL: C-Worker 4 · ben_cworker4" && lab("port") === "PORT: Honolulu · OFS pacioos"
            && lab("mission") === "PLAN ON DISK: 3 wpts, 1 lines · rev 3" && lab("mission_saved") === "PLAN SAVED: 2 wpts, 0 lines · rev 4"
            && lab("run_start") === "RUN START: survey · rth · 40 wpts · survey" && lab("run_end").startsWith("RUN END: GOTO · 0:40"),
      () => ["manifest", "vessel", "port", "mission", "mission_saved", "run_start", "run_end"].map(lab).join(" | "));

// 9. NOTHING LINEAR PER FRAME
CE.c.n = 0;
for (let s = 3; s < 900; s += 37) { F.cardsAt(t0 + s); F.planAt(t0 + s); F.wpAt(t0 + s); F.sessionAt(t0 + s); F.fixAt(t0 + s); F.lastStateAt(t0 + s); F.runIdxAt(t0 + s); }
dom("#evlist").children = G().MARKS.map(() => dom.make());
for (let p = 0; p < 900; p += 41) F.applyAt(p);
const reads = CE.c.n;
const SRC = ["applyAt", "render", "cardsAt", "planAt", "lastStateAt", "lastBefore", "highlightEvents", "wpAt", "targetsAt", "envAt", "sessionAt", "fixAt"];
const scans = SRC.filter((n) => /\bEVENTS\b/.test(PW.grab(w.H, n)));
check("9. NOTHING LINEAR PER FRAME: 25 cursors of cardsAt / planAt / wpAt / sessionAt / fixAt and 22 frames of applyAt read NO record of "
      + "EVENTS, and none of the per-frame functions names it",
      () => reads === 0 && scans.length === 0,
      () => reads + " EVENTS read(s); naming EVENTS: " + (scans.join(",") || "none"));

// 10. BINARY SEARCH; A BIG LOG OPENS
const big = new Array(100000).fill(0).map((_, i) => ({ t: i }));
const cb = counted(big);
const hit = F.lastBefore(cb.p, 77777.5);
const bigLog = [];
for (let i = 0; i < 130000; i++) bigLog.push({ t: t0 + i, kind: "telemetry", status: { lat_deg: LAT, lon_deg: LON + i * 1e-7, sog_kn: 3 } });
let bigErr = null, bigG = null;
try { bigG = PW.world(bigLog).g(); } catch (e) { bigErr = e; }
check("10. lastBefore is a binary search (" + cb.c.n + " reads of a 100,000-record array); a 130,000-record log opens - the old "
      + "Math.min(...ts) spread throws a RangeError past ~125,000",
      () => hit && hit.t === 77777 && cb.c.n <= 40 && !bigErr && bigG.FIXES.length === 130000 && bigG.T1 - bigG.T0 === 129999,
      () => bigErr ? "THREW " + bigErr.message : "reads " + cb.c.n + "; big log: " + bigG.FIXES.length + " fixes over " + (bigG.T1 - bigG.T0) + " s");

// 11. THE HIGHLIGHT
const rows = G().MARKS.map(() => dom.make());
dom("#evlist").children = rows;
G().PB.hl.n = -1;
dom.stats.classOps = 0;
F.highlightEvents(t0 + 500);
const first = dom.stats.classOps;
dom.stats.classOps = 0;
const i500 = rows.findIndex((r) => r.classList.has("cur"));
const nextT = G().MARKS[i500 + 1].t;
F.highlightEvents(nextT);
const step = dom.stats.classOps;
dom.stats.classOps = 0;
F.highlightEvents(nextT);
const same = dom.stats.classOps;
const pastOk = rows.every((r, i) => r.classList.has("past") === (G().MARKS[i].t <= nextT)) && rows[i500 + 1].classList.has("cur") && !rows[i500].classList.has("cur");
check("11. the timeline highlight touches only the rows that changed: the first paint every row (" + rows.length + "), one row on "
      + "a step of one, nothing on the same cursor - and every row's state is still right",
      () => first === 2 * rows.length && step <= 4 && same === 0 && pastOk,
      () => "class ops: first " + first + ", one step " + step + ", same cursor " + same + "; states right " + pastOk);

// 12. THE VESSEL CARD
F.applyAt(300.2);
const txt = (id) => dom("#" + id).textContent;
check("12. applyAt writes the Vessel card by what she burns (fuel, not volts), commanded vs made-good speed, COG, pitch/roll and the hold, "
      + "the guard's rung, and the clock as the console's and UTC",
      () => txt("v_batt") === "fuel 31.5 L (62%)" && dom("#v_batt").className === "v ok" && txt("v_spd") === "commanded SURVEY 4.0 kn · made good 3.00 kn"
            && txt("v_cog") === "95°" && txt("v_att") === "+1.2° / -0.8°" && txt("v_hold") === "HOLDING · 2.3 m off station · clear 15 m"
            && txt("v_wp") === "—" && txt("t_wall") === F.fmtClock(t0 + 300.2, G().PB.tz) && txt("s_vessel").startsWith("C-Worker 4")
            && txt("m_glevel") === "—",
      () => ["v_batt", "v_spd", "v_cog", "v_att", "v_hold", "v_wp", "t_wall"].map((id) => id + "=" + txt(id)).join(" | "));

// 13. THE DEEP LINK AND THE PICKER
const dl = F.parseDeepLink("?file=asv_20261105-060135.jsonl&t=123.4"), bad = F.parseDeepLink("?file=../state/mission.json&t=-5"), none = F.parseDeepLink("?t=abc");
const lab13 = F.pickLabel({ name: "asv_20261105-060135.jsonl", size: 2048, vessel: "ben_cworker4", base: "Honolulu", mode: "sim", port: 8795 });
const lab13b = F.pickLabel({ name: "asv_20261105-060135.jsonl", size: 4096 });
const loadSrc = PW.grab(w.H, "loadList");
check("13. ?file=asv_<ts>.jsonl&t=<s> opens that recording at that second (a name the server would refuse is not asked for, a negative t "
      + "is the start); the picker names each file's vessel, base, mode and console port, leaving out what it does not know",
      () => dl.file === "asv_20261105-060135.jsonl" && dl.t === 123.4 && bad.file === null && bad.t === 0 && none.file === null && none.t === null
            && lab13 === "20261105-060135  ·  ben_cworker4  ·  Honolulu  ·  SIM  ·  :8795  ·  2 KB" && lab13b === "20261105-060135  ·  4 KB"
            && /parseDeepLink\(location\.search\)/.test(loadSrc) && /link\.t/.test(loadSrc),
      () => JSON.stringify({ dl, bad, none, lab13, lab13b }));
// 13b (2026-11-10). WHERE IT RAN beats where the console booted: his overnight Eastport survey (booted at Pago Pago) was
// listed as "pago pago" and taken for a file that did not exist
const lab13c = F.pickLabel({ name: "asv_20261109-194359.jsonl", size: 2048, vessel: "drix08_em712", base: "pago pago", places: ["Eastport, ME"], mode: "sim", port: 8791 });
const lab13d = F.pickLabel({ name: "asv_20261109-194359.jsonl", size: 2048, base: "Castine, Maine", places: ["Castine, Maine", "New Castle, NH"] });
const lab13e = F.pickLabel({ name: "asv_20261109-194359.jsonl", size: 2048, base: "durham", places: [] });
check("13b. the picker names the bases a recording's runs started at (`places`), in order, over the base it booted at; with "
      + "none, the base as before",
      () => lab13c === "20261109-194359  ·  drix08_em712  ·  Eastport, ME  ·  SIM  ·  :8791  ·  2 KB"
            && lab13d === "20261109-194359  ·  Castine, Maine → New Castle, NH  ·  2 KB" && lab13e === "20261109-194359  ·  durham  ·  2 KB",
      () => JSON.stringify({ lab13c, lab13d, lab13e }));

// 14. THE SPLICE (review 2026-11-05): the console's Engine.amend keeps waypoints [0, splice_at) and flies the tail after
// them; drawn as the tail alone, the flown waypoints vanished and every one still ahead read 'passed'
const LL = (i) => [LAT + 0.001 * i, LON];
const pl = (s, name, idx, at) => Object.assign({ t: t0 + s, kind: "plan_loaded", behavior: "survey", name, staged: false, n: idx.length, route: idx.map(LL) },
                                               at == null ? {} : { splice_at: at });
const w14 = PW.world([{ t: t0, kind: "session_start" }, pl(10, "survey", [1, 2, 3, 4, 5]), pl(20, "amend", [20, 21], 2), pl(30, "amend", [30], 3)]).fn;
const mid = PW.world([{ t: t0, kind: "session_start" }, pl(10, "amend", [30, 31], 3), pl(20, "amend", [40], 4), pl(30, "amend", [50], 9)]).fn;
const r14 = (fw, s) => { const p = fw.planAt(t0 + s); return (p.route ? p.route.map((q) => Math.round((q.lat - LAT) * 1000)).join(",") : "none") + "@" + p.off; };
const g14 = [r14(w14, 15), r14(w14, 25), r14(w14, 35), r14(mid, 15), r14(mid, 25), r14(mid, 35)];
const renderSrc14 = PW.grab(w.H, "render");
check("14. an AMEND replaces the plan from its splice_at on, the flown prefix KEPT (1,2 then 20,21 - and again at 3: 1,2,20,30); a "
      + "recording that began mid-run has no prefix to keep: the tail, numbered from its index (off 3 - and a second amend inside it "
      + "keeps 30, off 3; one past the end the tail alone, off 9); the chart counts 'passed' in the route's own numbering (wp - off)",
      () => g14.join(" | ") === "1,2,3,4,5@0 | 1,2,20,21@0 | 1,2,20,30@0 | 30,31@3 | 30,40@3 | 50@9"
            && /const wpIdx = wpAt\(absT\)\.idx - \(plan\.off \|\| 0\)/.test(renderSrc14),
      () => g14.join(" | "));

// 15. A STOP PARKS THE PLAN (review 2026-11-05): the link keeps it aboard and the next Start flies it again from waypoint one
const cm = (s, path, code, body) => ({ t: t0 + s, kind: "command", path, body: body || {}, code: code || 200 });
const w15 = PW.world([{ t: t0, kind: "session_start" }, pl(10, "survey", [1, 2, 3]), cm(30, "/api/cmd/stop"), cm(40, "/api/cmd/start", 409),
                      cm(50, "/api/cmd/start"), cm(60, "/api/cmd/estop"), cm(70, "/api/cmd/start"),
                      cm(80, "/api/cmd/stop"), pl(85, "goto", [9]), cm(90, "/api/cmd/start"),
                      // a plan too long to record (no route, no command beside it) after a stop: the parked one is not it
                      cm(100, "/api/cmd/stop"), { t: t0 + 105, kind: "plan_loaded", behavior: "survey", name: "survey", staged: false, n: 6000, route_sha: "f00" },
                      cm(110, "/api/cmd/start")]).fn;
const g15 = [20, 35, 45, 55, 65, 75, 82, 88, 95, 115].map((s) => "+" + s + " " + r14(w15, s));
check("15. a stop PARKS the route rather than taking it away: none drawn after it (+35), a REFUSED Start (409) brings nothing back "
      + "(+45), the next accepted Start flies it again (+55); an E-STOP and Start the same; a new plan after a stop replaces the "
      + "parked one, and the Start after it does not bring the old one back - nor after a plan too long to record (+115)",
      () => g15.join(" | ") === "+20 1,2,3@0 | +35 none@0 | +45 none@0 | +55 1,2,3@0 | +65 none@0 | +75 1,2,3@0 | +82 none@0 | +88 9@0 | +95 9@0 | +115 none@0",
      () => g15.join(" | "));

check("16. the suite wrote nothing (every fs write function counted)", () => writes === 0, () => writes + " write call(s)");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
