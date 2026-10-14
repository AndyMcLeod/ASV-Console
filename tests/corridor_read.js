// tests/corridor_read.js - the page's side of the chart along a route: Read chart on the transit line, and the read-ahead.
//
// Andy, 2026-10-11 (step 3 of the long-transit plan): read a corridor, not a box. The server's side - the tiles a route
// reaches, the background job, the HTTP routes - is tests/enc_corridor.py. Here, the page's own functions lifted and
// driven with the server stubbed:
//   1    READ CHART: the corridor is the boat and the transit's points, 5 km either side; it polls while the job runs,
//        keeps the latest status (its unread squares as {W, S, E, N}), and says the start and the end on the banner and
//        in the session log; no line, nothing asked; a refusal said in words;
//   2    the summary's words: the scales, the unread water, the tiles not read, a stopped read;
//   3    the route ahead: from where she is along the route for exactly CORRIDOR_AHEAD_M, the last leg cut there;
//   4    THE READ-AHEAD: in the supervising window while she runs, once, then again only after CORRIDOR_AHEAD_EVERY_M or
//        a new route; never from a window that does not supervise, a boat not running, or one with no fix; the width the
//        guard's own box reaches;
//   5    the wiring: the panel's button and its line, the frame handler (caught), the unread squares drawn with the zones.
//
//   node tests/corridor_read.js   # exit 0 = pass
//
// TEETH - fourteen mutations RUN on scratch copies (scratchpad mutate_corridor.py), all caught:
//   the corridor without the boat / a different width / never polled /
//   the unread squares not kept / the end not logged                    -> 1
//   left busy after                                                     -> 1, 1b
//   read with no line                                                   -> 1b
//   the unread water left out of the summary                            -> 2
//   the last leg not cut                                                -> 3, 4
//   ahead from the route's start                                        -> 3
//   asked on every frame / from a window that does not supervise /
//   when she is not running                                             -> 4
//   the corridor's unread squares not drawn                             -> 5
// (The read-ahead's width - NOGO_RADIUS_M / 1000 - equals CORRIDOR_HALF_KM today, so swapping the two is not a
// mutation any check could see; 4 pins the value the guard's box reaches.)

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
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? (typeof detail === "function" ? "" : detail) + " — " : "") + "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", H.indexOf(")", start)), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const constOf = (n) => +(new RegExp("const " + n + " = ([\\d.]+)").exec(H) || new RegExp(n + " = ([\\d.]+)").exec(H) || [])[1];
const M = 111320;
const distTo = (a, b) => Math.hypot((b.lat - a.lat) * M, (b.lon - a.lon) * M * Math.cos(a.lat * Math.PI / 180));
const fmtMS = (s) => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
const AHEAD = constOf("CORRIDOR_AHEAD_M"), EVERY = constOf("CORRIDOR_AHEAD_EVERY_M"), NOGO_R = constOf("NOGO_RADIUS_M");
console.log("The chart along a route, on the page:");

// ── the page's block, lifted ──────────────────────────────────────────────────────────────────────────────────────
const world = (o) => {
  const w = Object.assign({ posts: [], gets: [], banners: [], notes: [], logs: [], renders: 0, sup: true,
                            asv: { lat: 43.07, lon: -70.70 }, passageWps: [], seq: [] }, o || {});
  const src = "let corridorRead = null, corridorBusy = false, corridorAhead = {at: null, route: null};\n"
    + "const CORRIDOR_HALF_KM = " + constOf("CORRIDOR_HALF_KM") + ", CORRIDOR_POLL_MS = 0, CORRIDOR_AHEAD_M = " + AHEAD
    + ", CORRIDOR_AHEAD_EVERY_M = " + EVERY + ";\n"
    + "const CORRIDOR_SCALES = [\"harbour\", \"approach\", \"coastal\", \"general\"];\n"
    + [grab("toCorridor"), grab("corridorSummary"), grab("readCorridor"), grab("routeAhead"), grab("corridorAheadTick")].join("\n")
    + "\nreturn {readCorridor, corridorSummary, routeAhead, corridorAheadTick, toCorridor, state: () => ({corridorRead, corridorBusy, corridorAhead})};";
  w.api = new Function("asv", "passageWps", "postCorridor", "getCorridor", "updateTransitPanel", "render", "showBanner", "flashNote",
    "logClient", "fmtMS", "distTo", "supervising", "indexedRoute", "window", "NOGO_RADIUS_M", src)(
    w.asv, w.passageWps, async (b) => { w.posts.push(b); return w.seq.length ? w.seq.shift() : { id: "j1", state: "done", total: 1, done: 1 }; },
    async (id) => { w.gets.push(id); return w.seq.shift(); }, () => {}, () => { w.renders++; }, (t) => w.banners.push(t),
    (t) => w.notes.push(t), (k, d) => w.logs.push([k, d]), fmtMS, distTo, () => w.sup, () => w.route, w.win || { _wpIndex: 0 }, NOGO_R);
  return w;
};

(async () => {
  // ── 1. Read chart ───────────────────────────────────────────────────────────────────────────────────────────────
  const A = world({ passageWps: [{ lat: 43.0, lon: -70.6 }, { lat: 42.5, lon: -70.0 }] });
  const run = (d) => ({ id: "j1", state: "running", total: 4, done: d, failed: [], bands: {}, unread: [], unread_n: 0, half_km: 5, seconds: d, eta_s: 4 - d });
  A.seq = [run(0), run(1), run(3), { id: "j1", state: "done", total: 4, done: 4, failed: [], bands: { harbour: 1, coastal: 3 },
           unread: [[-70.1, 42.6, -70.09, 42.61]], unread_n: 1, half_km: 5, seconds: 12 }];
  await A.api.readCorridor();
  const s = A.api.state();
  check("1. READ CHART reads the corridor of the boat and the line's points, 5 km either side; polls the job while it "
        + "runs; keeps the final status with its unread squares as {W, S, E, N}; says the start and the end on the "
        + "banner and in the session log; and is free again after",
        () => A.posts.length === 1 && JSON.stringify(A.posts[0].route) === JSON.stringify([{ lat: 43.07, lon: -70.70 }, ...A.passageWps])
              && A.posts[0].half_km === 5 && A.gets.length === 3 && s.corridorRead.state === "done"
              && JSON.stringify(s.corridorRead.unread) === JSON.stringify([{ W: -70.1, S: 42.6, E: -70.09, N: 42.61, failed: false }])
              && /^Reading the chart along the line: 4 tile/.test(A.banners[0]) && /^Chart read along the line: 4 tile/.test(A.banners[A.banners.length - 1])
              && A.logs.length === 2 && A.logs[0][1].state === "started" && A.logs[1][1].state === "done" && s.corridorBusy === false,
        () => JSON.stringify({ posts: A.posts.length, gets: A.gets.length, last: A.banners[A.banners.length - 1], logs: A.logs.length }).slice(0, 300));
  const N = world({ passageWps: [] }); await N.api.readCorridor();
  const R = world({ passageWps: [{ lat: 43, lon: -70 }] }); R.seq = [{ error: "that corridor reaches 900 chart tiles; at most 600 are read at once - read it in parts" }];
  await R.api.readCorridor();
  check("1b. no passage line (the Passage tab's, since 2026-10-14): nothing asked, a note says to draw one; a refusal from the console is said in its own "
        + "words, and nothing is kept",
        () => N.posts.length === 0 && /Draw the passage's line on the Passage tab first/.test(N.notes[0] || "") && R.posts.length === 1
              && /^Chart NOT read along the line: that corridor reaches 900 chart tiles/.test(R.banners[0] || "")
              && R.api.state().corridorRead === null && R.api.state().corridorBusy === false,
        () => JSON.stringify({ n: N.notes, r: R.banners }).slice(0, 200));

  // ── 2. the words ────────────────────────────────────────────────────────────────────────────────────────────────
  const say = A.api.corridorSummary;
  const w1 = say({ state: "done", total: 67, done: 67, half_km: 5, seconds: 754, bands: { harbour: 9, coastal: 50, general: 6, none: 2 },
                   unread_n: 14, failed: [{ tile: [], note: "x" }] });
  const w2 = say({ state: "canceled", total: 67, done: 20 });
  const w3 = say({ state: "done", total: 3, done: 3, half_km: 5, seconds: 2, bands: { coastal: 3 }, unread_n: 0, failed: [] });
  check("2. THE WORDS: the scales in order with their tiles, the tiles no chart covers, the unread water drawn gray and "
        + "refused, the tiles not read with what to do, a stopped read, and a clean one",
        () => /charted at harbour 9, coastal 50, general 6/.test(w1) && /2 tile\(s\) with no chart at any scale/.test(w1)
              && /UNREAD water in 14 square\(s\) near the line, drawn gray - a route through it is refused/.test(w1)
              && /1 tile\(s\) could NOT be read - press Read chart again/.test(w1) && /STOPPED after 20 of 67/.test(w2)
              && /no unread water near the line/.test(w3) && /offline too/.test(w3),
        () => [w1, w2, w3].join(" || ").slice(0, 400));

  // ── 3. the route ahead ──────────────────────────────────────────────────────────────────────────────────────────
  const here = { lat: 43.0, lon: -70.0 };
  const east = (km) => ({ lat: 43.0, lon: -70.0 + km * 1000 / (M * Math.cos(43 * Math.PI / 180)) });
  const rr = [east(5), east(12), east(20), east(40), east(60)];
  const ah = A.api.routeAhead(here, rr, 0, AHEAD);
  const lenOf = (pts) => pts.slice(1).reduce((m, p, i) => m + distTo(pts[i], p), 0);
  const fromIdx = A.api.routeAhead(here, rr, 2, AHEAD);        // heading for waypoint 3, 20 km off
  const farLeg = A.api.routeAhead(here, rr, 3, AHEAD);         // heading for waypoint 4, 40 km off: cut inside that leg
  const short = A.api.routeAhead(here, rr.slice(0, 2), 0, AHEAD);
  check("3. THE ROUTE AHEAD runs from where she is along the route for exactly " + AHEAD / 1000 + " km - the leg that "
        + "crosses it cut there - from the waypoint she is heading for (one farther off than that: cut inside her own "
        + "leg); a route shorter than that is taken whole",
        () => Math.abs(lenOf(ah) - AHEAD) < 1 && ah.length === 5 && Math.abs(lenOf(fromIdx) - AHEAD) < 1
              && distTo(fromIdx[1], rr[2]) < 0.01 && fromIdx.length === 3 && farLeg.length === 2
              && Math.abs(lenOf(farLeg) - AHEAD) < 1 && short.length === 3 && Math.abs(lenOf(short) - 12000) < 1,
        () => "ahead " + Math.round(lenOf(ah)) + " m in " + ah.length + " pts; from wp 3 " + Math.round(lenOf(fromIdx)) + " m in "
            + fromIdx.length + "; from wp 4 " + farLeg.length + " pts; short " + short.length);

  // ── 4. the read-ahead ───────────────────────────────────────────────────────────────────────────────────────────
  const B = world({ route: rr, asv: { lat: 43.0, lon: -70.0 } });
  const running = { run: "running" };
  B.api.corridorAheadTick(running);
  B.api.corridorAheadTick(running);                                   // same place: nothing
  B.asv.lon += 1500 / (M * Math.cos(43 * Math.PI / 180));               // 1.5 km on: nothing yet
  B.api.corridorAheadTick(running);
  const before = B.posts.length;
  B.asv.lon += 600 / (M * Math.cos(43 * Math.PI / 180));                // 2.1 km on: asked again
  B.api.corridorAheadTick(running);
  B.route = rr.slice(1); B.api.corridorAheadTick(running);            // a new route: asked at once
  const n4 = B.posts.length;
  const V = world({ route: rr, sup: false }); V.api.corridorAheadTick(running);
  const I = world({ route: rr }); I.api.corridorAheadTick({ run: "idle" });
  const F = world({ route: rr, asv: null }); F.api.corridorAheadTick(running);
  check("4. THE READ-AHEAD asks once, then again only after " + EVERY / 1000 + " km made good or for a new route; at the "
        + "width the guard's own box reaches (" + NOGO_R / 1000 + " km); never from a window that does not supervise, a "
        + "boat not running, or one with no fix",
        () => before === 1 && n4 === 3 && B.posts[0].half_km === NOGO_R / 1000 && Math.abs(lenOf(B.posts[0].route) - AHEAD) < 1
              && V.posts.length === 0 && I.posts.length === 0 && F.posts.length === 0,
        () => JSON.stringify({ before, n4, half: B.posts[0] && B.posts[0].half_km, v: V.posts.length, i: I.posts.length, f: F.posts.length }));

  // ── 5. the wiring ───────────────────────────────────────────────────────────────────────────────────────────────
  const panel = H.slice(H.indexOf('id="transitPanel"'), H.indexOf("<!-- ROC / HOME card"));
  check("5. THE WIRING: the transit panel carries Read chart and its line, the button reads the corridor, the frame "
        + "handler runs the read-ahead CAUGHT, and the corridor's unread squares are drawn with the zones (the layer "
        + "keyed on them)",
        () => /id="tr_read"/.test(panel) && /id="tr_read_st"/.test(panel) && /\$\("#tr_read"\)\.onclick = \(\) => readCorridor\(\);/.test(H)
              && /try\{ corridorAheadTick\(s\); \}catch\(e\)\{ console\.error\(e\); \}/.test(grab("onState"))
              && /corridorRead && corridorRead\.unread/.test(grab("drawNogo"))
              && /nogo\.unread, corridorRead\], drawNogo/.test(H),
        "markup / onState / drawNogo");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
