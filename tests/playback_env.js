// tests/playback_env.js - playback has ALL the environmental data, aged at the cursor (2026-11-05).
//
// Andy, 2026-11-05: "It should have all the environmental data for playback."
// A new recording carries the environment as an `env` STREAM - written on a change of value, in full after start and
// every wake - and its state snapshots no longer carry the four blocks; an old recording has only the snapshots. The
// replay reads the stream first, per block, ages each block at the cursor, and shows the Mission card's rows (their old
// strings), an Environment card with all of it, a rose at the boat, the stations' positions, and a time-series strip.
//
// DRIVEN: the page's own functions (tests/lib/playback_world.js) over SYNTHETIC logs in the contract's record shapes.
//   1   a stream block is AGED at the cursor: age_s when written plus the time since (the Mission card's own strings)
//   2   the stream outranks a state snapshot's block; an old log (no stream) reads the snapshots, ages frozen
//   3   a non-full record updates only the blocks it carries; a FULL record without a block ends that block
//   4   the Environment card: wind with gust, source and stations; sea; the set with its source; current with its model
//       and stations; water with datum, method, kind, station and surge; density; each buoy's own row, aged
//   5   the sim's forcing split from the 1 Hz trace; a recording with none says so
//   6   the rose at the boat (wind from, current and set toward, sea from); none of the wind when the env switch is off
//   7   the stations the recording places: tide gauge, current station, buoy
//   8   the ENV strip's series: the stream's wind, gust, Hs, current and water, the set from the 1 Hz trace
//   9   `env` records get no timeline row; the card says which source it read
//   10  a reading that is GONE (env switched off, current not ok, a full record without the water) is a GAP in the strip,
//       drawn as one; a series opens on a reading; a strip with no series of two readings is not shown   (review 2026-11-05)
//   11  a current recomputed with the same answer is re-aged by the console's resample record (that block alone)
//   12  the strip's time axis is the scrubber's, measured every draw: the scrubber narrows, the strip is drawn again
//   13  the suite wrote nothing
//
//   node tests/playback_env.js      # exit 0 = pass, 1 = fail
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

// ⚠ THIS SUITE WRITES NOTHING: every fs write is counted, and check 10 asserts none happened
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

// ── a NEW log: the env stream, no env blocks in its state snapshots ─────────────────
const t0 = 1790300000, LAT = 21.3, LON = -157.87;
const ENV0 = { ok: true, enabled: true, source: "buoy", note: "", station: "51201", stations: [{ id: "51201", dist_km: 12.3 }], age_s: 600, obs_t: t0 + 10 - 600,
               wind: { speed_kn: 8.1, dir_from_deg: 300, gust_kn: 11.2, gust_src: "buoy", stations: ["51201"] },
               sea: { hs_m: 0.8, tp_s: 7, dir_from_deg: 290, derived: false, stations: ["51201"] } };
const WATER0 = { ok: true, offset_m: 0.42, datum: "MLLW", method: "idw", data_kind: "observed", station: "1612340", name: "Honolulu", age_s: 300,
                 surge: { ok: true, low_m: -0.1, high_m: 0.3 } };
const CUR0 = { ok: true, source: "fused", speed_kn: 0.35, set_deg: 120, model: { label: "PacIOOS" }, stations: [["HAI1", "Honolulu Hbr", 1200, 0.6, 2]], age_s: 60 };
const DEN0 = { ok: true, rho: 1023.4, temp: { c: 25.1, source: "buoy" }, salinity: { psu: 34.9, source: "estimate" }, estimated: false, age_s: 900 };
const BUOY = { id: "51201", dist_km: 12.3, lat: 21.67, lon: -158.12, t: t0 - 600, WDIR: 300, WSPD: 4.2, GST: 5.8, WVHT: 0.8, DPD: 7, APD: 5, MWD: 290,
               PRES: 1015.2, ATMP: 26.1, WTMP: 25.8, DEWP: 20.5, VIS: 10 };
const EV = [
  { t: t0, kind: "session_start", argv: ["--sim"] },
  { t: t0 + 1, kind: "connect", mode: "sim" },
  { t: t0 + 5, kind: "state", state: { mode: "sim", run: "idle", autonomy: "safe", status: { lat_deg: LAT, lon_deg: LON, env_set_kn: 0.31, env_set_deg: 120, crab_deg: -3 } } },
  { t: t0 + 10, kind: "env", full: true, changed: ["current", "density", "env", "water", "extra"],
    blocks: { env: ENV0, water: WATER0, current: CUR0, density: DEN0 },
    extra: { buoys: [BUOY], stations: { water: [{ id: "1612340", name: "Honolulu", lat: 21.3067, lon: -157.867 }],
                                         current: [{ id: "HAI1", name: "Honolulu Hbr", lat: 21.30, lon: -157.88, bin: 2 }] } } },
  // a change of the weather alone
  { t: t0 + 100, kind: "env", full: false, changed: ["env"], blocks: { env: Object.assign({}, ENV0, { age_s: 30, wind: { speed_kn: 12, dir_from_deg: 310, gust_kn: 15, gust_src: "buoy", stations: ["51201"] } }) } },
  // after a wake: in full, and the density monitor has nothing
  { t: t0 + 200, kind: "env", full: true, changed: ["density"], blocks: { env: ENV0, water: WATER0, current: CUR0 }, extra: { buoys: [BUOY], stations: {} } },
];
// the 1 Hz trace: the set applied (the sum), its source, the crab - and the sim's own forcing split
for (let s = 6; s <= 300; s++)
  EV.push({ t: t0 + s, kind: "telemetry", status: { lat_deg: LAT, lon_deg: LON, sog_kn: 3, env_set_kn: 0.31, env_set_deg: 120, env_set_src: "stream", crab_deg: -3,
            forcing: { wind_kn: 9.0, wind_from_deg: 305, gust_mult: 1.12, leeway_kn: 0.12, leeway_deg: 125, stream_kn: 0.2, stream_deg: 116, hs_m: 0.8, tp_s: 7, wave_from_deg: 290, rho: 1023.4 } } });
EV.sort((a, b) => a.t - b.t);

console.log("Playback has all the environmental data, aged at the cursor:");
let w = null, err = null;
try { w = PW.world(EV); } catch (e) { err = e; }
check("0. the page's own functions evaluate over a log with an env stream", () => !err && !!w && w.g().PB.env.n === 3, () => err ? "THREW " + err.message : w.g().PB.env.n + " env records");
if (!w) { console.log("\n1 CHECK(S) FAILED"); process.exit(1); }
const F = w.fn;

// 1. AGED AT THE CURSOR
const c70 = F.cardsAt(t0 + 70);
check("1. a stream block is aged at the cursor: wind written 600 s old at +10 reads 11 min at +70, the water (300 s) 6 min, the current "
      + "(60 s) 2 min - the Mission card's own strings",
      () => c70.wind === "8.1 kn @ 300° · 11 min" && c70.water === "+0.42 m · Honolulu · 6 min" && c70.current === "0.35 kn @ 120° · 2 min",
      () => JSON.stringify({ wind: c70.wind, water: c70.water, current: c70.current }));

// 2. THE STREAM OUTRANKS A SNAPSHOT; AN OLD LOG READS THE SNAPSHOTS
const STALE_STATE = { t: t0 + 50, kind: "state", state: { mode: "sim", status: { lat_deg: LAT, lon_deg: LON },
                      env: { ok: true, enabled: true, age_s: 5, wind: { speed_kn: 99, dir_from_deg: 0 } } } };
const cMix = PW.world(EV.concat([STALE_STATE]).sort((a, b) => a.t - b.t)).fn.cardsAt(t0 + 70);
const OLD = [{ t: t0, kind: "session_start" }, Object.assign({}, STALE_STATE, { t: t0 + 10 })];
const cOld = PW.world(OLD).fn.cardsAt(t0 + 70);
check("2. the stream outranks a state snapshot's env block (8.1 kn, not the snapshot's 99); an old log with no stream reads its "
      + "snapshot, its age as written (5 s), and says so",
      () => cMix.wind.startsWith("8.1 kn") && cOld.wind === "99 kn @ 0° · 5 s" && cOld.envCard.from === "state snapshots (older recording)"
            && c70.envCard.from === "env stream",
      () => JSON.stringify({ mixed: cMix.wind, old: cOld.wind, from: [c70.envCard.from, cOld.envCard.from] }));

// 3. PARTIAL AND FULL
const c150 = F.cardsAt(t0 + 150), c250 = F.cardsAt(t0 + 250);
check("3. a non-full record updates only its block (+150: the new 12 kn wind, the water still the +10 reading, 440 s); a FULL record "
      + "without density ends it (+250: no density)",
      () => c150.wind === "12 kn @ 310° · 1 min" && c150.water === "+0.42 m · Honolulu · 7 min" && /^ρ 1023\.4/.test(c150.envCard.density)
            && c250.envCard.density === "—",
      () => JSON.stringify({ wind: c150.wind, water: c150.water, den150: c150.envCard.density, den250: c250.envCard.density }));

// 4. THE ENVIRONMENT CARD
const E = c70.envCard;
check("4. the Environment card: wind with gust, source and station; sea; the set with crab and source; current with its model and "
      + "stations; water with datum, method, kind, station and surge; density with its sources; the buoy's own row, aged",
      () => E.wind === "8.1 kn from 300° · gust 11.2 kn (buoy) · buoy · 51201 · 11 min"
            && E.sea === "0.80 m / 7.0 s from 290° · 51201 · 11 min"
            && E.set === "0.31 kn toward 120° · crab -3° · stream"
            && E.current === "0.35 kn toward 120° · fused · PacIOOS · Honolulu Hbr 1.20 km · 2 min"
            && E.water === "+0.42 m MLLW · idw · observed · Honolulu · surge low -0.10 m high 0.30 m · 6 min"
            && E.density === "ρ 1023.4 kg/m³ · 25.1 °C (buoy) · 34.9 psu (estimate) · 16 min"
            && E.buoys.length === 1 && E.buoys[0].text === "51201 · 12 km · 1015.2 hPa · air 26.1 °C · water 25.8 °C · dew 20.5 °C · vis 10.0 nmi · wind 4.2 m/s G 5.8 from 300° · Hs 0.8 m / 7 s · 11 min",
      () => JSON.stringify(E).slice(0, 700));

// 5. THE SIM'S FORCING
const cReal = PW.world([{ t: t0, kind: "session_start" }, { t: t0 + 5, kind: "telemetry", status: { lat_deg: LAT, lon_deg: LON, env_set_kn: 0.2, env_set_deg: 90 } }]).fn.cardsAt(t0 + 6);
check("5. the sim's forcing split at the cursor - wind as applied (gust x1.12), leeway and stream apart, the sea, rho; a recording "
      + "with none (a real link) says so",
      () => E.forcing === "wind 9.0 kn from 305° (x1.12) · leeway 0.12 kn toward 125° · stream 0.20 kn toward 116° · Hs 0.80 m / 7.0 s from 290° · ρ 1023.4"
            && cReal.envCard.forcing === "— (sim only; none in this recording)",
      () => JSON.stringify([E.forcing, cReal.envCard.forcing]));

// 6. THE ROSE
const OFF = EV.map((e) => e.kind === "env" ? Object.assign({}, e, { blocks: Object.assign({}, e.blocks, { env: Object.assign({}, e.blocks.env, { enabled: false }) }) }) : e);
const rOff = PW.world(OFF).fn.cardsAt(t0 + 70).rose;
const R = c70.rose;
check("6. the rose at the boat: the wind FROM 300 at 8.1 kn, the current and the set TOWARD 120, the sea from 290; with the env switch "
      + "off, no wind and no sea (the current and the set stand)",
      () => R.wind && R.wind.from === 300 && R.wind.kn === 8.1 && R.current && R.current.to === 120 && R.current.kn === 0.35
            && R.set && R.set.to === 120 && R.set.kn === 0.31 && R.sea && R.sea.from === 290
            && rOff.wind === null && rOff.sea === null && !!rOff.current && !!rOff.set,
      () => JSON.stringify({ R, rOff }));

// 7. STATIONS
const st = c70.stations;
check("7. the stations the recording places: the tide gauge, the current station and the buoy, each at its position",
      () => st.length === 3 && st.some((s) => s.kind === "water" && s.name === "Honolulu" && s.lat === 21.3067)
            && st.some((s) => s.kind === "current" && s.id === "HAI1") && st.some((s) => s.kind === "buoy" && s.id === "51201" && s.lon === -158.12)
            && F.cardsAt(t0 + 250).stations.filter((s) => s.kind !== "buoy").length === 0,
      () => JSON.stringify(st.map((s) => [s.kind, s.id])));

// 8. THE STRIP
const S = w.g().PB.strip;
check("8. the ENV strip's series: the stream's wind (8.1, 12, 8.1), gust, Hs, current and water level, and the set applied from the "
      + "1 Hz trace (one point per second that carries it)",
      () => JSON.stringify(S.wind.map((p) => p[1])) === "[8.1,12,8.1]" && S.gust.length === 3 && S.hs.length === 3 && S.cur.length === 2
            && S.water.length === 2 && S.set.length === 1 + 295 && S.set.every((p) => p[1] === 0.31) && F.stripHas(),
      () => Object.keys(S).map((k) => k + " " + S[k].length).join(", "));

// 9. NO TIMELINE ROWS FOR THE STREAM
check("9. `env` records are a stream: no timeline row each",
      () => !w.g().MARKS.some((m) => m.ev && m.ev.kind === "env"),
      () => w.g().MARKS.length + " timeline rows, " + w.g().MARKS.filter((m) => m.ev && m.ev.kind === "env").length + " of them env");

// a canvas 2d context that records every call (and a canvas whose context it is)
const rec2d = (log) => new Proxy({}, {
  get: (o, k) => k in o ? o[k] : k === "measureText" ? (() => ({ width: 10 })) : ((...a) => { log.push([k].concat(a)); }),
  set: (o, k, v) => { o[k] = v; return true; } });

// 10. A GONE READING IS A GAP (review 2026-11-05: only readings were pushed, so a switched-off environment drew its last
// value to the end of the recording beside a card that said off)
const ENVON = (kn) => ({ ok: true, enabled: true, source: "buoy", wind: { speed_kn: kn, dir_from_deg: 300 } });
const GAPS = [
  { t: t0, kind: "session_start", argv: ["--sim"] },
  { t: t0 + 5, kind: "env", full: true, changed: ["env"], blocks: { env: { ok: true, enabled: false } } },
  { t: t0 + 10, kind: "env", full: true, changed: ["env", "current", "water"],
    blocks: { env: ENVON(8), current: { ok: true, speed_kn: 0.3, set_deg: 90 }, water: { ok: true, offset_m: 0.4 } } },
  { t: t0 + 20, kind: "env", full: true, changed: ["env", "current", "water"], blocks: { env: { ok: true, enabled: false }, current: { ok: false, note: "no model" } } },
  { t: t0 + 30, kind: "env", full: false, changed: ["env", "current"], blocks: { env: ENVON(9), current: { ok: true, speed_kn: 0.5, set_deg: 90 } } },
];
const wG = PW.world(GAPS), SG = wG.g().PB.strip;
const ONE = [GAPS[0], GAPS[2], { t: t0 + 20, kind: "env", full: true, changed: ["env"], blocks: { env: { ok: true, enabled: false } } }];
const wOne = PW.world(ONE);
// drawn: the offscreen canvas's calls, split per series stroke
const drawLog = [];
const stripEl = (log) => ({ width: 0, height: 0, clientWidth: 600, clientHeight: 74, classList: { contains: () => false, toggle() {} },
                            getBoundingClientRect: () => ({ left: 0, right: 600, width: 600 }), getContext: () => rec2d(log) });
let scrubRect = { left: 100, right: 500, width: 400 }, builds = 0;
const onLog = [];
const sEl = stripEl(onLog), scEl = { getBoundingClientRect: () => scrubRect };
const fake$ = (sel) => sel === "#envstrip" ? sEl : sel === "#scrub" ? scEl : null;
const hadDoc = Object.prototype.hasOwnProperty.call(globalThis, "document"), oldDoc = globalThis.document;
globalThis.document = { createElement: () => { builds++; return { width: 0, height: 0, getContext: () => rec2d(drawLog) }; }, body: { classList: { toggle() {} } } };
let strokes = [], drawErr = null;
try {
  const wGd = PW.world(GAPS, { $: fake$ });
  wGd.fn.stripBuild();
  let cur = [];
  for (const c of drawLog) { if (c[0] === "beginPath") cur = []; else if (c[0] === "stroke") strokes.push(cur); else if (c[0] === "moveTo" || c[0] === "lineTo") cur.push(c[0][0] + Math.round(c[1])); }
} catch (e) { drawErr = e; }
const pts = (k) => JSON.stringify(SG[k].map((p) => [p[0] - t0, p[1]]));
check("10. a reading that is GONE is a GAP: the wind [+10 8, +20 off, +30 9] (the +5 'off' that opens it dropped), the current's "
      + "'not ok' a gap, the water's end at a full record without it, a series of nothing at all (gust, Hs) empty; DRAWN as a gap - "
      + "the wind's line ends at +20 and starts again at +30, the water's ends at +20, not at the strip's edge; and a recording "
      + "whose every series holds one reading has no strip",
      () => pts("wind") === "[[10,8],[20,null],[30,9]]" && pts("cur") === "[[10,0.3],[20,null],[30,0.5]]" && pts("water") === "[[10,0.4],[20,null]]"
            && SG.gust.length === 0 && SG.hs.length === 0 && wG.fn.stripHas() && !wOne.fn.stripHas()
            && !drawErr && strokes.length === 3 && strokes[0].filter((s) => s[0] === "m").length === 2
            && strokes[2].filter((s) => s[0] === "m").length === 1 && strokes[2][strokes[2].length - 1] === "l" + Math.round(107 + 20 / 30 * (493 - 107)),
      () => drawErr ? "THREW " + drawErr.message : "wind " + pts("wind") + " cur " + pts("cur") + " water " + pts("water") + "; strokes " + JSON.stringify(strokes));

// 11. THE RESAMPLE (asv_console SessionLogger ENV_RESAMPLE_LOG_S): a current recomputed with the same answer writes its block
// alone, so a replay does not age a fresh reading from the first record that carried it
const CURS = { ok: true, source: "fused", speed_kn: 0.35, set_deg: 120, age_s: 0 };
const RS = [
  { t: t0, kind: "session_start", argv: ["--sim"] },
  { t: t0 + 10, kind: "env", full: true, changed: ["current", "env", "extra"], blocks: { env: ENV0, current: Object.assign({}, CURS, { sampled_t: t0 + 10 }) },
    extra: { buoys: [BUOY], stations: {} } },
  { t: t0 + 130, kind: "env", full: false, changed: [], resampled: ["current"], blocks: { current: Object.assign({}, CURS, { sampled_t: t0 + 130 }) }, extra: {} },
];
const wR = PW.world(RS), FR = wR.fn;
const ageAt = (s) => { const c = FR.envAt(t0 + s).current; return c ? Math.round(c.age_s) : null; };
check("11. a current recomputed with the SAME answer is re-aged by its own record: 110 s old at +120, and 10 s old at +140 after "
      + "the console's resample record at +130 - which carries that block alone (the wind still read, the buoy still listed) and is no timeline row",
      () => ageAt(120) === 110 && ageAt(140) === 10 && FR.envAt(t0 + 140).env && FR.envAt(t0 + 140).env.wind.speed_kn === 8.1
            && FR.envAt(t0 + 140).buoys.length === 1 && !wR.g().MARKS.some((m) => m.ev && m.ev.kind === "env"),
      () => JSON.stringify({ a120: ageAt(120), a140: ageAt(140), buoys: FR.envAt(t0 + 140).buoys.length }));

// 12. THE STRIP'S AXIS IS MEASURED EVERY DRAW (review 2026-11-05: read once at load, before the first frame wrote the clock
// beside the flex:1 scrubber, the cursor line ran 250 px ahead of the thumb at the end of the recording)
let axErr = null, lr0 = null, lr1 = null, b0 = 0, b1 = 0, b2 = 0, drawn = 0;
try {
  const wA = PW.world(GAPS, { $: fake$ });
  builds = 0; wA.fn.stripBuild(); b0 = builds; lr0 = wA.g().PB.stripLR.slice();
  onLog.length = 0; wA.fn.stripDraw(); b1 = builds; drawn = onLog.filter((c) => c[0] === "drawImage").length;
  scrubRect = { left: 100, right: 400, width: 300 };
  wA.fn.stripDraw(); b2 = builds; lr1 = wA.g().PB.stripLR.slice();
} catch (e) { axErr = e; }
if (hadDoc) globalThis.document = oldDoc; else delete globalThis.document;
check("12. the strip's time axis is the scrubber's thumb travel (7 px in from each end: 107-493 px), and is MEASURED at every draw: "
      + "a draw on an unchanged axis paints the built image, a scrubber narrowed to 300 px builds the strip again on 107-393",
      () => !axErr && b0 === 1 && JSON.stringify(lr0) === "[107,493]" && b1 === 1 && drawn === 1 && b2 === 2 && JSON.stringify(lr1) === "[107,393]",
      () => axErr ? "THREW " + axErr.message : JSON.stringify({ lr0, lr1, builds: [b0, b1, b2], drawn }));

check("13. the suite wrote nothing (every fs write function counted)", () => writes === 0, () => writes + " write call(s)");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
