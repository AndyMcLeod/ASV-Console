// tests/trail_persist.js - the trail is saved while the boat moves, and a long day of it is kept (review #21, 2026-09-15).
//
// Andy: "The trail isn't saved while the boat is moving, and only about 4 km is kept. The browser-storage copy saves
// only after 800 ms without a new point. Above about 1.5 kn a point arrives every 0.75 s or sooner, so it never saves.
// A reload mid-survey loses the trail back to the last slow-down."
// saveTrack was a DEBOUNCE, so a moving boat never wrote; a point was laid every 5e-6 degrees and 8,000 were kept. Now
// the write is a THROTTLE flushed when the page is hidden or unloaded, a point is laid every TRACK_STEP_M and MAX_TRACK
// are kept (80 km - his longest boot in 189 session logs laid 68 km), stored as microdegree deltas, and a write that
// does not fit keeps the newest part of the trail.
// And a long trail is DRAWN by what shows (trailScreenPath): each point caches its zoom-0 world position, and sub-pixel
// and off-view vertices are left out.
// DRIVEN: the page's own trail block (TRACK_KEY through checkBoot and loadTrack), onState's own append, the two lines
// that wire the flush to the page's events, and trailScreenPath - over a fake clock, a store that can refuse a write
// for its size or refuse every write, and a flat stand-in for worldPx.
//
//   node tests/trail_persist.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 25 sidecar mutations RUN against this suite and spawn_trail.js together, 24 caught, 1 equivalent:
//   the debounce restored (the fault) -> 1, 1b, 2, 10    flushTrack does nothing -> 3, 6, 7, 8, 11
//   flushTrack writes with nothing pending -> 3          the step back in degrees -> 1, 4
//   the cap back to 8000 -> 5, 7                         the old {lat,lon} storage shape -> 6
//   a quota error gives up -> 7                          storage off retried per halving -> 8
//   the pre-#21 shape no longer loads -> 9 (spawn 7)     damage decoded as NaN points -> 9
//   no flush on pagehide -> 11                           visibilitychange flushes when visible -> 11
//   clearTrack leaves the timer handle -> 10             writeTrack leaves the timer handle -> 1, 1b, 2, 3
//   encoded to a meter (1e5) -> 1, 6, 7                  the stored copy keeps the OLDEST that fits -> 7
//   the boot id not stored -> 2                          every render projects every point (no cache) -> 13
//   positions cached at the zoom drawn -> 12, 13         no pixel rule -> 12
//   the edge rule tests two points, not three -> 13b     the boat's end can be left out -> 12, 13
//   drawn at zoom 0's scale -> 12, 13                    render draws every point again -> 14
//   EQUIVALENT: clearTrack does not cancel the armed write - writeTrack writes nothing for an empty trail, so the
//   write that fires after a clear has nothing to put back (see spawn_trail.js's TEETH note).
// ⚠ THREE FIXTURE MISTAKES, ALL MINE, CAUGHT BY THE FIRST RUN: a boat 0.9 m a frame lays a point every THIRD frame
// (2.7 m, not 2 m - the step is met on a frame, not between them); a "within a meter" wander drawn as a Lissajous
// spanned 2.5 m; and points exactly 2.000 m apart are a floating-point coin toss against `>= 2`.
//
// LIVE (port 8796, a temp copy running Andy's Eastport plan, the boat on line 1 at 6.9 kn): the stored copy stayed
// within 1-3 points of the trail on screen for 40 s; 170 points on screen immediately before a mid-run reload, 170
// restored at load (a probe at loadTrack). The page before this change, same console: 105 on screen, 65 restored -
// its stored copy sat unchanged for 15 s at a time, written only when a frame happened to arrive late. With 40,000
// points restored, drawing the trail cost 12.9 ms a render (median, zoom 13) before trailScreenPath, 6.6 ms with the
// pixel and edge rules, and 2.1 ms (zoom 13) / 2.3 ms (17) / 2.6 ms (19) with the cached projection.
//
// NOTE: the page's script is <script type="module">, which runs STRICT; the lifted code runs in a strict function here.

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

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

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
function between(a, b) {
  const i = H.indexOf(a); if (i < 0) throw new Error("test setup: anchor gone: " + JSON.stringify(a));
  const j = H.indexOf(b, i); if (j < 0) throw new Error("test setup: anchor gone: " + JSON.stringify(b));
  return H.slice(i, j);
}

console.log("The trail is saved while the boat moves, and a long day of it is kept:");

const TRACK_BLOCK = between("const TRACK_KEY =", "let asv = null;");
const PUSH = between("    const last = track[track.length-1];", "\n    }") + "\n    }";   // onState's own append
const WIRING = between("let asv = null;", "\n\n");                                          // the flush's two listeners
const MAX_TRACK = Number(/MAX_TRACK\s*=\s*(\d+)/.exec(H)[1]);
const TRACK_SAVE_MS = Number(/TRACK_SAVE_MS\s*=\s*(\d+)/.exec(H)[1]);
const TRACK_STEP_M = Number(/TRACK_STEP_M\s*=\s*(\d+(?:\.\d+)?)/.exec(H)[1]);
const KEY = "asv_track_v1";

// ── a clock that only moves when told ─────────────────────────────────────────────────────────────────────────────
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    get now() { return now; },
  };
}
// ── a store: `limit` refuses a value over that many characters as a quota error; `blocked` refuses everything ────────
function makeStore(opts) {
  const map = new Map();
  const s = {
    map, sets: 0, writesAt: [], limit: (opts && opts.limit) || Infinity, blocked: !!(opts && opts.blocked), clock: null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      s.sets++;
      if (s.blocked) { const e = new Error("The operation is insecure."); e.name = "SecurityError"; throw e; }
      if (String(v).length > s.limit) { const e = new Error("Setting the value exceeded the quota."); e.name = "QuotaExceededError"; throw e; }
      map.set(k, String(v)); if (s.clock) s.writesAt.push(s.clock.now);
    },
    removeItem: (k) => { map.delete(k); },
  };
  return s;
}
function makeWorld(store, clock) {
  store.clock = clock;
  const events = {}, doc = { visibilityState: "visible", events: {},
    addEventListener(t, f) { doc.events[t] = f; } };
  const body = [
    "\"use strict\";",
    "let renders = 0;",
    "function render(){ renders++; }",
    grab("lsGet"), grab("lsSet"), grab("lsDel"),
    "const MAX_TRACK = " + MAX_TRACK + ";",
    TRACK_BLOCK,
    WIRING,
    "function __push(a){ asv = a;\n" + PUSH + "\n}",
    "return { checkBoot, clearTrack, saveTrack, flushTrack, writeTrack, encodeTrack, decodeTrack, push: __push,",
    "         get track(){ return track; }, get savedBootId(){ return savedBootId; } };",
  ].join("\n");
  const w = new Function("localStorage", "distTo", "setTimeout", "clearTimeout", "addEventListener", "document", body)(
    store, G.distTo, clock.setTimeout, clock.clearTimeout, (t, f) => { events[t] = f; }, doc);
  w.events = events; w.doc = doc; w.store = store; w.clock = clock;
  return w;
}
const stored = (store) => { const raw = store.getItem(KEY); if (raw == null) return null; const o = JSON.parse(raw);
  return typeof o.d === "string" ? { bootId: o.bootId, pts: W0.decodeTrack(o.d), chars: raw.length } : { bootId: o.bootId, pts: o.track, chars: raw.length }; };
const worst = (a, b) => { let m = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, G.distTo(a[i], b[i])); return m; };
const REF = { lat: 44.9, lon: -66.98 };
const W0 = makeWorld(makeStore(), makeClock());       // a world only for decodeTrack in `stored`

// A boat at `kn` along a straight east-going line from REF, one telemetry frame every 250 ms, boot "boot-A".
function run(W, kn, seconds, fromE) {
  const v = kn * 0.514444;
  let e = fromE || 0;
  for (let t = 0; t < seconds * 1000; t += 250) {
    W.clock.advance(250); e += v * 0.25;
    W.checkBoot("boot-A"); W.push(G.fromEN(e, 0, REF));
  }
  return e;
}

// 1. THE REPORT
const S1 = makeStore(), W1 = makeWorld(S1, makeClock());
run(W1, 7, 60);
const s1 = stored(S1);
check("1. THE REPORT: a boat at 7 kn - a point every 0.75 s, well inside the old wait - is written while it moves: once "
      + "every TRACK_SAVE_MS, each write carrying the trail up to it",
      () => S1.sets >= Math.floor(60000 / TRACK_SAVE_MS) - 1 && s1 && s1.pts.length >= W1.track.length - Math.ceil(TRACK_SAVE_MS / 750)
            && worst(s1.pts, W1.track) < 0.12,
      () => S1.sets + " writes in 60 s (every " + TRACK_SAVE_MS + " ms); stored " + (s1 ? s1.pts.length : 0) + " of "
            + W1.track.length + " points, worst " + (s1 ? worst(s1.pts, W1.track).toFixed(3) : "-") + " m");

// 1b. a throttle, not a debounce: a point every 100 ms still writes at TRACK_SAVE_MS after the first
const S1b = makeStore(), C1b = makeClock(), W1b = makeWorld(S1b, C1b);
for (let i = 0; i < 100; i++) { C1b.advance(100); W1b.checkBoot("boot-A"); W1b.push(G.fromEN(3 * i, 0, REF)); }
check("1b. it is a THROTTLE, not a debounce: points every 100 ms for 10 s are written TRACK_SAVE_MS after the first one, "
      + "and again on the same beat",
      () => S1b.writesAt.length >= 3 && S1b.writesAt[0] === 100 + TRACK_SAVE_MS && S1b.writesAt[1] - S1b.writesAt[0] <= TRACK_SAVE_MS + 100,
      () => "writes at " + S1b.writesAt.join(", ") + " ms (first point at 100 ms)");

// 2. a reload keeps it
const W2 = makeWorld(S1, makeClock());
W2.checkBoot("boot-A");
check("2. a reload mid-run keeps the trail: the page restores every stored point under the same boot, and the boot check "
      + "leaves it alone",
      () => W2.track.length === s1.pts.length && W2.track.length > 50 && W2.savedBootId === "boot-A" && worst(W2.track, s1.pts) === 0,
      () => "restored " + W2.track.length + " of " + s1.pts.length + " stored, boot " + W2.savedBootId);

// 3. the flush
const S3 = makeStore(), W3 = makeWorld(S3, makeClock());
run(W3, 7, 10);                                       // writes at 3, 6, 9 s; the points after 9 s are pending
const before3 = S3.sets;
W3.flushTrack();
const s3 = stored(S3), after3 = S3.sets;
W3.flushTrack();
check("3. flushTrack writes the pending points AT ONCE - the stored trail is the whole trail - and with nothing pending it "
      + "writes nothing",
      () => after3 === before3 + 1 && s3.pts.length === W3.track.length && S3.sets === after3,
      () => "flush wrote " + (after3 - before3) + "; stored " + s3.pts.length + " of " + W3.track.length
            + "; a second flush wrote " + (S3.sets - after3));

// 4. the step. A point lands on the first FRAME at or past TRACK_STEP_M from the last one, so at 7 kn (0.90 m a frame)
// the spacing is three frames, 2.7 m: every gap is at least the step and short of the step plus one frame's travel.
const S4 = makeStore(), W4 = makeWorld(S4, makeClock());
const e4 = run(W4, 7, 1000 / (7 * 0.514444));       // one kilometer
const gaps4 = W4.track.slice(1).map((p, i) => G.distTo(W4.track[i], p)), frameM = 7 * 0.514444 * 0.25;
const S4b = makeStore(), C4b = makeClock(), W4b = makeWorld(S4b, C4b);
for (let i = 0; i < 2400; i++) {                     // ten minutes holding station, wandering inside a 0.9 m circle
  C4b.advance(250); W4b.checkBoot("boot-A");
  const r = 0.9 * Math.abs(Math.sin(i * 0.37)), th = i * 0.23;
  W4b.push(G.fromEN(r * Math.cos(th), r * Math.sin(th), REF));
}
check("4. a point is laid once the boat is TRACK_STEP_M from the last one - every gap over a kilometer at 7 kn is at "
      + "least the step and less than the step plus a frame - and a boat holding station inside a 0.9 m circle lays no "
      + "more than its first",
      () => gaps4.length > 300 && Math.min(...gaps4) >= TRACK_STEP_M && Math.max(...gaps4) < TRACK_STEP_M + frameM
            && W4b.track.length === 1,
      () => Math.round(e4) + " m run: " + W4.track.length + " points, gaps " + Math.min(...gaps4).toFixed(2) + "-"
            + Math.max(...gaps4).toFixed(2) + " m; ten minutes holding: " + W4b.track.length + " point(s)");

// 5-6. the length and the stored size
const S5 = makeStore(), W5 = makeWorld(S5, makeClock());
const TOTAL = MAX_TRACK + 5000, STEP5 = TRACK_STEP_M + 0.01;   // just over the step: exactly on it is a rounding coin toss
for (let i = 0; i < TOTAL; i++) { W5.checkBoot("boot-A"); W5.push(G.fromEN(i * STEP5, (i % 2000) < 1000 ? 0 : 20, REF)); }
const last5 = W5.track[W5.track.length - 1], first5 = W5.track[0];
const eFirst = G.toEN(first5, REF).e, eLast = G.toEN(last5, REF).e;
check("5. a run longer than the cap keeps the NEWEST " + (MAX_TRACK * TRACK_STEP_M / 1000) + " km - the boat's end of it - "
      + "which covers the longest boot in Andy's logs (68 km)",
      () => W5.track.length === MAX_TRACK && Math.abs(eLast - (TOTAL - 1) * STEP5) < 0.5
            && Math.abs(eFirst - 5000 * STEP5) < 0.5 && MAX_TRACK * TRACK_STEP_M >= 68000,
      () => W5.track.length + " points from " + Math.round(eFirst) + " m to " + Math.round(eLast) + " m along the run");
W5.flushTrack();
W5.saveTrack(); W5.flushTrack();
const s5 = stored(S5), oldShape = JSON.stringify({ bootId: "boot-A", track: W5.track }).length;
check("6. that whole trail is stored compactly - a fraction of the old shape's size - and comes back within 0.12 m at "
      + "every point",
      () => s5 && s5.pts.length === MAX_TRACK && s5.chars * 5 < oldShape && worst(s5.pts, W5.track) < 0.12,
      () => s5 && ("stored " + Math.round(s5.chars / 1024) + " KB against " + Math.round(oldShape / 1024)
                   + " KB as {lat,lon} JSON; worst round trip " + worst(s5.pts, W5.track).toFixed(3) + " m"));

// 7. a write that does not fit
const S7 = makeStore({ limit: 60000 }), W7 = makeWorld(S7, makeClock());
for (let i = 0; i < 20000; i++) { W7.checkBoot("boot-A"); W7.push(G.fromEN(i * TRACK_STEP_M, 0, REF)); }
W7.flushTrack(); W7.saveTrack(); W7.flushTrack();
const s7 = stored(S7);
check("7. a write the store refuses for its size keeps the NEWEST part of the trail that fits - the boat's end - not "
      + "nothing",
      () => s7 && s7.pts.length > 1000 && s7.pts.length < W7.track.length && s7.chars <= 60000
            && G.distTo(s7.pts[s7.pts.length - 1], W7.track[W7.track.length - 1]) < 0.12
            && G.distTo(s7.pts[0], W7.track[W7.track.length - s7.pts.length]) < 0.12,
      () => s7 ? ("kept the newest " + s7.pts.length + " of " + W7.track.length + " points in " + s7.chars + " chars")
               : "nothing stored");

// 8. storage switched off
const S8 = makeStore({ blocked: true }), W8 = makeWorld(S8, makeClock());
for (let i = 0; i < 5000; i++) { W8.checkBoot("boot-A"); W8.push(G.fromEN(i * TRACK_STEP_M, 0, REF)); }
let threw8 = null;
const sets8 = S8.sets;
try { W8.saveTrack(); W8.flushTrack(); } catch (e) { threw8 = e; }
check("8. with storage switched off a write is tried ONCE, not once per halving, and nothing escapes into the frame",
      () => threw8 === null && S8.sets - sets8 === 1,
      () => "tries " + (S8.sets - sets8) + ", threw " + (threw8 ? threw8.message : "nothing"));

// 9. what an older build left, and damage
const OLD = [{ lat: 44.90, lon: -66.98 }, { lat: 44.9001, lon: -66.9801 }, { lat: 44.9002, lon: -66.9802 }];
const legacy = (v) => { const s = makeStore(); s.map.set(KEY, JSON.stringify(v)); const w = makeWorld(s, makeClock()); return w; };
const Wtag = legacy({ bootId: "boot-A", track: OLD }), Warr = legacy(OLD);
let W9dmg = null, threw9 = null;
try { W9dmg = legacy({ bootId: "boot-A", d: "44900000,-66980000,100,-100,x,5,7,7" }); } catch (e) { threw9 = e; }
let W9junk = null;
try { W9junk = legacy({ bootId: "boot-A", d: 12 }); } catch (e) { threw9 = threw9 || e; }
check("9. a trail saved by an older build comes back - tagged or bare - and a damaged stored copy gives back the points "
      + "before the damage without throwing (it runs at module load)",
      () => Wtag.track.length === 3 && Wtag.savedBootId === "boot-A" && Warr.track.length === 3
            && threw9 === null && W9dmg.track.length === 2 && W9dmg.track.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
            && Array.isArray(W9junk.track),
      () => "tagged " + Wtag.track.length + ", bare " + Warr.track.length + ", damaged " + (W9dmg ? W9dmg.track.length : "-")
            + " point(s)" + (threw9 ? ", THREW " + threw9.message : ""));

// 10. a clear
const S10 = makeStore(), C10 = makeClock(), W10 = makeWorld(S10, C10);
run(W10, 7, 2);                                       // a write is armed, not yet made
W10.clearTrack();
C10.advance(TRACK_SAVE_MS * 3);
const afterClear = S10.getItem(KEY);
run(W10, 7, (TRACK_SAVE_MS + 1000) / 1000, 500);
const s10 = stored(S10);
check("10. a clear cancels the armed write and removes the stored copy - and the trail laid after it is saved again",
      () => afterClear === null && s10 && s10.pts.length > 0 && s10.pts.length <= W10.track.length,
      () => "after the clear: " + (afterClear === null ? "nothing stored" : "STORED") + "; after new points: "
            + (s10 ? s10.pts.length + " stored" : "nothing stored"));

// 11. the page's events
const S11 = makeStore(), W11 = makeWorld(S11, makeClock());
run(W11, 7, 1);                                       // pending
const a11 = S11.sets;
if (W11.events.pagehide) W11.events.pagehide();
const b11 = S11.sets;
run(W11, 7, 1, 100);
W11.doc.visibilityState = "visible"; if (W11.doc.events.visibilitychange) W11.doc.events.visibilitychange();
const c11 = S11.sets;
W11.doc.visibilityState = "hidden"; if (W11.doc.events.visibilitychange) W11.doc.events.visibilitychange();
const d11 = S11.sets;
check("11. the page flushes a pending write when it is unloaded (pagehide) and when it goes out of sight - not when it "
      + "comes back into view",
      () => b11 === a11 + 1 && c11 === b11 && d11 === c11 + 1,
      () => "pagehide wrote " + (b11 - a11) + ", visible wrote " + (c11 - b11) + ", hidden wrote " + (d11 - c11));

// 12-14. drawing a long trail. The page's worldPx is stood in for by a flat plane (lat = meters south, lon = meters
// east, times 2^zoom): trailScreenPath only needs worldPx at zoom 0 to be what it scales, and a plane lets a check say
// exactly where every point belongs on the screen.
let projected = 0;
const worldPx = (lat, lon, z) => { projected++; return { x: lon * Math.pow(2, z), y: lat * Math.pow(2, z) }; };
// eslint-disable-next-line no-eval
const trailScreenPath = eval("(function(){ \"use strict\";\n" + grab("trailScreenPath") + "\nreturn trailScreenPath; })()");
// The drawn path is a SUBSEQUENCE of the trail, so every trail point lies between two drawn vertices; its distance to the
// drawn segment spanning it is how far the picture moved it. Where a point belongs is computed HERE from its lat/lon,
// never from the position the function cached on it. Points outside the view are not measured.
function drawnDeviation(pts, zoom, o, w, h) {
  const path = trailScreenPath(pts, zoom, o, w, h), k = Math.pow(2, zoom);
  const scr = pts.map((p) => ({ x: p.lon * k - o.x, y: p.lat * k - o.y }));
  const idx = [];                                   // the trail index of each drawn vertex
  for (let d = 0, j = 0; d < path.length; d++) {
    while (j < scr.length && !(Math.abs(scr[j].x - path[d].x) < 1e-6 && Math.abs(scr[j].y - path[d].y) < 1e-6)) j++;
    idx.push(j); j++;
  }
  let worstPx = 0, measured = 0, tight = 0;         // tight: consecutive drawn vertices under a pixel apart (the boat's end excepted)
  for (let d = 0; d + 1 < path.length; d++) {
    const a = path[d], b = path[d + 1];
    if (d + 2 < path.length && Math.abs(b.x - a.x) < 1 && Math.abs(b.y - a.y) < 1) tight++;
    for (let j = idx[d]; j < idx[d + 1] || (d + 2 === path.length && j === idx[d + 1]); j++) {
      const s = scr[j];
      if (!s || s.x < 0 || s.x > w || s.y < 0 || s.y > h) continue;
      const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy;
      const u = L2 ? Math.max(0, Math.min(1, ((s.x - a.x) * vx + (s.y - a.y) * vy) / L2)) : 0;
      worstPx = Math.max(worstPx, Math.hypot(s.x - (a.x + u * vx), s.y - (a.y + u * vy))); measured++;
    }
  }
  return { path, worstPx, measured, tight, matched: idx.every((j) => j < pts.length),
           firstOk: idx[0] === 0, lastOk: idx[idx.length - 1] === pts.length - 1 };
}
const LONG = [];
{ let e = -1000, n = 0, dir = 1;
  for (let i = 0; i < 40000; i++) { LONG.push({ lat: -n, lon: e }); e += dir * 2; if (e > 1000 || e < -1000) { dir = -dir; n -= 20; } } }
// 5 m a pixel (2^zoom = 0.2): the whole 80 km on a 400 x 156 px patch in the middle of an 800 x 600 view
const far = drawnDeviation(LONG, Math.log2(0.2), { x: -400, y: -100 }, 800, 600);
check("12. a long trail seen from far off (5 m a pixel, its points 0.4 px apart) is drawn from vertices at least a pixel "
      + "apart - a third of its points - under a pixel and a half from every one of them, starting where it started and "
      + "ending at the boat",
      () => far.matched && far.path.length < LONG.length / 2.5 && far.tight === 0 && far.worstPx < 1.5
            && far.measured === LONG.length && far.firstOk && far.lastOk,
      () => far.path.length + " of " + LONG.length + " vertices drawn, " + far.tight + " under a pixel apart, worst "
            + far.worstPx.toFixed(2) + " px over " + far.measured + " points");
// 4 px a meter (zoom 2), on the trail's north-west corner - and the SAME point objects, whose cached positions were
// made at the other zoom: a render after a zoom must not draw them where they were
const projectedFar = projected;
const near = drawnDeviation(LONG, 2, { x: -4200, y: -100 }, 800, 600);
const projectedNear = projected - projectedFar;
check("13. zoomed in (after drawing zoomed out), the runs beyond the view are left out, every point IN the view is "
      + "drawn where it is, and not one point is projected again - each kept its position from the first draw",
      () => near.matched && near.path.length < LONG.length / 5 && near.worstPx < 1.5 && near.measured > 100 && near.lastOk
            && projectedFar === LONG.length && projectedNear === 0,
      () => near.path.length + " of " + LONG.length + " vertices drawn, " + near.measured + " points in view, worst "
            + near.worstPx.toFixed(2) + " px; projections: " + projectedFar + " on the first draw, " + projectedNear + " on the second");
// A trail that leaves by the left and comes back by the top, through the corner: no one edge holds the whole run, so
// joining its ends straight would draw a line across the view that the boat never made.
const CORNER = [[-50, 300], [-50, -50], [-40, -50], [300, -50], [300, 300]];
const cornerPath = trailScreenPath(CORNER.map(([x, y]) => ({ lat: y, lon: x })), 0, { x: 0, y: 0 }, 800, 600);
const crossesView = (() => {
  for (let d = 0; d + 1 < cornerPath.length; d++) {
    const a = cornerPath[d], b = cornerPath[d + 1];
    for (let t = 0; t <= 1; t += 0.02) {
      const x = a.x + t * (b.x - a.x), y = a.y + t * (b.y - a.y);
      if (x < 0 || x > 800 || y < 0 || y > 600) continue;
      let dmin = Infinity;
      for (let s = 0; s + 1 < CORNER.length; s++) {
        const [ax, ay] = CORNER[s], [bx, by] = CORNER[s + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
        const u = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
        dmin = Math.min(dmin, Math.hypot(x - (ax + u * vx), y - (ay + u * vy)));
      }
      if (dmin > 1.5) return [Math.round(x), Math.round(y)];
    }
  }
  return null;
})();
check("13b. a trail that leaves the view by the left and comes back by the top, through the corner, is not joined "
      + "straight across the view",
      () => crossesView === null && cornerPath.length >= 3,
      () => cornerPath.map((s) => Math.round(s.x) + "," + Math.round(s.y)).join(" -> ")
            + (crossesView ? "; draws across the view at " + crossesView : ""));
const RENDER = grab("render").replace(/\/\/[^\n]*/g, "");
check("14. the chart draws the trail through trailScreenPath, not point by point",
      () => /trailScreenPath\(track, zoom, o, w, h\)/.test(RENDER) && !/track\.forEach\(/.test(RENDER),
      () => "trailScreenPath in render: " + /trailScreenPath\(track, zoom, o, w, h\)/.test(RENDER)
            + "; track.forEach in render: " + /track\.forEach\(/.test(RENDER));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
