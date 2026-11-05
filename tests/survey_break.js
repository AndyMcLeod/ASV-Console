// tests/survey_break.js - a survey broken off for a return home is recorded, and CONTINUE picks it up 100 m back.
//
// Andy, 2026-10-11: "When an ASV breaks off a survey to RTH for refueling the survey departure point must be recorded.
// On refuel, the option to regain the survey from the break off point minus 100m for overlap coverage must be
// presented. The ASV will then proceed to continue or complete the initial survey. From the users point of view I
// envision a "Continue" button next to the "Start" button. But a survey selection process may have to be put in place."
//
// The page's own functions are lifted out and driven, with stubs for the console and the planner:
//   1-1d  the RECORD (surveyBreakNow): taken only for a survey under way with something left to fly - its line's ends,
//         how far along and which way, the remainder from the waypoint she was heading for, its survey, her level -
//         a paused run's from the press of Pause, a break between lines with no line; nothing for another behavior,
//         a hold, or the end of the plan;
//   2     BANKED on the plan (bankBreak): newest first, one per survey, three in all, saved;
//   3     the REFUEL gate (breakReady): a fuel break-off waits until her level is up 2% of the tank since she broke
//         off; an RTH of the operator's, or a vessel that reports no level, does not wait;
//   4-4b  THE POINT (breakTail): 100 m back down her line on the side she came from, ON the line - clamped at the line's
//         start when she broke off nearer it than that - then the remainder;
//   5-5e  CONTINUE (continueSurvey): the way in routed and put in front, uploaded, started as a fresh run without a
//         second question, the record spent - and on every failure (no route, a refused upload, a Start that did not
//         start, a boat commanded meanwhile) nothing more sent and the record KEPT;
//   6-6b  the wiring: doRTH takes the record before its first await and banks it only after the RTH took, never for
//         the end-of-plan chain; the fuel monitor's RTH is a "fuel" break-off; the button sits beside Start; Start's
//         own pause-resume and question are skipped only for Continue; the plan's loader keeps the records.
//   7-11  THE RE-FLY OFFER (2026-11-05, "build the re-fly offer"): struck coverage banked by the forward-strike
//         (mission.strikes) gets its own cluster beside Continue - rendered only while the bank holds a record,
//         enabled only when the water tests clear (strikeReady), the press modeled on continueSurvey gate for
//         gate, every failure keeping the record, the × dropping it at the operator's word, the wiring pinned.
//         The adversarial round's additions: the watch covers EVERY banked record, said once per CLEARING (7d,
//         7e); the selector-rebuild guard and the x's self-re-enable (7c, 7f); the route's five refusal branches,
//         the guard-hold stand-down (never spend guardHeld unsaid), the mid-press drop, the double-press, the
//         whole-tail chart read, the disc at the route's last point and the loiter clause (8h-8l, in 8 itself);
//         the selection flying/dropping the CHOSEN record (11). strikeReady's own ladder and memo are
//         tests/ais_avoid.js 33-33c; the page-side plan whitelist is tests/plan_save.js 13.
//   (The plan store's side - saved, loaded, refused in words - is tests/mission_store.py 17-17b and 18-18b.)
//
// TEETH - fifteen mutations RUN on scratch copies of static/, tests/ and vessels/, all caught (the first cut of check 2
// let 'a survey keeps every break-off' SURVIVE: its sequence answered the same with or without the rule - rewritten):
//   rejoined 100 m FORWARD, over water not yet run          -> 4, 4b, 5
//   no overlap: rejoined where she broke off                -> 4, 4b, 5
//   the end-of-plan chain records a break-off               -> 6
//   the fuel RTH not named a fuel break-off                 -> 6
//   a survey holding is recorded                            -> 1d
//   a paused run's mark read again (her drift)              -> 1b
//   the remainder one waypoint short                        -> 1, 1c
//   a survey keeps every break-off                          -> 2
//   no refuel wait                                          -> 3, 5d
//   no level reported waits for ever                        -> 0 (the suite crashes on the level it cannot print)
//   not asked again after the awaits                        -> 5c
//   the record spent before the Start                       -> 5b
//   the way in not put in front                             -> 5
//   Start resumes the old pause                             -> 5
//   the loader drops the break-offs                         -> 6b

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
const APP = path.join(__dirname, "..");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");   // a sweep's sidecar, or the page
const GD = require(path.join(APP, "static", "js", "geodesy.js"));
const F = require(path.join(APP, "static", "js", "fuel.js"));
const SV = require(path.join(APP, "static", "js", "surveys.js"));
const KO = require(path.join(APP, "static", "js", "keepouts.js"));   // the re-fly's water test asks the real blockedInfo (7-10)

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const start = H.search(new RegExp("(async )?function " + name + "\\("));
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const decl = (name) => { const m = new RegExp("const " + name + " = [^;]+;").exec(H); if (!m) throw new Error(name + " gone"); return m[0]; };

// a plane about a point off Portsmouth: meters east / north
const REF = { lat: 43.07, lon: -70.71 };
const fr = GD.planeFrame(REF);
const LL = (e, n) => fr.fromEN(e, n), EN = (p) => fr.toEN(p);
// the plan: line 1 east from (0,0) to (400,0), a turn, line 2 west at n = 50; each line tagged S2
const LA = LL(0, 0), LB = LL(400, 0), L2A = LL(400, 50), L2B = LL(0, 50);
const LINES = [{ a: LA, b: LB, sv: "S2" }, { a: L2A, b: L2B, sv: "S2" }];
const ROUTE = [LL(-150, -80), { ...LA, sv: "S2" }, { ...LB, sv: "S2" }, { ...LL(440, 25), turn: true }, { ...L2A, sv: "S2" }, { ...L2B, sv: "S2" }];

// ONE world: the page's functions with the console stubbed round them; `o` sets the stubs a check needs
function world(o) {
  const w = Object.assign({
    S: { behavior: "survey", run: "running", status: { fuel_l: 60, holding: false }, armed: true, estop: false },
    asv: LL(129, 0), wpIndex: 2, runLineIdx: 0, pauseMark: null, mission: { lines: LINES, surveys: [{ id: "S2", no: 2, name: "North" }], breaks: [] },
    calls: [], banners: [], notes: [], saves: 0, canCommand: true,
    plan: (from, to) => ({ route: [LL(-100, -40), to] }),          // the router: a detour, then the target
    upload: { ok: true }, start: true,
  }, o || {});
  const v = { VESSEL: JSON.parse(fs.readFileSync(path.join(APP, "vessels", "drix08_em712.json"), "utf8")), SPEED_KN: { high: 10 } };
  const src = [
    "const {distTo, azTo, atDA} = GD, {energyModel, energyLevel, FUEL_REARM_FRAC} = F, {svOf} = SV;",
    "let S = w.S, asv = w.asv, mission = w.mission, pauseMark = w.pauseMark, runLineIdx = w.runLineIdx, runRoute = w.route || null, runUnsafe = [], planIntent = null;",
    "const window = {_wpIndex: w.wpIndex};",
    "const V = w.V, LINE_MATCH_M = 1;",
    "const fuelModel = () => energyModel(V.VESSEL, 10);",
    "const fuelFmt = (m, x) => x.toFixed(1) + ' ' + m.unit, fmtDist = (m) => m.toFixed(1) + ' m';",
    "const indexedRoute = () => runRoute;",
    "const surveyById = (id) => (mission.surveys || []).find((s) => s.id === id) || null;",
    "const lineNo = (k) => k + 1;",
    "const alongLineM = (L, p) => { const a = GD.toEN(L.a, L.a), b = GD.toEN(L.b, L.a), q = GD.toEN(p, L.a), len = Math.hypot(b.e - a.e, b.n - a.n); return ((q.e - a.e) * (b.e - a.e) + (q.n - a.n) * (b.n - a.n)) / len; };",
    "const saveMission = () => { w.saves++; }, logClient = (k, d) => w.calls.push(['log', k, d]);",
    "const flashNote = (t) => w.notes.push(t), showBanner = (t) => w.banners.push(t), takeDownBanner = () => {}, render = () => {};",
    "const applyCmdState = () => {}, canCommand = () => w.canCommand, supervising = () => true, setTip = () => {};",
    "const guiConfirm = async () => true, ensureNogoCovers = async () => true;",
    "const holdOpts = () => ({}), patClipBufM = () => 5, holdClearAt = () => 7, tailEndsAtHold = () => false, routeTooLong = () => false;",
    "const planNogoRoute = (from, to) => w.plan(from, to);",
    "const planInsideChart = async (pts, opts, plan) => plan();",
    // THE ROUTE WORKER (2026-10-12) is not here: each search runs on this thread as it always did (tests/route_worker.js)
    "const planOffThread = async (job, here) => here();",
    "const planWhy = (p) => p && p.error, heldOffWhy = () => 'it is held off';",
    "const notTookSay = (r) => 'REFUSED: ' + (r && r.error);",
    "const took = (r) => !!(r && r.ok);",
    "const cmd = async (path, body) => { w.calls.push(['cmd', path, body]); if (w.onCmd) w.onCmd(path); return path === '/api/cmd/upload' ? w.upload : {ok: true}; };",
    "const dropCornerSlow = (why) => w.calls.push(['corner', why]);",
    "const setPlanIntent = (k, p, r) => { planIntent = {kind: k, why: [], route: r.length}; };",
    "const legStartsHere = () => {};",
    "const startRun = async (opts) => { w.calls.push(['start', opts]); return w.start; };",
    decl("SURVEY_BREAK_BACK_M"), decl("BREAKS_MAX"),
    "let breakSel = null, continueBusy = false, breakReadySaid = null;",
    grab("lineMark"), grab("resumePointOn"),
    grab("surveyBreakNow"), grab("bankBreak"), grab("breakList"), grab("breakSelected"), grab("breakLabel"),
    grab("breakReady"), grab("breakTail"), grab("continueSurvey"),
    "return {now: (why) => surveyBreakNow(why), bank: bankBreak, ready: breakReady, tail: breakTail, cont: continueSurvey,",
    "        mission: () => mission, runRoute: () => runRoute, setS: (s) => { S = s; w.S = s; }, setAsv: (p) => { asv = p; } };",
  ].join("\n");
  w.V = v;
  w.api = new Function("w", "GD", "F", "SV", src)(w, GD, F, SV);
  return w;
}

console.log("A survey broken off for a return home, and Continue:");

// ── 1. THE RECORD ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  // running east down line 1, 129 m along it, heading for its end (route index 2)
  const W = world({ route: ROUTE });
  const r = W.api.now("fuel");
  check("1. A SURVEY UNDER WAY BROKEN OFF IS RECORDED: its line's own ends, how far along it and which way, the remainder "
        + "from the waypoint she was heading for, its survey (S2) and her level - and the record names why",
        () => r && r.why === "fuel" && r.sv === "S2" && r.no === 2 && r.name === "North" && r.line_no === 1
              && Math.abs(r.line.along - 129) < 0.5 && r.line.fwd === 1 && GD.distTo(r.line.a, LA) < 0.01 && GD.distTo(r.line.b, LB) < 0.01
              && r.route.length === 4 && GD.distTo(r.route[0], LB) < 0.01 && r.route[1].turn === true && r.level === 60 && r.unit === "L",
        () => JSON.stringify({why: r && r.why, sv: r && r.sv, line_no: r && r.line_no, along: r && r.line && Math.round(r.line.along), fwd: r && r.line && r.line.fwd, wpts: r && r.route.length, level: r && r.level}));
  // paused: the mark from the press of Pause, not where she has drifted to
  const P = world({ route: ROUTE, S: { behavior: "survey", run: "paused", status: { fuel_l: 60 } }, asv: LL(300, 30),
                    pauseMark: { line: 0, along: 129, fwd: 1, at: LL(129, 0) } });
  const rp = P.api.now("rth");
  check("1b. ... a PAUSED run's from the press of Pause - not where she has drifted to since - and an operator's RTH "
        + "says so ('rth')",
        () => rp && rp.why === "rth" && rp.line && Math.abs(rp.line.along - 129) < 0.5,
        () => "along " + (rp && rp.line && rp.line.along) + " (she has drifted to 300 m), why " + (rp && rp.why));
  // between lines (on the turn): no line, the remainder from the turn's waypoint
  const T = world({ route: ROUTE, runLineIdx: -1, asv: LL(430, 20), wpIndex: 3 });
  const rt = T.api.now("fuel");
  check("1c. ... broken off BETWEEN lines (on a turn): no line - nothing to back down - and the remainder from the turn on",
        () => rt && rt.line === null && rt.line_no === null && rt.route.length === 3 && rt.route[0].turn === true,
        () => JSON.stringify({line: rt && rt.line, wpts: rt && rt.route.length}));
  const none = [
    world({ route: ROUTE, S: { behavior: "goto", run: "running", status: {} } }).api.now("rth"),
    world({ route: ROUTE, S: { behavior: "survey", run: "running", status: { holding: true } } }).api.now("rth"),
    world({ route: ROUTE, wpIndex: 6 }).api.now("rth"),
    world({ route: ROUTE, S: { behavior: "survey", run: "idle", status: {} } }).api.now("rth"),
  ];
  check("1d. ... and NOTHING is recorded for another behavior, a survey holding (its end, or a hold), the end of the "
        + "plan, or a run not under way",
        () => none.every((x) => x === null),
        () => JSON.stringify(none));
}

// ── 2. BANKED ON THE PLAN ─────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world({ route: ROUTE });
  const rec = (sv, t) => ({ id: "B" + t, t, why: "fuel", sv, no: 1, route: [LB], line: null });
  // one per survey: S2 broken off twice keeps only its later record (a list that kept both would read B3,B2,B1)
  W.api.bank(rec("S1", 1)); W.api.bank(rec("S2", 2)); W.api.bank(rec("S2", 3));
  const per = W.api.mission().breaks.map((b) => b.id).join(",");
  // three in all: a fourth survey's pushes the oldest out
  const C = world({ route: ROUTE });
  C.api.bank(rec("S1", 1)); C.api.bank(rec("S2", 2)); C.api.bank(rec("S3", 3)); C.api.bank(rec("S4", 4));
  const cap = C.api.mission().breaks.map((b) => b.id).join(",");
  check("2. BANKED ON THE PLAN: newest first, ONE per survey (a later break-off of S2 replaces its earlier one), three in "
        + "all, and saved",
        () => per === "B3,B1" && cap === "B4,B3,B2" && W.saves === 3,
        () => "S1, S2, S2 -> " + per + " (want B3,B1); four surveys -> " + cap + " (want B4,B3,B2); saves " + W.saves);
}

// ── 3. THE REFUEL GATE ────────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world({ route: ROUTE });
  const b = { id: "B1", why: "fuel", level: 49.6, unit: "L", route: [LB] };
  const at = (fuel) => { W.api.setS({ behavior: "rth", run: "running", status: { fuel_l: fuel, holding: true } }); return W.api.ready(b); };
  const r1 = at(50), r2 = at(54.5), r3 = at(55), r4 = at(null);
  const op = W.api.ready({ id: "B2", why: "rth", level: 49.6, unit: "L", route: [LB] });
  check("3. THE REFUEL GATE: a fuel break-off waits until she is refueled - her level up 2% of the 250 L tank (5 L) since "
        + "she broke off at 49.6 L - and says so; a vessel reporting no level, or an operator's RTH, does not wait",
        () => !r1.ok && /REFUELED/.test(r1.why) && !r2.ok && r3.ok && r4.ok && op.ok,
        () => "50 L: " + r1.ok + ", 54.5: " + r2.ok + ", 55: " + r3.ok + ", no level: " + r4.ok + ", operator's: " + op.ok);
}

// ── 4. THE POINT ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const W = world({ route: ROUTE });
  const rec = (along, fwd) => ({ id: "B", why: "rth", route: [LB, L2A], line: { a: LA, b: LB, along, fwd } });
  const t = W.api.tail(rec(129, 1)), p = EN(t.to);
  const back = W.api.tail(rec(260, -1)), pb = EN(back.to);
  const early = W.api.tail(rec(40, 1)), pe = EN(early.to);
  const noLine = W.api.tail({ id: "B", route: [LB, L2A], line: null });
  check("4. THE POINT: 100 m back down her line on the side she came FROM, ON the line - 29 m along at 129 m heading "
        + "east; 360 m along at 260 m heading west - then the remainder",
        () => Math.abs(p.e - 29) < 0.2 && Math.abs(p.n) < 0.2 && t.backedM === 100 && t.tail.length === 3 && GD.distTo(t.tail[1], LB) < 0.01
              && Math.abs(pb.e - 360) < 0.2 && Math.abs(pb.n) < 0.2,
        () => "east: " + p.e.toFixed(1) + " m (" + t.backedM + " back), west: " + pb.e.toFixed(1) + " m");
  check("4b. ... CLAMPED at the line's start when she broke off nearer it than 100 m (40 m along: back to its start, 40 m "
        + "of overlap), and a break-off between lines starts from its remainder",
        () => Math.abs(pe.e) < 0.2 && Math.abs(early.backedM - 40) < 1e-6 && noLine.to === null && noLine.tail.length === 2,
        () => "40 m along -> " + pe.e.toFixed(1) + " m, " + early.backedM + " back; no line -> " + noLine.tail.length + " waypoints");
}

// ── 5. CONTINUE ───────────────────────────────────────────────────────────────────────────────────────────────────
const REC = () => ({ id: "B1", t: 1, why: "fuel", sv: "S2", no: 2, name: "North", line_no: 1,
                     line: { a: LA, b: LB, along: 129, fwd: 1 }, route: [LB, L2A, L2B], level: 49.6, unit: "L" });
const homeAt = (o) => world(Object.assign({ asv: LL(-200, -100),
  S: { behavior: "rth", run: "running", armed: true, status: { fuel_l: 250, holding: true } } }, o || {}));
(async () => {
  {
    const W = homeAt(); W.mission.breaks = [REC()];
    await W.api.cont();
    const up = W.calls.find((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload"), st = W.calls.find((c) => c[0] === "start");
    const route = up && up[2].route, p2 = route && EN(route[1]);
    check("5. CONTINUE: the way in routed and put in front (the router's detour), then the line 100 m back from the "
          + "break-off (29 m along), then what she had left - uploaded, started as a FRESH run without a second question - "
          + "and the record SPENT and saved",
          () => route && route.length === 5 && Math.abs(p2.e - 29) < 0.2 && Math.abs(p2.n) < 0.2 && GD.distTo(route[2], LB) < 0.01
                && st && st[1].fresh === true && st[1].confirmed === true && W.mission.breaks.length === 0 && W.saves === 1
                && /SURVEY CONTINUED/.test(W.banners[W.banners.length - 1] || ""),
          () => "route " + (route ? route.length : "none") + " (want 5), rejoin " + (p2 ? p2.e.toFixed(1) : "-") + " m along, start "
              + JSON.stringify(st && st[1]) + ", breaks left " + W.mission.breaks.length);
  }
  {
    const W = homeAt({ plan: () => ({ error: "no clear route to the target" }) }); W.mission.breaks = [REC()];
    await W.api.cont();
    const U = homeAt({ upload: { ok: false, refused: true, error: "ARM before uploading a plan" } }); U.mission.breaks = [REC()];
    await U.api.cont();
    const N = homeAt({ start: false }); N.mission.breaks = [REC()];
    await N.api.cont();
    const sent = (x) => x.calls.filter((c) => c[0] === "cmd").map((c) => c[1]);
    check("5b. ... and on a FAILURE the break-off is KEPT and nothing more is sent: no way in (nothing at all), a refused "
          + "upload (no Start), a Start that did not start (uploaded, said so)",
          () => sent(W).length === 0 && W.mission.breaks.length === 1 && /CANNOT CONTINUE/.test(W.banners.join(" "))
                && sent(U).join() === "/api/cmd/upload" && !U.calls.some((c) => c[0] === "start") && U.mission.breaks.length === 1
                && N.mission.breaks.length === 1 && /did NOT start/.test(N.banners.join(" ")),
          () => "no route: sent " + JSON.stringify(sent(W)) + "; refused upload: " + JSON.stringify(sent(U)) + "; start failed: kept "
              + N.mission.breaks.length);
  }
  {
    // commanded while the way in was being planned: the router's call flips the world under it
    const W = homeAt(); W.mission.breaks = [REC()];
    W.plan = (from, to) => { W.canCommand = false; return { route: [to] }; };
    await W.api.cont();
    check("5c. ... and one COMMANDED, DISARMED OR STOPPED while the way in was being planned is not uploaded over: asked "
          + "again after the awaits, nothing sent, the break-off kept",
          () => !W.calls.some((c) => c[0] === "cmd") && W.mission.breaks.length === 1 && /NOT CONTINUED/.test(W.banners.join(" ")),
          () => "sent " + JSON.stringify(W.calls.filter((c) => c[0] === "cmd").map((c) => c[1])));
  }
  {
    // not refueled: no Continue at all; under way: no Continue
    const W = homeAt({ S: { behavior: "rth", run: "running", armed: true, status: { fuel_l: 50, holding: true } } }); W.mission.breaks = [REC()];
    await W.api.cont();
    const U = homeAt({ S: { behavior: "goto", run: "running", armed: true, status: { fuel_l: 250, holding: false } } }); U.mission.breaks = [REC()];
    await U.api.cont();
    check("5d. ... and it is not CONTINUED before she is refueled, nor while she is under way on something else",
          () => !W.calls.some((c) => c[0] === "cmd") && /REFUELED/.test(W.notes.join(" ")) && !U.calls.some((c) => c[0] === "cmd")
                && /under way/.test(U.notes.join(" ")),
          () => "unrefueled: " + W.notes.join(" | ").slice(0, 80) + "; under way: " + U.notes.join(" | ").slice(0, 60));
  }

  // ── 6. THE WIRING ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    const R = grab("doRTH"), firstAwait = R.indexOf("await "), take = R.indexOf("surveyBreakNow("), bank = R.indexOf("bankBreak(brk)");
    const tookAt = R.lastIndexOf("if(!took(r)){", bank);
    check("6. doRTH takes the record BEFORE its first await (before the RTH replaces the plan aboard), never for the "
          + "end-of-plan chain, and banks it only AFTER the RTH took; the fuel monitor's RTH is a 'fuel' break-off",
          () => take > 0 && take < firstAwait && /const brk = chained \? null : surveyBreakNow\(opts && opts\.breakWhy\);/.test(R)
                && bank > tookAt && tookAt > 0 && /breakWhy: "fuel"/.test(grab("fuelTick")),
          "doRTH / fuelTick");
    const bar = H.slice(H.indexOf('id="b_start"'), H.indexOf('id="b_pause"'));
    check("6b. CONTINUE sits beside Start; Start skips its pause-resume and its question only for Continue's fresh, "
          + "already-confirmed plan; the plan's loader keeps the break-offs (or the next save would drop them)",
          () => /id="b_continue"/.test(bar) && /id="b_contSel"/.test(bar) && /id="b_contDrop"/.test(bar)
                && /if\(S && S\.run === "paused" && !fresh\) return resumeRun\(\);/.test(grab("startRun"))
                && (H.match(/fresh: true/g) || []).length === 2 && /fresh: true/.test(grab("continueSurvey"))
                && /fresh: true/.test(grab("reflyStrike"))   // the re-fly is the second already-confirmed fresh start (2026-11-05)
                && /if\(!confirmed && !await guiConfirm\("Start the autonomous survey"/.test(grab("startRun"))
                && /breaks:Array\.isArray\(m\.breaks\) \? m\.breaks : \[\]/.test(grab("loadMission"))
                && /renderBreakControls\(armed, estop, underWay\)/.test(grab("applyCmdState")),
          "the command bar / startRun / loadMission / applyCmdState");
  }
  // ── 7-10. THE RE-FLY OFFER (2026-11-05) ───────────────────────────────────────────────────────────────────────
  // Its own world: the strike cluster's functions lifted real (strikeReady included - the real blockedInfo under
  // it, so "occupied" is geometry, not a stub's say-so), the moored CLIP a lever (its own unit is ais_avoid 32/33),
  // and the three elements path_card-style fakes so render states are read back, never described.
  function reflyWorld(o) {
    const w = Object.assign({
      S: { behavior: "hold", run: "running", status: { holding: true }, armed: true, estop: false },
      asv: LL(-150, -80), mission: { lines: LINES, surveys: [], breaks: [], strikes: [] },
      calls: [], banners: [], notes: [], tips: [], asked: [], saves: 0, canCommand: true, confirm: true,
      covers: [], clearAsk: [], heldOffer: null, guardHeld: null, tailHold: false, tooLong: false, pin: null,
      moored: { polys: [], stale: false, note: null },
      plan: (from, to) => ({ route: [LL(-100, -40), to] }),          // the router: a detour, then the target
      upload: { ok: true }, start: true,
    }, o || {});
    const mkEl = (id) => { const cls = new Set(); return { id, textContent: "", value: "", disabled: false,
        style: {}, dataset: {}, title: "", kids: [],
        appendChild(k) { this.kids.push(k); },
        classList: { toggle(c, f) { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; },
                     contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }; };
    w.els = { "#b_refly": mkEl("b_refly"), "#b_reflySel": mkEl("b_reflySel"), "#b_reflyDrop": mkEl("b_reflyDrop") };
    const src = [
      "const {distTo, azTo} = GD;",
      "let S = w.S, asv = w.asv, mission = w.mission, runRoute = w.route || null, runUnsafe = [], planIntent = null;",
      "const nogo = { ready: true, frame: FR, ko: null, buffer: 3 };",
      "let aisVessels = [], aisPolledAt = 1000, aisTorn = false;",
      "const aisMooredClipKeepouts = () => w.moored;",                                 // the lever; the real one is ais_avoid 32
      "const blockedInfo = KO.blockedInfo;",
      "const fmtDist = (m) => m.toFixed(1) + ' m';",
      "const saveMission = () => { w.saves++; }, logClient = (k, d) => w.calls.push(['log', k, d]);",
      "const flashNote = (t) => w.notes.push(t), showBanner = (t) => w.banners.push(t), takeDownBanner = () => {}, render = () => {};",
      "const applyCmdState = () => {}, canCommand = () => w.canCommand, supervising = () => w.supervising !== false;",
      "const setTip = (el, t) => { el.title = t; w.tips.push(t); };",
      "const guiConfirm = async (t, m, opts) => { w.asked.push({ t, opts: opts || {} }); return w.confirm; };",
      // RECORDED, not swallowed (review C11): covering the WHOLE banked tail is the diff's own widening over
      // Continue's [from, target], so the check reads what was actually asked for.
      "const ensureNogoCovers = async (pts) => { w.covers.push(pts); return true; };",
      // ... and holdClearAt records ITS point (review C17): the disc is the one safety number the vessel acts on.
      "const holdOpts = () => ({}), patClipBufM = () => 5;",
      "const holdClearAt = (ll) => { w.clearAsk.push(ll); return 7; };",
      "const tailEndsAtHold = () => w.tailHold === true;",
      "const routeTooLong = (n) => { if (w.tooLong) { w.notes.push('too long ' + n); return true; } return false; };",
      // the guard's bank (review C1): the held rung reads the SYNCHRONOUS marker beside the derived offer
      "let guardHeld = w.guardHeld || null;",
      "const guardHeldOffer = () => w.heldOffer || null;",
      "const planNogoRoute = (from, to) => w.plan(from, to);",
      // `during` runs inside the planning await - the world a press can change under the page's feet (5c's idiom);
      // `pin` steers the ANSWER (review C10): error / heldOff / withdrawn / degraded are refusal branches too.
      "const planInsideChart = async (pts, opts, plan) => { if (w.during) w.during(); return w.pin ? w.pin : plan(); };",
      "const planOffThread = async (job, here) => here();",
      "const planWhy = (p) => p && p.error, heldOffWhy = () => 'it is held off';",
      "const notTookSay = (r) => 'REFUSED: ' + (r && r.error);",
      "const took = (r) => !!(r && r.ok);",
      "const cmd = async (path, body) => { w.calls.push(['cmd', path, body]); if (w.onCmd) w.onCmd(path); return path === '/api/cmd/upload' ? w.upload : {ok: true}; };",
      "const dropCornerSlow = (why) => w.calls.push(['corner', why]);",
      "const setPlanIntent = (k, p, r) => { planIntent = {kind: k, why: [], route: r.length}; };",
      "const legStartsHere = () => {};",
      "const startRun = async (opts) => { w.calls.push(['start', opts]); return w.start; };",
      "const document = { createElement: () => ({ value: '', textContent: '' }) };",
      "const $ = (s) => w.els[s] || null;",
      "let strikeSel = null, reflyBusy = false;",
      "const strikeReadySaid = new Set();",
      "let strikeReadyMemo = null;",
      grab("strikeList"), grab("strikeSelected"), grab("strikeLabel"), grab("strikeReady"),
      grab("renderStrikeControls"), grab("reflyStrike"), grab("dropStrike"),
      "return { list: strikeList, sel: strikeSelected, label: strikeLabel, ready: strikeReady,",
      "         render: (a, e, u) => renderStrikeControls(a, e, u), fly: reflyStrike, drop: dropStrike,",
      "         mission: () => mission, setS: (s) => { S = s; w.S = s; },",
      "         setSel: (v) => { strikeSel = v; }, busy: () => reflyBusy,",
      "         setHeld: (v) => { guardHeld = v; },",                             // the hold won mid-press (C1)
      "         bump: () => { aisPolledAt++; } };",                               // a fresh poll, as the memo keys it
    ].join("\n");
    w.api = new Function("w", "GD", "KO", "FR", src)(w, GD, KO, fr);
    return w;
  }
  // a moored contact's poly, r meters square round frame point (e, n) - real geometry for the real blockedInfo
  const SQ = (e, n, r) => ({ ring: [{ e: e - r, n: n - r }, { e: e + r, n: n - r }, { e: e + r, n: n + r }, { e: e - r, n: n + r }],
                             bb: { x0: e - r, y0: n - r, x1: e + r, y1: n + r },
                             kind: "AIS: BARGE (30 x 8 m, moored)", mmsi: 111222333, moving: false });
  // a banked strike: two waypoints down line 1, struck when the barge sat on the first; `e0` places a
  // second record's own water elsewhere so two banked stretches can disagree (C4/C12/C13)
  const SREC = (id, e0 = 100) => ({ id: id || "k1", t: 1760000000000, n: 2, m: 40, lines: [1],
                                    by: ["AIS: BARGE (30 x 8 m, moored)"],
                                    wps: [LL(e0, 0), LL(e0 + 40, 0)] });

  // ── 7. THE CLUSTER RENDERS FROM THE WATER ──
  {
    const W = reflyWorld();
    W.api.render(true, false, false);
    const hidden = W.els["#b_refly"].style.display === "none" && W.els["#b_reflyDrop"].style.display === "none";
    W.mission.strikes = [SREC()];
    W.moored = { polys: [SQ(100, 0, 30)], stale: false, note: "1 vessel not under way" };   // she is still on wp 1
    W.api.bump();
    W.api.render(true, false, false);
    const occ = { shown: W.els["#b_refly"].style.display === "", disabled: W.els["#b_refly"].disabled,
                  flash: W.els["#b_refly"].classList.contains("flash"), tip: W.tips[W.tips.length - 1] || "" };
    W.moored = { polys: [], stale: false, note: "0 vessels not under way" };                 // she sailed
    W.api.bump();
    W.api.render(true, false, false);
    const clear = { disabled: W.els["#b_refly"].disabled, flash: W.els["#b_refly"].classList.contains("flash"),
                    tip: W.tips[W.tips.length - 1] || "", banners: W.banners.filter((b) => /WATER CLEAR/.test(b)).length };
    W.api.render(true, false, false);
    const saidOnce = W.banners.filter((b) => /WATER CLEAR/.test(b)).length;
    W.moored = { polys: [], stale: true, note: "no AIS read in hand (the layer is off, or the last poll failed)" };
    W.api.bump();
    W.api.render(true, false, false);
    const stale = { disabled: W.els["#b_refly"].disabled, tip: W.tips[W.tips.length - 1] || "" };
    check("7. the cluster renders from the water: hidden with nothing banked; shown-but-disabled while the berth is "
          + "occupied, the tip saying NOT YET and why; enabled and FLASHING when it tests clear, said ONCE as a banner; "
          + "a stale feed disables it with 'cannot tell', never 'clear'",
          () => hidden && occ.shown && occ.disabled && !occ.flash && /NOT YET/.test(occ.tip) && /still occupied/.test(occ.tip)
                && clear.disabled === false && clear.flash === true && !/NOT YET/.test(clear.tip)
                && clear.banners === 1 && saidOnce === 1
                && stale.disabled && /no AIS read in hand/.test(stale.tip),
          () => JSON.stringify({ hidden, occ: { d: occ.disabled, f: occ.flash }, clear: { d: clear.disabled, f: clear.flash },
                                 said: saidOnce, stale: stale.disabled }));
    // 7b. Continue's own gate chain, in Continue's order, water first
    const G = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] } });
    G.api.render(true, true, false);                              // E-STOP
    const gEstop = G.tips[G.tips.length - 1] || "";
    G.api.render(false, false, false);                            // disarmed
    const gArm = G.tips[G.tips.length - 1] || "";
    G.supervising = false;
    G.api.render(true, false, false);                             // view-only tab
    const gSup = G.tips[G.tips.length - 1] || "";
    G.supervising = true;
    G.api.render(true, false, true);                              // under way
    const gWay = G.tips[G.tips.length - 1] || "";
    const sel2 = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC("k1"), SREC("k2")] } });
    sel2.api.render(true, false, false);
    const selShown = sel2.els["#b_reflySel"].style.display === "" && sel2.els["#b_reflySel"].kids.length === 2
                     && sel2.els["#b_reflySel"].dataset.key === "k1,k2";
    check("7b. the gates speak in Continue's order and the selector appears only for two or more records",
          () => /clear E-STOP first/.test(gEstop) && /arm her first/.test(gArm)
                && /not supervising/.test(gSup) && /under way/.test(gWay) && selShown,
          () => JSON.stringify({ gEstop: gEstop.slice(0, 40), gArm: gArm.slice(0, 40), sel: selShown }));

    // 7c. the selector is rebuilt only when the BANK changes (review C16): at 4 Hz a rebuild-every-frame
    // select resets the operator's open dropdown four times a second, exactly when more than one stretch matters.
    sel2.api.render(true, false, false);
    check("7c. a second render leaves the selector's options alone - the dataset.key guard owns the rebuild",
          () => sel2.els["#b_reflySel"].kids.length === 2 && sel2.els["#b_reflySel"].dataset.key === "k1,k2",
          () => "kids " + sel2.els["#b_reflySel"].kids.length + ", key " + sel2.els["#b_reflySel"].dataset.key);

    // 7d. EVERY banked record is watched, not only the selected one (review C4/C13): the selected berth still
    // occupied, the OTHER one clear - the clear one is bannered, naming the selector, while the button stays
    // honestly disabled for the selected record.
    const W4 = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC("k1", 100), SREC("k2", 300)] },
                            moored: { polys: [SQ(100, 0, 30)], stale: false, note: "1 vessel not under way" } });
    W4.api.render(true, false, false);
    check("7d. the watch covers every banked record: a non-selected stretch's clearing is bannered (naming the "
          + "selector) while the selected, still-occupied one keeps the button disabled",
          () => W4.els["#b_refly"].disabled === true
                && W4.banners.filter((b) => /WATER CLEAR/.test(b)).length === 1
                && /The selector beside Re-fly picks it/.test(W4.banners.join(" ")),
          () => JSON.stringify(W4.banners));

    // 7e. a berth that clears, re-occupies and clears again is announced AGAIN (review C5): the said-once
    // latch lets go with the water - unlike a refuel, occupancy is not monotonic, and the clearing the
    // operator can actually act on must never be the one left unsaid.
    const W5 = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC("k1")] } });
    W5.api.render(true, false, false);                                                   // clear -> said
    W5.moored = { polys: [SQ(100, 0, 30)], stale: false, note: "1" }; W5.api.bump();
    W5.api.render(true, false, false);                                                   // re-occupied -> re-armed
    W5.moored = { polys: [], stale: false, note: "0" }; W5.api.bump();
    W5.api.render(true, false, false);                                                   // clear again -> said AGAIN
    W5.api.render(true, false, false);                                                   // ... and only once
    check("7e. clear, re-occupied, clear again: the WATER CLEAR banner is said once per CLEARING, not once per "
          + "session - the re-occupation re-arms it",
          () => W5.banners.filter((b) => /WATER CLEAR/.test(b)).length === 2,
          () => W5.banners.filter((b) => /WATER CLEAR/.test(b)).length + " said: " + JSON.stringify(W5.banners.slice(-2)));

    // 7f. the x re-enables ITSELF (review C7): applyViewOnly disables every .cbtn in a view-only tab and
    // re-enables nothing on a takeover, so a control that wants to live again must write its own state per frame.
    const W6 = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC("k1")] } });
    W6.els["#b_reflyDrop"].disabled = true;
    W6.els["#b_reflyDrop"].title = "VIEW ONLY — another tab is supervising.";
    W6.api.render(true, false, false);
    check("7f. the x writes its own disabled state and title every frame, so a takeover from view-only gets it back",
          () => W6.els["#b_reflyDrop"].disabled === false
                && /Drop this struck-coverage record/.test(W6.els["#b_reflyDrop"].title),
          () => "disabled " + W6.els["#b_reflyDrop"].disabled + ", title " + W6.els["#b_reflyDrop"].title.slice(0, 40));
  }

  // ── 8. THE PRESS ──
  {
    const W = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] } });
    await W.api.fly();
    const up = W.calls.find((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload");
    const start = W.calls.find((c) => c[0] === "start");
    const log = W.calls.find((c) => c[0] === "log" && c[1] === "strike_refly");
    check("8. the press re-flies the struck stretch: asked once, the chart read over the WHOLE banked tail (not "
          + "only the target), the way in routed and put IN FRONT, uploaded with the clear disc measured at the "
          + "route's LAST point, started fresh and already confirmed, the record SPENT only then, said and logged",
          () => W.asked.length === 1 && !W.asked[0].opts.always
                && up && up[2].route.length === 3 && up[2].hold_clear_m === 7
                && Math.abs(EN(up[2].route[0]).e - (-100)) < 1 && Math.abs(EN(up[2].route[1]).e - 100) < 1
                && Math.abs(EN(up[2].route[2]).e - 140) < 1
                && W.covers.length === 1 && W.covers[0].length === 3                                   // [from, wp1, wp2] (C11)
                && Math.abs(EN(W.covers[0][1]).e - 100) < 1 && Math.abs(EN(W.covers[0][2]).e - 140) < 1
                && W.clearAsk.length === 1 && Math.abs(EN(W.clearAsk[0]).e - 140) < 1                  // the disc at the END (C17)
                && up[2].completion === undefined                                                      // no hold pending: no loiter
                && start && start[1].confirmed === true && start[1].fresh === true
                && W.mission.strikes.length === 0 && W.saves === 1
                && /STRUCK COVERAGE RE-FLOWN/.test(W.banners.join(" "))
                && log && log[2].wpts === 2 && log[2].via === 1 && W.api.busy() === false,
          () => "asked " + W.asked.length + "; route " + (up ? up[2].route.length : "none") + "; covers "
                + JSON.stringify(W.covers.map((c) => c.length)) + "; strikes left "
                + W.mission.strikes.length + "; " + JSON.stringify(W.calls.map((c) => c[0] + ":" + (c[1] || ""))));
    // 8b. a Start that did not take keeps the record
    const B = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] }, start: false });
    await B.api.fly();
    check("8b. a Start that does not take keeps the record - UPLOADED but NOT started, said in words",
          () => B.mission.strikes.length === 1 && /did NOT start/.test(B.banners.join(" ")) && B.saves === 0,
          () => "strikes " + B.mission.strikes.length + "; " + B.banners.join(" | ").slice(0, 80));
    // 8c. a refused upload keeps the record
    const C = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] },
                           upload: { ok: false, error: "the link is down" } });
    await C.api.fly();
    check("8c. a refused upload keeps the record and nothing is started",
          () => C.mission.strikes.length === 1 && /NOT RE-FLOWN/.test(C.banners.join(" "))
                && !C.calls.some((c) => c[0] === "start"),
          () => C.banners.join(" | ").slice(0, 100));
    // 8d. commanded/disarmed while the way in planned: asked AGAIN after the awaits
    const D = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] } });
    D.during = () => { D.canCommand = false; };
    await D.api.fly();
    check("8d. disarmed while the way in was being planned: asked again after the awaits, nothing sent, the record kept",
          () => D.mission.strikes.length === 1 && !D.calls.some((c) => c[0] === "cmd")
                && /NOT RE-FLOWN/.test(D.banners.join(" ")),
          () => D.banners.join(" | ").slice(0, 100));
    // 8e. THE WATER CHANGED while the way in planned: the ready test is re-asked and refuses
    const E = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] } });
    E.during = () => { E.moored = { polys: [SQ(100, 0, 30)], stale: false, note: "1 vessel not under way" }; E.api.bump(); };
    await E.api.fly();
    check("8e. a vessel that berths back while the way in is being planned refuses the press: the water is re-asked "
          + "after the awaits, nothing sent, the record kept - never an upload over a re-occupied berth",
          () => E.mission.strikes.length === 1 && !E.calls.some((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload")
                && /water changed/.test(E.banners.join(" ")) && /still occupied/.test(E.banners.join(" ")),
          () => E.banners.join(" | ").slice(0, 120));
    // 8f. a declined question sends nothing and keeps the record, without a banner
    const F2 = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] }, confirm: false });
    await F2.api.fly();
    // 8g. an occupied berth refuses the press up front, in the ready test's words
    const G2 = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] },
                            moored: { polys: [SQ(100, 0, 30)], stale: false, note: "1 vessel not under way" } });
    await G2.api.fly();
    check("8f/8g. a declined question sends nothing; an occupied berth refuses the press up front in the ready "
          + "test's own words - both keep the record",
          () => F2.mission.strikes.length === 1 && !F2.calls.some((c) => c[0] === "cmd")
                && G2.mission.strikes.length === 1 && !G2.calls.some((c) => c[0] === "cmd") && G2.asked.length === 0
                && /still occupied/.test(G2.notes.join(" ")),
          () => "declined: sent " + F2.calls.filter((c) => c[0] === "cmd").length + "; occupied: "
                + G2.notes.join(" | ").slice(0, 80));

    // 8h. THE ROUTE'S OWN REFUSALS (review C10): a failed search, a held-off target, a withdrawal and a
    // too-long route each stand down with the record kept; a DEGRADED answer flies the bare tail SAYING the
    // way in was not certified - the five branches the passthrough stub never reached.
    const mk8 = (o) => reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] }, ...o });
    // every press is WRAPPED (ais_avoid's tryIt rule): a refusal branch deleted makes the press THROW on the
    // missing route, and an unwrapped await turns that into a suite crash the mutation runner cannot name
    const flew = async (w) => { try { await w.api.fly(); return null; } catch (e) { return (e && e.message) || String(e); } };
    const PE = mk8({ pin: { error: "no clear route to the target" } });                           const peT = await flew(PE);
    const PH2 = mk8({ pin: { heldOff: { kind: "a dock / pier" } } });                             const phT = await flew(PH2);
    const PW = mk8({ pin: { withdrawn: true, error: "Re-fly withdrawn: STOP was pressed" } });    const pwT = await flew(PW);
    const PD = mk8({ pin: { degraded: true, route: [LL(0, 0)] } });                               const pdT = await flew(PD);
    const PL = mk8({ tooLong: true });                                                            const plT = await flew(PL);
    const sentOf = (w) => w.calls.filter((c) => c[0] === "cmd").map((c) => c[1]);
    const PDup = PD.calls.find((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload");
    check("8h. the route's refusals: a failed search and a held-off target refuse in words, a withdrawal stands "
          + "down silently (planInsideChart already said it), a too-long route sends nothing - each keeps the "
          + "record and none of them THROWS - and a DEGRADED answer flies the bare tail saying the way in is "
          + "NOT certified",
          () => peT === null && phT === null && pwT === null && pdT === null && plT === null
                && /CANNOT RE-FLY/.test(PE.banners.join(" ")) && sentOf(PE).length === 0 && PE.mission.strikes.length === 1
                && /cannot be certified/.test(PH2.banners.join(" ")) && sentOf(PH2).length === 0 && PH2.mission.strikes.length === 1
                && sentOf(PW).length === 0 && PW.mission.strikes.length === 1 && PW.api.busy() === false
                && sentOf(PL).length === 0 && PL.mission.strikes.length === 1
                && PDup && PDup[2].route.length === 2 && /NOT certified/.test(PD.banners.join(" "))
                && PD.mission.strikes.length === 0,
          () => JSON.stringify({ threw: [peT, phT, pwT, pdT, plT], err: sentOf(PE), held: sentOf(PH2),
                                 wd: sentOf(PW), long: sentOf(PL), deg: PDup ? PDup[2].route.length : "none" }));

    // 8i. THE GUARD'S BANK OUTRANKS THE OFFER (review C1, the FRIGGA shape a sixth time): with the plan she was
    // flying held by the guard, the button says why and the press refuses up front; a hold won WHILE the way in
    // planned refuses AFTER the awaits, read by the SYNCHRONOUS marker beside the derived offer - the re-fly
    // must never spend guardHeld's banked remainder unsaid.
    const GH = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] },
                            heldOffer: { route: [LL(0, 0)], idx: 1 } });
    GH.api.render(true, false, false);
    const ghTip = GH.tips[GH.tips.length - 1] || "";
    await GH.api.fly();
    const GH2 = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] } });
    GH2.during = () => { GH2.api.setHeld({ route: [LL(0, 0)], idx: 1 }); };
    await GH2.api.fly();
    check("8i. the guard's bank outranks the offer: held -> the button says why and the press refuses up front; "
          + "a hold won while the way in planned refuses AFTER the awaits by the synchronous marker - nothing "
          + "sent, the record kept, the held remainder never spent",
          () => GH.els["#b_refly"].disabled === true && /guard holds the plan/.test(ghTip)
                && !GH.calls.some((c) => c[0] === "cmd") && /guard holds the plan/.test(GH.notes.join(" "))
                && !GH2.calls.some((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload")
                && /NOT RE-FLOWN — the guard now holds/.test(GH2.banners.join(" "))
                && GH2.mission.strikes.length === 1,
          () => "tip " + ghTip.slice(0, 60) + "; mid-press: " + GH2.banners.join(" | ").slice(0, 100));

    // 8j. the x mid-press (review C3): a record dropped while the way in planned is NOT flown - membership is
    // the one post-await change the water test cannot see.
    const DJ = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] } });
    DJ.during = () => { DJ.mission.strikes = []; };
    await DJ.api.fly();
    check("8j. a record dropped while the way in was being planned is not flown: membership is re-asked after "
          + "the awaits",
          () => !DJ.calls.some((c) => c[0] === "cmd") && /dropped while the way in/.test(DJ.banners.join(" ")),
          () => DJ.banners.join(" | ").slice(0, 100));

    // 8k. ONE press at a time (review C14): a second press inside the first one's awaits asks and sends
    // nothing of its own, and mid-press the button reads re-flying.
    const DK = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] } });
    let dkTip = "";
    DK.during = () => { DK.api.fly(); DK.api.render(true, false, false); dkTip = DK.tips[DK.tips.length - 1] || ""; };
    await DK.api.fly();
    check("8k. a second press inside the first one's awaits is refused by the busy latch - one question, one "
          + "upload - and the button reads re-flying meanwhile",
          () => DK.asked.length === 1
                && DK.calls.filter((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload").length === 1
                && /re-flying/.test(dkTip),
          () => "asked " + DK.asked.length + ", uploads "
                + DK.calls.filter((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload").length + ", tip " + dkTip.slice(0, 40));

    // 8l. the loiter clause (review C17): a re-fly whose route ends at a pending hold's own point ships
    // completion:'loiter' - the 3b rule at this call site too (the sister pin is guard_resume's).
    const DL = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] }, tailHold: true });
    await DL.api.fly();
    const dlUp = DL.calls.find((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload");
    check("8l. a re-fly whose route ends at a pending hold's own point ships completion:'loiter'",
          () => dlUp && dlUp[2].completion === "loiter",
          () => "completion " + (dlUp ? JSON.stringify(dlUp[2].completion) : "no upload"));
  }

  // ── 9. THE DROP ──
  {
    const W = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: [SREC()] }, confirm: false });
    await W.api.drop();
    const kept = W.mission.strikes.length === 1 && W.asked[0] && W.asked[0].opts.always === true;
    W.confirm = true;
    await W.api.drop();
    check("9. the × asks even in the simulator ({always: true}); a NO keeps the record, a YES drops it, saves and logs",
          () => kept && W.mission.strikes.length === 0 && W.saves === 1
                && W.calls.some((c) => c[0] === "log" && c[1] === "strike_drop")
                && /dropped/.test(W.notes.join(" ")),
          () => "kept=" + kept + "; after yes " + W.mission.strikes.length + " record(s), saves " + W.saves);
  }

  // ── 11. THE SELECTION FLIES AND DROPS THE CHOSEN RECORD (review C12) ──────────────────────────────────────────
  {
    const strikes2 = () => [SREC("k1", 100), SREC("k2", 300)];
    const W = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: strikes2() } });
    W.api.setSel("k2");
    await W.api.fly();
    const up = W.calls.find((c) => c[0] === "cmd" && c[1] === "/api/cmd/upload");
    const D = reflyWorld({ mission: { lines: LINES, surveys: [], breaks: [], strikes: strikes2() } });
    D.api.setSel("k2");
    await D.api.drop();
    check("11. the selector's choice is what flies and what drops: Re-fly uploads the CHOSEN record's waypoints "
          + "and spends that record alone; the x drops the chosen one and keeps the other",
          () => up && Math.abs(EN(up[2].route[1]).e - 300) < 1 && Math.abs(EN(up[2].route[2]).e - 340) < 1
                && W.mission.strikes.length === 1 && W.mission.strikes[0].id === "k1"
                && D.mission.strikes.length === 1 && D.mission.strikes[0].id === "k1",
          () => "flown e=" + (up ? EN(up[2].route[1]).e.toFixed(0) : "none") + "; left after fly "
                + JSON.stringify(W.mission.strikes.map((s) => s.id)) + ", after drop "
                + JSON.stringify(D.mission.strikes.map((s) => s.id)));
  }

  // ── 10. THE WIRING ──
  {
    const bar = H.slice(H.indexOf('id="b_start"'), H.indexOf('id="b_pause"'));
    check("10. RE-FLY sits beside Continue in the command bar with its selector and its ×; applyCmdState renders it "
          + "each frame beside the break controls; the three presses are wired to their own functions",
          () => /id="b_refly"/.test(bar) && /id="b_reflySel"/.test(bar) && /id="b_reflyDrop"/.test(bar)
                && /renderStrikeControls\(armed, estop, underWay\)/.test(grab("applyCmdState"))
                && /\$\("#b_refly"\)\.onclick = \(\) => reflyStrike\(\);/.test(H)
                && /\$\("#b_reflySel"\)\.onchange = \(e\) => \{ strikeSel = e\.target\.value; applyCmdState\(S\); \};/.test(H)
                && /\$\("#b_reflyDrop"\)\.onclick = \(\) => dropStrike\(\);/.test(H)
                && /strikes:Array\.isArray\(m\.strikes\) \? m\.strikes : \[\]/.test(grab("loadMission")),
          "the command bar / applyCmdState / the wiring / loadMission");
  }

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
