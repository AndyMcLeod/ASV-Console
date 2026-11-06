// tests/page_model_posts.js - THE MISSION RECORD, the page's part (2026-11-05): what each guard decision was made AGAINST.
//
// Andy, 2026-11-05: "Look at the logging function(s) and add in data that fully describes any given mission." The page's
// posts said what the console DID - a rung, a way round, a hold - and none said what it did it against. Four change-only
// streams now carry that, from the SUPERVISING tab only: client:model (the keep-out model's identity), client:chart_ink
// (the structures read off the chart image and folded in), client:ais_model (the AIS keep-outs the guard was handed) and
// client:guard_level (the ladder's rung, coalesced to two a second). logClient names the tab (X-ASV-Client), the LINES
// rows carry the coverage actually run, and every change-only latch is reset when the recording wakes from quiet, so the
// values a quiet log dropped are posted again.
//
// DRIVEN: the page's own logClient, recNum, nogoInkN, nogoModelSig, logNogoModel, chartInkSig, chartInkRecord,
// logAisModel, logGuardLevel, logWakeTick, logModelTick, lineRowsForLog, updateNogoUI and logGuardChange, brace-matched
// out of static/asv.html and evaluated under "use strict" with a recording `fetch`, a clock, a supervising() switch and the
// state each reads. The AIS keep-outs are the REAL ones (static/js/ais_keepout.js aisKeepout, in a real planeFrame), so a
// ring posted in the wrong frame, or lat/lon swapped, is a ring in the wrong water. The wiring - the typeof-guarded hooks
// in onState and updateNogoUI, the 2 s ticker in connect(), and clearanceGuard's record of what its ladder saw - is read
// as text, because those functions are lifted by some thirty suites and are theirs to drive.
//
// It writes nothing: no console is started, no file is opened for writing, and every post goes to the fetch stub.
//
//   node tests/page_model_posts.js      # exit 0 = pass, 1 = fail
// ASV_HTML points this at a SIDECAR copy for a mutation run.
//
// TEETH - 42 mutations of the page RUN on a sidecar copy (the real file hashed before and after, unchanged), all caught:
// 40 here, and two - the guard bar's whole text, the elapsed-digit key - by page_log_posts.js (1b, 3):
//   no tab header / the header read bare in the TDZ -> 1        model keyed on the water READING, not the built level -> 2
//   the enforce toggles or the built-at level dropped -> 2      the lock waiver, chart-ink count or unread squares -> 2c
//   an empty model posted at boot / an empty AIS box key -> 3   a no-model frame read as the last frame's rung -> 3, 7c
//   chart ink unkeyed on `folded` / its emptying unposted -> 4b a view-only tab posts any of the four -> 5
//   a throwing supervising() taken as yes -> 12                 one try for both records / a record's throw escapes -> 12
//   AIS: no 10 s floor -> 6b; all in reach -> 6, 6b; feed health ignored -> 6b; [lon,lat] -> 6, 6c; the CURRENT frame -> 6c
//   the rung uncoalesced -> 7, 7b; a fall to clear held -> 7    a payload key named t -> 7b, 11
//   the wake: the nogo latch kept, no re-post, every frame a wake -> 8                 LINES rows without `done` -> 9
//   a hook unguarded, dropped, or back between clearanceGuard and accumLineTime; no 2 s tick in connect() -> 10
//   clearanceGuard's record dropped, or naming a name it does not declare -> 10b (and clearance_guard.js, ais_avoid.js,
//   guard_resume.js crash on that one - which is why the record may use only its own names)
const fs = require("fs");
const path = require("path");

// crash guard: a death outside a check() is REPORTED, not silent (turn_geometry.js 30)
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const AK = require("../static/js/ais_keepout.js");
const { planeFrame, M_PER_DEG_LAT } = require("../static/js/geodesy.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
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
function decl(re) { const m = H.match(re); if (!m) throw new Error("test setup: declaration " + re + " not found"); return m[0]; }

const FNS = ["logClient", "recNum", "nogoInkN", "nogoModelSig", "logNogoModel", "chartInkSig", "chartInkRecord",
             "logAisModel", "logGuardLevel", "logWakeTick", "logModelTick", "lineRowsForLog", "updateNogoUI", "logGuardChange"];
const DECLS = [/^let lastNogoLogged = null;/m, /^let lastGuardLogged = "";/m, /^let modelLogged = [^\n]*;/m,
               /^let aisHeadLogged = [^\n]*;/m, /^let guardLevelLogged = [^\n]*;/m, /^let logQuietWas = [^\n]*;/m,
               /^const GUARD_LEVEL_MIN_MS = [^\n]*;/m, /^const AIS_MODEL_MOVE_MS = [^\n]*;/m];

// every post any world in this suite made: no page payload may carry a top-level t or iso (check 11)
const ALL_POSTS = [];
const FR = planeFrame({ lat: 21.3, lon: -157.88 });

function world(o = {}) {
  const posts = [];
  const env = { sup: true, now: 1e12, oper: 0 };
  const els = {};
  const fakeEl = (id) => ({ id, textContent: "", className: "", style: {}, title: "", disabled: false,
                            classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } } });
  const $ = (s) => els[s] || (els[s] = fakeEl(s));
  const fetch = (url, opts) => { const p = { url, headers: opts.headers, body: JSON.parse(opts.body) };
                                 posts.push(p); ALL_POSTS.push(p); return { catch() {} }; };
  const readout = { text: "1300 zones · floor 2.3 m", cls: "" };
  const nogo = o.empty
    ? { ready: false, busy: false, band: null, bbox: null, center: null, buffer: 10, enf: { land: true, depth: true, haz: true,
        area: false, wreck: true, chan: true }, builtOffset: null, ko: null, skin: null, unread: [], failed: null, frame: null }
    : { ready: true, busy: false, band: "enc_harbour", bbox: { W: -157.95, S: 21.25, E: -157.85, N: 21.35 },
        center: { lat: 21.3, lon: -157.9 }, buffer: 10,
        enf: { land: true, depth: true, haz: true, area: false, wreck: true, chan: true }, builtOffset: 0.3,
        ko: { polys: [{}, {}], lines: [{}], points: [] }, skin: { gaps: [{}, {}] }, unread: [{}], failed: null, frame: FR };
  const sea = { waterOffset: 0.32, enc: { partial: [], stale: [] } };
  const V = { NOGO_MIN_DEPTH_M: 2.3, OPEN_WATER: true };
  const mission = { lines: [] };
  const src = `"use strict";
    const Date = { now: () => env.now };
    const supervising = () => { if (env.supThrows) throw new Error("supervising() threw"); return env.sup; };
    ${o.noClientId ? "" : 'const CLIENT_ID = "tab-1234-abcd";'}
    const nogoDR = () => { if (env.drThrows) throw new Error("nogoDR() threw");
                           return { min: Math.max(V.NOGO_MIN_DEPTH_M, env.oper || 0), max: 0 }; };
    const nogoReadout = () => ({ text: readout.text, cls: readout.cls, title: "" });
    const setTip = () => {}; const nogoKeyShow = () => {};
    const aisMotion = AK.aisMotion;
    const buildLineTable = () => mission.lines.map((L, k) => ({ line: k + 1, drawn: k + 1, len_m: 100 + k, lead_m: 0, plan_s: 60, actual_s: 30 }));
    const lineDoneFrac = (L) => L.frac;
    let nogoShow = true;
    let chartInk = { key: null, lines: [], areas: [], detached: [], note: null, z: null, ms: 0, busy: false };
    let chartReads = [], inkRefused = null, lockWaiver = null;
    let clearance = { m: null };
    let aisKoNote = null, aisKoStale = false, aisKoBlind = false, aisTorn = false, aisPolledAt = 0, aisVessels = [];
    let grant = null, S = { run: "idle" };
    let lastActivity = "boot";
    ${DECLS.map(decl).join("\n")}
    ${FNS.map(grab).join("\n")}
    return { logClient, logNogoModel, logAisModel, logGuardLevel, logWakeTick, logModelTick, lineRowsForLog, updateNogoUI,
             logGuardChange,
             set: { chartInk: v => { chartInk = v; }, chartReads: v => { chartReads = v; }, inkRefused: v => { inkRefused = v; },
                    lockWaiver: v => { lockWaiver = v; }, clearance: v => { clearance = v; }, aisKoNote: v => { aisKoNote = v; },
                    aisKoStale: v => { aisKoStale = v; }, aisKoBlind: v => { aisKoBlind = v; }, aisTorn: v => { aisTorn = v; },
                    aisPolledAt: v => { aisPolledAt = v; }, aisVessels: v => { aisVessels = v; }, grant: v => { grant = v; },
                    S: v => { S = v; }, lastActivity: v => { lastActivity = v; } },
             get: { lastActivity: () => lastActivity, lastNogoLogged: () => lastNogoLogged, lastGuardLogged: () => lastGuardLogged } };`;
  // eslint-disable-next-line no-new-func
  const W = new Function("$", "fetch", "readout", "env", "nogo", "sea", "V", "mission", "AK", "console", src)(
    $, fetch, readout, env, nogo, sea, V, mission, AK, { error() {}, warn() {}, log() {} });
  return { W, posts, env, nogo, sea, V, mission, readout, $, kinds: () => posts.map((p) => p.body.kind) };
}
const of = (posts, k) => posts.filter((p) => p.body.kind === k);

// AIS contacts as the guard models them: the REAL keep-out, in the real frame, round a boat at the frame's origin
const OWN = FR.toEN({ lat: 21.3, lon: -157.88 });
const VESSELS = [
  { mmsi: 367000001, name: "MOORED ONE", lat: 21.3027, lon: -157.8790, sog: 0, cog: 12, heading: 45, nav: 5, age: 600, length: 100, beam: 18 },
  { mmsi: 367000002, name: "UNDER WAY", lat: 21.3009, lon: -157.8800, sog: 9, cog: 90, age: 2, length: 40, beam: 9 },
  { mmsi: 367000003, lat: 21.2985, lon: -157.8812, sog: 0, age: 900 },            // stopped, no heading: the disc
];
function koOf(vessels, frame, now) {
  return vessels.map((v) => AK.aisKeepout(v, frame, { now, polledAt: now, own: frame.toEN({ lat: 21.3, lon: -157.88 }), sweepS: 45 }))
                .filter(Boolean);
}
function liveClearance(extra) {
  return Object.assign({ m: 42.25, kind: null, level: "clear", tEntry: null, why: null, onPlan: true, koFrame: FR,
                         aisKo: [], aisInReach: [], aisReach: 87.54, aisCaused: false, her: null, entry: null,
                         onStation: false, settling: false, act: true }, extra || {});
}
const mDist = (a, b) => Math.hypot((a[0] - b[0]) * M_PER_DEG_LAT, (a[1] - b[1]) * M_PER_DEG_LAT * Math.cos(a[0] * Math.PI / 180));

console.log("The page records what each decision was made against:");

// ---- 1. logClient names the tab ---------------------------------------------------------------------------------- //
{
  const A = world(), B = world({ noClientId: true });
  A.W.logClient("k", { a: 1 }); B.W.logClient("k", { a: 2 });
  // a post made while the module is still evaluating meets CLIENT_ID before its line: the const is in its TDZ
  let tdzThrew = null; const tdz = [];
  try {
    // eslint-disable-next-line no-new-func
    new Function("fetch", `"use strict"; ${grab("logClient")}
      logClient("early", {}); let CLIENT_ID = "late"; return CLIENT_ID;`)((u, o) => { tdz.push(o); return { catch() {} }; });
  } catch (e) { tdzThrew = e.message; }
  const a = A.posts[0], b = B.posts[0];
  check("1. logClient names the TAB (X-ASV-Client: CLIENT_ID) and still labels the body application/json; a world with "
        + "no CLIENT_ID, and a post made before the const's own line ran, post without the name rather than throw",
        () => a && a.url === "/api/logevent" && a.headers["X-ASV-Client"] === "tab-1234-abcd"
              && a.headers["Content-Type"] === "application/json" && a.body.kind === "k" && a.body.data.a === 1
              && b && !("X-ASV-Client" in b.headers) && b.headers["Content-Type"] === "application/json"
              && tdzThrew === null && tdz.length === 1 && !("X-ASV-Client" in tdz[0].headers),
        () => JSON.stringify({ a: a && a.headers, b: b && b.headers, tdzThrew, tdz: tdz.map((x) => x.headers) }));
}

// ---- 2-3. client:model ------------------------------------------------------------------------------------------- //
{
  const { W, posts, nogo, sea, env } = world();
  W.logNogoModel(); W.logNogoModel(); W.logNogoModel();
  const first = of(posts, "model").length;
  sea.waterOffset = 0.38;                 W.logNogoModel();   // a station update: the model was NOT rebuilt
  const afterLevel = of(posts, "model").length;
  nogo.builtOffset = 0.42;                W.logNogoModel();   // the tide rebuild
  nogo.enf = { ...nogo.enf, wreck: false }; W.logNogoModel(); // an enforce toggle
  env.oper = 4.0;                         W.logNogoModel();   // the operator's Min depth deeper than the hull's
  const M = of(posts, "model"), m0 = M[0] && M[0].body.data, last = M[M.length - 1] && M[M.length - 1].body.data;
  check("2. client:model is the keep-out model's IDENTITY, posted on a change of the MODEL: three identical asks post once; "
        + "a new water reading the model was not rebuilt for posts nothing; a tide rebuild, an enforce toggle and a deeper "
        + "operator floor each post once",
        () => first === 1 && afterLevel === 1 && M.length === 4 && M[1].body.data.built_offset_m === 0.42
              && M[2].body.data.enf.wreck === false && last.floor === 4 && last.min_depth_req === 2.3,
        () => M.length + " model post(s): " + JSON.stringify(M.map((p) => [p.body.data.built_offset_m, p.body.data.enf.wreck, p.body.data.floor])));
  check("2b. ... carrying what a replay must rebuild it from: band, box [W,S,E,N], center, the floor and buffer, the six "
        + "enforce toggles and open water, the level it was BUILT at beside the reading, its counts, the seabed gaps, "
        + "the unread squares and the frame's origin",
        () => m0.ready === true && m0.band === "enc_harbour" && JSON.stringify(m0.bbox) === "[-157.95,21.25,-157.85,21.35]"
              && m0.center.lat === 21.3 && m0.center.lon === -157.9 && m0.buffer === 10 && m0.floor === 2.3
              && JSON.stringify(m0.enf) === '{"land":true,"depth":true,"haz":true,"area":false,"wreck":true,"chan":true}'
              && m0.open_water === true && m0.built_offset_m === 0.3 && m0.water_offset_m === 0.32
              && m0.n_polys === 2 && m0.n_lines === 1 && m0.n_points === 0 && m0.ink_n === 0 && m0.skin_gaps === 2
              && m0.unread_n === 1 && m0.failed === null && m0.lock_waiver_id === null
              && m0.frame_origin.lat === 21.3 && m0.frame_origin.lon === -157.88,
        () => JSON.stringify(m0));
  // the other things that change WHICH model the guard holds without a rebuild of the extract
  const n0 = of(posts, "model").length;
  W.set.lockWaiver({ id: "w7", keys: new Set(["a", "b"]) });   W.logNogoModel();   // a lock transit waives its walls
  W.set.chartInk({ key: "k9", z: 16, ms: 1, busy: false, note: null, detached: [], areas: [],
                   lines: [{ a: { lat: 21.3, lon: -157.88 }, b: { lat: 21.301, lon: -157.88 } },
                           { a: { lat: 21.302, lon: -157.88 }, b: { lat: 21.303, lon: -157.88 } }] });
  W.logNogoModel();                                                                  // structures folded in
  nogo.unread = [];                                        W.logNogoModel();   // the square under the boat read
  W.logNogoModel();
  const N = of(posts, "model").slice(n0).map((p) => p.body.data);
  check("2c. ... and again when a lock waiver opens its walls, when chart-read structures are folded in, and when an "
        + "unread square is read - none of which rebuilds the extract",
        () => N.length === 3 && N[0].lock_waiver_id === "w7" && N[1].ink_n === 2 && N[2].unread_n === 0,
        () => JSON.stringify(N.map((d) => [d.lock_waiver_id, d.ink_n, d.unread_n])));
}
{
  const E = world({ empty: true });
  E.W.logNogoModel(); E.W.logNogoModel(); E.W.logModelTick(); E.W.logModelTick();
  const quietBoot = E.posts.filter((p) => p.body.kind !== "guard_level").length;
  const off = of(E.posts, "guard_level");
  E.nogo.failed = { at: 1, why: "ENC enc_coastal/158: Could not find service" };
  E.W.logNogoModel();
  const f = of(E.posts, "model")[0];
  check("3. a console that has read no chart yet posts no model, no chart ink and no AIS keep-outs (nothing is not news) - "
        + "only, once, that the guard is OFF; a read that FAILED is news - the guard has no model because the chart could "
        + "not be read, and that is said",
        () => quietBoot === 0 && off.length === 1 && off[0].body.data.level === "off"
              && f && f.body.data.failed === "ENC enc_coastal/158: Could not find service"
              && f.body.data.ready === false && f.body.data.band === null && !of(E.posts, "chart_ink").length,
        () => quietBoot + " post(s) at boot besides the rung; then " + JSON.stringify(E.posts.map((p) => [p.body.kind, p.body.data.failed || p.body.data.level])));
}

// ---- 4. client:chart_ink ----------------------------------------------------------------------------------------- //
{
  const { W, posts, nogo } = world();
  W.logNogoModel();                                        // the model; the ink is still empty: not posted
  const before = of(posts, "chart_ink").length;
  W.set.chartReads([{ key: "k1", bb: { W: -157.9, S: 21.29, E: -157.87, N: 21.31 }, z: 16, got: 20, tiles: 24, ms: 312, seq: 1,
                      lines: [], areas: [], detached: [] }]);
  W.set.chartInk({ key: "k1", z: 16, ms: 312, busy: false, note: "x",
                   lines: [{ a: { lat: 21.3000001234, lon: -157.88 }, b: { lat: 21.301, lon: -157.8812345678 }, lengthM: 140 }],
                   areas: [{ ring: [{ lat: 21.302, lon: -157.879 }, { lat: 21.3021, lon: -157.879 }, { lat: 21.3021, lon: -157.8789 }] },
                           { ring: [{ lat: 1, lon: 1 }] }],
                   detached: [{}] });
  W.logNogoModel(); W.logNogoModel();
  const I = of(posts, "chart_ink"), r0 = I[0] && I[0].body.data;
  nogo.enf = { ...nogo.enf, land: false }; W.logNogoModel();          // structures off: the ink is no longer folded
  W.set.inkRefused({ bb: {}, why: "an area of 410 tiles, past the 256 a read may take" }); W.logNogoModel();
  W.set.chartInk({ key: null, lines: [], areas: [], detached: [], note: null, z: null, ms: 0, busy: false });
  W.set.chartReads([]); W.set.inkRefused(null); W.logNogoModel();   // a new extract over other water empties it
  const J = of(posts, "chart_ink").map((p) => p.body.data);
  check("4. client:chart_ink is posted when the merged read CHANGES - not at boot when there is none - with its lines as "
        + "[lat,lon,lat,lon] and footprints as rings of [lat,lon] at 1e-6, the reads it merges, the detached marks counted "
        + "and whether it was FOLDED into the model",
        () => before === 0 && I.length === 1 && r0.key === "k1" && r0.folded === true && r0.z === 16
              && JSON.stringify(r0.lines) === "[[21.3,-157.88,21.301,-157.881235]]"
              && r0.areas.length === 1 && JSON.stringify(r0.areas[0][1]) === "[21.3021,-157.879]"
              && r0.reads.length === 1 && JSON.stringify(r0.reads[0]) === '{"key":"k1","bb":[-157.9,21.29,-157.87,21.31],"z":16,"got":20,"tiles":24,"ms":312}'
              && r0.detached_n === 1 && r0.refused === null,
        () => JSON.stringify(r0));
  check("4b. ... and again when the structure toggle stops it being folded, when a read is REFUSED, and when a new "
        + "extract EMPTIES it - the replay must not fold ink the console did not use",
        () => J.length === 4 && J[1].folded === false && J[1].key === "k1" && J[2].refused === "an area of 410 tiles, past the 256 a read may take"
              && J[3].key === null && J[3].lines.length === 0 && J[3].reads.length === 0 && J[3].refused === null,
        () => JSON.stringify(J.map((d) => [d.key, d.folded, d.refused, d.lines.length])));
}

// ---- 5. the supervising tab only --------------------------------------------------------------------------------- //
{
  const { W, posts, env } = world();
  const now = env.now, ko = koOf(VESSELS, FR, now);
  W.set.aisPolledAt(now); W.set.aisVessels(VESSELS); W.set.clearance(liveClearance({ aisKo: ko }));
  W.set.chartInk({ key: "k5", z: 16, ms: 1, busy: false, note: null, detached: [], areas: [],
                   lines: [{ a: { lat: 21.3, lon: -157.88 }, b: { lat: 21.301, lon: -157.88 } }] });
  env.sup = false;
  W.logNogoModel(); W.logAisModel(); W.logGuardLevel(); W.logModelTick();
  const viewOnly = posts.length;
  env.sup = true; env.now += 2000; W.logModelTick();
  check("5. a tab that is not supervising posts none of the four (its model is not what the boat was steered by); the "
        + "same tab, taking over, posts what it holds at its next 2 s tick - model, chart ink, AIS keep-outs and the rung",
        () => viewOnly === 0 && of(posts, "model").length === 1 && of(posts, "ais_model").length === 1
              && of(posts, "guard_level").length === 1 && of(posts, "chart_ink").length === 1,
        () => viewOnly + " post(s) while view-only; then " + JSON.stringify(posts.map((p) => p.body.kind)));
}

// ---- 6. client:ais_model ----------------------------------------------------------------------------------------- //
{
  const { W, posts, env, nogo } = world();
  const t0 = env.now;
  let ko = koOf(VESSELS, FR, t0);
  W.set.aisPolledAt(t0); W.set.aisVessels(VESSELS); W.set.aisKoNote(ko.length + " AIS contacts modelled");
  W.set.clearance(liveClearance({ aisKo: ko, aisInReach: [ko[1]] }));
  W.logAisModel(); W.logAisModel();
  const A = of(posts, "ais_model"), d = A[0] && A[0].body.data;
  const byM = d ? Object.fromEntries(d.contacts.map((c) => [c.mmsi, c])) : {};
  const disc = byM[367000003], moored = byM[367000001], under = byM[367000002];
  const mean = disc ? [disc.ring.reduce((s, p) => s + p[0], 0) / disc.ring.length, disc.ring.reduce((s, p) => s + p[1], 0) / disc.ring.length] : [0, 0];
  check("6. client:ais_model is the AIS keep-outs the GUARD was handed, each ring in [lat,lon] (a stopped contact with no "
        + "heading is the disc round her own antenna), with her rule, margin, heading and where the heading came from, and "
        + "which of them the ladder had in reach; asked twice it posts once",
        () => A.length === 1 && d.contacts.length === 3 && d.key === true && d.ids.length === 3
              && d.stale === false && d.blind === false && d.torn === false
              && d.reach_m === 87.5 && d.poll_age_s === 0 && d.note === "3 AIS contacts modelled"
              && mDist(mean, [21.2985, -157.8812]) < 1.5 && disc.hdg === null && disc.hdg_from === null
              && moored.hdg === 45 && moored.hdg_from === "heading" && moored.moving === false && typeof moored.rule === "string"
              && under.moving === true && under.hdg === 90 && under.hdg_from === "course" && under.in_reach === true
              && moored.in_reach === false && disc.in_reach === false && /^AIS: MOORED ONE/.test(moored.kind)
              && moored.ring.every((p) => Math.abs(p[0] - 21.30) < 0.01 && Math.abs(p[1] + 157.88) < 0.01),
        () => d ? JSON.stringify(d.contacts.map((c) => [c.mmsi, c.moving, c.hdg, c.hdg_from, c.rule, c.margin_m, c.in_reach, c.ring.length]))
                  + " disc mean " + mDist(mean, [21.2985, -157.8812]).toFixed(2) + " m off her antenna" : "no post");
  // she moves on: only her keep-out's box changed
  const moved = VESSELS.map((v) => v.mmsi === 367000002 ? { ...v, lon: v.lon + 0.0004 } : v);
  env.now = t0 + 2000; ko = koOf(moved, FR, env.now); W.set.aisPolledAt(env.now); W.set.aisVessels(moved);
  W.set.clearance(liveClearance({ aisKo: ko, aisInReach: [ko[1]] })); W.logAisModel();
  const at2 = of(posts, "ais_model").length;
  env.now = t0 + 10000; W.logAisModel();
  const at10 = of(posts, "ais_model").length;
  env.now = t0 + 12000; W.set.clearance(liveClearance({ aisKo: ko, aisInReach: [] })); W.logAisModel();   // out of reach
  const reach = of(posts, "ais_model").length;
  env.now = t0 + 14000; W.set.aisKoBlind(true); W.logAisModel();
  const blind = of(posts, "ais_model");
  check("6b. a contact under way whose keep-out only MOVED is re-posted at most every 10 s, while a change of what the "
        + "ladder has in reach, or of the feed (BLIND), is posted at the next tick",
        () => at2 === 1 && at10 === 2 && reach === 3 && blind.length === 4 && blind[3].body.data.blind === true
              && blind[2].body.data.contacts.every((c) => c.in_reach === false),
        () => [at2, at10, reach, blind.length].join(" / ") + " posts at +2 / +10 / +12 / +14 s");
  const D = blind.map((p) => p.body.data);
  const shape = (x) => x.contacts.map((c) => c.mmsi + (c.ring ? "+ring" : "")).join(",");
  check("6d. a post after the first carries WHAT CHANGED (review 2026-11-05: every post re-sent every contact's ring - "
        + "13.6 MB an hour replayed on a real harbor session): ids names every contact held, and contacts only hers - at "
        + "+10 her moved ring, at +12 her flags alone (her ring stands), at +14 none (the feed went blind); no keyframe",
        () => D[1].key === false && D[1].ids.length === 3 && shape(D[1]) === "367000002+ring"
              && D[2].key === false && shape(D[2]) === "367000002" && D[2].contacts[0].in_reach === false
              && D[3].key === false && shape(D[3]) === "" && D[3].ids.length === 3,
        () => D.map((x) => (x.key ? "KEY " : "") + "[" + shape(x) + "]").join(" | "));
  // the frame moved on (a new extract) after the guard's last frame: the rings are in the frame they were BUILT in
  const fr2 = planeFrame({ lat: 21.31, lon: -157.87 });
  nogo.frame = fr2;
  env.now = t0 + 16000; W.set.aisKoBlind(false); W.logAisModel();
  const unkeyed = of(posts, "ais_model").pop().body.data;
  env.now = t0 + 16000 + 600000; W.logAisModel();            // AIS_MODEL_KEY_MS on: a keyframe, every ring again
  const last = of(posts, "ais_model").pop().body.data, disc2 = last.contacts.find((c) => c.mmsi === 367000003);
  check("6e. ... and a KEYFRAME every AIS_MODEL_KEY_MS (every contact, every ring), so a reader may start there - not before",
        () => unkeyed.key === false && last.key === true && last.contacts.length === 3 && last.contacts.every((c) => Array.isArray(c.ring)),
        () => JSON.stringify([unkeyed.key, last.key, last.contacts.length]));
  const mean2 = [disc2.ring.reduce((s, p) => s + p[0], 0) / disc2.ring.length, disc2.ring.reduce((s, p) => s + p[1], 0) / disc2.ring.length];
  check("6c. ... and each ring is converted in the frame the guard BUILT it in (clearance.koFrame), not the one the model "
        + "holds by the time the tick runs - a new extract between the two would otherwise post every ring a kilometer off",
        () => mDist(mean2, [21.2985, -157.8812]) < 1.5,
        () => "disc mean " + mDist(mean2, [21.2985, -157.8812]).toFixed(1) + " m off her antenna");
  // she LEAVES the model and comes back where she was (review 2026-11-05: the delta's ring memory)
  const koNo1 = ko.filter((q) => q.mmsi !== 367000001);
  env.now = t0 + 16000 + 620000; W.set.clearance(liveClearance({ aisKo: koNo1, aisInReach: [] })); W.logAisModel();
  const gone1 = of(posts, "ais_model").pop().body.data;
  env.now = t0 + 16000 + 622000; W.set.clearance(liveClearance({ aisKo: ko, aisInReach: [] })); W.logAisModel();
  const back1 = of(posts, "ais_model").pop().body.data, her1 = back1.contacts.find((c) => c.mmsi === 367000001);
  check("6f. a contact that LEAVES the model and comes back where she was is a JOIN - the post at her return carries her "
        + "ring, though it is the one posted before she left (gone is gone: a reader dropped it with her)",
        () => gone1.key === false && gone1.ids.length === 2 && !gone1.ids.includes(367000001)
              && back1.key === false && back1.ids.length === 3 && !!her1 && Array.isArray(her1.ring) && her1.ring.length > 2,
        () => JSON.stringify({ gone: gone1.ids, back: back1.ids, her: her1 ? Object.keys(her1) : null }));
}

// ---- 7. client:guard_level --------------------------------------------------------------------------------------- //
{
  const { W, posts, env } = world();
  const t0 = env.now;
  W.set.S({ run: "running", armed: true, server_t: 1762370000.25 });
  W.set.clearance(liveClearance());
  W.logGuardLevel(); W.logGuardLevel();
  const one = of(posts, "guard_level").length;
  env.now = t0 + 100; W.set.clearance(liveClearance({ level: "slow", kind: "a pier" })); W.logGuardLevel();
  env.now = t0 + 300; W.set.clearance(liveClearance({ level: "hold", kind: "a pier", tEntry: 12.34, why: "x".repeat(300),
    onStation: true, settling: true, entry: FR.toEN({ lat: 21.3004, lon: -157.8803 }) })); W.logGuardLevel();
  const inWindow = of(posts, "guard_level").length;
  env.now = t0 + 600; W.logGuardLevel();
  env.now = t0 + 700; W.set.clearance(liveClearance()); W.logGuardLevel();                      // a fall to clear
  env.now = t0 + 800; W.set.clearance(liveClearance({ level: "slow", kind: "a pier" })); W.logGuardLevel();
  env.now = t0 + 900; W.set.clearance(liveClearance()); W.logGuardLevel();                      // a 100 ms blip, gone
  const G = of(posts, "guard_level").map((p) => p.body.data);
  check("7. client:guard_level is the ladder's rung, on a change of (level, kind, act), at most twice a second keeping the "
        + "LATEST - the slow that lasted 200 ms between two posts is folded into the hold that followed - and a fall to "
        + "clear is posted at once, inside the window",
        () => one === 1 && inWindow === 1 && G.length === 3 && G[0].level === "clear" && G[0].prev === null
              && G[1].level === "hold" && G[1].prev === "clear" && G[2].level === "clear" && G[2].prev === "hold",
        () => JSON.stringify(G.map((g) => [g.level, g.prev])));
  const h = G[1];
  check("7b. ... carrying what the ladder saw: time to entry, why (cut to 200), clearance, the hazard as kind_, on plan / on "
        + "station / settling, the entry point in lat/lon, whether the tab could act, and the frame it judged (frame_t)",
        () => h.t_entry_s === 12.3 && h.why.length === 200 && h.clear_m === 42.3 && h.kind_ === "a pier" && h.on_plan === true
              && h.on_station === true && h.settling === true && h.act === true && h.grant === false
              && h.frame_t === 1762370000.25 && Math.abs(h.entry.lat - 21.3004) < 1e-6 && Math.abs(h.entry.lon + 157.8803) < 1e-6
              && h.ais_caused === false && h.her_mmsi === null,
        () => JSON.stringify(h).slice(0, 400));
  env.now = t0 + 2000;
  W.set.clearance(liveClearance({ level: "slow", aisCaused: true, her: { mmsi: 367000002, kind: "AIS: UNDER WAY (40 x 9 m, 9.0 kn)" },
                                  aisInReach: [{ mmsi: 367000002 }] })); W.logGuardLevel();
  const ais = of(posts, "guard_level").pop().body.data;
  env.now = t0 + 3000; W.set.clearance({ ...liveClearance({ level: "hold" }), m: null }); W.logGuardLevel();   // the model is gone
  const off = of(posts, "guard_level").pop().body.data;
  check("7c. a rung a CONTACT caused names her (kind_ and her_mmsi, and how many the ladder had in reach); with no keep-out "
        + "model the guard is not assessing, and the rung says OFF rather than the last frame's level",
        () => ais.kind_ === "AIS: UNDER WAY (40 x 9 m, 9.0 kn)" && ais.her_mmsi === 367000002 && ais.ais_caused === true
              && ais.ais_in_reach === 1 && off.level === "off" && off.prev === "slow" && off.clear_m === null && /no keep-out model/.test(off.why),
        () => JSON.stringify({ ais: [ais.kind_, ais.her_mmsi, ais.ais_in_reach], off: [off.level, off.why] }));
  // her speed wobbles on the 5 s polls: the SAME rung, the same contact - no post (review 2026-11-05)
  const nBefore = of(posts, "guard_level").length;
  env.now = t0 + 4000; W.set.clearance(liveClearance({ level: "slow", aisCaused: true, her: { mmsi: 367000002, kind: "AIS: UNDER WAY (40 x 9 m, 9.0 kn)" } })); W.logGuardLevel();
  const nSlow = of(posts, "guard_level").length;
  env.now = t0 + 5000; W.set.clearance(liveClearance({ level: "slow", aisCaused: true, her: { mmsi: 367000002, kind: "AIS: UNDER WAY (40 x 9 m, 9.1 kn)" } })); W.logGuardLevel();
  env.now = t0 + 6000; W.set.clearance(liveClearance({ level: "slow", aisCaused: true, her: { mmsi: 367000002, kind: "AIS: UNDER WAY (40 x 9 m, 8.9 kn)" } })); W.logGuardLevel();
  // ... and her NAME arriving mid-episode (her static report, after the positions that named her by MMSI): still her
  env.now = t0 + 6500; W.set.clearance(liveClearance({ level: "slow", aisCaused: true, her: { mmsi: 367000002, kind: "AIS: SEA WOLF (40 x 9 m, 8.9 kn)" } })); W.logGuardLevel();
  const nWobble = of(posts, "guard_level").length;
  env.now = t0 + 7000; W.set.clearance(liveClearance({ level: "slow", aisCaused: true, her: { mmsi: 367000005, kind: "AIS: ANOTHER (40 x 9 m, 8.9 kn)" } })); W.logGuardLevel();
  const nOther = of(posts, "guard_level").length;
  env.now = t0 + 8000; W.set.clearance(liveClearance({ level: "slow", kind: "AIS: NO MMSI (30 x 8 m, 2.0 kn)" })); W.logGuardLevel();
  env.now = t0 + 9000; W.set.clearance(liveClearance({ level: "slow", kind: "AIS: NO MMSI (30 x 8 m, 2.4 kn)" })); W.logGuardLevel();
  const nKind = of(posts, "guard_level").length;
  check("7d. the rung's key is WHO, not how she is written: her speed in the kind changing (9.0 -> 9.1 -> 8.9 kn), or her "
        + "name arriving, posts nothing - it posted the same rung, and a timeline row, on every SOG wobble - another contact does; with no "
        + "contact, the kind without a speed in it",
        () => nSlow === nBefore + 1 && nWobble === nSlow && nOther === nWobble + 1 && nKind === nOther + 1,
        () => [nBefore, nSlow, nWobble, nOther, nKind].join(" -> "));
}

// ---- 8. the latches on wake -------------------------------------------------------------------------------------- //
{
  const { W, posts, env, $ } = world();
  const ko = koOf(VESSELS, FR, env.now);
  W.set.aisPolledAt(env.now); W.set.aisVessels(VESSELS); W.set.clearance(liveClearance({ aisKo: ko }));
  W.set.chartInk({ key: "k1", z: 16, ms: 1, busy: false, note: null, lines: [], areas: [], detached: [] });
  const bar = $("#guardBar"); bar.style.display = "none";
  W.updateNogoUI(); W.logModelTick(); W.logGuardChange();
  const before = posts.length;
  W.logWakeTick({ log_quiet: false }); W.logWakeTick({ log_quiet: false });
  W.logWakeTick({ log_quiet: true });
  const quietOnly = posts.length;
  W.set.lastActivity("surveying|line 3");
  W.logWakeTick({ log_quiet: false });                      // the recording wakes
  const atWake = posts.slice(quietOnly).map((p) => p.body.kind);
  env.now += 2000; W.logModelTick(); W.logGuardChange();
  const after = posts.slice(quietOnly).map((p) => p.body.kind);
  const wakeAm = of(posts, "ais_model").pop().body.data;
  check("8. when the recording WAKES (log_quiet true -> false) every change-only latch is reset, so what a quiet log "
        + "dropped is posted again: the readout, the model and the chart ink at once, the AIS keep-outs (a KEYFRAME: every "
        + "contact, every ring - a reader may start at the resume), the rung and the guard bar (hidden, said as hidden) at "
        + "their next tick, the activity on the next frame; a frame that is not a wake changes nothing",
        () => before === 5 && quietOnly === before
              && wakeAm.key === true && wakeAm.contacts.length === ko.length && wakeAm.contacts.every((c) => Array.isArray(c.ring))
              && JSON.stringify(atWake) === '["nogo","model","chart_ink"]'
              && JSON.stringify(after) === '["nogo","model","chart_ink","ais_model","guard_level","guard"]'
              && W.get.lastActivity() === null && of(posts, "guard").pop().body.data.shown === false,
        () => before + " posts before; at the wake " + JSON.stringify(atWake) + "; after its tick " + JSON.stringify(after)
              + "; lastActivity " + JSON.stringify(W.get.lastActivity()));
}

// ---- 9. the LINES rows carry the coverage run -------------------------------------------------------------------- //
{
  const { W, mission } = world();
  mission.lines = [{ a: { lat: 1, lon: 1 }, b: { lat: 1, lon: 2 }, frac: 0.4567 }, { a: { lat: 1, lon: 1 }, b: { lat: 1, lon: 3 }, frac: 1 },
                   { frac: 0.5 }];
  const rows = W.lineRowsForLog();
  check("9. the LINES rows the log carries gain `done`: the share of each line's coverage actually RUN (lineDoneFrac, "
        + "2 dp) - which otherwise lives only in this browser - the table's own fields untouched",
        () => rows.length === 3 && rows[0].done === 0.46 && rows[1].done === 1 && rows[2].done === null
              && rows[0].len_m === 100 && rows[1].line === 2 && rows[0].actual_s === 30,
        () => JSON.stringify(rows));
}

// ---- 10. the wiring ---------------------------------------------------------------------------------------------- //
{
  const upd = grab("updateNogoUI"), on = grab("onState"), conn = grab("connect"), cg = grab("clearanceGuard");
  const tick = grab("logLinesTick"), lt = grab("logLineTable");
  check("10. WIRED, behind typeof guards (some thirty suites lift these functions with no stub for the new names): "
        + "updateNogoUI asks the model; onState asks the wake at the top and the rung on the guard's own frame, after the "
        + "line that follows clearanceGuard() (which clearance_guard.js 17 holds); connect() runs the 2 s tick; both LINES "
        + "posts carry the run coverage",
        () => /if\(typeof logNogoModel === "function"\) logNogoModel\(\);/.test(upd)
              && /checkBoot\(s\.boot_id\);[^\n]*\n\s*if\(typeof logWakeTick === "function"\) logWakeTick\(s\);/.test(on)
              && /\n\s*clearanceGuard\(\);\n\s*accumLineTime\(\)[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if\(typeof logGuardLevel === "function"\) logGuardLevel\(\);/.test(on)
              && /setInterval\(logModelTick, 2000\);/.test(conn)
              && /lines: lineRowsForLog\(\)/.test(tick) && /const lines=lineRowsForLog\(\)/.test(lt),
        () => "");
  // clearanceGuard keeps what its ladder saw on `clearance` - with ONLY names it already declares, because every suite
  // that lifts it (speed_modes.js has no stub for anything new) would throw a ReferenceError on a new one
  const rec = (cg.match(/\n[^\n]*clearance\.koFrame = [^\n]*\n(?:[^\n]*clearance\.[A-Za-z]+ = [^\n]*\n)*/) || [""])[0]
            + (cg.match(/\n[^\n]*clearance\.act = act;[^\n]*/) || [""])[0];
  const stash = [...rec.matchAll(/clearance\.([A-Za-z]+) = ([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  const declared = (n) => new RegExp("(const|let)\\s+(?:[\\w$]+\\s*=[^;]*?,\\s*)*" + n + "\\s*=").test(cg) || n === "nogo" || n === "clearance";
  const KEYWORDS = new Set(["null", "true", "false", "undefined"]);
  const names = [...new Set(stash.flatMap(([, rhs]) => (rhs.replace(/\.[A-Za-z_$][\w$]*/g, "").match(/[A-Za-z_$][\w$]*/g) || [])))]
    .filter((n) => !KEYWORDS.has(n));
  const need = ["entry", "onStation", "settling", "aisKo", "aisInReach", "aisReach", "aisCaused", "her", "koFrame", "act"];
  const have = stash.map(([k]) => k);
  const iPlan = cg.indexOf("clearance.onPlan = !!a.onPlan;"), iRec = cg.indexOf("clearance.koFrame = "),
        iAct = cg.indexOf("const act = "), iActRec = cg.indexOf("clearance.act = act;");
  check("10b. clearanceGuard records what its ladder saw on `clearance` - the entry, on station, settling, the AIS keep-outs "
        + "and those in reach, the reach, whether a contact caused it and which, the frame they are in, and whether it could "
        + "act - after the rung is set, with no name in it the function does not already declare",
        () => need.every((k) => have.includes(k)) && names.every(declared) && iPlan > 0 && iRec > iPlan && iActRec > iAct,
        () => "recorded: " + have.join(", ") + "; names read: " + names.join(", ")
              + (names.filter((n) => !declared(n)).length ? "; NOT DECLARED in clearanceGuard: " + names.filter((n) => !declared(n)).join(", ") : ""));
}

// ---- 12. a recorder never takes a frame down --------------------------------------------------------------------- //
{
  const { W, posts, env } = world();
  W.set.chartInk({ key: "k12", z: 16, ms: 1, busy: false, note: null, detached: [], areas: [],
                   lines: [{ a: { lat: 21.3, lon: -157.88 }, b: { lat: 21.301, lon: -157.88 } }] });
  env.drThrows = true;                                          // the model's own record throws
  let threwModel = null;
  try { W.updateNogoUI(); } catch (e) { threwModel = e.message; }
  const model = of(posts, "model").length, ink = of(posts, "chart_ink").length;
  env.drThrows = false; env.supThrows = true;                   // the supervision question itself throws
  const before = posts.length; let threwSup = null;
  try { W.logNogoModel(); W.logAisModel(); W.logGuardLevel(); W.logModelTick(); } catch (e) { threwSup = e.message; }
  const supPosts = posts.length - before;
  const R = world();                                            // the rung's record throws half way through its payload
  const cl = liveClearance({ level: "hold", kind: "a pier" });
  cl.entry = Object.defineProperty({ n: 0 }, "e", { get() { throw new Error("entry threw"); } });
  R.W.set.clearance(cl);
  let threwRung = null;
  try { R.W.logGuardLevel(); } catch (e) { threwRung = e.message; }
  check("12. a recorder never takes a frame down: a model record that throws inside updateNogoUI is caught there, and "
        + "the chart ink is still posted; a supervising() that throws posts nothing (it is not a yes); a rung record that "
        + "throws is caught inside onState's call",
        () => threwModel === null && model === 0 && ink === 1 && threwSup === null && supPosts === 0 && threwRung === null,
        () => JSON.stringify({ threwModel, model, ink, threwSup, supPosts, threwRung }));
}

// ---- 11. no record field is overwritten -------------------------------------------------------------------------- //
{
  const NEW = new Set(["model", "chart_ink", "ais_model", "guard_level"]);
  const mine = ALL_POSTS.filter((p) => NEW.has(p.body.kind));
  const bad = mine.filter((p) => p.body.data && ["t", "iso", "kind"].some((k) => k in p.body.data));
  check("11. no payload of the four streams carries a top-level t, iso or kind - the server writes client data FLAT onto "
        + "{t, iso, kind}, so any of them would overwrite the record's own",
        () => mine.length >= 20 && bad.length === 0 && new Set(mine.map((p) => p.body.kind)).size === 4,
        () => mine.length + " posts of the four kinds checked" + (bad.length ? "; offending: " + JSON.stringify(bad.map((p) => [p.body.kind, Object.keys(p.body.data)])) : ""));
}

// ---- 13. EVERY post names its tab, and a stall or a sleep names its window -------------------------------------- //
// Andy's 19:29 stall on 2026-11-05 came with an EMPTY context (no waypoints, no run, zoom 13): the controls window, which
// runs the same watchdog - and the posts that build their own body (page_stall, page_asleep, activity, guard_override...)
// went out with no X-ASV-Client, so the record could not say which window it was.
{
  const sites = [];
  for (let k = H.indexOf('fetch("/api/logevent"'); k >= 0; k = H.indexOf('fetch("/api/logevent"', k + 1))
    sites.push(H.slice(k, k + 160));
  const bare = sites.filter((s) => !/typeof logHeaders === "function" \? logHeaders\(\)/.test(s) && !/\{method:"POST", headers, body/.test(s));
  const run = (pre, post) => new Function(`"use strict"; ${pre} ${grab("logHeaders")} let r, err = null;
    try { r = logHeaders(); } catch (e) { err = e.message; } ${post} return { r, err };`)();
  const withId = run('const CLIENT_ID = "tab-77";', "");
  const noId = run("", "");
  const tdz = run("", 'const CLIENT_ID = "late";');            // the const's own line has not run yet
  const ctxOf = (role) => new Function(`"use strict"; ${role ? `const UIROLE = "${role}";` : ""}
    const mission = { waypoints: [], lines: [], boundary: [] }, nogo = { ko: {} }, pat = {}, patClip = [], runRoute = [],
          track = [], zoom = 13, S = {}, actionLog = [], mode = "pan";
    ${grab("stallContext")} return stallContext(2000);`)();
  const slept = grab("supervisorSlept").match(/kind:"page_asleep"[\s\S]*?\}\}\)/g) || [];
  check("13. every log post names its tab - logClient's and the eleven that build their own body (logHeaders(), behind a "
        + "typeof for the suites that lift them alone), the header read safely with no CLIENT_ID or inside its TDZ - and "
        + "a stall or a sleep says which WINDOW (UIROLE), so the controls window's stall is not read as the chart's",
        () => sites.length >= 12 && bare.length === 0
              && withId.err === null && withId.r["X-ASV-Client"] === "tab-77" && withId.r["Content-Type"] === "application/json"
              && noId.err === null && !("X-ASV-Client" in noId.r) && tdz.err === null && !("X-ASV-Client" in tdz.r)
              && ctxOf("controls").role === "controls" && ctxOf(null).role === null
              && slept.length === 2 && slept.every((s) => /role: \(typeof UIROLE === "string" \? UIROLE : null\)/.test(s)),
        () => sites.length + " post sites, " + bare.length + " bare" + (bare.length ? ": " + bare[0].slice(0, 90) : "")
              + "; tdz " + JSON.stringify(tdz) + "; role " + ctxOf("controls").role + "; page_asleep literals " + slept.length);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
