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
  // (1c-1e: the page's wait limit, its ask's bound and its helpers, and the world's own clock once a check sets it -
  // `w.clock`, each poll's wait moving it `w.step` on)
  const src = "let corridorRead = null, corridorBusy = false, corridorAhead = {at: null, route: null};\n"
    + "const CORRIDOR_HALF_KM = " + constOf("CORRIDOR_HALF_KM") + ", CORRIDOR_POLL_MS = 0, CORRIDOR_AHEAD_M = " + AHEAD
    + ", CORRIDOR_AHEAD_EVERY_M = " + EVERY + ";\n"
    + /const CORRIDOR_WAIT_MAX_MS = [^;]+;/.exec(H)[0] + "\n" + /const CORRIDOR_ASK_MS = [^;]+;/.exec(H)[0] + "\n" + /const CORRIDOR_MUTE_MS = [^;]+;/.exec(H)[0] + "\n"
    + "const Date = class extends globalThis.Date { static now(){ return w.clock != null ? w.clock : globalThis.Date.now(); } };\n"
    // (with the world's clock, any timer but the poll's - an ask's bound - is kept for the check to fire: 1d)
    + "const setTimeout = (fn, ms) => { if (w.clock == null) return globalThis.setTimeout(fn, ms);"
    + " if (ms === 0){ w.polls = (w.polls || 0) + 1; w.clock += w.step; return globalThis.setTimeout(fn, 0); }"
    + " const t = {fn, ms, cleared: false}; (w.races = w.races || []).push(t); return t; };\n"
    + "const clearTimeout = (t) => { if (t && t.fn) t.cleared = true; else globalThis.clearTimeout(t); };\n"
    + "const CORRIDOR_SCALES = [\"harbour\", \"approach\", \"coastal\", \"general\"];\n"
    + [grab("corridorFailure"), grab("corridorLate"), grab("corridorAsk"), grab("corridorStart"), grab("corridorWait"),
       grab("bandWord"), grab("toCorridor"), grab("corridorGivenUp"), grab("corridorReadLine"), grab("corridorSummary"), grab("readCorridor"), grab("routeAhead"), grab("corridorAheadTick")].join("\n")
    + "\nreturn {readCorridor, corridorReadLine, corridorSummary, routeAhead, corridorAheadTick, toCorridor, ASK: CORRIDOR_ASK_MS, MUTE: CORRIDOR_MUTE_MS, state: () => ({corridorRead, corridorBusy, corridorAhead})};";
  w.api = new Function("w", "asv", "passageWps", "postCorridor", "getCorridor", "updateTransitPanel", "render", "showBanner", "flashNote",
    "logClient", "fmtMS", "distTo", "supervising", "indexedRoute", "window", "NOGO_RADIUS_M", src)(
    // (`postHang`: the console never answers the ask - 1d; `sigs`: each ask's abort signal)
    w, w.asv, w.passageWps, async (b, sig) => { w.posts.push(b); (w.sigs = w.sigs || []).push(sig); if (w.postHang) return new Promise(() => {}); return w.seq.length ? w.seq.shift() : { id: "j1", state: "done", total: 1, done: 1 }; },
    // (`running`: the world's read never leaves "running" - until 400 polls, so a page that never gives up FAILS 1c, not
    // hangs; `getFail`: the polls that fail, by number - 1e; past the world's answers a refusal in words, never undefined:
    // a page that asks again on no answer would ask for good)
    async (id, sig) => { w.gets.push(id); (w.sigs = w.sigs || []).push(sig);
      if (w.getFail && w.getFail.indexOf(w.gets.length) >= 0) throw new TypeError("Failed to fetch");
      if (w.running) return w.polls > 400 ? { id, state: "done", total: 4, done: 4, failed: [], bands: {}, unread: [], unread_n: 0, half_km: 5, seconds: 9 } : w.running;
      return w.seq.length ? w.seq.shift() : { error: "the world has no more answers" }; },
    () => {}, () => { w.renders++; }, (t) => w.banners.push(t),
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
  // 1c. THE WAIT HAS AN END (2026-11-14): a read that never leaves "running" held Read chart (and Plan passage, which it
  // greys) for good. Polled a minute apart, it is given up at CORRIDOR_WAIT_MAX_MS of wall clock - said with how much
  // was read and that the tiles are kept, logged, and the button free
  const MAXW = +new Function("return " + /const CORRIDOR_WAIT_MAX_MS = ([^;]+);/.exec(H)[1])();
  const L = world({ passageWps: [{ lat: 43, lon: -70 }] });
  L.clock = 1.8e12; L.step = 60000; L.polls = 0;
  L.seq = [{ id: "j9", state: "running", total: 4, done: 0, failed: [], bands: {}, unread: [], unread_n: 0, half_km: 5, seconds: 0 }];
  L.running = { id: "j9", state: "running", total: 4, done: 1, failed: [], bands: {}, unread: [], unread_n: 0, half_km: 5, seconds: 60 };
  await L.api.readCorridor();
  const lLog = L.logs.find((l) => l[1] && l[1].state === "late");
  check("1c. A READ THAT NEVER FINISHES IS GIVEN UP at " + MAXW / 60000 + " min of wall clock, polled a minute apart: said with how "
        + "much was read and that the tiles are kept, logged, Read chart free again, and the Passage tab's line no longer 'reading'",
        () => MAXW === 1800000 && L.polls === 30
              && (L.banners[L.banners.length - 1] || "") === "Chart NOT read along the line: the read did not finish in 30 min (1 of 4 tile(s) read)"
                 + " - the tiles read are kept: press Read chart again to go on from them."
              && lLog && lLog[1].done === 1 && lLog[1].tiles === 4 && lLog[1].min === 30 && lLog[1].mute === false
              && L.api.state().corridorBusy === false && L.api.state().corridorRead.state === "given up"
              && L.api.corridorReadLine(L.api.state().corridorRead) === "chart read given up at 1 of 4 tiles",
        () => JSON.stringify({ polls: L.polls, last: L.banners[L.banners.length - 1], log: lLog && lLog[1], busy: L.api.state().corridorBusy,
                               line: L.api.corridorReadLine(L.api.state().corridorRead) }));
  // 1d. AN ASK THE CONSOLE NEVER ANSWERS (a stalled server's request can hang for good: tests/enc_corridor.py 4) - bounded
  // by CORRIDOR_ASK_MS and aborted (the 2026-11-14 review), and once past the 30 min given up with nothing read said so -
  // NOT said as tiles kept, since nothing is known to be read - the button free. Given 2 s of real time after the bound, a
  // page that waited on the request itself is said HUNG here, and fails
  const Hn = world({ passageWps: [{ lat: 43, lon: -70 }] });
  Hn.clock = 1.8e12; Hn.step = 60000; Hn.polls = 0; Hn.postHang = true;
  const pHn = Hn.api.readCorridor();
  for (let i = 0; i < 100 && !Hn.posts.length; i++) await new Promise((r) => setTimeout(r, 0));
  const raceHn = (Hn.races || [])[0];
  Hn.clock += MAXW; (Hn.races || []).filter((t) => !t.cleared).forEach((t) => t.fn());
  const endHn = await Promise.race([pHn.then(() => "settled"), new Promise((r) => setTimeout(() => r("HUNG"), 2000))]);
  check("1d. AN ASK THE CONSOLE NEVER ANSWERS is bounded by CORRIDOR_ASK_MS and aborted, and past the " + MAXW / 60000 + " min given up, "
        + "said so - the tiles NOT said kept; Read chart free again",
        () => endHn === "settled" && raceHn && raceHn.ms === Hn.api.ASK && Hn.api.ASK === 30000 && Hn.gets.length === 0
              && Hn.sigs.length === 1 && Hn.sigs[0] && Hn.sigs[0].aborted === true
              && (Hn.banners[Hn.banners.length - 1] || "") === "Chart NOT read along the line: the read had no answer it could use from the console for 30 min"
                 + " (the last ask: unanswered in 30 s) - press Read chart again to ask again."
              && Hn.api.state().corridorBusy === false,
        () => JSON.stringify({ end: endHn, race: raceHn && raceHn.ms, aborted: (Hn.sigs || []).map((x) => x && x.aborted), last: Hn.banners[Hn.banners.length - 1], busy: Hn.api.state().corridorBusy }));
  // 1e. A POLL THAT FAILS IS NOT THE END (the 2026-11-14 review): one lost poll - the network, a reply not JSON - threw
  // out of the read, said "Chart NOT read"; now it is polled again, and the read, done, is said and kept
  const E = world({ passageWps: [{ lat: 43.0, lon: -70.6 }] });
  E.seq = [run(0), run(1), run(3), { id: "j1", state: "done", total: 4, done: 4, failed: [], bands: { coastal: 4 }, unread: [], unread_n: 0, half_km: 5, seconds: 12 }];
  E.getFail = [2];
  await E.api.readCorridor();
  check("1e. A POLL THAT FAILS IS POLLED AGAIN: the read goes on to its end, said and kept, not 'Chart NOT read'",
        () => E.gets.length === 4 && E.api.state().corridorRead && E.api.state().corridorRead.state === "done"
              && /^Chart read along the line: 4 tile/.test(E.banners[E.banners.length - 1] || "") && E.api.state().corridorBusy === false,
        () => JSON.stringify({ gets: E.gets.length, last: E.banners[E.banners.length - 1], read: E.api.state().corridorRead && E.api.state().corridorRead.state }));

  // 1f. THE CONSOLE'S OWN FAILURE IS NO ANSWER (the second 2026-11-14 review): an HTTP 500 - do_POST's catch, with an
  // {error} - was taken as the console's refusal, and a single one ended the end-of-plan chain for good. corridorReply
  // throws it, named (asked again: corridorAsk, which says what the ask got); a refusal (4xx) and a status (200) stay
  // answers, and the signal goes with each request. And an ask aborted at its bound is said as unanswered - not as the
  // abort's own rejection, which a real fetch makes on the abort (here the bound fires in 5 ms of real time)
  const Fx = { calls: [], next: null };
  const reply = (status, body) => ({ status, json: async () => { if (body instanceof Error) throw body; return body; } });
  const fapi = new Function("fetch", "setTimeout", /const CORRIDOR_ASK_MS = [^;]+;/.exec(H)[0] + "\n"
    + [grab("corridorReply"), grab("corridorFailure"), grab("postCorridor"), grab("getCorridor"), grab("corridorAsk")].join("\n")
    + "\nreturn {postCorridor, getCorridor, corridorAsk};")(async (url, opts) => { Fx.calls.push({ url, opts }); return Fx.next; },
                                                           (fn, ms) => setTimeout(fn, Math.min(ms, 5)));
  const outcome = async (p) => { try { return { ok: await p }; } catch (e) { return { threw: e.message, corridor: !!e.corridor }; } };
  const sig = { tag: "the caller's signal" };
  const SAID500 = "the console failed handling /api/enc/corridor: OSError: disk full";
  Fx.next = reply(500, { error: SAID500 });
  const f500 = await outcome(fapi.postCorridor({ route: [1, 2] }, sig));
  const n500 = {}, a500 = await fapi.corridorAsk((s) => fapi.postCorridor({ route: [1, 2] }, s), n500);
  Fx.next = reply(502, new SyntaxError("Unexpected token <"));
  const f502 = await outcome(fapi.getCorridor("j 1", sig));
  Fx.next = reply(400, { error: "a route needs two points" });
  const f400 = await outcome(fapi.postCorridor({ route: [] }, sig));
  Fx.next = reply(404, { error: "no such corridor read" });
  const f404 = await outcome(fapi.getCorridor("j1", sig));
  Fx.next = reply(200, { id: "j1", state: "running", total: 3, done: 1 });
  const f200 = await outcome(fapi.getCorridor("j1", sig));
  const whyOf = async (ask) => { const n = {}; const st = await fapi.corridorAsk(ask, n); return st === null ? n.why : "ANSWERED"; };
  const wNet = await whyOf(async () => { throw new TypeError("Failed to fetch"); });
  const wJson = await whyOf(async () => { throw new SyntaxError("Unexpected token <"); });
  const wStr = await whyOf(async () => "<html>");
  const wAbort = await whyOf((signal) => new Promise((_, rej) => signal.addEventListener("abort",
    () => rej(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })))));
  const c0 = Fx.calls[0], c1 = Fx.calls[1], c2 = Fx.calls[2];
  check("1f. THE CONSOLE'S OWN FAILURE IS NO ANSWER: HTTP 500 and 502 thrown, named (and the ask says it got that); a "
        + "refusal (400, 404) and a status (200) answers; the signal sent with each; the words for an unreachable console, "
        + "a reply not JSON, a reply not a status; an ask aborted at its bound said unanswered, not by the abort",
        () => f500.threw === "HTTP 500 - " + SAID500 && f500.corridor && a500 === null && n500.why === "HTTP 500 - " + SAID500
              && f502.threw === "HTTP 502" && f502.corridor
              && f400.ok && f400.ok.error === "a route needs two points" && f404.ok && f404.ok.error === "no such corridor read"
              && f200.ok && f200.ok.state === "running"
              && c0.url === "/api/enc/corridor" && c0.opts.method === "POST" && c0.opts.signal === sig && JSON.parse(c0.opts.body).route.length === 2
              && c1.opts.signal && c1.opts.signal !== sig && c1.opts.signal.aborted === false
              && c2.url === "/api/enc/corridor?id=j%201" && c2.opts.signal === sig
              && wNet === "the console could not be reached" && wJson === "a reply that was not JSON" && wStr === "a reply that was not a status"
              && wAbort === "unanswered in 30 s",
        () => JSON.stringify({ f500, why500: n500.why, f502, f400, f404, f200: f200.ok && f200.ok.state, urls: Fx.calls.map((c) => c.url), wNet, wJson, wStr, wAbort }));

  // 1g. A TILE THAT FAILED IS NOT READ (the third 2026-11-14 review): the console counts a tile `done` when it is finished
  // with it, read or failed - two builds cut at their limit were said "2 of 4 read" and kept. The read count leaves the
  // failed out and says them; nothing read, nothing said kept. And the Passage tab's line (corridorReadLine), each state
  const runF = (done, nf) => ({ id: "jf", state: "running", total: 4, done, failed: Array.from({ length: nf }, (_, k) => ({ tile: [k], note: "build cut" })),
                                bands: {}, unread: [], unread_n: 0, half_km: 5, seconds: 60 });
  const G = world({ passageWps: [{ lat: 43, lon: -70 }] });
  G.clock = 1.8e12; G.step = 60000; G.polls = 0; G.seq = [runF(0, 0)]; G.running = runF(2, 2);
  await G.api.readCorridor();
  const G2 = world({ passageWps: [{ lat: 43, lon: -70 }] });
  G2.clock = 1.8e12; G2.step = 60000; G2.polls = 0; G2.seq = [runF(0, 0)]; G2.running = runF(2, 1);
  await G2.api.readCorridor();
  const rl = A.api.corridorReadLine;
  const lines1g = [rl(null), rl(run(1)), rl({ ...run(1), eta_s: null }), rl(G.api.state().corridorRead),
                   rl({ state: "done", total: 4, done: 4, failed: [{}], unread_n: 2 }), rl({ state: "canceled", total: 4, done: 2, failed: [], unread_n: 0 })];
  check("1g. A TILE THAT FAILED IS NOT READ: 2 done of which 2 failed said '0 of 4 read, 2 could not be', NOT kept; 2 done, 1 failed "
        + "said '1 of 4 read, 1 could not be', kept; and the Passage tab's line for no read, a read running (with and without its "
        + "time left), given up, done, stopped",
        () => (G.banners[G.banners.length - 1] || "") === "Chart NOT read along the line: the read did not finish in 30 min (0 of 4 tile(s) read, "
                 + "2 could not be) - press Read chart again to ask again."
              && (G2.banners[G2.banners.length - 1] || "") === "Chart NOT read along the line: the read did not finish in 30 min (1 of 4 tile(s) read, "
                 + "1 could not be) - the tiles read are kept: press Read chart again to go on from them."
              && JSON.stringify(lines1g) === JSON.stringify(["", "reading chart: 1 of 4 tiles · ~" + fmtMS(3) + " left", "reading chart: 1 of 4 tiles",
                 "chart read given up at 2 of 4 tiles · 2 NOT read", "chart read: 4 tiles · 2 unread · 1 NOT read", "chart read: 4 tiles · stopped"]),
        () => JSON.stringify({ none: G.banners[G.banners.length - 1], one: G2.banners[G2.banners.length - 1], lines: lines1g }));

  // ── 2. the words ────────────────────────────────────────────────────────────────────────────────────────────────
  const say = A.api.corridorSummary;
  const w1 = say({ state: "done", total: 67, done: 67, half_km: 5, seconds: 754, bands: { harbour: 9, coastal: 50, general: 6, none: 2 },
                   unread_n: 14, failed: [{ tile: [], note: "x" }] });
  const w2 = say({ state: "canceled", total: 67, done: 20 });
  const w3 = say({ state: "done", total: 3, done: 3, half_km: 5, seconds: 2, bands: { coastal: 3 }, unread_n: 0, failed: [] });
  check("2. THE WORDS: the scales in order with their tiles, the tiles no chart covers, the unread water drawn gray and "
        + "refused, the tiles not read with what to do, a stopped read, and a clean one",
        // the tally's WIRE key is "harbour" (the server's _corridor_run strips the enc_ prefix and
        // nothing more); the SENTENCE says the operator's word through bandWord (2026-11-04) - so
        // this check pins both: harbor said, harbour not said.
        () => /charted at harbor 9, coastal 50, general 6/.test(w1) && !/harbour/.test(w1)
              && /2 tile\(s\) with no chart at any scale/.test(w1)
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
              // (the page gathers the squares for the keep-out layer - nogoDrawData - which chartlayers.js draws, since 2026-10-17)
              && /corridorRead && corridorRead\.unread/.test(grab("nogoDrawData"))
              && /nogo\.unread, corridorRead\],\s*drawNogo/.test(H),
        "markup / onState / nogoDrawData");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
