// tests/trail_backfill.js - the trail a sleeping chart page missed is filled in from the console (2026-10-17).
//
// Andy, with a screenshot of his New Castle survey: "When the chart window is offscreen, the path history does not load
// when it comes back. This is misleading to the viewer. The playback does show the path generating." The trail is laid
// from the frames the page handles, and a page the browser has frozen handles none - the console drops what a sleeping
// subscriber does not read - so the trail stopped on one line and took up again lines later, one straight chord across
// the pattern between, and the lines surveyed meanwhile were drawn as if never run. The console now keeps her track this
// boot (asv_console.py TrackHistory, every 2 m) and stamps each frame with its clock (server_t); the page's layTrack asks
// GET /api/track for the stretch between two frames more than TRACK_GAP_S apart, or between the trail it restored and its
// first frame, and trackBackfill lays it in by time.
//
//   1   THE REPORT: a boat on a line, the page asleep for a minute: it asks once, for exactly the stretch it missed, and
//       the answer leaves the trail with no chord - no step longer than the console's own;
//   2   an unbroken stream asks nothing, a gap of TRACK_GAP_S asks nothing, a gap just over it asks once;
//   3   A RELOAD: the trail stored with the time of its last frame, a page loaded ten minutes later asks for those ten
//       minutes and lays them after the restored points (which carry no time) and before its own;
//   4   NOTHING THROWN AWAY COMES BACK, AND NOTHING FOREIGN GOES IN: a clear or a new boot while the answer is out, an
//       answer for another boot, points outside the stretch asked for, a cleared (empty) trail, an older console's frames
//       with no server_t;
//   5   two stretches answered out of order each land in their place;
//   6   a console that does not answer, or answers nonsense, leaves the trail as it was;
//   7   THE WIRING, both ends: onState lays the trail through layTrack with the frame's server_t, the stored copy keeps its
//       time, the page asks /api/track by boot, since and until; the console stamps server_t, keeps the track every
//       TRACK_STEP_M of the page's, as many points as MAX_TRACK, feeds it from the telemetry loop and serves it.
//
// TEETH (2026-10-17, scratchpad perf/mutate_trail.py): 12 mutants of the page's half, 10 caught; the 2 left are one
// EQUIVALENT PAIR - a clear both empties the trail and forgets its time (clearTrack), and layTrack asks only with a
// trail and a time, so either guard alone holds: a clear that kept the time is stopped by the empty trail, a missing
// empty-trail test by the time forgotten. The console's half: tests/track_history.py, 7 of 7.
//
// DRIVEN: the page's own trail block (TRACK_KEY through checkBoot and loadTrack, with layTrack and trackBackfill in it),
// called the way onState calls it, against a stand-in console whose answers the test releases, in any order.
//
//   node tests/trail_backfill.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const G = require("../static/js/geodesy.js");

const H = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8").split("\r\n").join("\n");
const PY = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");

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
function between(a, b) {
  const i = H.indexOf(a); if (i < 0) throw new Error("test setup: anchor gone: " + JSON.stringify(a));
  const j = H.indexOf(b, i); if (j < 0) throw new Error("test setup: anchor gone: " + JSON.stringify(b));
  return H.slice(i, j);
}

const TRACK_BLOCK = between("const TRACK_KEY =", "let asv = null;");
const MAX_TRACK = Number(/MAX_TRACK\s*=\s*(\d+)/.exec(H)[1]);
const TRACK_STEP_M = Number(/TRACK_STEP_M\s*=\s*(\d+(?:\.\d+)?)/.exec(H)[1]);
const TRACK_GAP_S = Number(/const TRACK_GAP_S\s*=\s*(\d+(?:\.\d+)?)/.exec(H)[1]);
const KEY = "asv_track_v1";
const tick = () => new Promise((r) => setImmediate(r));

function makeStore() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); },
           removeItem: (k) => { map.delete(k); } };
}
// The page's trail block in a world of its own; `fetch` hands each request to the test, which answers it when it likes.
function makeWorld(store) {
  const asks = [];
  const fetchStub = (url) => new Promise((resolve, reject) => {
    const q = Object.fromEntries(new URL(url, "http://console").searchParams);
    asks.push({ url, q, answer: (body) => resolve({ json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)) }),
                fail: () => reject(new Error("the console did not answer")) });
  });
  const body = [
    "\"use strict\";",
    "let asv = null, renders = 0;",
    "function render(){ renders++; }",
    "function giveUpRoute(){}",
    grab("lsGet"), grab("lsSet"), grab("lsDel"),
    "const MAX_TRACK = " + MAX_TRACK + ";",
    TRACK_BLOCK,
    // onState's own order: checkBoot, then the fix laid
    "function __frame(boot, pos, ft){ checkBoot(boot); if(!pos) return; asv = pos; layTrack(asv, ft); }",
    "return { frame: __frame, clearTrack, flushTrack, decodeTrack,",
    "         get track(){ return track; }, get renders(){ return renders; } };",
  ].join("\n");
  const w = new Function("localStorage", "distTo", "setTimeout", "clearTimeout", "fetch", body)(
    store, G.distTo, () => 0, () => {}, fetchStub);
  w.asks = asks; w.store = store;
  return w;
}

// THE BOAT: east along a line from REF at 7 kn; where she is at console time t, and the console's track of her - a
// point every TRACK_STEP_M - strictly between t0 and t1, as TrackHistory would hand it
const REF = { lat: 43.06, lon: -70.69 }, V = 7 * 0.514444, T0 = 1.79e9;
const posAt = (t) => G.fromEN((t - T0) * V, 0, REF);
function consoleTrack(t0, t1) {
  const out = [];
  for (let k = 0; ; k++) {
    const t = T0 + (k * TRACK_STEP_M) / V;
    if (t >= t1) break;
    if (t > t0) { const p = posAt(t); out.push([Math.round(t * 1000) / 1000, p.lat, p.lon]); }
  }
  return out;
}
// frames every 0.25 s from t0 to t1 (console time), boot "boot-A"
function run(W, t0, t1, boot) { for (let t = t0; t <= t1 + 1e-9; t += 0.25) W.frame(boot || "boot-A", posAt(t), Math.round(t * 1000) / 1000); }
const longestStep = (tr) => { let m = 0; for (let i = 1; i < tr.length; i++) m = Math.max(m, G.distTo(tr[i - 1], tr[i])); return m; };
const inTimeOrder = (tr) => { let last = -Infinity; for (const p of tr) { if (p.t == null) continue; if (p.t < last) return false; last = p.t; } return true; };
// answer an ask if it was made (a page that never asks must FAIL a check, not crash the suite)
const answer = (ask, body) => { if (ask) ask.answer(body); };
const refuse = (ask) => { if (ask) ask.fail(); };
const stored = (store) => { const raw = store.getItem(KEY); return raw == null ? null : JSON.parse(raw); };

(async () => {
  console.log("The trail a sleeping page missed is filled in from the console:");

  // 1. THE REPORT
  const S1 = makeStore(), W1 = makeWorld(S1);
  run(W1, T0, T0 + 60);                                   // a minute on the line, on screen
  const beforeSleep = W1.track.length;
  run(W1, T0 + 120, T0 + 130);                            // the page asleep from T0+60 to T0+120, then awake
  const chord = longestStep(W1.track), asked1 = W1.asks.length, q1 = W1.asks[0] && W1.asks[0].q;
  if (q1) answer(W1.asks[0], { boot_id: "boot-A", points: consoleTrack(Number(q1.since), Number(q1.until)) });
  await tick();
  W1.flushTrack();
  const st1 = stored(S1);
  check("1. THE REPORT: asleep for a minute on the line, the page asks ONCE, for exactly the stretch it missed (its last "
        + "frame to its first frame back, by its boot), and the console's answer leaves no chord - no step longer than the "
        + "console's own, the trail in time order and stored whole with the time of its last frame",
        () => asked1 === 1 && q1.boot === "boot-A" && Number(q1.since) === T0 + 60 && Number(q1.until) === T0 + 120
              && chord > 200 && longestStep(W1.track) < TRACK_STEP_M * 1.5 && inTimeOrder(W1.track)
              && W1.track.length > beforeSleep + 100 && st1 && st1.t === T0 + 130 && W1.decodeTrack(st1.d).length === W1.track.length
              && W1.renders >= 1,
        () => JSON.stringify({ asked1, q1, chordBefore: Math.round(chord), longestAfter: +longestStep(W1.track).toFixed(2),
                               points: [beforeSleep, W1.track.length], storedT: st1 && st1.t }));

  // 2. when it asks
  const W2 = makeWorld(makeStore());
  run(W2, T0, T0 + 300);
  const unbroken = W2.asks.length;
  W2.frame("boot-A", posAt(T0 + 300 + TRACK_GAP_S), T0 + 300 + TRACK_GAP_S);
  const atGap = W2.asks.length;
  W2.frame("boot-A", posAt(T0 + 303 + TRACK_GAP_S + 0.5), T0 + 303 + TRACK_GAP_S + 0.5);
  const overGap = W2.asks.length;
  check("2. five minutes of an unbroken stream asks nothing; a gap of TRACK_GAP_S (" + TRACK_GAP_S + " s) asks nothing; "
        + "one just over it asks once",
        () => unbroken === 0 && atGap === 0 && overGap === 1,
        () => JSON.stringify({ unbroken, atGap, overGap }));

  // 3. A RELOAD
  const S3 = makeStore(), W3a = makeWorld(S3);
  run(W3a, T0, T0 + 30);
  W3a.flushTrack();
  const restoredN = W3a.track.length;
  const W3 = makeWorld(S3);                                // the page loaded again, ten minutes on
  const restored = W3.track.length;
  run(W3, T0 + 630, T0 + 632);
  const q3 = W3.asks[0] && W3.asks[0].q;
  if (q3) answer(W3.asks[0], { boot_id: "boot-A", points: consoleTrack(Number(q3.since), Number(q3.until)) });
  await tick();
  const firstNew = W3.track.findIndex((p) => p.t != null);
  check("3. A RELOAD: the trail stored with the time of its last frame; the page loaded ten minutes on restores it, asks "
        + "for those ten minutes, and lays them AFTER the restored points (no time of their own) and before its own - no "
        + "chord",
        () => restored === restoredN && W3.asks.length === 1 && Number(q3.since) === T0 + 30 && Number(q3.until) === T0 + 630
              && firstNew === restored && longestStep(W3.track) < TRACK_STEP_M * 1.5 && inTimeOrder(W3.track),
        () => JSON.stringify({ restored, asks: W3.asks.length, q3, firstNew, longest: +longestStep(W3.track).toFixed(2) }));

  // 4. nothing thrown away comes back, nothing foreign goes in
  const gapThen = async (mk, act) => { const W = makeWorld(makeStore()); run(W, T0, T0 + 20); run(W, T0 + 80, T0 + 81);
    const n0 = W.track.length, q = W.asks[0] && W.asks[0].q; await mk(W, q); await tick(); return { W, n0, laid: act(W, n0) }; };
  const cleared = await gapThen(async (W, q) => { W.clearTrack(); if (q) answer(W.asks[0], { boot_id: "boot-A", points: consoleTrack(+q.since, +q.until) }); },
                                (W) => W.track.length);
  const reboot = await gapThen(async (W, q) => { W.frame("boot-B", posAt(T0 + 82), T0 + 82);
                                                  if (q) answer(W.asks[0], { boot_id: "boot-A", points: consoleTrack(+q.since, +q.until) }); },
                               (W) => W.track.length);
  const otherBoot = await gapThen(async (W, q) => { if (q) answer(W.asks[0], { boot_id: "boot-Z", points: consoleTrack(+q.since, +q.until) }); },
                                  (W, n0) => W.track.length - n0);
  const outside = await gapThen(async (W, q) => {
    if (q) answer(W.asks[0], { boot_id: "boot-A", points: [[+q.since, 0, 0], [+q.since - 5, 1, 1], [+q.until, 2, 2], [+q.until + 9, 3, 3],
                                                   [(+q.since + +q.until) / 2, posAt(T0 + 50).lat, posAt(T0 + 50).lon]] }); },
                                (W, n0) => W.track.length - n0);
  const WE = makeWorld(makeStore()); run(WE, T0, T0 + 10); WE.clearTrack(); run(WE, T0 + 90, T0 + 91);
  const WO = makeWorld(makeStore()); for (let t = T0; t < T0 + 10; t += 0.25) WO.frame("boot-A", posAt(t));
  WO.frame("boot-A", posAt(T0 + 300));
  check("4. NOTHING THROWN AWAY COMES BACK, NOTHING FOREIGN GOES IN: a trail cleared while the answer was out, or a new "
        + "boot meanwhile, lays nothing; an answer for another boot lays nothing; of points at and outside the stretch "
        + "only the one strictly inside is laid; a cleared trail with a gap after it asks nothing; an older console's "
        + "frames (no server_t) ask nothing",
        () => cleared.laid === 0 && reboot.laid === 1 && reboot.W.track[0].t === T0 + 82   // only the new boot's own fix
              && otherBoot.laid === 0 && outside.laid === 1
              && WE.asks.length === 0 && WO.asks.length === 0,
        () => JSON.stringify({ cleared: cleared.laid, reboot: reboot.laid, otherBoot: otherBoot.laid, outside: outside.laid,
                               clearedAsks: WE.asks.length, oldConsoleAsks: WO.asks.length }));

  // 5. two stretches answered out of order
  const W5 = makeWorld(makeStore());
  run(W5, T0, T0 + 10); run(W5, T0 + 40, T0 + 50); run(W5, T0 + 90, T0 + 100);
  const [a5, b5] = W5.asks;
  if (b5) answer(b5, { boot_id: "boot-A", points: consoleTrack(+b5.q.since, +b5.q.until) }); await tick();
  if (a5) answer(a5, { boot_id: "boot-A", points: consoleTrack(+a5.q.since, +a5.q.until) }); await tick();
  check("5. two stretches missed, the later answered first: each lands in its place - the trail in time order, no chord",
        () => W5.asks.length === 2 && inTimeOrder(W5.track) && longestStep(W5.track) < TRACK_STEP_M * 1.5,
        () => JSON.stringify({ asks: W5.asks.length, ordered: inTimeOrder(W5.track), longest: +longestStep(W5.track).toFixed(2) }));

  // 6. no answer, or nonsense
  const W6 = makeWorld(makeStore());
  run(W6, T0, T0 + 10); run(W6, T0 + 60, T0 + 61); run(W6, T0 + 120, T0 + 121); run(W6, T0 + 180, T0 + 181);
  const n6 = W6.track.length;
  refuse(W6.asks[0]); answer(W6.asks[1], new Error("not JSON")); answer(W6.asks[2], { boot_id: "boot-A", points: "nonsense" });
  await tick(); await tick();
  check("6. a console that does not answer, answers what is not JSON, or answers nonsense leaves the trail as it was",
        () => W6.asks.length === 3 && W6.track.length === n6,
        () => JSON.stringify({ asks: W6.asks.length, before: n6, after: W6.track.length }));

  // 7. the wiring, both ends
  const pyStep = Number((/^TRACK_HISTORY_STEP_M = ([\d.]+)/m.exec(PY) || [])[1]);
  const pyMax = Number((/^TRACK_HISTORY_MAX = (\d+)/m.exec(PY) || [])[1]);
  check("7. THE WIRING: onState lays the trail through layTrack with the frame's server_t; the stored copy keeps its time and "
        + "a reload reads it; the page asks /api/track by boot, since and until; the console stamps server_t on every frame, "
        + "keeps her track at the page's step and length, feeds it from the telemetry loop and serves it",
        () => /\n    layTrack\(asv, s\.server_t\);/.test(H)
              && /JSON\.stringify\(\{bootId:sessionBootId, t:trackFrameT,/.test(H) && /savedTrackT = Number\.isFinite\(raw\.t\)/.test(H)
              && /fetch\("\/api\/track\?boot=" \+ encodeURIComponent\(boot\) \+ "&since=" \+ t0 \+ "&until=" \+ t1/.test(grab("trackBackfill"))
              && /"server_t": round\(time\.time\(\), 3\)/.test(PY) && pyStep === TRACK_STEP_M && pyMax === MAX_TRACK
              && /TRACK_HISTORY\.note\(self\.boot_id, time\.time\(\), telem\["lat_deg"\], telem\["lon_deg"\]\)/.test(PY)
              && /TRACK_HISTORY\.between\(boot, since, until\)/.test(PY),
        () => "console step " + pyStep + " / page " + TRACK_STEP_M + ", console cap " + pyMax + " / page " + MAX_TRACK);

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
