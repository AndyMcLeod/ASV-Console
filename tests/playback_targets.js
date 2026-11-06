// tests/playback_targets.js - playback shows EVERY sensor's targets, drawn by the live page's own rule (2026-11-05).
//
// Andy, 2026-11-05: "The playback function should display targets from AIS and any other sensor we may add."
// The console now records a generic target stream per sensor - `targets` (who is held, the rows that changed) and
// `track_info` (each track's particulars) - and the replay reads any sensor it is handed. An OLD log's `ais` records and
// state.roc adapt into the same model. Each contact is pointed by aisMotion from static/js/ais_keepout.js - the REAL
// module, loaded here with import() and handed to the page as window.PBK, exactly as the page's module bridge does - so a
// replay cannot point a ship differently from the live chart.
//
// DRIVEN: the page's own functions (tests/lib/playback_world.js lifts every one) over SYNTHETIC logs built from the
// record shapes in the mission-record contract (no console needed).
//   1   membership: a contact is shown while the sensor's last record holds her, and not after she is `gone`
//   2   a sensor's last record is the traffic for TARGETS_STALE_S (75 s) and no longer
//   3   a contact between two reports is interpolated by report time; held past the newest; NOT joined across a gap in
//       her membership or across reports farther apart than TGT_INTERP_MAX_S
//   4   her particulars are the last track_info at or before the cursor; a sensor that writes none still lists her
//   5   which way she points is aisMotion's answer (heading first: a moored ship lies along her HEADING, not her course)
//   6   the fallback rule (no module) agrees with aisMotion on a grid of contacts
//   7   the glyph plan: hull to scale / glyph / disc, the speed stalk only under way, the label at zoom 12, dimmed when old
//   8   trails: the last TGT_TRAIL_S, broken where her membership broke
//   9   what the guard saw: the open avoidance episode rings its contact, and ends the ways the page ends it
//   10  the guard's AIS model and chart ink at the cursor, behind no timeline row of their own; its rung on the card
//   11  cards.ais keeps the AIS shape; cards.roc comes from the roc sensor (over state.roc); every sensor in cards.targets
//   12  the Targets card's CPA is the live card's own (targets.js cpa); rows nearest first
//   13  an OLD log: `ais` records and state.roc adapt into the same model (report age from the service's `age`)
//   14  the module bridge imports only names the modules export, from the path the console serves them at
//   15  a Targets row words a contact by the rule her glyph points by
//   16  an avoidance hold's OWN /api/cmd/hold does not end its episode; a later command does   (review 2026-11-05)
//   17  a SLOW avoidance ends on the supervisor's clear past the grace; a hold's does not
//   18  client:ais_model DELTAS made whole: rings stand, ids drop, partial before a keyframe; an old whole record as it was
//   19  the Targets card's notices (no traffic record, AVOIDING not held, model BLIND/STALE/TORN)
//   20  the suite wrote nothing
//
//   node tests/playback_targets.js      # exit 0 = pass, 1 = fail
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
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

// ⚠ THIS SUITE WRITES NOTHING: every fs write is counted, and check 15 asserts none happened
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

// ── the synthetic log: three sensors over 800 s ─────────────────────────────────────
const t0 = 1790300000, LAT = 21.30, LON = -157.87, DLON = 1 / (111320 * Math.cos(LAT * Math.PI / 180));
const EV = [];
EV.push({ t: t0, kind: "session_start", argv: ["--sim"] });
EV.push({ t: t0 + 1, kind: "connect", mode: "sim" });
// an OLD-style state.roc in a NEW log: the roc sensor's own `targets` must win over it (check 11)
EV.push({ t: t0 + 2, kind: "state", state: { run: "running", autonomy: "auto", status: { lat_deg: LAT - 0.01, lon_deg: LON, heading_deg: 0, cog_deg: 0, sog_kn: 3 },
          roc: { rocs: [{ id: "other", name: "StateROC", kind: "shore", lat: LAT - 0.03, lon: LON }] }, supervisor: { holder: "a", tabs: 1, avoiding: null } } });
for (let s = 3; s <= 900; s++) EV.push({ t: t0 + s, kind: "telemetry", status: { lat_deg: LAT - 0.01, lon_deg: LON, heading_deg: 0, cog_deg: 0, sog_kn: 3 } });
const info = (t, sensor, id, name, cls, len, beam, dim, extra) => ({ t, kind: "track_info", sensor, id, name, cls, feed: "aisstream", len_m: len, beam_m: beam, dim: dim || null, info: extra || {} });
const A333 = { lat: LAT + 0.002, lon: LON }, B333 = { lat: LAT + 0.003, lon: LON + 0.01 };
const C444 = { lat: LAT + 0.004, lon: LON }, D444 = { lat: LAT + 0.004, lon: LON + 0.002 };
const lon222 = (k) => LON + 40 * DLON * (k - 1);
for (let k = 1; k <= 80; k++) {
  const t = t0 + 10 * k;
  if (k === 1) {
    EV.push(info(t, "ais", "111", "MOORED SHIP", "cargo", 200, 30, { a: 150, b: 50, c: 15, d: 15 }, { dest: "HONOLULU", type: 70 }));
    EV.push(info(t, "ais", "222", "UNDERWAY TUG", "tug", 25, 8));
    EV.push(info(t, "ais", "333", "NOHDG", "pleasure", null, null));
    EV.push(info(t, "ais", "444", "SPARSE", "fishing", 18, 6));
    EV.push(info(t, "roc", "ship-1", "Mothership", "roc:ship", null, null, null, { status: "ok", arrival: { lat: LAT - 0.019, lon: LON + 0.001 }, home: true }));
  }
  if (k === 4) EV.push(info(t, "ais", "333", "NOHDG", "pleasure", null, null));          // her return: a first sight again
  if (k === 20) EV.push(info(t, "ais", "222", "TUG RENAMED", "tug", 25, 8));
  const ids = ["111", "222"].concat(k === 3 ? [] : ["333"]).concat(["444"]);
  const rows = [{ id: "222", obs_t: t - 1, lat: LAT + 0.001, lon: lon222(k), sog: 7.8, cog: 90, hdg: null, nav: 0 }];
  if (k === 1) {
    rows.push({ id: "111", obs_t: t0 + 5, lat: LAT, lon: LON, sog: 0, cog: 327.5, hdg: 251, nav: 5 });
    rows.push({ id: "333", obs_t: t0 + 8, lat: A333.lat, lon: A333.lon, sog: 0.1, cog: 45, hdg: null, nav: 0 });
    rows.push({ id: "444", obs_t: t0 + 10, lat: C444.lat, lon: C444.lon, sog: 0, cog: null, hdg: 90, nav: null });
  }
  if (k === 4) rows.push({ id: "333", obs_t: t0 + 39, lat: B333.lat, lon: B333.lon, sog: 0.1, cog: 45, hdg: null, nav: 0 });
  if (k === 30) rows.push({ id: "444", obs_t: t0 + 300, lat: D444.lat, lon: D444.lon, sog: 0, cog: null, hdg: 90, nav: null });
  EV.push({ t, kind: "targets", sensor: "ais", ok: true, note: "", center: { lat: LAT - 0.01, lon: LON }, area: { mode: "sea" },
            health: { aisstream: { state: "up", stalled: false } }, ids, rows, gone: k === 3 ? ["333"] : [], keyframe: k === 1 });
  EV.push({ t, kind: "targets", sensor: "roc", ok: true, note: "", center: null, area: null, health: { home_id: "ship-1" }, ids: ["ship-1"],
            rows: k === 1 ? [{ id: "ship-1", obs_t: t, lat: LAT - 0.02, lon: LON, sog: 3, cog: 50, hdg: 45, nav: null }] : [], gone: [], keyframe: k === 1 });
  // a sensor nobody has written a line of playback for: it must draw and list with no change to the page
  EV.push({ t, kind: "targets", sensor: "radar", ok: true, note: "", center: null, area: null, health: {}, ids: ["r1"],
            rows: [{ id: "r1", obs_t: t, lat: LAT + 0.005, lon: LON - 0.0001 * k, sog: 2.0, cog: 270, hdg: null, nav: null }], gone: [], keyframe: k === 1 });
}
// what the guard saw (asv.html's payloads; /api/logevent renames the page's `kind` to `kind_`)
const TUG_KIND = "AIS: UNDERWAY TUG (25 x 8 m)", SHIP_KIND = "AIS: MOORED SHIP (200 x 30 m)";
EV.push({ t: t0 + 100, kind: "client:ais_avoid", kind_: TUG_KIND, rung: "hold", mmsi: 222, charted: false, line: 2, t_entry_s: 18 });
EV.push({ t: t0 + 100, kind: "client:guard_level", level: "hold", prev: "clear", t_entry_s: 18, why: "AIS contact in reach", clear_m: 12.5,
          kind_: TUG_KIND, act: "hold", ais_in_reach: true, ais_caused: true, her_mmsi: 222 });
EV.push({ t: t0 + 100, kind: "client:ais_model", stale: false, blind: false, torn: false, reach_m: 50,
          contacts: [{ mmsi: 222, kind: TUG_KIND, moving: true, hdg: 90, rule: null, margin_m: 12, in_reach: true,
                       ring: [[LAT + 0.0009, LON], [LAT + 0.0011, LON], [LAT + 0.0011, LON + 0.0003], [LAT + 0.0009, LON + 0.0003]] }] });
EV.push({ t: t0 + 130, kind: "client:ais_return", kind_: TUG_KIND, line: 2, back_m: 20, held_s: 30 });
EV.push({ t: t0 + 50, kind: "client:chart_ink", key: "ink-1", folded: true, z: 16, lines: [[LAT, LON, LAT + 0.001, LON + 0.001]],
          areas: [[[LAT, LON], [LAT + 0.001, LON], [LAT + 0.001, LON + 0.001]]], detached_n: 0, refused: false });
EV.push({ t: t0 + 200, kind: "client:ais_model", stale: false, blind: false, torn: false, reach_m: 50, contacts: [] });
EV.push({ t: t0 + 300, kind: "client:avoiding", why: "routed round", kind_: SHIP_KIND, rejoin: 5, by_waypoint: true });
EV.push({ t: t0 + 301, kind: "client:ais_around", kind_: SHIP_KIND, mmsi: 111, round_m: 80, std_m: 50, line: null });
const sup = (t, avoiding) => ({ t, kind: "state", state: { run: "running", autonomy: "auto", status: { lat_deg: LAT - 0.01, lon_deg: LON, heading_deg: 0, cog_deg: 0, sog_kn: 3 },
                                supervisor: { holder: "a", tabs: 1, avoiding } } });
EV.push(sup(t0 + 303, null));                      // inside the grace: a snapshot can predate the record
EV.push(sup(t0 + 330, { why: "routed round", kind: SHIP_KIND, rejoin_ll: null, for_s: 29, inherited: false }));
EV.push(sup(t0 + 400, null));                      // the way round is over
EV.sort((a, b) => a.t - b.t);

(async () => {
  const ROOT = path.join(__dirname, "..");
  const KO = await import(pathToFileURL(path.join(ROOT, "static", "js", "ais_keepout.js")).href);
  const TG = await import(pathToFileURL(path.join(ROOT, "static", "js", "targets.js")).href);
  const spy = { motion: 0, cpa: 0, box: 0 };
  const PBK = {
    aisMotion: (v, o) => { spy.motion++; return KO.aisMotion(v, o); }, aisBox: KO.aisBox, aisDiscM: KO.aisDiscM, hullRingEN: KO.hullRingEN,
    aisAgeS: KO.aisAgeS, cpa: (a, b) => { spy.cpa++; return TG.cpa(a, b); }, hullBox: (v) => { spy.box++; return TG.hullBox(v); },
  };
  const H = PW.source();
  console.log("Playback shows every sensor's targets, pointed by the live page's own rule:");
  let w = null, err = null;
  try { w = PW.world(EV, { window: { PBK } }); } catch (e) { err = e; }
  check("0. the page's own functions evaluate over a three-sensor log, with the REAL ais_keepout.js / targets.js as window.PBK",
        () => !err && !!w && !!w.g().PB.tgt.ais && !!w.g().PB.tgt.radar && !!w.g().PB.tgt.roc,
        () => err ? "THREW " + err.message : "sensors " + Object.keys(w.g().PB.tgt).join(","));
  if (!w) { console.log("\n1 CHECK(S) FAILED"); process.exit(1); }
  const F = w.fn, G = () => w.g();
  const ids = (t, sensor) => { const S = F.targetsAt(t).find((x) => x.sensor === sensor); return S ? S.contacts.map((v) => v.id).join(",") : "?"; };
  const view = (t, id, sensor) => { const S = F.targetsAt(t).find((x) => x.sensor === (sensor || "ais")); return S ? S.contacts.find((v) => v.id === id) : null; };

  // 1. MEMBERSHIP
  check("1. membership: 333 is shown while the ais record holds her, not after her `gone` record, and again on her return",
        () => ids(t0 + 25, "ais") === "111,222,333,444" && ids(t0 + 35, "ais") === "111,222,444" && ids(t0 + 45, "ais") === "111,222,333,444",
        () => [25, 35, 45].map((s) => "+" + s + " " + ids(t0 + s, "ais")).join("; "));

  // 2. STALENESS
  const c875 = F.cardsAt(t0 + 875), c876 = F.cardsAt(t0 + 876);
  check("2. the last record (+800 s) is the traffic for TARGETS_STALE_S = 75 s: contacts at +875, none (cards.ais null, sensor stale) at +876",
        () => Array.isArray(c875.ais) && c875.ais.length === 4 && c876.ais === null
              && c876.targets.every((S) => S.stale && S.contacts.length === 0) && c875.targets.every((S) => !S.stale),
        () => "+875: " + (c875.ais ? c875.ais.length : "null") + "; +876: " + JSON.stringify(c876.ais) + ", stale " + c876.targets.map((S) => S.sensor + "=" + S.stale).join(","));

  // 3. INTERPOLATION
  const v15 = view(t0 + 15, "222"), v805 = view(t0 + 805, "222"), v444 = view(t0 + 150, "444"), v333 = view(t0 + 20, "333");
  check("3. between reports by report time (222 at +15: 6/10 of the way from obs +9 to obs +19); held past the newest (+805 = obs +799); "
        + "NOT joined across reports 290 s apart (444 held at her first) nor across a gap in her membership (333 held at A)",
        () => near(v15.lon, LON + 24 * DLON, 1e-9) && v15.interp === true && near(v805.lon, lon222(80), 1e-12) && v805.interp === false
              && near(v444.lon, C444.lon, 1e-12) && v444.interp === false && near(v333.lon, A333.lon, 1e-12) && v333.interp === false,
        () => "222@+15 lon off by " + ((v15.lon - (LON + 24 * DLON)) / DLON).toFixed(2) + " m; 444@+150 " + (v444.lon - C444.lon).toExponential(2)
              + "; 333@+20 " + (v333.lon - A333.lon).toExponential(2));

  // 4. STATIC INFO BY TIME
  const n150 = view(t0 + 150, "222").name, n250 = view(t0 + 250, "222").name, r1 = view(t0 + 250, "r1", "radar");
  check("4. her particulars are the last track_info at or before the cursor (UNDERWAY TUG at +150, TUG RENAMED at +250); "
        + "a sensor that writes no track_info still lists her (radar r1, no name)",
        () => n150 === "UNDERWAY TUG" && n250 === "TUG RENAMED" && !!r1 && r1.name === null && view(t0 + 150, "111").len_m === 200,
        () => JSON.stringify({ n150, n250, r1: r1 && { id: r1.id, name: r1.name } }));

  // 5. POINTED BY aisMotion
  const at = t0 + 390, mpp = 0.5;
  const cAt = F.cardsAt(at);
  const all = cAt.targets.filter((S) => S.sensor !== "roc").flatMap((S) => S.contacts);
  spy.motion = 0;
  const glyphs = all.map((v) => ({ v, g: F.tgtGlyph(v, mpp, 14) }));
  const g111 = glyphs.find((x) => x.v.id === "111").g;
  const sameAsModule = glyphs.every(({ v, g }) => g.dir === KO.aisMotion(F.tgtAsAis(v), { now: 0, polledAt: 0 }).hdg);
  check("5. every contact is pointed by aisMotion itself (called once per glyph) - the moored ship lies along her HEADING 251, "
        + "not her course 327.5 (the old replay drew course first)",
        () => spy.motion === all.length && sameAsModule && g111.dir === 251 && g111.from === "heading",
        () => "aisMotion calls " + spy.motion + " for " + all.length + " contacts; 111 dir " + g111.dir + " (" + g111.from + ")");

  // 6. THE FALLBACK AGREES WITH THE MODULE
  let grid = 0, off = [];
  for (const sog of [null, 0, 0.4, 0.5, 1.9, 2.5, 3.5, 8])
    for (const cog of [null, 90])
      for (const heading of [null, 251, 511, 360])
        for (const nav of [null, 0, 1, 5, 6])
          for (const age of [0, 399, 401]) {
            const a = { sog, cog, heading, nav, age };
            const m = KO.aisMotion(a, { now: 0, polledAt: 0 }), f = F.tgtMotionFallback(a);
            grid++;
            if (m.moving !== f.moving || m.hdg !== f.hdg || m.from !== f.from) off.push(JSON.stringify(a) + " module " + m.moving + "/" + m.hdg + " fallback " + f.moving + "/" + f.hdg);
          }
  w.window.PBK = undefined;
  const gNo = F.tgtGlyph(all.find((v) => v.id === "111"), mpp, 14);
  w.window.PBK = PBK;
  check("6. without the module the documented fallback points every contact as aisMotion does: " + grid + " contacts (sog, cog, heading incl. 511/360, nav, age)",
        () => off.length === 0 && gNo.dir === 251 && gNo.shape === "hull",
        () => off.length ? off.length + " disagree, e.g. " + off[0] : "all agree; 111 without the module: " + gNo.shape + " @ " + gNo.dir);

  // 7. THE GLYPH PLAN
  const gl = (id, sensor, m, z) => F.tgtGlyph(view(at, id, sensor), m, z == null ? 14 : z);
  const p111 = gl("111", "ais", 0.5), p222 = gl("222", "ais", 0.5), p222far = gl("222", "ais", 10), p333 = gl("333", "ais", 0.5), pr1 = gl("r1", "radar", 0.5);
  check("7. the live layer's glyph rules: the 200 m ship to scale along 251, no stalk, dimmed (report 385 s old); the tug to scale "
        + "at 0.5 m/px with a stalk from her bow along course 90, a glyph at 10 m/px; the stopped boat with no heading a disc; "
        + "a radar contact with no particulars a glyph by course, colored unknown; the name at zoom 12, not 11",
        () => p111.shape === "hull" && p111.dir === 251 && p111.stalk === null && p111.alpha === 0.45 && p111.col === "#3fbf6b" && p111.label === "MOORED SHIP"
              && p222.shape === "hull" && p222.dir === 90 && p222.stalk && p222.stalk.cog === 90 && near(p222.stalk.fromPx, 12.5 / 0.5, 1e-9) && p222.alpha === 1 && p222.col === "#000000"
              && p222far.shape === "glyph" && near(p222far.stalk.fromPx, 12 * 0.62, 1e-9)
              && p333.shape === "disc" && near(p333.rPx, 12 * 0.62, 1e-9) && p333.stalk === null
              && pr1.shape === "glyph" && pr1.dir === 270 && pr1.col === "#8fa3b0" && pr1.label === "r1"
              && gl("222", "ais", 0.5, 12).label === "TUG RENAMED" && gl("222", "ais", 0.5, 11).label === null,
        () => JSON.stringify({ p111: [p111.shape, p111.dir, !!p111.stalk, p111.alpha], p222: [p222.shape, p222.dir, p222.stalk && p222.stalk.fromPx],
                               far: [p222far.shape], p333: [p333.shape, p333.rPx], r1: [pr1.shape, pr1.dir, pr1.col] }));

  // 8. TRAILS
  const tr222 = G().PB.tgt.ais.tracks["222"], tr333 = G().PB.tgt.ais.tracks["333"];
  const t800 = F.tgtTrail(tr222, t0 + 800, view(t0 + 800, "222")), t60 = F.tgtTrail(tr333, t0 + 60, view(t0 + 60, "333"));
  const hasA = t60.some((line) => line.some((p) => near(p.lat, A333.lat, 1e-12) && near(p.lon, A333.lon, 1e-12)));
  check("8. trails: the tug's is the last 600 s (first point her report after +200, one line); 333's starts at her return and never "
        + "joins the sighting before her gap",
        () => t800.length === 1 && near(t800[0][0].lon, lon222(21), 1e-12) && t800[0].length >= 60 && t60.length === 1 && !hasA,
        () => "tug: " + t800.length + " line(s), first lon at k=" + (t800[0] ? Math.round((t800[0][0].lon - LON) / (40 * DLON)) + 1 : "?")
              + ", " + (t800[0] ? t800[0].length : 0) + " pts; 333: " + t60.length + " line(s), holds A " + hasA);

  // 9. EPISODES
  const ep = (s) => { const c = F.cardsAt(t0 + s); return c.episode ? (c.avoided ? c.avoided.id : "open, no contact") : "none"; };
  const want9 = { 110: "222", 140: "none", 300.5: "111", 305: "111", 350: "111", 401: "none" };
  const got9 = Object.keys(want9).map((s) => [s, ep(+s)]);
  check("9. the open avoidance episode rings its contact: the tug through her hold (ais_avoid, by mmsi) until ais_return; the ship from "
        + "client:avoiding (no mmsi - found by the name in kind_) through ais_around, past a supervisor snapshot inside the grace, until "
        + "the supervisor no longer says avoiding; 'AIS: MMSI n (...)' names an mmsi",
        () => got9.every(([s, v]) => v === want9[s]) && F.kindName("AIS: MMSI 366123 (20 x 8 m)").mmsi === "366123"
              && F.kindName(SHIP_KIND).name === "MOORED SHIP",
        () => got9.map(([s, v]) => "+" + s + " " + v).join("; "));

  // 10. THE GUARD'S MODEL, INK AND RUNG
  const M = G().MARKS;
  const glvl = F.cardsAt(t0 + 110).glevel;
  check("10. the guard's AIS model and chart ink at the cursor (1 keep-out at +150, none at +250; ink from +50); the model gets NO timeline "
        + "row (a stream), the ink and the rung do; the Mission card's rung reads level, kind_, clearance and entry",
        () => F.cardsAt(t0 + 150).ko.ais_model.e.contacts.length === 1 && F.cardsAt(t0 + 250).ko.ais_model.e.contacts.length === 0
              && F.cardsAt(t0 + 40).ko.chart_ink === null && F.cardsAt(t0 + 60).ko.chart_ink.e.key === "ink-1"
              && !M.some((m) => m.ev && m.ev.kind === "client:ais_model") && M.some((m) => m.ev && m.ev.kind === "client:chart_ink")
              && M.some((m) => m.ev && m.ev.kind === "client:guard_level" && /^HOLD/.test(m.det))
              && /^HOLD \(from CLEAR\)/.test(glvl) && glvl.includes(TUG_KIND) && glvl.includes("12.5 m clear") && glvl.includes("entry in 18 s")
              && !glvl.includes("client:") && F.cardsAt(t0 + 50).glevel === "—",
        () => "rung: " + glvl);

  // 11. THE AIS SHAPE, THE ROC SENSOR, EVERY SENSOR
  const a0 = cAt.ais[0], roc = cAt.roc;
  check("11. cards.ais keeps the AIS shape (mmsi a number, name, cat, length, heading, dest); cards.roc is the roc sensor's (Mothership "
        + "with heading and arrival - NOT the state.roc of the same log); cards.targets lists ais, radar, roc in that order",
        () => a0.mmsi === 111 && a0.name === "MOORED SHIP" && a0.cat === "cargo" && a0.length === 200 && a0.heading === 251 && a0.dest === "HONOLULU"
              && roc.length === 1 && roc[0].name === "Mothership" && roc[0].heading === 45 && roc[0].arrival && near(roc[0].arrival.lat, LAT - 0.019, 1e-12)
              && roc[0].home === true && cAt.targets.map((S) => S.sensor).join(",") === "ais,radar,roc",
        () => JSON.stringify({ a0: { mmsi: a0.mmsi, name: a0.name, cat: a0.cat, heading: a0.heading }, roc: roc.map((r) => r.name), sensors: cAt.targets.map((S) => S.sensor) }));

  // 12. CPA BY THE LIVE FUNCTION
  spy.cpa = 0;
  const boat = F.fixAt(at);
  const rows = F.targetRows(cAt.targets, boat);
  const tugRow = rows.find((r) => r.id === "222");
  const direct = TG.cpa({ lat: boat.lat, lon: boat.lon, sog: boat.sog, cog: boat.cog }, { lat: tugRow && view(at, "222").lat, lon: view(at, "222").lon, sog: 7.8, cog: 90 });
  check("12. the Targets card's CPA is targets.js cpa itself (once per contact), the tug's equal to a direct call; rows nearest the boat first",
        () => spy.cpa === rows.length && rows.length === 6 && tugRow.cpa && near(tugRow.cpa.cpaM, direct.cpaM, 1e-6)
              && rows.every((r, i) => i === 0 || r.rangeM >= rows[i - 1].rangeM),
        () => "cpa calls " + spy.cpa + " for " + rows.length + " rows; tug CPA " + (tugRow && tugRow.cpa ? Math.round(tugRow.cpa.cpaM) + " m" : "none")
              + "; order " + rows.map((r) => r.id).join(","));

  // 13. AN OLD LOG
  const OLD = [
    { t: t0, kind: "session_start", argv: ["--sim"] },
    { t: t0 + 2, kind: "state", state: { status: { lat_deg: LAT, lon_deg: LON }, roc: { rocs: [{ id: "ship-1", name: "Mothership", kind: "ship", lat: LAT - 0.02, lon: LON, heading: 45, age_s: 3 }] } } },
    { t: t0 + 10, kind: "ais", count: 2, vessels: [
      { mmsi: 366000001, name: "OLD TUG", lat: LAT + 0.001, lon: LON, sog: 6, cog: 180, heading: 511, nav: 0, cat: "tug", length: 30, beam: 10, age: 12, src: "aisstream", dest: "HONOLULU" },
      { mmsi: 2, name: "FERRY", lat: LAT + 0.002, lon: LON, sog: 8, cog: 270, cat: "passenger", age: 1 }] },
    { t: t0 + 20, kind: "ais", count: 1, vessels: [{ mmsi: 366000001, name: "OLD TUG", lat: LAT + 0.0005, lon: LON, sog: 6, cog: 180, heading: 511, nav: 0, cat: "tug", length: 30, beam: 10, age: 4, src: "aisstream", dest: "HONOLULU" }] },
  ];
  const wo = PW.world(OLD, { window: { PBK } });
  const co = wo.fn.cardsAt(t0 + 25), so = wo.g().PB.tgt.ais;
  const go = wo.fn.tgtGlyph(wo.fn.targetsAt(t0 + 25)[0].contacts[0], 10, 14);
  check("13. an OLD log: each `ais` record is a keyframe of the ais sensor (stale after AIS_STALE_S 60), her report age from the service's "
        + "`age` (9 s at +25 for a report 4 s old at +20); heading 511 is no heading, so she points by her course under way; shown at "
        + "exactly 60 s, gone at 61; state.roc is the roc sensor",
        () => so.recs.length === 2 && so.recs.every((r) => r.old && r.stale_s === 60) && co.ais.length === 1 && co.ais[0].mmsi === 366000001
              && near(co.ais[0].age, 9, 1e-9) && co.ais[0].dest === "HONOLULU" && go.dir === 180 && go.from === "course"
              && Array.isArray(wo.fn.cardsAt(t0 + 80).ais) && wo.fn.cardsAt(t0 + 81).ais === null
              && wo.fn.cardsAt(t0 + 1000).roc.length === 1 && wo.fn.cardsAt(t0 + 1000).roc[0].name === "Mothership",
        () => JSON.stringify({ recs: so.recs.length, ais: co.ais.map((v) => [v.mmsi, v.age]), dir: go.dir, from: go.from, roc: wo.fn.cardsAt(t0 + 1000).roc.length }));

  // 14. THE BRIDGE
  const mod = (/<script type="module">([\s\S]*?)<\/script>/.exec(H) || [, ""])[1];
  const imps = [...mod.matchAll(/import \{([^}]*)\} from "([^"]+)"/g)].map((m) => ({ names: m[1].split(",").map((s) => s.trim()).filter(Boolean), from: m[2] }));
  const probs = [];
  for (const im of imps) {
    if (!im.from.startsWith("/static/js/")) { probs.push(im.from + " is not where the console serves its modules (/static/js/)"); continue; }
    const file = path.join(ROOT, "static", "js", im.from.slice("/static/js/".length));
    if (!fs.existsSync(file)) { probs.push(im.from + " has no file"); continue; }
    const ns = await import(pathToFileURL(file).href);
    for (const n of im.names) if (typeof ns[n] !== "function") probs.push(n + " is not exported by " + im.from);
  }
  const pbkKeys = (/window\.PBK = \{([^}]*)\}/.exec(mod) || [, ""])[1].split(",").map((s) => s.trim());
  check("14. the module bridge imports only names its modules export, from /static/js/ (where the console serves them), puts aisMotion, "
        + "hullBox, aisDiscM and cpa on window.PBK, and declares no function the classic script's harness would miss",
        () => imps.length === 2 && probs.length === 0 && ["aisMotion", "hullBox", "aisDiscM", "cpa"].every((k) => pbkKeys.includes(k))
              && !/^\s*(async\s+)?function\s+[\w$]+\s*\(/m.test(mod.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")),
        () => probs.length ? probs.join("; ") : imps.map((i) => i.from + " {" + i.names.join(",") + "}").join(" + "));

  // 15. THE ROW'S WORDS ASK THE POINTING RULE: a moored ship's course is noise, so her row never says she is going anywhere
  const rowOf = (id) => (rows.find((r) => r.id === id) || { text: "" }).text;
  const oldRoc = (F.targetRows(wo.fn.cardsAt(t0 + 1000).targets, null).find((r) => r.sensor === "roc") || { text: "" }).text;
  check("15. a Targets row words a contact by the same rule her glyph points by: the moored ship 'not under way · hdg 251°' (never her "
        + "course 327), the tug '7.8 kn @ 90°', a slow contact with no heading 'not under way' alone, a contact with no speed (an old "
        + "log's state.roc) her heading alone",
        () => rowOf("111").includes("MOORED SHIP · 0.0 kn · not under way · hdg 251° · ") && !/327/.test(rowOf("111"))
              && rowOf("222").includes("TUG RENAMED · 7.8 kn @ 90° · ") && /· 0\.1 kn · not under way · \d/.test(rowOf("333"))
              && rowOf("444").includes("· 0.0 kn · not under way · hdg 90° · ") && rowOf("r1").includes("[radar] · 2.0 kn @ 270° · ")
              && /^Mothership \[roc\] · hdg 45°( · |$)/.test(oldRoc) && !/ kn|--/.test(oldRoc),
        () => JSON.stringify({ r111: rowOf("111"), r222: rowOf("222"), r333: rowOf("333"), r444: rowOf("444"), r1: rowOf("r1"), oldRoc }));

  // 16. THE RUNG'S OWN HOLD (review 2026-11-05): the page logs client:ais_avoid and posts /api/cmd/hold in one frame, and
  // the console stamps the command after dispatch - so that hold closed the episode it had just opened.
  const epiW = (evs) => PW.world([{ t: t0, kind: "session_start", argv: ["--sim"] }].concat(evs), { window: { PBK } }).fn;
  const avoid = (s, rung, mmsi) => ({ t: t0 + s, kind: "client:ais_avoid", kind_: TUG_KIND, rung, mmsi: mmsi || 222, charted: false, line: 2, t_entry_s: 18 });
  const cmd = (s, p) => ({ t: t0 + s, kind: "command", path: p, body: {}, code: 200 });
  const supClear = (s) => ({ t: t0 + s, kind: "state", state: { run: "running", supervisor: { holder: "a", tabs: 1, avoiding: null } } });
  const open = (fw, s) => !!fw.episodeAt(t0 + s);
  const e16 = epiW([avoid(100, "hold"), cmd(100.3, "/api/cmd/hold"), cmd(200, "/api/cmd/stop")]);
  const e16b = epiW([avoid(100, "hold"), cmd(103, "/api/cmd/hold")]);
  check("16. an avoidance HOLD's own /api/cmd/hold (stamped after dispatch, 0.3 s on) does not end the episode it opened - it rings "
        + "its contact through the hold - and the operator's stop later does; a hold 3 s on (past EPI_OWN_CMD_S) is a new command and ends it",
        () => open(e16, 100.1) && open(e16, 150) && open(e16, 199) && !open(e16, 201) && open(e16b, 102) && !open(e16b, 104),
        () => JSON.stringify({ own: [open(e16, 150), open(e16, 201)], late: [open(e16b, 102), open(e16b, 104)] }));

  // 17. A MOVING EPISODE HAS NO BANK (review 2026-11-05): rung 'slow' is an underway splice round her; no ais_return comes
  const e17 = epiW([avoid(100, "slow"), supClear(105), supClear(120)]);
  const e17h = epiW([avoid(100, "hold"), supClear(105), supClear(120)]);
  check("17. a SLOW avoidance (no hold, no ais_return ever) ends when the supervisor's snapshot no longer says avoiding - past the "
        + "grace, not inside it - while a HOLD's episode is not ended by that snapshot (its ais_return ends it)",
        () => open(e17, 106) && open(e17, 119) && !open(e17, 121) && open(e17h, 121) && open(e17h, 500),
        () => JSON.stringify({ slow: [open(e17, 106), open(e17, 121)], hold: [open(e17h, 121)] }));

  // 18. THE AIS MODEL IS A DELTA (asv.html AIS_MODEL_KEY_MS, review 2026-11-05): made whole once, here
  const RG = (k) => [[LAT + k * 1e-4, LON], [LAT + k * 1e-4, LON + 1e-4], [LAT + k * 1e-4 + 1e-4, LON]];
  const am = (s, e) => Object.assign({ t: t0 + s, kind: "client:ais_model", stale: false, blind: false, torn: false, reach_m: 50 }, e);
  const m18 = epiW([
    am(10, { key: true, ids: [1, 2], contacts: [{ mmsi: 1, ring: RG(1), in_reach: false, margin_m: 10 }, { mmsi: 2, ring: RG(2), in_reach: false, margin_m: 10 }] }),
    am(20, { key: false, ids: [1, 2], contacts: [{ mmsi: 2, in_reach: true, margin_m: 20 }] }),
    am(30, { key: false, ids: [2], contacts: [] }),
    // 3 joins before her ring; and 1 is BACK with the post that carried her new ring LOST (a failed POST): her old ring,
    // from before she left at +30, must not stand
    am(40, { key: false, ids: [2, 3, 1], contacts: [{ mmsi: 3, in_reach: false, margin_m: 10 }, { mmsi: 1, in_reach: true, margin_m: 10 }] }),
    am(50, { key: true, ids: [3], contacts: [{ mmsi: 3, ring: RG(3), in_reach: false, margin_m: 10 }] }),
  ]);
  const mAt = (fw, s) => { const k = fw.cardsAt(t0 + s).ko.ais_model; return k ? k.e : null; };
  const sh = (e) => e ? e.contacts.map((c) => c.mmsi + (Array.isArray(c.ring) ? "r" : "") + (c.in_reach ? "!" : "")).join(",") + (e.partial ? " partial" : "") : "none";
  const old18 = epiW([am(10, { contacts: [{ mmsi: 7, ring: RG(7), in_reach: true }] })]);
  const noKey = epiW([am(10, { key: false, ids: [5], contacts: [{ mmsi: 5, in_reach: true }] })]);
  const g18 = { 15: sh(mAt(m18, 15)), 25: sh(mAt(m18, 25)), 35: sh(mAt(m18, 35)), 45: sh(mAt(m18, 45)), 55: sh(mAt(m18, 55)) };
  check("18. client:ais_model is a DELTA made whole at load: a contact's ring stands until she moves (2's ring through her in-reach "
        + "flag at +20, her margin the delta's), `ids` drops one no longer held (1 at +30), a contact read before her ring is PARTIAL "
        + "(3 at +40) until a keyframe; a contact that LEFT is forgotten - 1 back at +40 with the post of her new ring lost is "
        + "partial, never drawn at her old ring; a record written before the delta (no ids) is whole as it was, and a delta with no "
        + "keyframe before it is partial",
        () => g18[15] === "1r,2r" && g18[25] === "1r,2r!" && mAt(m18, 25).contacts[1].margin_m === 20 && g18[35] === "2r!" && g18[45] === "2r!,3,1! partial"
              && g18[55] === "3r" && sh(mAt(old18, 15)) === "7r!" && sh(mAt(noKey, 15)) === "5! partial",
        () => JSON.stringify(g18) + " old " + sh(mAt(old18, 15)) + " nokey " + sh(mAt(noKey, 15)));

  // 19. WHAT THE CURSOR CANNOT SHOW IS SAID ON THE CARD (review 2026-11-05: the canvas text sat under the opaque top bar)
  const n880 = F.targetNotices(F.cardsAt(t0 + 880)), n700 = F.targetNotices(F.cardsAt(t0 + 700));
  const nSyn = F.targetNotices({ ais: [], episode: { kind: "AIS: GHOST (20 x 8 m)" }, avoided: null, ko: { ais_model: { e: { blind: true, torn: true, note: "feed down" } } } });
  const nNone = epiW([]).targetNotices({ ais: null, episode: null, avoided: null, ko: { ais_model: null } });
  check("19. the Targets card's notices: 'no traffic record' once the AIS record is past TARGETS_STALE_S (+880) - not while it holds "
        + "(+700), and not in a log with no AIS sensor at all; an episode whose contact is not held says AVOIDING with her name; a "
        + "model BLIND/TORN says which and its note",
        () => n880.includes("AIS: no traffic record at the cursor") && n700.length === 0 && nNone.length === 0
              && nSyn.length === 2 && nSyn[0] === "AVOIDING AIS: GHOST (20 x 8 m) (not among the contacts held)"
              && nSyn[1] === "AIS model BLIND TORN · feed down",
        () => JSON.stringify({ n880, n700, nSyn, nNone }));

  check("20. the suite wrote nothing (every fs write function counted)", () => writes === 0, () => writes + " write call(s)");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
