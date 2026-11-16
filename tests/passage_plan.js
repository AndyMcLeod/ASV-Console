// tests/passage_plan.js - the passage, planned coarse: static/js/coarse.js, fuel.js passageFuel, and the page's Plan passage.
//
// Andy, 2026-10-12: "Step 4" of the long-transit plan - a passage planner for the DIESEL hulls, coarse over the whole
// passage, with FUEL STOPS and a check that every leg between them arrives with 20%. The server's grid (each chart
// tile as a plan of the water) is tests/passage_grid.py. Here:
//   1    THE CELLS: the grid file decoded; levels at a floor - unread, blocked (a center under it; AT the floor is
//        water), partly (only touched), clear; a file of the wrong size refused;
//   2    NEAR across a tile edge: a clear cell beside a partly one in the NEXT tile is near; one two cells off is not;
//   3    OPEN WATER: two tiles, one straight segment, its length the flat distance within 0.5%;
//   4    AN ISLAND: the route goes round it - no cell of it blocked - where (the control) open water is straight;
//   5    NO CORNER CUT: a wall of cells touching only at their corners is not slipped through;
//   5b   ... NOR INSIDE A PORT'S CIRCLE (2026-11-09): such a wall 1.5 km off a port gone ROUND by the search and the
//        coarse home field alike; the same wall closing the harbor, crossed;
//   5c   ... and a crossing there is no other way for runs straight through the land, not in square steps;
//   6    A PORT: a start 1 km inside land is left by water when it is a port; the same start NOT a port, refused;
//   6b   A PORT AT A BAY HEAD, A NECK OF LAND FROM ANOTHER SEA (Pago Pago, 2026-11-09): left BY WATER, out and in, never
//        over the land its circle reaches across; the bay shut, the neck crossed (the least land); the home field the same;
//   6c   THE PULL NEVER CUTS OVER LAND IN A PORT'S CIRCLE, open water on or off; a crossing it had to make kept to that;
//   7    UNREAD: an end off the chart read refused, with where; a band of unread water not crossed;
//   8    NARROW: a channel of cells a danger touches, the only way: the route takes it and says so once, its length;
//        the same channel inside a port's circle is not narrow;
//   9    PULLED TAUT, NEVER WORSE: over random fields, no segment crosses a blocked cell, and none is worse than the
//        stretch of path it replaced;
//   10   THE PASSAGE: a leg that cannot be planned carries why and where; the rest are planned; the ports said;
//   11   THE FUEL, LEG BY LEG (fuel.js passageFuel): the first leg from what is aboard (never more than a tank), the
//        rest from a full tank; arriving with exactly the reserve is enough; how far she gets before she is down to it;
//   12   THE PAGE'S POINTS: her position first (a port), the fuel stops and the arrival ports; without a fix T1 departs;
//   13   ONLY A DIESEL HULL: a battery hull, no fuel model, no transit speed - refused, said why;
//   14   A FUEL STOP is a click on a point: toggled, the line's plan dropped; the arrival is a port already;
//   15   FUEL LEGS cut at the ports, a leg not planned leaving its fuel leg NOT checked;
//   16   PLAN PASSAGE end to end, the console and the worker stubbed: the corridor read WITH grids, polled; each tile's
//        grid fetched; the worker given the floor in decimeters and the points; the plan kept, its fuel judged, the
//        reserve marked, said on the banner and logged; an edit while it planned, a worker that failed, a read that
//        stopped, a battery hull - refused and said, nothing kept;
//   17   THE WORDS: planned in part, what could not be and why, a fuel leg NOT checked, the ports planned in detail;
//   18   THE DRAWING: each planned leg's line, a failed leg straight and red, a mark per narrow stretch, a circle per
//        port, the reserve mark;
//   19   THE WIRING: the button, the drawing after the transit's, every edit of the line, the worker.
//   OPEN WATER FIRST (Andy, 2026-10-14: "For open ocean/or large bay, etc paths consider a more direct and less complex
//   path as a default consideration"; coarse.js openWaterCosts - checks 1-19 run with it, the default):
//   20   AN ISLAND CHAIN across the way: the passage goes ROUND it, at twice the berth the level rules thread it with, for
//        a few percent more length; with it off, through a gap as before;
//   20b  THE PULL KEEPS THE BERTH: past a headland the search keeps off, the cost rule keeps the taut route there - the
//        level rule alone, on the same search's cells, cuts it back toward the headland;
//   20c  NOT IN A PORT'S CIRCLE (the detail planner's water): the search's cells there are the level rules' own; off,
//        no tile carries the cost; the worker is told, and says which it planned with.
//   ONE READ, TWO READERS (2026-11-15, a SAFETY defect an adversarial review found: the page's coarse field home canceled
//   the chart read it shared with the far RTH's way home - the same tiles are the same job - and the way home was
//   refused for good). THE CONSOLE'S OWN JOB CODE IS UNDER THE PAGE HERE (tests/lib/corridor_console.py, a child running
//   asv_console.corridor_post and corridor_status, the tile reads alone stubbed and held at a gate; python on the path):
//   16s  400 km out the two asks are one job past the field's 60 tiles, the build sends no cancel and the way home is
//        planned; 300 km out the build joins the one read, each tile read once; alone, its ask starts nothing;
//   16t  a read stopped from elsewhere (the console's cancel) is answered late, not kept, naming the cause - not final -
//        and asked again it is planned; Plan passage says to press again;
//   16u  A WINDOW STILL ON THE OLD PAGE (the independent review ran the page of before this change against this console
//        and got the whole defect back): its build's ask with no limit, then its cancel, put to the console as it sends
//        them, in both orders - the way home's read is never stopped, and she is planned on her FIRST ask (the console
//        counts the asks on a read; a cancel takes back one; an ask never joins a read being stopped).
//   TEETH (scratchpad mut_cc.py: 13 page mutants on scratch copies through ASV_HTML, 17 of asv_console.py on a sidecar app
//   through ASV_APP, 1 with both; killed = the suite red AND the named check red; the real sources' sha1 unchanged):
//     THE ORIGINAL DEFECT (no limit in the ask, the read past 60 tiles canceled)      -> 16s (and 16u; fuel_rth 11f)
//     the limit dropped from the ask (and 16u); the error judged before the count; the
//     ask's limit one more than the build's                                           -> 16s
//     the planner's stopped-read branch dead (also 16b); answered without late; said
//     kept; the tab's line left "reading"; not logged; said in the old words          -> 16t
//     the console: the limit ignored; the refusal stopping the other asker's read;
//     the limit, or the route's direction, made part of the job's name; the refusal
//     without its count                                                               -> 16s
//     the console's cancel ignored (16t's own fixture: the read must really stop)     -> 16t
//     the console: a cancel stopping the read whatever asks are on it; an ask
//     rejoining a read being stopped; a joining ask not counted; a cancel taking back
//     every ask                                                                       -> 16u
//     BOTH LAYERS OUT - the old build on the page and the old cancel on the console    -> 16s, 16u, and the refusal ITSELF
//                                                                                        is back: "the chart read along
//                                                                                        it was stopped ..."
//   GREEN BY DESIGN, each a second layer earned apart (their own checks are red): the cancel restored with the limit
//   kept (fuel_rth 11f: the console refuses the ask before a job is held); a running read past the limit waited on
//   (11f: the console's own code never hands the build one); the limit judged only after a rejoin (16s green - the
//   page leaves a running read alone - enc_corridor 4d and 16u's count red); the refusal without its `over` flag (4d:
//   the page judges the count); the handler answering beside corridor_post (enc_corridor 5: the child here calls
//   corridor_post itself).
//   ⚠ A PROBE THAT ASKS IS AN ASK. 16s's "the same read" probe was first posted while the way home waited - one more ask
//   on her read, and on a read being stopped it STARTED A NEW ONE: with both layers out the way home read "planned". It
//   is posted after her answer now. Found by that mutant, which is why it is kept.
//
//   node tests/passage_plan.js   # exit 0 = pass

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
const C = require(path.join(APP, "static", "js", "coarse.js"));
const F = require(path.join(APP, "static", "js", "fuel.js"));

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
console.log("The passage, planned coarse:");

// ── a synthetic grid, as the server makes one ─────────────────────────────────────────────────────────────────────
const N = C.GRID_N, N2 = N * N, CD = C.CELL_DEG;
const TX = Math.round((-70.75 + 180) / C.TILE_DEG), TY = Math.round((43.0 + 90) / C.TILE_DEG);
function grid(tx, ty, fill = 300) {
  const W = tx * C.TILE_DEG - 180, S = ty * C.TILE_DEG - 90;
  return { head: { tile: [W, S, W + C.TILE_DEG, S + C.TILE_DEG] }, C: new Int16Array(N2).fill(fill), T: new Int16Array(N2).fill(fill),
           A: new Int16Array(N2).fill(32767), tx, ty };
}
const setC = (g, c, r, v) => { g.C[r * N + c] = v; if (g.T[r * N + c] > v) g.T[r * N + c] = v; };
const setT = (g, c, r, v) => { g.T[r * N + c] = v; };
const ll = (g, c, r) => ({ lat: (g.ty * N + r + 0.5) * CD - 90, lon: (g.tx * N + c + 0.5) * CD - 180 });
const enc = (g) => {                                  // the server's file layout (_grid_bytes)
  const hb = Buffer.from(JSON.stringify(Object.assign({ v: 2, n: N }, g.head)) + " ");
  const h2 = hb.length % 2 ? hb.slice(0, hb.length - 1) : hb;
  const len = Buffer.alloc(4); len.writeUInt32LE(h2.length);
  const b = Buffer.concat([Buffer.from("ASVG"), len, h2, Buffer.from(g.C.buffer), Buffer.from(g.T.buffer), Buffer.from(g.A.buffer)]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
};
const flat = (a, b) => Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));
const FLOOR = 30;

(async () => {
  // ── 1. the cells ────────────────────────────────────────────────────────────────────────────────────────────────
  const g1 = grid(TX, TY);
  setC(g1, 1, 1, C.GRID_UNREAD); setC(g1, 2, 1, 20); setT(g1, 3, 1, 20); setC(g1, 4, 1, FLOOR); setC(g1, 5, 1, C.GRID_HARD);
  const d1 = C.decodeGrid(enc(g1));
  const lv1 = C.tileLevels(d1.C, d1.T, FLOOR);
  let wrong = null;
  try { C.decodeGrid(enc(g1).slice(0, 1000)); } catch (e) { wrong = e.message; }
  check("1. THE CELLS: the file decoded as the server writes it; at a 3.0 m floor - unread, blocked (a center under it), "
        + "partly (only touched), clear, AT the floor water, land blocked; a file of the wrong size refused",
        () => lv1[N + 1] === C.LV_UNREAD && lv1[N + 2] === C.LV_BLOCKED && lv1[N + 3] === C.LV_PARTLY && lv1[N + 4] === C.LV_CLEAR
              && lv1[N + 5] === C.LV_BLOCKED && lv1[N + 6] === C.LV_CLEAR && d1.head.tile[0] === -70.75 && /size/.test(wrong || ""),
        () => "levels " + Array.from(lv1.slice(N + 1, N + 7)).join(",") + "; wrong-size: " + wrong);

  // ── 1b. OVERHEAD (2026-10-12): the grid's third layer, A - the lowest clearance over a cell ───────────────────
  // A cell a span or a line crosses lower than her need (airDm: air draft + overhead clearance, decimeters) is BLOCKED;
  // AT her need it is water; a hull with no air draft (airDm 0) judges nothing overhead. A plan goes round a low span
  // that a hull with no air draft passes under.
  const g1b = grid(TX, TY);
  g1b.A[N + 1] = 21; g1b.A[N + 2] = 39; g1b.A[N + 3] = 38; g1b.A[N + 4] = 0;
  const d1b = C.decodeGrid(enc(g1b));
  const lvAir = C.tileLevels(d1b.C, d1b.T, FLOOR, d1b.A, 39), lvNone = C.tileLevels(d1b.C, d1b.T, FLOOR, d1b.A, 0);
  const span = grid(TX, TY);
  for (let r = 40; r < 220; r++) for (let c = 126; c < 130; c++) span.A[r * N + c] = 21;      // a 2.1 m span, across
  const pa1b = ll(span, 60, 128), pb1b = ll(span, 200, 128);
  const under = C.planPassage({ grids: [span], floorDm: FLOOR, airDm: 0, points: [pa1b, pb1b] });
  const round = C.planPassage({ grids: [span], floorDm: FLOOR, airDm: 39, points: [pa1b, pb1b] });
  const fldR = C.buildField([span], FLOOR, 39);
  const cellsR = []; for (let k = 1; k < (round.legs[0].pts || []).length; k++)
    cellsR.push(...C.lineCells(C.cellOf(round.legs[0].pts[k - 1]), C.cellOf(round.legs[0].pts[k])));
  const worstR = cellsR.length ? Math.max(...cellsR.map((c) => fldR.level(c.gx, c.gy))) : -1;
  check("1b. OVERHEAD: the file's third layer decoded; a 2.1 m span blocks a hull needing 3.9 m, 3.9 m clears AT her need, "
        + "3.8 m does not, no clearance charted (0) blocks; a hull with no air draft judges none of it; a plan goes "
        + "ROUND a low span a hull with no air draft passes straight under",
        () => d1b.A[N + 1] === 21 && lvAir[N + 1] === C.LV_BLOCKED && lvAir[N + 2] === C.LV_CLEAR && lvAir[N + 3] === C.LV_BLOCKED
              && lvAir[N + 4] === C.LV_BLOCKED && [1, 2, 3, 4].every((k) => lvNone[N + k] === C.LV_CLEAR)
              && !under.legs[0].error && under.legs[0].pts.length === 2 && !round.legs[0].error
              && round.legs[0].lengthM > under.legs[0].lengthM * 1.2 && worstR < C.LV_BLOCKED,
        () => "levels at 3.9 m " + Array.from(lvAir.slice(N + 1, N + 5)).join(",") + ", at none " + Array.from(lvNone.slice(N + 1, N + 5)).join(",")
              + "; under " + (under.legs[0].error || Math.round(under.legs[0].lengthM) + " m/" + under.legs[0].pts.length + " pts")
              + ", round " + (round.legs[0].error || Math.round(round.legs[0].lengthM) + " m") + ", its worst cell " + worstR);

  // ── 2. near across a tile edge ──────────────────────────────────────────────────────────────────────────────────
  const gA = grid(TX, TY), gB = grid(TX + 1, TY);
  setT(gA, 255, 100, 0);
  const f2 = C.buildField([gA, gB], FLOOR);
  const lvB = (c, r) => f2.level(gB.tx * N + c, gB.ty * N + r);
  check("2. NEAR ACROSS A TILE EDGE: a clear cell beside a partly one in the NEXT tile is near (beside and on the "
        + "diagonal); one two cells off is clear",
        () => lvB(0, 100) === C.LV_NEAR && lvB(0, 101) === C.LV_NEAR && lvB(0, 102) === C.LV_CLEAR && lvB(1, 100) === C.LV_CLEAR,
        () => [lvB(0, 100), lvB(0, 101), lvB(0, 102), lvB(1, 100)].join(","));

  // ── 3. open water ───────────────────────────────────────────────────────────────────────────────────────────────
  const o1 = grid(TX, TY), o2 = grid(TX + 1, TY);
  const pa = ll(o1, 20, 128), pb = ll(o2, 230, 140);
  const p3 = C.planPassage({ grids: [o1, o2], floorDm: FLOOR, points: [pa, pb] });
  const L3 = p3.legs[0].lengthM, S3 = flat(pa, pb);
  check("3. OPEN WATER over two tiles: one straight segment, its length the flat distance within 0.5%",
        () => !p3.legs[0].error && p3.legs[0].pts.length === 2 && Math.abs(L3 - S3) / S3 < 0.005,
        () => "pts " + p3.legs[0].pts.length + ", " + L3.toFixed(0) + " m vs " + S3.toFixed(0) + " m");

  // ── 4. an island ────────────────────────────────────────────────────────────────────────────────────────────────
  const i1 = grid(TX, TY);
  for (let r = 80; r < 180; r++) for (let c = 100; c < 160; c++) setC(i1, c, r, C.GRID_HARD);
  const pa4 = ll(i1, 40, 130), pb4 = ll(i1, 220, 130);
  const p4 = C.planPassage({ grids: [i1], floorDm: FLOOR, points: [pa4, pb4] });
  const fld4 = C.buildField([i1], FLOOR);
  const cellsOf = (pts) => { const out = []; for (let k = 1; k < pts.length; k++) out.push(...C.lineCells(C.cellOf(pts[k - 1]), C.cellOf(pts[k]))); return out; };
  const worst4 = Math.max(...cellsOf(p4.legs[0].pts).map((c) => fld4.level(c.gx, c.gy)));
  const ctl4 = C.planPassage({ grids: [grid(TX, TY)], floorDm: FLOOR, points: [pa4, pb4] });
  check("4. AN ISLAND in the way: the route goes round it - no cell of it blocked - and is longer; the control, open "
        + "water, is straight",
        () => !p4.legs[0].error && worst4 < C.LV_BLOCKED && p4.legs[0].lengthM > flat(pa4, pb4) * 1.1
              && ctl4.legs[0].pts.length === 2,
        () => "worst level " + worst4 + "; " + p4.legs[0].lengthM.toFixed(0) + " m round vs " + flat(pa4, pb4).toFixed(0) + " straight");

  // ── 5. no corner cut ────────────────────────────────────────────────────────────────────────────────────────────
  const w5 = grid(TX, TY);
  for (let k = 40; k <= 215; k++) setC(w5, k, k, C.GRID_HARD);           // a diagonal of cells touching only at corners
  const f5 = C.buildField([w5], FLOOR);
  const a5 = { gx: TX * N + 100, gy: TY * N + 140 }, b5 = { gx: TX * N + 140, gy: TY * N + 100 };
  const r5 = C.searchLeg(f5, a5, b5, []);
  let cut5 = 0;
  for (let k = 1; k < (r5.cells || []).length; k++) {
    const p = r5.cells[k - 1], q = r5.cells[k];
    if (p.gx !== q.gx && p.gy !== q.gy && f5.level(q.gx, p.gy) >= C.LV_BLOCKED && f5.level(p.gx, q.gy) >= C.LV_BLOCKED) cut5++;
  }
  const straight5 = Math.hypot(40, 40) * 100;
  check("5. NO CORNER CUT: a wall of cells touching only at their corners is gone round, not slipped through between "
        + "two of them",
        () => !r5.error && cut5 === 0 && r5.cost > straight5 * 3,
        () => (r5.error || "") + " corner cuts " + cut5 + "; cost " + (r5.cost | 0) + " vs " + (straight5 | 0) + " straight");

  // ── 5b. no corner cut INSIDE A PORT'S CIRCLE either (2026-11-09) ─────────────────────────────────────────────────
  // A diagonal wall of land cells touching only at corners (c + r = 215, cols 95-120), ~1.5 km from a port, the sea
  // beyond it ~2 km off: inside the circle a blocked cell may be ENTERED (no water way, 6), and the corner rule read that
  // as leave to slip between two of them on a move from water to water. Now it goes ROUND the wall's end - the passage's
  // search and the coarse home field alike; the same wall CLOSING the harbor (across the whole tile) is crossed.
  const wall5 = (closed) => {
    const g = grid(TX, TY);
    for (let c = closed ? 0 : 95; c <= (closed ? 215 : 120); c++) setC(g, c, 215 - c, C.GRID_HARD);
    return g;
  };
  const cutsOf = (fld, cells) => { let n = 0; for (let k = 1; k < cells.length; k++) { const p = cells[k - 1], q = cells[k];
    if (p.gx !== q.gx && p.gy !== q.gy && fld.level(q.gx, p.gy) >= C.LV_BLOCKED && fld.level(p.gx, q.gy) >= C.LV_BLOCKED) n++; } return n; };
  const port5 = { gx: TX * N + 100, gy: TY * N + 100 }, sea5 = { gx: TX * N + 115, gy: TY * N + 115 };
  const w5o = wall5(false), w5c = wall5(true), f5o = C.buildField([w5o], FLOOR), f5c = C.buildField([w5c], FLOOR);
  const s5o = C.searchLeg(f5o, port5, sea5, [port5]), s5c = C.searchLeg(f5c, port5, sea5, [port5]);
  const len5 = (r) => (r.cells ? C.routeLengthM(r.cells) : NaN), st5 = C.routeLengthM([port5, sea5]);
  const home5o = C.coarseHomeDistM(C.coarseHomeField(f5o, C.cellLL(port5.gx, port5.gy)), C.cellLL(sea5.gx, sea5.gy));
  const home5c = C.coarseHomeDistM(C.coarseHomeField(f5c, C.cellLL(port5.gx, port5.gy)), C.cellLL(sea5.gx, sea5.gy));
  check("5b. NO CORNER CUT INSIDE A PORT'S CIRCLE: a diagonal wall of land touching only at corners, 1.5 km off a port - "
        + "the passage's search and the coarse home field go ROUND its end, never between two of its cells; the same wall "
        + "closing the harbor (no way round) is crossed by both",
        () => !s5o.error && cutsOf(f5o, s5o.cells) === 0 && len5(s5o) > 1.3 * st5 && home5o > 1.3 * st5
              && !s5c.error && len5(s5c) < 1.2 * st5 && Number.isFinite(home5c) && home5c < 1.2 * st5,
        () => "open wall: search " + (s5o.error || Math.round(len5(s5o)) + " m, corner cuts " + cutsOf(f5o, s5o.cells))
              + ", home " + Math.round(home5o) + " m; closed: search " + (s5c.error || Math.round(len5(s5c)) + " m")
              + ", home " + Math.round(home5c) + " m; straight " + Math.round(st5) + " m");

  // ── 5c. ... and a crossing there is no other way for runs STRAIGHT through ─────────────────────────────────────
  // The corner rule binds a step between two cells of water; a step into or out of a cell crossed keeps the open rule.
  // A dock 1.3 km inside land on the diagonal (land where c + r < 110, the dock at 45,45), the sea off to the northeast:
  // the search's own cells and the home field's length run the diagonal through the land, within 5% of the straight
  // line - not a staircase of square steps (~11% longer, and a third more land).
  const dock5 = grid(TX, TY);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (c + r < 110) setC(dock5, c, r, C.GRID_HARD);
  const fd5 = C.buildField([dock5], FLOOR), at5 = { gx: TX * N + 45, gy: TY * N + 45 }, to5 = { gx: TX * N + 80, gy: TY * N + 80 };
  const sd5 = C.searchLeg(fd5, at5, to5, [at5]), std5 = C.routeLengthM([at5, to5]);
  const hd5 = C.coarseHomeDistM(C.coarseHomeField(fd5, C.cellLL(at5.gx, at5.gy)), C.cellLL(to5.gx, to5.gy));
  check("5c. ... A CROSSING THERE IS NO OTHER WAY FOR RUNS STRAIGHT THROUGH: a dock 1.3 km inside land on the diagonal - "
        + "the search's cells and the home field's length within 5% of the straight line, not a staircase",
        () => !sd5.error && C.routeLengthM(sd5.cells) < 1.05 * std5 && Number.isFinite(hd5) && hd5 < 1.05 * std5,
        () => "search " + (sd5.error || Math.round(C.routeLengthM(sd5.cells)) + " m") + ", home " + Math.round(hd5)
              + " m; straight " + Math.round(std5) + " m");

  // ── 6. a port ───────────────────────────────────────────────────────────────────────────────────────────────────
  const h6 = grid(TX, TY);
  for (let r = 0; r < N; r++) for (let c = 0; c < 60; c++) setC(h6, c, r, C.GRID_HARD);   // land to the west
  const dock = ll(h6, 50, 128), sea6 = ll(h6, 200, 128);
  const p6 = C.planPassage({ grids: [h6], floorDm: FLOOR, points: [{ ...dock, port: true }, sea6] });
  const n6 = C.planPassage({ grids: [h6], floorDm: FLOOR, points: [dock, sea6] });
  const f6 = C.buildField([h6], FLOOR);
  const landCells6 = cellsOf(p6.legs[0].pts || []).filter((c) => f6.level(c.gx, c.gy) === C.LV_BLOCKED);
  const farthest6 = Math.max(0, ...landCells6.map((c) => flat(C.cellLL(c.gx, c.gy), dock)));
  check("6. A PORT: a start ~1 km inside the land is left by water when it is a port - the land crossed only inside the "
        + "port's circle; the same start NOT a port is refused (blocked)",
        () => !p6.legs[0].error && landCells6.length > 0 && farthest6 <= C.PORT_R_M && n6.legs[0].error === "blocked",
        () => "port: " + (p6.legs[0].error || "planned") + ", land cells " + landCells6.length + " to " + farthest6.toFixed(0)
              + " m; not a port: " + (n6.legs[0].error || "planned"));

  // ── 6b. a port at a bay head, a neck of land from another sea (Pago Pago, 2026-11-09) ─────────────────────────────
  // Andy's Go-To north from Pago Pago: the bay head lies 1.3 km from Tutuila's north shore, inside the port's 4 km circle,
  // and at PORT_BLOCKED_COST 8 the coarse route ran straight over the island - the land cheaper than the water round it.
  // Here a peninsula from the west edge (rows 100-140, ~4.5 km), a bay cut into it from the south to 7 rows (~760 m) of
  // its north shore, the port at the bay head, the sea 10.7 km north. SHUT: the same bay walled off for 21 rows - no
  // water way out, so the land is crossed, and the least of it (the neck, not the wall).
  const bay = (shut) => {
    const g = grid(TX, TY);
    for (let r = 100; r <= 140; r++) for (let c = 0; c < 200; c++) {
      const inBay = c >= 96 && c <= 104 && r <= 133;
      if (!inBay || (shut && r <= 120)) setC(g, c, r, C.GRID_HARD);
    }
    return g;
  };
  const b6 = bay(false), s6 = bay(true), head6 = ll(b6, 100, 132), north6 = ll(b6, 100, 230);
  const out6 = C.planPassage({ grids: [b6], floorDm: FLOOR, points: [{ ...head6, port: true }, north6] }).legs[0];
  const in6 = C.planPassage({ grids: [b6], floorDm: FLOOR, points: [north6, { ...head6, port: true }] }).legs[0];
  const sh6 = C.planPassage({ grids: [s6], floorDm: FLOOR, points: [{ ...head6, port: true }, north6] }).legs[0];
  const fb6 = C.buildField([b6], FLOOR), fs6 = C.buildField([s6], FLOOR);
  const land6 = (fld, g) => cellsOf(g.pts || []).filter((c) => fld.level(c.gx, c.gy) === C.LV_BLOCKED).length;
  const straight6 = flat(head6, north6);
  const homeB6 = C.coarseHomeDistM(C.coarseHomeField(fb6, head6), north6);
  const homeS6 = C.coarseHomeDistM(C.coarseHomeField(fs6, head6), north6);
  check("6b. A PORT AT A BAY HEAD, A NECK OF LAND FROM ANOTHER SEA (Pago Pago): the route leaves BY WATER - down the bay "
        + "and round - never over the ~760 m of land its circle reaches across, out and in alike; the same bay SHUT (no "
        + "water way out) still crosses, and only the neck; the coarse home field (the fuel monitor's way home) the same",
        () => !out6.error && land6(fb6, out6) === 0 && out6.lengthM > 1.5 * straight6
              && !in6.error && land6(fb6, in6) === 0 && in6.lengthM > 1.5 * straight6
              && !sh6.error && land6(fs6, sh6) > 0 && land6(fs6, sh6) <= 10 && sh6.lengthM < 1.1 * straight6
              && homeB6 > 1.5 * straight6 && homeS6 < 1.1 * straight6,
        () => "out " + (out6.error || Math.round(out6.lengthM) + " m, land cells " + land6(fb6, out6)) + "; in "
              + (in6.error || Math.round(in6.lengthM) + " m, land " + land6(fb6, in6)) + "; shut " + (sh6.error
              || Math.round(sh6.lengthM) + " m, land " + land6(fs6, sh6)) + "; straight " + Math.round(straight6)
              + " m; home from the north: open " + Math.round(homeB6) + " m, shut " + Math.round(homeS6) + " m");

  // ── 6c. the pull never cuts over land in a port's circle ─────────────────────────────────────────────────────────
  // A search's path round a block of land (cols 110-112, rows 95-105) inside the port's circle, beside a danger on its
  // way (row 107 partly): the straight shortcut through the block is refused with open water on AND off (until
  // 2026-11-09 the block counted as PARTLY, and a stretch with a partly cell let the pull through it); the same path with
  // no block is pulled straight. FORCED: a path that must cross one land cell out of its pocket (col 101) and then goes
  // round the block - the shortcut crosses the block too, refused; one over the same land cell, no dearer, taken.
  const pullCase = (block, forced) => {
    const g = grid(TX, TY);
    if (block) for (let r = 95; r <= 105; r++) for (let c = 110; c <= 112; c++) setC(g, c, r, C.GRID_HARD);
    if (forced) setC(g, 101, 100, C.GRID_HARD);
    for (let c = 100; c <= 115; c++) setT(g, c, 107, 10);
    const at = (c, r) => ({ gx: TX * N + c, gy: TY * N + r });
    const cells = [at(100, 100)];
    if (forced) { cells.push(at(101, 100), at(102, 100)); for (let r = 101; r <= 107; r++) cells.push(at(102, r)); }
    else for (let r = 101; r <= 107; r++) cells.push(at(100, r));
    for (let c = forced ? 103 : 101; c <= 115; c++) cells.push(at(c, 107));
    for (let r = 106; r >= 100; r--) cells.push(at(115, r));
    for (let c = 116; c <= 130; c++) cells.push(at(c, 100));
    return { g, cells, port: [at(100, 100)] };
  };
  const pulled = (pc, ow) => C.pullTaut(C.buildField([pc.g], FLOOR, 0, { openWater: ow }), pc.cells, pc.port);
  const landOn = (pc, out) => { const f = C.buildField([pc.g], FLOOR); let n = 0;
    for (let k = 1; k < out.length; k++) for (const c of C.lineCells(out[k - 1], out[k])) if (f.level(c.gx, c.gy) === C.LV_BLOCKED) n++;
    return n; };
  const blk6 = pullCase(true, false), clr6 = pullCase(false, false), frc6 = pullCase(true, true), frcClr6 = pullCase(false, true);
  const pB = { on: pulled(blk6, true), off: pulled(blk6, false) }, pC = { on: pulled(clr6, true), off: pulled(clr6, false) };
  const pF = { on: pulled(frc6, true), off: pulled(frc6, false) }, pFc = pulled(frcClr6, false);
  check("6c. THE PULL NEVER CUTS OVER LAND IN A PORT'S CIRCLE: round a block of land beside a danger, the shortcut through "
        + "it is refused, open water on and off (none of the block on the pulled route); the same path with no block, "
        + "straight; a path that must cross one land cell keeps to that one - the block refused, a shortcut over the "
        + "same cell taken",
        () => landOn(blk6, pB.on) === 0 && landOn(blk6, pB.off) === 0 && pB.off.length > 2 && pB.on.length > 2
              && pC.on.length === 2 && pC.off.length === 2
              && landOn(frc6, pF.on) === 1 && landOn(frc6, pF.off) === 1 && pF.off.length > 2
              && landOn(frcClr6, pFc) === 1 && pFc.length === 2,
        () => "block: on " + pB.on.length + " pts/" + landOn(blk6, pB.on) + " land, off " + pB.off.length + "/" + landOn(blk6, pB.off)
              + "; clear: on " + pC.on.length + ", off " + pC.off.length + "; forced: on " + pF.on.length + "/" + landOn(frc6, pF.on)
              + ", off " + pF.off.length + "/" + landOn(frc6, pF.off) + "; forced, no block: " + pFc.length + "/" + landOn(frcClr6, pFc));

  // ── 7. unread ───────────────────────────────────────────────────────────────────────────────────────────────────
  const u7 = grid(TX, TY);
  const off = { lat: 41.0, lon: -60.0 };
  const p7 = C.planPassage({ grids: [u7], floorDm: FLOOR, points: [ll(u7, 20, 20), off] });
  const b7 = grid(TX, TY);
  for (let r = 0; r < N; r++) for (let c = 120; c < 124; c++) setC(b7, c, r, C.GRID_UNREAD);
  const q7 = C.planPassage({ grids: [b7], floorDm: FLOOR, points: [ll(b7, 20, 128), ll(b7, 230, 128)] });
  check("7. UNREAD: an end off the chart read is refused, with where; a band of unread water across the way is not "
        + "crossed (the leg refused)",
        () => p7.legs[0].error === "unread" && Math.abs(p7.legs[0].at.lat - 41.0) < 0.01 && q7.legs[0].error === "blocked",
        () => JSON.stringify([p7.legs[0].error, p7.legs[0].at, q7.legs[0].error]));

  // ── 8. narrow ───────────────────────────────────────────────────────────────────────────────────────────────────
  const s8 = grid(TX, TY);
  for (let r = 0; r < N; r++) for (let c = 100; c < 150; c++) {
    if (r >= 126 && r <= 130) setT(s8, c, r, 10);                         // the strait: water, a danger touching it
    else setC(s8, c, r, C.GRID_HARD);
  }
  const a8 = ll(s8, 20, 128), b8 = ll(s8, 230, 128);
  const p8 = C.planPassage({ grids: [s8], floorDm: FLOOR, points: [a8, b8] });
  const nr8 = p8.legs[0].narrow || [];
  const chanM = 50 * CD * 111320 * Math.cos(43.12 * Math.PI / 180);
  const q8 = C.planPassage({ grids: [s8], floorDm: FLOOR, points: [{ ...ll(s8, 95, 128), port: true }, { ...ll(s8, 155, 128), port: true }] });
  check("8. NARROW: a channel of cells a danger touches, the only way - the route takes it and says ONE narrow stretch "
        + "about its length (" + chanM.toFixed(0) + " m); the same channel inside the ports' circles is not narrow",
        () => !p8.legs[0].error && nr8.length === 1 && Math.abs(nr8[0].lenM - chanM) < 400 && !q8.legs[0].error
              && q8.legs[0].narrow.length === 0,
        () => (p8.legs[0].error || "planned") + "; narrow " + JSON.stringify(nr8.map((n) => n.lenM | 0)) + "; in port "
              + JSON.stringify((q8.legs[0].narrow || []).map((n) => n.lenM | 0)));

  // ── 9. pulled taut, never worse ─────────────────────────────────────────────────────────────────────────────────
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let trials = 0, crossed = 0, worse = 0, shortcuts = 0;
  for (let t = 0; t < 12; t++) {
    const g9 = grid(TX, TY);
    for (let b = 0; b < 40; b++) {
      const cx = 30 + Math.floor(rnd() * 196), cy = Math.floor(rnd() * N), rr = 2 + Math.floor(rnd() * 10), hard = rnd() < 0.6;
      for (let r = cy - rr; r <= cy + rr; r++) for (let c = cx - rr; c <= cx + rr; c++)
        if (r >= 0 && r < N && c >= 0 && c < N && (c - cx) ** 2 + (r - cy) ** 2 <= rr * rr) (hard ? setC : setT)(g9, c, r, hard ? C.GRID_HARD : 10);
    }
    const f9 = C.buildField([g9], FLOOR);
    const a9 = { gx: TX * N + 5, gy: TY * N + Math.floor(rnd() * N) }, b9 = { gx: TX * N + 250, gy: TY * N + Math.floor(rnd() * N) };
    const r9 = C.searchLeg(f9, a9, b9, []);
    if (r9.error) continue;
    trials++;
    const taut = C.pullTaut(f9, r9.cells, []);
    for (let k = 1; k < taut.length; k++) {
      const i0 = r9.cells.indexOf(taut[k - 1]), i1 = r9.cells.indexOf(taut[k]);
      if (i1 === i0 + 1) continue;                   // a step of the search's own: no shortcut, nothing replaced
      shortcuts++;
      let was = 0;
      for (let q = i0 + 1; q < i1; q++) was = Math.max(was, f9.level(r9.cells[q].gx, r9.cells[q].gy));
      for (const c of C.lineCells(taut[k - 1], taut[k])) {
        if ((c.gx === taut[k - 1].gx && c.gy === taut[k - 1].gy) || (c.gx === taut[k].gx && c.gy === taut[k].gy)) continue;
        const v = f9.level(c.gx, c.gy);
        if (v >= C.LV_BLOCKED) crossed++;
        if (v > was) worse++;
      }
    }
  }
  check("9. PULLED TAUT, NEVER WORSE: over random fields of islands and shoals, no taut segment crosses a blocked cell, "
        + "and none passes a cell worse than the stretch of path it replaced",
        () => trials >= 8 && shortcuts > 20 && crossed === 0 && worse === 0,
        () => trials + " fields planned, " + shortcuts + " shortcuts; blocked crossed " + crossed + ", worse cells " + worse);

  // 9a. EVERY CELL A SEGMENT PASSES THROUGH (the 2026-10-16 review, finding 6): lineCells sampled a quarter cell and
  // missed a blocked cell's corner between two samples - 26 taut segments in 300 random fields ran into one. Against
  // brute force (every cell any point of the segment lies in, at 1/400 cell), and the corner pass lists both cells.
  const bruteCells = (p, q) => { const set = new Set(); const n = Math.max(1, Math.ceil(Math.hypot(q.gx - p.gx, q.gy - p.gy) * 400));
    for (let k = 0; k <= n; k++) { const x = p.gx + 0.5 + (q.gx - p.gx) * k / n, y = p.gy + 0.5 + (q.gy - p.gy) * k / n;
      // interior points only (a point on a boundary belongs to both cells; the walk lists them)
      if (Math.abs(x - Math.floor(x) - 0.5) < 0.499 && Math.abs(y - Math.floor(y) - 0.5) < 0.499) set.add(Math.floor(x) + "," + Math.floor(y)); }
    return set; };
  let seedA = 777, missing = 0, segs = 0;
  const rndA = () => { seedA = (seedA * 1103515245 + 12345) % 2147483648; return seedA / 2147483648; };
  for (let t = 0; t < 400; t++) {
    const p = { gx: Math.floor(rndA() * 40), gy: Math.floor(rndA() * 40) }, q = { gx: Math.floor(rndA() * 40), gy: Math.floor(rndA() * 40) };
    const got = new Set(C.lineCells(p, q).map((c) => c.gx + "," + c.gy));
    segs++;
    for (const k of bruteCells(p, q)) if (!got.has(k)) missing++;
  }
  const diag = C.lineCells({ gx: 0, gy: 0 }, { gx: 2, gy: 2 }).map((c) => c.gx + "," + c.gy);
  check("9a. lineCells LISTS EVERY CELL a segment passes through: 400 random segments against brute force, none missing; "
        + "a diagonal through the corners lists the two cells beside each corner (the corner cut the search forbids)",
        () => segs === 400 && missing === 0 && ["0,0", "1,0", "0,1", "1,1", "2,1", "1,2", "2,2"].every((k) => diag.includes(k)),
        () => segs + " segments, " + missing + " cell(s) missed; diagonal " + JSON.stringify(diag));
  // ... and so a taut route never runs through a blocked cell's interior, nor between two diagonal blocked cells
  let seedB = 3, cutIn = 0, cutCorner = 0, tautSegs = 0, fields = 0;
  const rndB = () => { seedB = (seedB * 1103515245 + 12345) % 2147483648; return seedB / 2147483648; };
  for (let t = 0; t < 60 && fields < 30; t++) {
    const g = grid(TX, TY), S = 24, blk = new Set();
    for (let i = 0; i < S * S * 0.18; i++) { const x = Math.floor(rndB() * S), y = Math.floor(rndB() * S); blk.add(x + "," + y); setC(g, x, y, C.GRID_HARD); }
    const f = C.buildField([g], FLOOR);
    const free = () => { for (;;) { const x = Math.floor(rndB() * S), y = Math.floor(rndB() * S); if (!blk.has(x + "," + y)) return { gx: TX * N + x, gy: TY * N + y }; } };
    const r = C.searchLeg(f, free(), free(), []);
    if (r.error) continue;
    fields++;
    const taut = C.pullTaut(f, r.cells, []);
    for (let i = 1; i < taut.length; i++) {
      const p = taut[i - 1], q = taut[i]; tautSegs++;
      for (const k of bruteCells(p, q)) { const [cx, cy] = k.split(",").map(Number); if (f.level(cx, cy) === C.LV_BLOCKED) { cutIn++; break; } }
      const dx = q.gx - p.gx, dy = q.gy - p.gy;
      if (Math.abs(dx) === Math.abs(dy) && dx) { const sx = Math.sign(dx), sy = Math.sign(dy);
        for (let k = 1; k <= Math.abs(dx); k++) { const cx = p.gx + k * sx, cy = p.gy + k * sy;
          if (f.level(cx, cy - sy) === C.LV_BLOCKED && f.level(cx - sx, cy) === C.LV_BLOCKED) { cutCorner++; break; } } }
    }
  }
  check("9c. PULLED TAUT, THROUGH NO BLOCKED CELL: over random 24 x 24 fields (18% blocked), no taut segment runs through a "
        + "blocked cell's interior and none passes between two diagonal blocked cells (before: 26 and 1 in 300)",
        () => fields >= 20 && tautSegs >= 60 && cutIn === 0 && cutCorner === 0,
        () => fields + " fields, " + tautSegs + " taut segments; through a blocked cell " + cutIn + ", through a corner " + cutCorner);

  // a wall with a one-cell gap a danger touches, then a shoal across the straight way on: the path goes through the gap
  // and ROUND the shoal - a shortcut from the gap (itself partly) must not take that as leave to cross the shoal
  const s9 = grid(TX, TY);
  for (let r = 0; r < N; r++) if (r !== 128) setC(s9, 128, r, C.GRID_HARD);
  setT(s9, 128, 128, 10);
  for (let r = 160; r <= 164; r++) for (let c = 158; c <= 166; c++) setT(s9, c, r, 10);
  const p9b = C.planPassage({ grids: [s9], floorDm: FLOOR, points: [ll(s9, 60, 128), ll(s9, 200, 200)] });
  check("9b. A SHORTCUT FROM A VERTEX A DANGER TOUCHES IS NO LICENCE: through a one-cell gap a danger touches, then ROUND "
        + "a shoal - the taut route says ONE narrow stretch (the gap), not two (the shoal crossed)",
        () => !p9b.legs[0].error && p9b.legs[0].narrow.length === 1,
        () => (p9b.legs[0].error || "planned") + ", narrow " + JSON.stringify((p9b.legs[0].narrow || []).map((n) => n.lenM | 0)));

  // ... and the rule itself, on a path laid by hand that BENDS at a cell a danger touches (P): a wall keeps the start from
  // seeing past P, and a shoal lies across the straight way from P to the end, which the path goes round
  const h9 = grid(TX, TY);
  for (let r = 10; r <= 49; r++) for (let c = 11; c <= 40; c++) setC(h9, c, r, C.GRID_HARD);
  setT(h9, 10, 50, 10);                                                    // P
  for (let r = 70; r <= 80; r++) for (let c = 30; c <= 40; c++) setT(h9, c, r, 10);   // the shoal
  const f9h = C.buildField([h9], FLOOR), G = (c, r) => ({ gx: TX * N + c, gy: TY * N + r });
  const path9 = [];
  for (let r = 10; r <= 50; r++) path9.push(G(10, r));
  for (let c = 11; c <= 60; c++) path9.push(G(c, 50));
  for (let r = 51; r <= 100; r++) path9.push(G(60, r));
  const taut9 = C.pullTaut(f9h, path9, []);
  const shoalHit = [];
  for (let k = 1; k < taut9.length; k++)
    for (const c of C.lineCells(taut9[k - 1], taut9[k])) {
      const cc = c.gx - TX * N, rr = c.gy - TY * N;
      if (cc >= 30 && cc <= 40 && rr >= 70 && rr <= 80) shoalHit.push([cc, rr]);
    }
  check("9c. ... THE RULE ITSELF, on a path that bends AT a cell a danger touches: the shortcut from there to the end "
        + "would cross a shoal the path went round - not taken (the bend is no licence)",
        () => taut9.some((c) => c.gx === TX * N + 10 && c.gy === TY * N + 50) && shoalHit.length === 0,
        () => "taut " + taut9.map((c) => (c.gx - TX * N) + "," + (c.gy - TY * N)).join(" ") + "; shoal cells crossed " + shoalHit.length);

  // ── 10. the passage ─────────────────────────────────────────────────────────────────────────────────────────────
  const g10 = grid(TX, TY);
  const pts10 = [{ ...ll(g10, 10, 10), port: true }, ll(g10, 200, 30), off, { ...ll(g10, 240, 240), port: true }];
  const p10 = C.planPassage({ grids: [g10], floorDm: FLOOR, points: pts10 });
  check("10. THE PASSAGE: a leg per pair of points; the two legs to and from a point off the chart carry why and where, "
        + "the leg before them is planned, its length the passage's; the ports said",
        () => p10.legs.length === 3 && !p10.legs[0].error && p10.legs[1].error === "unread" && p10.legs[2].error === "unread"
              && Math.abs(p10.lengthM - p10.legs[0].lengthM) < 1e-6 && p10.ports.length === 2,
        () => JSON.stringify(p10.legs.map((g) => g.error || (g.lengthM | 0))) + " ports " + p10.ports.length);

  // ── 11. the fuel, leg by leg ────────────────────────────────────────────────────────────────────────────────────
  const vessel = JSON.parse(fs.readFileSync(path.join(APP, "vessels", "drix08_em712.json"), "utf8"));
  const high = (vessel.speeds_kn || vessel.speed_kn || {}).high || 10;
  const model = F.energyModel(vessel, high);
  const kn = 7, perM = model.rateAt(kn) / 3600 / (kn * 0.514444), res = model.floor + model.reserve;
  const exactM = (model.full - res) / perM;
  const pf = F.passageFuel(model, [{ lengthM: 100000 }, { lengthM: 800000 }, { lengthM: exactM }], kn, 100);
  const capped = F.passageFuel(model, [{ lengthM: 1000 }], kn, 9999);
  const exact = F.passageFuel(model, [{ lengthM: 0 }], kn, res);      // arrives with EXACTLY the reserve, no rounding
  check("11. THE FUEL, LEG BY LEG: the first leg from what is aboard (100 L), the rest from a full tank; a leg arriving "
        + "under the reserve fails and says how far she gets; one arriving with EXACTLY the reserve is enough; never "
        + "more aboard than a tank; no speed, no answer",
        () => model && model.kind === "fuel" && Math.abs(pf[0].start - 100) < 1e-9 && Math.abs(pf[0].used - perM * 100000) < 1e-6
              && pf[0].ok === (100 - perM * 100000 >= res) && Math.abs(pf[1].start - model.full) < 1e-9 && pf[1].ok === false
              && Math.abs(pf[1].reachM - (model.full - res) / perM) < 1e-3 && pf[2].ok === true
              && Math.abs(pf[2].arriveFrac - 0.2) < 1e-9 && exact[0].arrive === res && exact[0].ok === true && capped[0].start === model.full && F.passageFuel(model, [{ lengthM: 1 }], 0, 1) === null,
        () => JSON.stringify(pf.map((x) => ({ s: +x.start.toFixed(1), a: +x.arrive.toFixed(1), ok: x.ok, reachNm: +(x.reachM / 1852).toFixed(1) }))));

  // ── the page's block, lifted ────────────────────────────────────────────────────────────────────────────────────
  const fuelSrc = [grab("fuelFmt"), grab("fuelPct")].join("\n");
  const fmtDist = (m, dp) => m < 1000 ? Math.round(m) + " m" : (m / 1852).toFixed(dp == null ? 2 : dp) + " nm";   // units.js's SAE shape, `dp` honored
  const fmtDur = (s) => Math.floor(s / 3600) + "h " + String(Math.round((s % 3600) / 60)).padStart(2, "0") + "m";
  const world = (o) => {
    const w = Object.assign({ posts: [], gets: [], fetches: [], banners: [], notes: [], logs: [], renders: 0, workerMsgs: [],
                              asv: { lat: 43.07, lon: -70.71 }, transit: [], seq: [], model, kn: 7, status: { fuel_l: 200 },
                              ends: { dep: { ok: true, km: 2.5, wpts: 40 }, arr: { ok: true, km: 3.1, wpts: 55 } },
                              grid404: [], worker: null, ops: [], preReads: [], sigs: [] }, o || {});
    // (16j-16o: the page's wait limit and its ask's bound, its four helpers, and a clock and timers of the world's own once a
    // check sets them - `clockOf` - the real ones otherwise; read when asked, so a check sets them on the world it has made)
    const src = "let passage = null, passageBusy = false, passageStatus = \"\", passageGen = 0, corridorRead = null;\n"
      + "const PASSAGE_HALF_KM = 5, PASSAGE_HALF_MAX_KM = 25, PASSAGE_GRID_FETCHES = 6, CORRIDOR_POLL_MS = 0;\n"
      + /const CORRIDOR_WAIT_MAX_MS = [^;]+;/.exec(H)[0] + "\n" + /const CORRIDOR_ASK_MS = [^;]+;/.exec(H)[0] + "\n" + /const CORRIDOR_MUTE_MS = [^;]+;/.exec(H)[0] + "\n"
      + "const Date = class extends globalThis.Date { static now(){ return w.clock != null ? w.clock : globalThis.Date.now(); } };\n"
      + "const setTimeout = (fn, ms) => w.timer ? w.timer(fn, ms) : globalThis.setTimeout(fn, ms);\n"
      + "const clearTimeout = (t) => w.untimer ? w.untimer(t) : globalThis.clearTimeout(t);\n"
      + ["corridorFailure", "corridorLate", "corridorGivenUp", "corridorAsk", "corridorStart", "corridorWait"].map(grab).join("\n") + "\n"
      + "const PASSAGE_LEG_WHY = " + /const PASSAGE_LEG_WHY = (\{[\s\S]*?\});/.exec(H)[1] + ";\n"
      + fuelSrc + "\n"
      + /const PASSAGE_CASING = [^;]*;/.exec(H)[0] + "\n"
      + ["strokeCased", "fillHaloed", "passageEdited", "passagePointAt", "toggleFuelStop", "passageRefusal", "passagePoints", "passageName", "passageFuelLegs",
         "passageAlong", "passageSummary", "passageLine", "passageGrids", "passageHalfKm", "passageEndsSay", "passagePlanFor", "planPassageNow",
         "drawPassage", "preReadFirstSection"].map(grab).join("\n")
      + "\nlet passagePreRead = null;"
      // (16s: the coarse field home's build beside the planner - the two ask the console for ONE read of the way home)
      + "\nlet coarseHome = {key: null, hf: null, at: 0, tried: null, note: null, busy: false};\n"
      + ["COARSE_HOME_HALF_MIN_KM", "COARSE_HOME_HALF_FRAC", "COARSE_HOME_HALF_MAX_KM", "COARSE_HOME_MAX_TILES"].map((n) => {
        const m = new RegExp("const " + n + " = [^;]*;").exec(H); if (!m) throw new Error("anchor gone: " + n); return m[0]; }).join("\n")
      + "\n" + grab("coarseHomeBuild")
      + "\nconst coarseHomeApi = {build: coarseHomeBuild, now: () => coarseHome, MAX_TILES: COARSE_HOME_MAX_TILES};"
      + "\nreturn {coarseHome: coarseHomeApi, passageEdited, passagePointAt, toggleFuelStop, passageRefusal, passagePoints, passageFuelLegs, passageAlong,"
      + " passageSummary, passageLine, passageHalfKm, passageEndsSay, planPassageNow, drawPassage, passagePlanFor, MAX: CORRIDOR_WAIT_MAX_MS, ASK: CORRIDOR_ASK_MS, MUTE: CORRIDOR_MUTE_MS,"
      + " state: () => ({passage, passageBusy, passageGen, corridorRead}), setCorridorRead: (c) => { corridorRead = c; }, setPassage: (p) => { passage = p; }, bump: () => { passageGen++; },"
      + " preRead: () => passagePreRead};";
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { w.ops.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } });
    w.api = new Function("w", "asv", "passageWps", "planPassageEnds", "fuelModel", "V", "roleSpeed", "S", "energyLevel", "passageFuel", "FUEL_RESERVE_FRAC",
      "fmtDist", "fmtDur", "fmtMS", "distTo", "PASSAGE_PORT_R_M", "M_PER_DEG_LAT", "nogoDR", "postCorridor", "getCorridor",
      "corridorSummary", "toCorridor", "fetch", "passageInWorker", "showBanner", "flashNote", "logClient", "updateTransitPanel",
      "render", "worldPx", "zoom", "ctx", "airNeedM", "ensureNogoCovers", "fmtVol", "coarseHomeInWorker", "coarseHomeDistM", src)(
      w, w.asv, w.transit, async () => { w.endsAsked = (w.endsAsked || 0) + 1; return w.ends; }, () => w.model, { SPEED_KN: { transit: w.kn } }, () => "transit", { status: w.status, home: w.home || null }, F.energyLevel,
      F.passageFuel, F.FUEL_RESERVE_FRAC, fmtDist, fmtDur, (s) => s + "s", flat, C.PORT_R_M, 111320, () => ({ min: 3.15 }),
      // (`postAnswer` / `getAnswer`: the world's own answers to the post and to each poll - a read that never leaves
      // "running", a request never answered or failed, one answered late - 16j-16o; `sigs` each ask's abort signal. A poll
      // past the world's answers is a refusal in words, never undefined: a page that asks again on no answer would ask for good)
      async (b, sig) => { w.posts.push(b); w.sigs.push(sig); if (w.postAnswer) return w.postAnswer(b); return w.seq.length ? w.seq.shift() : { id: "j", state: "done", total: 0, done: 0, tiles: [] }; },
      async (id, sig) => { w.gets.push(id); w.sigs.push(sig); if (w.getAnswer) return w.getAnswer(id); return w.seq.length ? w.seq.shift() : { error: "the world has no more answers" }; },
      (st) => "SUMMARY " + JSON.stringify(st), (st) => st,
      async (url) => { w.fetches.push(url); const bad = w.grid404.some((t) => url.endsWith(t)); return { ok: !bad, arrayBuffer: async () => new ArrayBuffer(8) }; },
      async (msg) => { w.workerMsgs.push(msg); if (w.duringWorker) w.duringWorker(w); return w.worker; },
      (t) => w.banners.push(t), (t) => w.notes.push(t), (k, d) => w.logs.push([k, d]), () => {}, () => { w.renders++; },
      (lat, lon) => ({ x: lon * 1000, y: -lat * 1000 }), 9, ctx, () => 3.85,
      async (pts, pad, opts) => { w.preReads.push({ pts, pad, opts }); return true; },
      require("../static/js/units.js").fmtVol,    // the page's fuelFmt writes fuel through it (2026-10-17)
      // (16s: the coarse field's search, answered - coarse.js's own is tests/fuel_rth.js 11a-11c)
      async (m) => { (w.homeMsgs = w.homeMsgs || []).push(m); return { tiles: [{ tx: 1, ty: 2, len: new Float32Array(4) }], reached: 3, ms: 5 }; },
      () => 1234);
    return w;
  };

  // ── 12. the points ──────────────────────────────────────────────────────────────────────────────────────────────
  const T3 = [{ lat: 43.0, lon: -70.6 }, { lat: 43.3, lon: -70.35, fuel: true }, { lat: 43.6, lon: -70.1 }, { lat: 43.65, lon: -70.25 }];
  const W12 = world({ transit: T3.map((p) => ({ ...p })) });
  const P12 = W12.api.passagePoints();
  const W12b = world({ asv: null, transit: T3.map((p) => ({ ...p })) });
  const P12b = W12b.api.passagePoints();
  check("12. THE POINTS: her position first, a port (t 0); a fuel stop and the arrival are ports, the others not; with no "
        + "fix, T1 departs",
        () => P12.length === 5 && P12[0].t === 0 && P12[0].port && P12.map((p) => p.port ? 1 : 0).join("") === "10101"
              && P12b.length === 4 && P12b[0].t === 1 && P12b.map((p) => p.port ? 1 : 0).join("") === "1101",
        () => P12.map((p) => p.t + (p.port ? "p" : "")).join(" ") + " | " + P12b.map((p) => p.t + (p.port ? "p" : "")).join(" "));

  // ── 13. only a diesel hull ──────────────────────────────────────────────────────────────────────────────────────
  const bat = { kind: "battery" };
  const r13 = [world({ model: bat }).api.passageRefusal(), world({ model: null }).api.passageRefusal(),
               world({ kn: 0 }).api.passageRefusal(), world().api.passageRefusal()];
  const W13 = world({ model: bat, transit: T3.map((p) => ({ ...p })) });
  await W13.api.planPassageNow();
  check("13. ONLY A DIESEL HULL: a battery hull is refused (\"for the diesel hulls\"), as are a vessel with no fuel model "
        + "and no transit speed; a diesel hull may; Plan passage on a battery hull asks the console nothing",
        () => /diesel hulls/.test(r13[0]) && /no fuel model/.test(r13[1]) && /no transit speed/.test(r13[2]) && r13[3] === null
              && W13.posts.length === 0 && /^Passage NOT planned: long passages are for the diesel hulls/.test(W13.banners[0] || ""),
        () => JSON.stringify(r13) + " | " + W13.banners[0]);

  // ── 14. a fuel stop ─────────────────────────────────────────────────────────────────────────────────────────────
  const W14 = world({ transit: T3.map((p) => ({ ...p, fuel: false })) });
  W14.api.setPassage({ old: true });
  W14.api.toggleFuelStop(1);
  const s14 = W14.api.state();
  W14.api.setPassage({ old: true });
  W14.api.toggleFuelStop(3);
  const s14b = W14.api.state();
  const hit = W14.api.passagePointAt(-70.35 * 1000 + 4, -43.3 * 1000 + 3), miss = W14.api.passagePointAt(0, 0);
  check("14. A FUEL STOP is a click on a point: T2 made one, the line's plan dropped, the note says so; the arrival "
        + "(the last point) refused with a note, nothing changed; a click within a few pixels of a point finds it",
        () => W14.transit[1].fuel === true && s14.passage === null && s14.passageGen === 1 && /P2 is a FUEL STOP/.test(W14.notes[0])
              && !W14.transit[3].fuel && s14b.passage !== null && s14b.passageGen === 1 && /P4 is the arrival/.test(W14.notes[1])
              && hit === 1 && miss === -1,
        () => JSON.stringify({ fuel: W14.transit.map((p) => !!p.fuel), gen: [s14.passageGen, s14b.passageGen], notes: W14.notes, hit, miss }));

  // ── 15. fuel legs ───────────────────────────────────────────────────────────────────────────────────────────────
  const fl15 = W12.api.passageFuelLegs(P12, [{ lengthM: 10 }, { lengthM: 20 }, { lengthM: 30 }, { lengthM: 40, error: "blocked" }]);
  check("15. FUEL LEGS cut at the ports: her position to T2 (legs 0-1, 30 m), T2 to T4 (legs 2-3) - and that one, with a "
        + "leg not planned, NOT whole",
        () => fl15.length === 2 && fl15[0].from.t === 0 && fl15[0].to.t === 2 && fl15[0].lengthM === 30 && fl15[0].whole
              && JSON.stringify(fl15[1].legs) === "[2,3]" && fl15[1].to.t === 4 && fl15[1].whole === false,
        () => JSON.stringify(fl15.map((f) => [f.from.t, f.to.t, f.lengthM, f.whole])));

  // ── 16. Plan passage end to end ─────────────────────────────────────────────────────────────────────────────────
  const mkLeg = (i, a, b, m, extra) => Object.assign({ i, from: a, to: b, lengthM: m, narrow: [], pts: [a, b] }, extra || {});
  const W16 = world({ transit: T3.map((p) => ({ ...p })), status: { fuel_l: 120 } });
  const P16 = W16.api.passagePoints();
  const tiles16 = [[-70.75, 43, -70.5, 43.25], [-70.5, 43, -70.25, 43.25], [-70.5, 43.25, -70.25, 43.5]];
  W16.grid404 = ["-70.5,43.25,-70.25,43.5"];
  W16.seq = [{ id: "g1", state: "running", total: 3, done: 0, tiles: tiles16, eta_s: 9 },
             { id: "g1", state: "running", total: 3, done: 2, tiles: tiles16, eta_s: 3 },
             { id: "g1", state: "done", total: 3, done: 3, tiles: tiles16, failed: [] }];
  W16.worker = { legs: [mkLeg(0, P16[0], P16[1], 40000), mkLeg(1, P16[1], P16[2], 50000),
                        mkLeg(2, P16[2], P16[3], 500000, { narrow: [{ fromM: 1, toM: 501, lenM: 500, at: P16[3] }] }),
                        mkLeg(3, P16[3], P16[4], 400000)], lengthM: 990000, ms: 12 };
  await W16.api.planPassageNow();
  const s16 = W16.api.state(), pl = s16.passage;
  const banner16 = W16.banners[W16.banners.length - 1] || "";
  check("16. PLAN PASSAGE end to end: the corridor read WITH grids along the points, 5 km either side, polled to done; "
        + "each listed tile's grid fetched (one missing, counted); the worker given the floor in decimeters (3.15 m -> 32) "
        + "and what she needs overhead (3.85 m -> 39) "
        + "and the points; the plan kept - her position to T2 from the 120 L aboard, T2 to T4 from a full tank and SHORT, "
        + "its reserve marked - said, logged (reading, planned, with the points) and free after",
        () => W16.posts.length === 1 && W16.posts[0].grids === true && W16.posts[0].half_km === W16.api.passageHalfKm(P16)
              && W16.posts[0].route.length === 5 && W16.gets.length === 2 && W16.fetches.length === 3
              && /tile=-70.75,43,-70.5,43.25$/.test(W16.fetches[0]) && W16.workerMsgs.length === 1
              && W16.workerMsgs[0].floorDm === 32 && W16.workerMsgs[0].airDm === 39
              && W16.workerMsgs[0].points.length === 5 && W16.workerMsgs[0].grids.length === 2
              && pl && pl.missing === 1 && pl.fuel.length === 2 && pl.fuel[0].start === 120 && pl.fuel[1].start === model.full
              && pl.fuel[1].ok === false && pl.reserveAt[0] === null && pl.reserveAt[1] && /PASSAGE PLANNED, COARSE/.test(banner16)
              && /BELOW THE 20% RESERVE/.test(banner16) && W16.logs.length === 2 && W16.logs[0][1].state === "reading"
              && W16.logs[1][1].state === "planned" && W16.logs[1][1].points.length === 5 && s16.passageBusy === false,
        () => JSON.stringify({ posts: W16.posts.length, gets: W16.gets.length, fetches: W16.fetches.length, worker: W16.workerMsgs.map((m) => [m.floorDm, m.airDm, m.points.length, m.grids.length]),
                               fuel: pl && pl.fuel.map((x) => [x.start, +x.arrive.toFixed(1), x.ok]), logs: W16.logs.map((l) => l[1].state), banner: banner16.slice(0, 160) }));
  // 16f. THE CORRIDOR WIDENS WITH THE LONGEST LEG (2026-10-14): a fifth of it, PASSAGE_HALF_KM at least, 25 km at most -
  // a Go-To's one straight leg along the Maine coast crosses the peninsulas, and the way round Pemaquid runs more than
  // 5 km off it
  const hk = (km) => W16.api.passageHalfKm([{ lat: 43.6, lon: -70.25 }, { lat: 43.6 + km / 111.32, lon: -70.25 }]);
  check("16f. THE CORRIDOR WIDENS WITH THE LONGEST LEG: 5 km either side of a 12 km leg, 24 km of a 120 km one, the "
        + "server's 25 km of a 300 km one; this plan's longest leg (39 km) read 8 km either side",
        () => hk(12) === 5 && hk(120) === 24 && hk(300) === 25 && W16.posts[0].half_km === 8,
        () => [hk(12), hk(120), hk(300), W16.posts[0].half_km].join(", "));
  // 16g. ENDS FIRST (2026-10-14): once the coarse plan is in, its first and last sections are planned in detail
  // (planPassageEnds, stubbed here: tests/passage_tab.js drives it) - once - kept with the plan, and said
  const W16g = world({ transit: T3.map((p) => ({ ...p })), ends: { dep: { ok: true, km: 2.5, wpts: 40 }, arr: { ok: false, why: "its end is not clear water to hold at" } } });
  W16g.seq = [{ id: "g1", state: "done", total: 3, done: 3, tiles: tiles16, failed: [] }];
  W16g.worker = W16.worker;
  await W16g.api.planPassageNow();
  const pl16g = W16g.api.state().passage, b16g = W16g.banners[W16g.banners.length - 1] || "";
  check("16g. ENDS FIRST: the coarse plan's two ends planned in detail once it is in - asked once, kept with the plan - "
        + "both planned said with their lengths; one that could not be said NOT SAILABLE, with why",
        () => W16.endsAsked === 1 && pl && pl.ends && pl.ends.dep.km === 2.5 && /Both ends planned in detail \(leaving 1\.3 nm, arriving 1\.7 nm\)\.$/.test(banner16)
              && W16g.endsAsked === 1 && pl16g && pl16g.ends && pl16g.ends.arr.ok === false
              && /⚠ NOT SAILABLE - its ends could not be planned in detail: arriving: its end is not clear water to hold at\.$/.test(b16g),
        () => JSON.stringify({ asked: [W16.endsAsked, W16g.endsAsked], b16: banner16.slice(-90), b16g: b16g.slice(-120) }));
  // 16h. SECTION 1'S CHART IMAGE, READ WHEN THE PASSAGE IS PLANNED (2026-10-15: "On goto transition to passage ... there
  // should be no pause"): over the water Sail will read - her position and section 1's points, as a route - once the plan
  // is in and its ends could be planned; kept beside the plan for Sail to wait on. NOT for a plan whose ends could not be.
  const SEC1 = { from: P16[0], via: [P16[1]], to: P16[2], end: "hold", port: null, lengthM: 90000 };
  const W16h = world({ transit: T3.map((p) => ({ ...p })) });
  W16h.seq = [{ id: "h1", state: "done", total: 3, done: 3, tiles: tiles16, failed: [] }];
  W16h.worker = { ...W16.worker, sections: [SEC1] };
  await W16h.api.planPassageNow();
  const W16i = world({ transit: T3.map((p) => ({ ...p })), ends: { dep: { ok: false, why: "no plan" }, arr: { ok: true, km: 3, wpts: 9 } } });
  W16i.seq = [{ id: "i1", state: "done", total: 3, done: 3, tiles: tiles16, failed: [] }];
  W16i.worker = { ...W16.worker, sections: [SEC1] };
  await W16i.api.planPassageNow();
  const pr16 = W16h.preReads[0], kept16 = W16h.api.preRead();
  check("16h. SECTION 1'S CHART IMAGE READ WHEN THE PASSAGE IS PLANNED: once, as a route, over her position and section 1's "
        + "points - kept with the plan for Sail; none for a plan whose ends could not be planned",
        () => W16h.preReads.length === 1 && pr16.opts && pr16.opts.route === true
              && JSON.stringify(pr16.pts) === JSON.stringify([{ lat: W16h.asv.lat, lon: W16h.asv.lon }, P16[1], P16[2]])
              && kept16 && kept16.plan === W16h.api.state().passage && W16i.preReads.length === 0 && W16i.api.preRead() === null,
        () => JSON.stringify({ reads: W16h.preReads.length, pts: pr16 && pr16.pts, kept: !!kept16, notSailable: W16i.preReads.length }));
  const W16b = world({ transit: T3.map((p) => ({ ...p })) });
  W16b.seq = [{ id: "g", state: "done", total: 1, done: 1, tiles: [tiles16[0]], failed: [] }];
  W16b.worker = W16.worker;
  W16b.duringWorker = (w) => w.api.bump();               // the line edited while the worker planned
  await W16b.api.planPassageNow();
  const W16c = world({ transit: T3.map((p) => ({ ...p })) });
  W16c.seq = [{ id: "g", state: "done", total: 1, done: 1, tiles: [tiles16[0]], failed: [] }];
  W16c.worker = { error: "the passage's worker failed: boom" };
  await W16c.api.planPassageNow();
  const W16d = world({ transit: T3.map((p) => ({ ...p })) });
  W16d.seq = [{ id: "g", state: "running", total: 9, done: 1, tiles: [] }, { id: "g", state: "canceled", total: 9, done: 2 }];
  await W16d.api.planPassageNow();
  check("16b. REFUSED AND SAID, NOTHING KEPT: the line edited while it was planned (its ends not then planned for nothing - "
        + "2026-11-13, a mutation found that unchecked); a worker that failed; a chart read that stopped (the worker never asked)",
        () => W16b.api.state().passage === null && /edited while it was being planned/.test(W16b.banners.pop() || "") && !W16b.endsAsked
              && W16c.api.state().passage === null && /worker failed: boom/.test(W16c.banners.pop() || "")
              && W16d.api.state().passage === null && W16d.workerMsgs.length === 0 && /was stopped/.test(W16d.banners.pop() || "")
              && !W16b.api.state().passageBusy && !W16c.api.state().passageBusy && !W16d.api.state().passageBusy,
        () => JSON.stringify([W16b.banners, W16c.banners, W16d.banners]).slice(0, 300));

  const W16e = world({ transit: T3.map((p) => ({ ...p })) });
  const P16e = W16e.api.passagePoints();
  W16e.seq = [{ id: "g", state: "done", total: 1, done: 1, tiles: [tiles16[0]], failed: [] }];
  W16e.worker = { legs: [mkLeg(0, P16e[0], P16e[1], 40000), mkLeg(1, P16e[1], P16e[2], 0, { error: "blocked", pts: [] }),
                         mkLeg(2, P16e[2], P16e[3], 9000), mkLeg(3, P16e[3], P16e[4], 9000)], lengthM: 58000, ms: 3 };
  await W16e.api.planPassageNow();
  const pl16e = W16e.api.state().passage;
  check("16c. A FUEL LEG PART OF WHICH COULD NOT BE PLANNED is NOT judged by Plan passage itself: its fuel null, said NOT "
        + "checked, no reserve mark; the next fuel leg judged as before",
        () => pl16e && pl16e.fuel[0] === null && pl16e.reserveAt[0] === null && pl16e.fuel[1] && pl16e.fuel[1].ok === true
              && /Her position to P2: its fuel is NOT checked/.test(W16e.banners.pop() || ""),
        () => JSON.stringify(pl16e && pl16e.fuel));

  // ── 16j-16o. THE WAIT FOR THE CHART READ HAS AN END (2026-11-14) ────────────────────────────────────────────────
  // passagePlanFor polled the corridor job while it ran, with no end: a read the console never finished held Plan passage
  // (passageBusy: every far RTH "busy") and the far RTH's one flight home (every RTH joined it) for good. Now
  // CORRIDOR_WAIT_MAX_MS of WALL CLOCK from the ask (corridorWait), judged on a poll asked once it has passed, then refused
  // in words (corridorLate); and each ask - the post, each poll - bounded by CORRIDOR_ASK_MS and aborted, a failed or
  // unanswered one asked again (corridorAsk, corridorStart: the 2026-11-14 review). The world's own clock here: each
  // poll's wait moves it `stepMs` on (a hidden tab's waits are long, a visible one's short); any other timer - an ask's
  // bound - is kept, for the check to fire (`drive`: the clock moved CORRIDOR_ASK_MS on as it fires). A wait with no end
  // is capped by the world (after 400 polls the read answers done), so a page that never gives up FAILS here rather than
  // hanging the suite.
  const MAXW = W16.api.MAX, MIN = Math.round(MAXW / 60000), ASK = W16.api.ASK;
  const tiles16j = [tiles16[0]];
  const clockOf = (w, stepMs, runFor, cap) => {
    w.clock = 1.8e12; w.t0 = w.clock; w.polls = 0; w.races = []; w.hung = 0;
    w.timer = (fn, ms) => {
      if (ms === 0) { w.polls++; w.clock += stepMs; return setTimeout(fn, 0); }     // (CORRIDOR_POLL_MS is 0 in this world)
      const t = { fn, ms, set: w.clock, cleared: false, fired: false }; w.races.push(t); return t;
    };
    w.untimer = (t) => { if (t && t.fn) t.cleared = true; else clearTimeout(t); };
    w.over = () => w.polls > (cap || 400) || (runFor != null && w.clock - w.t0 >= runFor);
    w.done = (id) => ({ id, state: "done", total: 9, done: 9, tiles: tiles16j, failed: [] });
    w.getAnswer = (id) => w.over() ? w.done(id) : { id, state: "running", total: 9, done: 2, tiles: [] };
    w.seq = [{ id: "g", state: "running", total: 9, done: 0, tiles: [] }];          // the post's answer
    w.worker = W16.worker;
    return w;
  };
  const hang = (w) => new Promise(() => { w.hung++; });                               // an ask the console never answers
  const fireRaces = (w) => w.races.filter((t) => !t.cleared && !t.fired).forEach((t) => { t.fired = true; t.fn(); });
  const until = async (f) => { for (let i = 0; i < 5000 && !f(); i++) await new Promise((r) => setTimeout(r, 0)); };
  // (a page that waits on a hung ask for good: given 2 s of real time, it is said HUNG and fails here)
  const within = (p, ms) => Promise.race([p.then(() => "settled", () => "threw"), new Promise((r) => setTimeout(() => r("HUNG"), ms))]);
  // THE CONSOLE NOT ANSWERING, DRIVEN: each time the page waits on an ask's bound with the ask hung, the clock moves
  // CORRIDOR_ASK_MS on and the bound fires - to `p`'s end, or 200 bounds (a page that never gives up: HUNG)
  const drive = async (w, p, onHang) => {
    let end = null; p.then(() => { end = "settled"; }, () => { end = "threw"; });
    const open = () => w.races.find((t) => !t.cleared && !t.fired && t.ms === ASK);
    for (let n = 0; n < 200 && !end; n++) {
      // (a turn first: an ask the world has answered settles in it, so a bound still open after it is a HUNG ask's)
      await new Promise((r) => setTimeout(r, 0));
      await until(() => end || open());
      if (end || !open()) break;
      if (onHang) onHang(w, n);
      w.clock += ASK; const t = open(); t.fired = true; t.fn();
    }
    return end || await within(p, 2000);
  };
  const lateSay = "the chart read along it did not finish in " + MIN + " min (2 of 9 tile(s) read)";
  const keptSay = " - the tiles read are kept: press Plan passage again to go on from them.";
  const W16j = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  await W16j.api.planPassageNow();
  const W16j2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000, MAXW - 60000);     // done at 29 min
  await W16j2.api.planPassageNow();
  const W16j3 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000, MAXW);             // done in the wait that crosses 30
  await W16j3.api.planPassageNow();
  const W16jd = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  const out16j = await W16jd.api.passagePlanFor(W16jd.api.passagePoints(), () => {}, () => false);
  const log16j = W16j.logs.find((l) => l[0] === "passage_plan" && l[1].state === "late");
  const W16jg = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);              // a far Go-To's (goToOrPassage)
  await W16jg.api.planPassageNow("give the Go-To again");
  const goSaid16j = W16jg.banners[W16jg.banners.length - 1] || "";
  check("16j. A CHART READ THAT NEVER FINISHES IS GIVEN UP AT " + MIN + " MIN OF WALL CLOCK (CORRIDOR_WAIT_MAX_MS): polled a minute "
        + "apart, it is refused on the first poll asked past it - said with how much was read and that the tiles are kept, "
        + "logged, nothing planned, the worker never asked, the Passage tab free; the planner's answer {error, late, kept} (the "
        + "far RTH asks again on it); every ask's bound cleared; and the same read DONE at 29 min, or in the wait that crosses "
        + "30 (the last poll's answer taken - the 2026-11-14 review), is planned",
        () => MIN === 30 && W16j.polls === 30 && W16j.gets.length === 30 && W16j.api.state().passage === null && !W16j.api.state().passageBusy
              && W16j.workerMsgs.length === 0
              && (W16j.banners[W16j.banners.length - 1] || "") === "Passage NOT planned: " + lateSay + keptSay
              && log16j && log16j[1].done === 2 && log16j[1].tiles === 9 && log16j[1].min === 30 && log16j[1].mute === false
              && W16j.api.state().corridorRead && W16j.api.state().corridorRead.state === "given up" && W16j.api.state().corridorRead.id === "g"
              && out16j && out16j.late === true && out16j.kept === true && out16j.error === lateSay && !out16j.plan
              && W16j.races.length === W16j.gets.length + 1 && W16j.races.every((t) => t.cleared && !t.fired && t.ms === ASK)
              && W16j2.api.state().passage && W16j2.workerMsgs.length === 1 && W16j2.polls === 29
              && !W16j2.logs.some((l) => l[1] && l[1].state === "late")
              && W16j3.api.state().passage && W16j3.workerMsgs.length === 1 && W16j3.polls === 30
              && !W16j3.logs.some((l) => l[1] && l[1].state === "late")
              && goSaid16j === "Passage NOT planned: " + lateSay + " - the tiles read are kept: give the Go-To again to go on from them.",
        () => JSON.stringify({ polls: [W16j.polls, W16j2.polls, W16j3.polls], gets: W16j.gets.length, banner: (W16j.banners[W16j.banners.length - 1] || "").slice(0, 200),
                               log: log16j && log16j[1], out: out16j, races: [W16j.races.length, W16j.gets.length, W16j.races.filter((t) => !t.cleared).length],
                               planned: [!!W16j2.api.state().passage, !!W16j3.api.state().passage, (W16j3.banners[W16j3.banners.length - 1] || "").slice(0, 80)] }));
  // 16k. THE CLOCK, NOT THE POLLS: a hidden tab stretches the poll's 2 s wait to a minute and more (measured 2026-11-14) -
  // waits of 11 min are given up at the third (33 min), said as 30; a visible tab polling every half second for 1,980
  // polls (16.5 min) is not given up
  const W16k = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 11 * 60000);
  await W16k.api.planPassageNow();
  const W16k2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 500, 1980 * 500, 5000);
  await W16k2.api.planPassageNow();
  check("16k. MEASURED BY THE CLOCK, NOT BY POLLS: waits of 11 min (a hidden tab) given up at the third, said as " + MIN + " min; "
        + "1,980 polls half a second apart (16.5 min) waited out and planned",
        () => W16k.polls === 3 && W16k.api.state().passage === null && W16k.workerMsgs.length === 0
              && (W16k.banners[W16k.banners.length - 1] || "").indexOf("Passage NOT planned: " + lateSay) === 0
              && W16k2.polls === 1980 && !!W16k2.api.state().passage && W16k2.workerMsgs.length === 1,
        () => JSON.stringify({ hidden: [W16k.polls, (W16k.banners[W16k.banners.length - 1] || "").slice(0, 120)], quick: [W16k2.polls, !!W16k2.api.state().passage] }));
  // 16l. AN ASK THE CONSOLE NEVER ANSWERS (a rejoined job once hung its request for good: tests/enc_corridor.py 4; the
  // 2026-11-14 review: one hung poll took the whole limit). Each ask is bounded by CORRIDOR_ASK_MS and ABORTED (a hung
  // fetch holds one of the browser's few connections to the console), and the read polled again: one poll hung while
  // the read finishes is planned; polls hung for good are given up once the console has answered nothing for
  // CORRIDOR_MUTE_MS and 3 asks (the second 2026-11-14 review) - polls a minute apart, at the 5th, 4 min unheard - with
  // the last progress heard and what the last ask got; a post never answered is posted again, then given up the same at
  // the 3rd - NOT said as tiles kept; and the clock runs from the ASK - a post answered 20 min in leaves the read 10 polls
  const W16l = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000, 5 * 60000);
  W16l.getAnswer = ((g) => (id) => W16l.polls === 3 ? hang(W16l) : g(id))(W16l.getAnswer);
  const end16l = await drive(W16l, W16l.api.planPassageNow());
  const hung16l = W16l.races.filter((t) => t.fired);
  const W16l2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16l2.getAnswer = ((g) => (id) => W16l2.polls >= 3 && !W16l2.over() ? hang(W16l2) : g(id))(W16l2.getAnswer);
  const end16l2 = await drive(W16l2, W16l2.api.planPassageNow());
  const W16l3 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16l3.postAnswer = () => W16l3.posts.length > 400 ? { id: "g", state: "running", total: 9, done: 0, tiles: [] } : hang(W16l3);
  const end16l3 = await drive(W16l3, W16l3.api.planPassageNow());
  const W16l4 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16l4.postAnswer = async () => { W16l4.clock += 20 * 60000; return { id: "g", state: "running", total: 9, done: 0, tiles: [] }; };
  await W16l4.api.planPassageNow();
  const last = (w) => w.banners[w.banners.length - 1] || "";
  check("16l. AN ASK NEVER ANSWERED: bounded by CORRIDOR_ASK_MS (" + ASK / 1000 + " s) and aborted, and asked again - one poll hung "
        + "while the read finishes is planned; polls hung for good given up at the 5th (4 min unheard) with the progress last "
        + "heard and what the last ask got; a post never answered posted again, then given up at the 3rd, the tiles NOT said "
        + "kept; nothing planned in those; and the 30 min run from the ASK - a post answered 20 min in leaves the read 10 polls",
        () => ASK === 30000 && end16l === "settled" && end16l2 === "settled" && end16l3 === "settled"
              && W16l.hung === 1 && hung16l.length === 1 && hung16l[0].ms === ASK && W16l.sigs[3] && W16l.sigs[3].aborted === true
              && W16l.sigs.filter((s) => s && s.aborted).length === 1 && !!W16l.api.state().passage && W16l.workerMsgs.length === 1
              && W16l2.hung === 3 && W16l2.api.state().passage === null && !W16l2.api.state().passageBusy && W16l2.workerMsgs.length === 0
              && last(W16l2) === "Passage NOT planned: the chart read along it had no answer it could use from the console for 4 min (2 of 9 "
                                 + "tile(s) read when it last answered; the last ask: unanswered in 30 s)" + keptSay
              && W16l2.sigs.filter((s) => s && s.aborted).length === W16l2.hung && W16l2.clock - W16l2.t0 === 6.5 * 60000
              && W16l3.posts.length === 3 && W16l3.posts.length === W16l3.hung && W16l3.gets.length === 0
              && W16l3.sigs.every((s) => s && s.aborted)
              && last(W16l3) === "Passage NOT planned: the chart read along it had no answer it could use from the console for 3 min (the last "
                                 + "ask: unanswered in 30 s) - press Plan passage again to ask again."
              && !W16l3.api.state().passageBusy && W16l3.workerMsgs.length === 0
              && W16l4.polls === 10 && W16l4.api.state().passage === null && W16l4.workerMsgs.length === 0,
        () => JSON.stringify({ ends: [end16l, end16l2, end16l3], one: [W16l.hung, hung16l.map((t) => t.ms), W16l.sigs.map((s) => s && s.aborted), !!W16l.api.state().passage],
                               forGood: [W16l2.hung, (W16l2.clock - W16l2.t0) / 60000, last(W16l2).slice(0, 140)],
                               post: [W16l3.posts.length, W16l3.hung, W16l3.gets.length, last(W16l3).slice(0, 160)], fromAsk: W16l4.polls }));
  // 16m. A WITHDRAWAL OUTRANKS THE CLOCK: the line edited during the wait that crosses 30 min - said as the edit (gone),
  // not as a read too slow; and (the third 2026-11-14 review) edited DURING the poll that decides it - the one asked past
  // 30 min, or the 3rd unanswered past the 2 min - the same: the planner asks again after the wait. The read's line on
  // the Passage tab is no longer "reading" after it
  const W16m = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16m.getAnswer = ((g) => (id) => { if (W16m.polls === 29) W16m.api.bump(); return g(id); })(W16m.getAnswer);
  await W16m.api.planPassageNow();
  const W16m2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16m2.getAnswer = ((g) => (id) => { if (W16m2.polls === 30) W16m2.api.bump(); return g(id); })(W16m2.getAnswer);
  await W16m2.api.planPassageNow();
  const W16m3 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16m3.getAnswer = ((g) => (id) => { if (W16m3.polls === 5) W16m3.api.bump(); return W16m3.polls >= 3 ? Promise.reject(new TypeError("Failed to fetch")) : g(id); })(W16m3.getAnswer);
  await W16m3.api.planPassageNow();
  const notLate = (w) => /edited while it was being planned/.test(last(w)) && !w.logs.some((l) => l[1] && l[1].state === "late");
  check("16m. A WITHDRAWAL OUTRANKS THE CLOCK: the line edited in the poll that crosses " + MIN + " min, or during the poll that "
        + "decides it - asked past " + MIN + " min, or the 3rd unanswered - refused as edited, not as late; the read's line no longer 'reading'",
        () => W16m.polls === 30 && notLate(W16m)
              && W16m2.polls === 30 && W16m2.gets.length === 30 && notLate(W16m2)
              && W16m2.api.state().corridorRead && W16m2.api.state().corridorRead.state === "given up"
              && W16m3.gets.length === 5 && notLate(W16m3),
        () => JSON.stringify({ polls: [W16m.polls, W16m2.polls, W16m3.gets.length], banner: [last(W16m), last(W16m2).slice(0, 90), last(W16m3).slice(0, 90)],
                               read: W16m2.api.state().corridorRead && W16m2.api.state().corridorRead.state }));
  // 16n. A FAILED ASK IS NOT AN ANSWER (the 2026-11-14 review: one lost poll threw out of the planner, and the far RTH
  // took it as a FINAL refusal - the chain's rthChainFailed, the monitor's latch kept): a poll that fails (the network,
  // a reply that is not JSON) or answers no status is polled again - polls 3 and 4 fail, 5 answers, 6 and 7 answer no
  // status, 8 is done; failing for good, it is given up as LATE (asked again) once the console has answered nothing for
  // 2 min and 3 polls (the 5th, a minute apart), never thrown; a post that fails is posted again
  const fails16n = { 3: new TypeError("Failed to fetch"), 4: new SyntaxError("Unexpected token < in JSON at position 0"), 6: null, 7: "<html>" };
  const W16n = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16n.getAnswer = ((g) => (id) => {
    if (W16n.polls in fails16n) { const f = fails16n[W16n.polls]; return f instanceof Error ? Promise.reject(f) : f; }
    return W16n.polls >= 8 ? W16n.done(id) : g(id);
  })(W16n.getAnswer);
  const out16n = await W16n.api.passagePlanFor(W16n.api.passagePoints(), () => {}, () => false).catch((e) => ({ threw: String(e) }));
  const W16n2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16n2.getAnswer = ((g) => (id) => W16n2.polls >= 3 && !W16n2.over() ? Promise.reject(new TypeError("Failed to fetch")) : g(id))(W16n2.getAnswer);
  const out16n2 = await W16n2.api.passagePlanFor(W16n2.api.passagePoints(), () => {}, () => false).catch((e) => ({ threw: String(e) }));
  const W16n3 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000, 3 * 60000);
  W16n3.postAnswer = () => W16n3.posts.length <= 2 ? Promise.reject(new TypeError("Failed to fetch")) : { id: "g", state: "running", total: 9, done: 0, tiles: [] };
  const out16n3 = await W16n3.api.passagePlanFor(W16n3.api.passagePoints(), () => {}, () => false).catch((e) => ({ threw: String(e) }));
  check("16n. A FAILED ASK IS NOT AN ANSWER: polls that fail (the network; a reply not JSON) or answer no status (null, a page "
        + "of HTML) are polled again and the read, done, planned; failing for good, given up as late at the 5th poll (3 min "
        + "unheard), kept, the failure named - never thrown (the far RTH would refuse for good); a post that fails twice is "
        + "posted again and the read planned",
        () => out16n && !!out16n.plan && W16n.gets.length === 8 && W16n.races.every((t) => t.cleared)
              && out16n2 && !out16n2.threw && out16n2.late === true && out16n2.kept === true && W16n2.gets.length === 5
              && out16n2.error === "the chart read along it had no answer it could use from the console for 3 min (2 of 9 tile(s) read "
                                   + "when it last answered; the last ask: the console could not be reached)"
              && out16n3 && !!out16n3.plan && W16n3.posts.length === 3,
        () => JSON.stringify({ blips: [out16n && (out16n.threw || !!out16n.plan), W16n.gets.length], forGood: [out16n2, W16n2.gets.length],
                               post: [out16n3 && (out16n3.threw || !!out16n3.plan), W16n3.posts.length] }));
  // 16o. A WITHDRAWAL SEEN THROUGH A HUNG ASK (the 2026-11-14 review: a Stop pressed during a hung request waited the
  // whole limit, every RTH in it joining a flight already withdrawn): the line edited while a poll hangs is said as the
  // edit at the next poll, one bound later; while the post hangs, the same - not posted again; and a post that hangs past
  // the clock with the line edited is said as the edit, not late
  const W16o = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16o.getAnswer = ((g) => (id) => W16o.polls >= 3 && !W16o.over() ? hang(W16o) : g(id))(W16o.getAnswer);
  const end16o = await drive(W16o, W16o.api.planPassageNow(), (w, n) => { if (n === 0) w.api.bump(); });
  const W16o2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16o2.postAnswer = () => W16o2.posts.length > 400 ? { id: "g", state: "running", total: 9, done: 0, tiles: [] } : hang(W16o2);
  const end16o2 = await drive(W16o2, W16o2.api.planPassageNow(), (w, n) => { if (n === 0) w.api.bump(); });
  const W16o3 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16o3.postAnswer = () => W16o3.posts.length > 400 ? { id: "g", state: "running", total: 9, done: 0, tiles: [] } : hang(W16o3);
  const end16o3 = await drive(W16o3, W16o3.api.planPassageNow(), (w, n) => { if (n === 0){ w.api.bump(); w.clock = w.t0 + MAXW; } });
  const edited = (w) => /^Passage NOT planned: the line was edited while it was being planned/.test(last(w)) && !w.logs.some((l) => l[1] && l[1].state === "late");
  check("16o. A WITHDRAWAL SEEN THROUGH A HUNG ASK: the line edited while a poll hangs - said as the edit after that one bound, "
        + "no poll more; while the post hangs, the same, not posted again; and a post hung past the clock with the line "
        + "edited said as the edit, not late",
        () => end16o === "settled" && edited(W16o) && W16o.hung === 1 && W16o.gets.length === 3 && W16o.races.filter((t) => t.fired).length === 1
              && end16o2 === "settled" && edited(W16o2) && W16o2.posts.length === 1 && W16o2.gets.length === 0
              && end16o3 === "settled" && edited(W16o3) && W16o3.posts.length === 1,
        () => JSON.stringify({ poll: [end16o, W16o.hung, W16o.gets.length, last(W16o).slice(0, 90)], post: [end16o2, W16o2.posts.length, last(W16o2).slice(0, 90)],
                               pastClock: [end16o3, W16o3.posts.length, last(W16o3).slice(0, 90)] }));
  // 16p. A CONSOLE THAT HAS STOPPED ANSWERING IS GIVEN UP SOONER (the second 2026-11-14 review: asked again on every
  // failure, a console down held Read chart and Plan passage grayed for the whole 30 min, where it had been said at
  // once): nothing answered for CORRIDOR_MUTE_MS (2 min) AND 3 asks - a visible tab's polls 2 s apart are given up at the
  // 62nd, its posts at the 61st; a hidden tab's posts a minute apart at the 3rd; said with what the last ask got (the
  // console's own HTTP 500 named), and NOT said as tiles kept when none was read
  const MUTE = W16.api.MUTE;
  const down = () => Promise.reject(new TypeError("Failed to fetch"));
  const W16p = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 2000);
  W16p.getAnswer = ((g) => (id) => W16p.polls >= 3 ? down() : g(id))(W16p.getAnswer);
  const out16p = await W16p.api.passagePlanFor(W16p.api.passagePoints(), () => {}, () => false).catch((e) => ({ threw: String(e) }));
  const W16p2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 2000);
  W16p2.postAnswer = down;
  const other16p = { id: "another read", state: "running", total: 4, done: 1 };     // (Read chart's, still being read)
  W16p2.api.setCorridorRead(other16p);
  await W16p2.api.planPassageNow();
  const W16p3 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16p3.postAnswer = down;
  const out16p3 = await W16p3.api.passagePlanFor(W16p3.api.passagePoints(), () => {}, () => false).catch((e) => ({ threw: String(e) }));
  const e500 = Object.assign(new Error("HTTP 500 - the console failed handling /api/enc/corridor: OSError: disk full"), { corridor: true });
  const W16p4 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16p4.getAnswer = () => Promise.reject(e500);
  await W16p4.api.planPassageNow();
  const late16p = (w) => w.logs.find((l) => l[0] === "passage_plan" && l[1].state === "late");
  check("16p. A CONSOLE THAT HAS STOPPED ANSWERING IS GIVEN UP AT " + MUTE / 60000 + " MIN AND 3 ASKS (CORRIDOR_MUTE_MS): polls 2 s "
        + "apart at the 62nd, posts 2 s apart at the 61st, posts a minute apart at the 3rd - said as no answer it could use, with "
        + "the progress last heard and what the last ask got (an HTTP 500 named), late (asked again), logged; nothing read: "
        + "NOT said kept; another read's line left as it is",
        () => MUTE === 120000 && out16p && !out16p.threw && out16p.late === true && out16p.kept === true && W16p.gets.length === 62
              && out16p.error === "the chart read along it had no answer it could use from the console for 2 min (2 of 9 tile(s) read "
                                  + "when it last answered; the last ask: the console could not be reached)"
              && W16p2.posts.length === 61 && W16p2.gets.length === 0 && !W16p2.api.state().passageBusy && W16p2.workerMsgs.length === 0
              && W16p2.api.state().corridorRead === other16p
              && last(W16p2) === "Passage NOT planned: the chart read along it had no answer it could use from the console for 2 min (the "
                                 + "last ask: the console could not be reached) - press Plan passage again to ask again."
              && out16p3 && out16p3.late === true && out16p3.kept === false && W16p3.posts.length === 3
              && out16p3.error === "the chart read along it had no answer it could use from the console for 2 min (the last ask: the console could not be reached)"
              && W16p4.gets.length === 3 && W16p4.api.state().passage === null
              && last(W16p4) === "Passage NOT planned: the chart read along it had no answer it could use from the console for 3 min (0 of 9 "
                                 + "tile(s) read when it last answered; the last ask: HTTP 500 - the console failed handling /api/enc/corridor: "
                                 + "OSError: disk full) - press Plan passage again to ask again."
              && late16p(W16p4) && late16p(W16p4)[1].mute === true && late16p(W16p4)[1].done === 0 && late16p(W16p4)[1].min === 3,
        () => JSON.stringify({ polls: [out16p, W16p.gets.length], posts: [W16p2.posts.length, last(W16p2).slice(0, 200)], hidden: [out16p3, W16p3.posts.length],
                               none: [W16p4.gets.length, last(W16p4).slice(0, 260), late16p(W16p4) && late16p(W16p4)[1]] }));
  // 16q. THE CLOCK IS READ BEFORE THE POLL (the 2026-11-14 review): a poll asked at 29 min 50 s that hangs its 30 s bound
  // across the 30 min is not the last - the next poll, asked past it, is, and the read it finds done is planned
  const W16q = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16q.postAnswer = async () => { W16q.clock += 50000; return { id: "g", state: "running", total: 9, done: 0, tiles: [] }; };
  W16q.getAnswer = ((g) => (id) => W16q.polls === 29 ? hang(W16q) : W16q.polls >= 30 ? W16q.done(id) : g(id))(W16q.getAnswer);
  const end16q = await drive(W16q, W16q.api.planPassageNow());
  check("16q. THE CLOCK IS READ BEFORE THE POLL: a poll asked at 29 min 50 s hung across the " + MIN + " min is not the last - the "
        + "next, asked past it, finds the read done, and it is planned",
        () => end16q === "settled" && W16q.hung === 1 && W16q.polls === 30 && !!W16q.api.state().passage && W16q.workerMsgs.length === 1
              && !W16q.logs.some((l) => l[1] && l[1].state === "late"),
        () => JSON.stringify({ end: end16q, hung: W16q.hung, polls: W16q.polls, planned: !!W16q.api.state().passage, banner: last(W16q).slice(0, 120) }));
  // 16r. A TILE THAT FAILED IS NOT READ (the third 2026-11-14 review): the console counts a tile `done` read or failed -
  // two builds cut at their limit were said "2 of 9 read" and the tiles kept. The read count leaves them out and says them
  const runF16r = (nf) => (id) => ({ id, state: "running", total: 9, done: 2, tiles: [], failed: Array.from({ length: nf }, (_, k) => ({ tile: [k], note: "build cut" })) });
  const W16r = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16r.getAnswer = runF16r(1);
  const out16r = await W16r.api.passagePlanFor(W16r.api.passagePoints(), () => {}, () => false);
  const W16r2 = clockOf(world({ transit: T3.map((p) => ({ ...p })) }), 60000);
  W16r2.getAnswer = runF16r(2);
  await W16r2.api.planPassageNow();
  check("16r. A TILE THAT FAILED IS NOT READ: 2 done, 1 failed, said '1 of 9 read, 1 could not be', kept; 2 done, both failed, "
        + "said '0 of 9 read, 2 could not be', NOT said kept",
        () => out16r && out16r.late === true && out16r.kept === true
              && out16r.error === "the chart read along it did not finish in " + MIN + " min (1 of 9 tile(s) read, 1 could not be)"
              && last(W16r2) === "Passage NOT planned: the chart read along it did not finish in " + MIN + " min (0 of 9 tile(s) read, 2 could not "
                                 + "be) - press Plan passage again to ask again.",
        () => JSON.stringify({ one: out16r, none: last(W16r2) }));

  // ── 16s-16t. ONE READ, TWO READERS (2026-11-15) ─────────────────────────────────────────────────────────────────
  // The way home past RTH_MAX_M is planned as a passage from where she is (sailHomeFreshRun -> passagePlanFor: her
  // position, then home), and the low-fuel monitor's water distance home is the coarse field's (coarseHomeBuild: home,
  // then her position). Both read the chart along that one line with its grids; from ~125 km both read 25 km either
  // side, and the console names a read by its TILES (corridor_start) - so the two asks are ONE job. Past
  // COARSE_HOME_MAX_TILES (330-400 km at 43 N, by heading) the build STOPPED the read it had no use for ({cancel: id},
  // and again every minute): the way home's own read, which answered "canceled" - "RTH refused: ... the chart read along it was
  // stopped", FINAL for the end-of-plan chain (rthChainFailed) and the monitor (its latch kept). Driven here against the
  // console's OWN job code (tests/lib/corridor_console.py: corridor_post and corridor_status in a child, the tile reads
  // alone stubbed and held at a gate), because the defect is in neither side's stub - it is that the two are one job.
  const corridorConsole = () => {
    const child = require("child_process").spawn(process.env.PYTHON || "python", [path.join(__dirname, "lib", "corridor_console.py")],
      { env: Object.assign({}, process.env, { ASV_APP: APP, PYTHONIOENCODING: "utf-8" }), stdio: ["pipe", "pipe", "pipe"] });
    let buf = "", err = "", dead = false;
    const waiting = [];
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      for (let k = buf.indexOf("\n"); k >= 0; k = buf.indexOf("\n")) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1);
        const r = waiting.shift(); if (r) { try { r(JSON.parse(line)); } catch (e) { r({ dead: "a line that was not JSON: " + line.slice(0, 120) }); } }
      }
    });
    child.stderr.on("data", (d) => { err += d; });
    const end = (why) => { dead = why; while (waiting.length) waiting.shift()({ dead: why + (err ? ": " + err.slice(-300) : "") }); };
    child.on("error", (e) => end("the child did not start (" + e.message + ")"));
    child.on("exit", (code) => end("the child ended (exit " + code + ")"));
    // (an ask the child never answers is said, not waited on for good)
    // (`ms`: the first ask waits out the child's start - the app's import, compiled afresh, took past 20 s on a busy
    // machine, and three checks went red for a console that was only slow to start)
    const ask = (o, ms) => {
      if (dead) return Promise.resolve({ dead });
      let timer = null;
      return Promise.race([
        new Promise((r) => { waiting.push(r); child.stdin.write(JSON.stringify(o) + "\n"); }),
        new Promise((r) => { timer = setTimeout(() => r({ dead: "no answer in " + (ms || 20000) / 1000 + " s to " + JSON.stringify(o).slice(0, 80) }), ms || 20000); }),
      ]).finally(() => clearTimeout(timer));
    };
    return { ask, quit: () => { try { child.stdin.end(); } catch (e) { /* gone */ } try { child.kill(); } catch (e) { /* gone */ } } };
  };
  const bounded = (p, ms) => Promise.race([Promise.resolve(p).catch((e) => ({ threw: String((e && e.message) || e) })),
                                           new Promise((r) => setTimeout(() => r({ hung: true }), ms || 20000))]);
  const HOME16 = { lat: 43.07, lon: -70.71 };
  const eastOf = (p, m) => ({ lat: p.lat, lon: p.lon + m / (111320 * Math.cos(p.lat * Math.PI / 180)) });
  // her world `m` meters east of home: the page's asks put to the console's own code, and the points the far RTH plans
  // her way home over - her position then home, two ports (sailHomeFreshRun's own line, pinned below)
  const homeWorld = (con, m) => {
    const here = eastOf(HOME16, m), w = world({ asv: here, home: HOME16 });
    w.here = here; w.answers = [];
    w.postAnswer = async (b) => { const a = await con.ask({ op: "post", body: b }); if (a.dead) throw new Error(a.dead); w.answers.push(a); return a.body; };
    w.getAnswer = async (id) => { const a = await con.ask({ op: "get", id }); if (a.dead) throw new Error(a.dead); return a.body; };
    w.pts = [{ lat: here.lat, lon: here.lon, port: true, t: 0 }, { lat: HOME16.lat, lon: HOME16.lon, port: true, t: 1 }];
    w.worker = { legs: [mkLeg(0, w.pts[0], w.pts[1], flat(w.pts[0], w.pts[1]))], lengthM: flat(w.pts[0], w.pts[1]), ms: 3 };
    w.wayHome = () => w.api.passagePlanFor(w.pts, () => {}, () => false);
    w.coarseAsk = () => w.posts.find((b) => b && b.route && flat(b.route[0], HOME16) < 1);      // the build's: home first
    return w;
  };
  const con16 = corridorConsole();
  const hello16 = await con16.ask({ op: "seen" }, 120000);
  const MAXT = W16.api.coarseHome.MAX_TILES;
  let one16 = null, stop16 = null, stale16 = null;
  if (hello16 && hello16.jobs) {
    // (A) 400 km out, past the limit: the way home's read running and waited on, then the build asks
    const wA = homeWorld(con16, 400000);
    const pA = bounded(wA.wayHome());
    await until(() => wA.gets.length >= 2);
    const readA = (wA.answers[0] || {}).body || {};
    await bounded(wA.api.coarseHome.build("KA", wA.here));
    const coarseA = wA.api.coarseHome.now(), askA = wA.coarseAsk() || {};
    const seenA = await con16.ask({ op: "seen" });
    await con16.ask({ op: "open" });
    const outA = await pA;
    // (the SAME read: the build's own ask, its limit left off, put to the console names the way home's job. Asked only
    // AFTER the way home has its answer - asked while she waited, this probe was itself an ask on her read, and where a
    // cancel had it being stopped the probe started it again: the old build and the old cancel together then read
    // "planned", and the refusal this check exists for could not be seen)
    const bareA = Object.assign({}, askA); delete bareA.max_tiles;
    const sameA = ((await con16.ask({ op: "post", body: bareA })) || {}).body || {};
    // (the probe's own read - the gate is open - ended before the next part shuts it and counts its tiles)
    for (let i = 0; i < 2000 && sameA.id && ((((await con16.ask({ op: "get", id: sameA.id })) || {}).body || {}).state === "running"); i++) await new Promise((r) => setTimeout(r, 5));
    // (B) the pair, 300 km out, within the limit: the build JOINS the way home's read - one job, each tile read once
    await con16.ask({ op: "shut" });
    const wB = homeWorld(con16, 300000), reads0 = ((await con16.ask({ op: "seen" })) || {}).reads;
    const pB = bounded(wB.wayHome());
    await until(() => wB.gets.length >= 2);
    const pcB = bounded(wB.api.coarseHome.build("KB", wB.here));
    await until(() => wB.answers.length >= 2);
    const readB = (wB.answers[0] || {}).body || {}, joinB = (wB.answers[1] || {}).body || {};
    await con16.ask({ op: "open" });
    const outB = await pB; await pcB;
    const coarseB = wB.api.coarseHome.now(), seenB = await con16.ask({ op: "seen" });
    // (C) 400 km out and nobody else asking: the build's ask starts NOTHING on the console - no job, no tile read
    await con16.ask({ op: "shut" });
    const wC = homeWorld(con16, 400000), seenC0 = await con16.ask({ op: "seen" });
    await bounded(wC.api.coarseHome.build("KC", wC.here));
    await new Promise((r) => setTimeout(r, 100));          // (a job made in error has its first tiles in flight by now)
    const coarseC = wC.api.coarseHome.now(), seenC = await con16.ask({ op: "seen" });
    const jobA = (seenA.jobs || []).find((j) => j.id === readA.id) || {};
    one16 = { readA, sameA, seenA, jobA, outA, coarseA, askA, wA, readB, joinB, outB, coarseB, seenB, reads0, wB, wC, coarseC, seenC0, seenC };
    // 16t. (D) A READ STOPPED FROM ELSEWHERE - a window still on an older page, a request of the operator's own: the
    // console's cancel door stays, and the page no longer sends one. 200 km out, the way home's read running; a cancel
    // put to the console; the planner's answer is NOT final ({late}: the far RTH asks again) - and asked again, planned
    await con16.ask({ op: "shut" });
    const wD = homeWorld(con16, 200000);
    const pD = bounded(wD.wayHome());
    await until(() => wD.gets.length >= 2);
    const readD = (wD.answers[0] || {}).body || {};
    const stopD = await con16.ask({ op: "post", body: { cancel: readD.id } });
    await con16.ask({ op: "open" });
    const outD = await pD, stD = wD.api.state(), workerD = wD.workerMsgs.length;
    const logD = wD.logs.find((l) => l[0] === "passage_plan" && l[1].state === "stopped");
    const outD2 = await bounded(wD.wayHome());
    // ... and Plan passage's own words for it (the operator's press)
    await con16.ask({ op: "shut" });
    const wE = homeWorld(con16, 150000); wE.transit.push({ lat: HOME16.lat, lon: HOME16.lon });
    const pE = bounded(wE.api.planPassageNow());
    await until(() => wE.gets.length >= 2);
    await con16.ask({ op: "post", body: { cancel: ((wE.answers[0] || {}).body || {}).id } });
    await con16.ask({ op: "open" });
    await pE;
    stop16 = { readD, stopD, outD, stD, logD, outD2, wD, wE, workerD };
    // 16u. THE STALE PAGE (the adversarial review of 16s, which ran the page of before this change against this console
    // and got the whole defect back). A window left on an older page still sends the old build's two posts every minute -
    // its ask with NO limit, then {cancel: id} - and an older page still takes "canceled" as final. So the console counts
    // the asks on a read (corridor_cancel: a cancel takes back ONE) and never joins an ask to a read being stopped. The
    // stale window's two posts are put to the console here as it sends them: the build's own ask without its limit.
    const bare = (w) => { const b = Object.assign({}, w.coarseAsk() || {}); delete b.max_tiles; return b; };
    // (F) THE WAY HOME FIRST: her read running and waited on; the stale ask JOINS it (2 asks), its cancel takes that one
    // back - nothing stopped, and the way home is planned on its FIRST ask, never told "canceled"
    await con16.ask({ op: "shut" });
    const wF = homeWorld(con16, 430000);
    const pF = bounded(wF.wayHome());
    await until(() => wF.gets.length >= 2);
    const readF = (wF.answers[0] || {}).body || {};
    await bounded(wF.api.coarseHome.build("KF", wF.here));         // (this page's own ask, refused with the count)
    const joinF = ((await con16.ask({ op: "post", body: bare(wF) })) || {}).body || {};
    const cancelF = ((await con16.ask({ op: "post", body: { cancel: joinF.id } })) || {}).body || {};
    const seenF = await con16.ask({ op: "seen" });
    await con16.ask({ op: "open" });
    const outF = await pF;
    // (G) THE STALE WINDOW FIRST: its ask starts the read, tiles in flight (held at the gate), its cancel - the read is
    // BEING stopped, running still - and THEN the way home asks: a new read under the same name, not the one being
    // stopped; planned on its first ask
    await con16.ask({ op: "shut" });
    const wG = homeWorld(con16, 460000);
    await bounded(wG.api.coarseHome.build("KG", wG.here));
    const readsG0 = ((await con16.ask({ op: "seen" })) || {}).reads || 0;
    const startG = ((await con16.ask({ op: "post", body: bare(wG) })) || {}).body || {};
    for (let i = 0; i < 400 && (((await con16.ask({ op: "seen" })) || {}).reads || 0) <= readsG0; i++) await new Promise((r) => setTimeout(r, 5));
    const cancelG = ((await con16.ask({ op: "post", body: { cancel: startG.id } })) || {}).body || {};
    const pG = bounded(wG.wayHome());
    await until(() => wG.gets.length >= 2);
    const readG = (wG.answers[1] || {}).body || {};                // ([0] is this page's build, refused; [1] the way home's)
    const seenG = await con16.ask({ op: "seen" });
    await con16.ask({ op: "open" });
    const outG = await pG;
    stale16 = { readF, joinF, cancelF, seenF, outF, wF, startG, cancelG, readG, seenG, outG, wG };
  }
  con16.quit();
  const sfr16 = grab("sailHomeFreshRun");
  check("16s. ONE READ, TWO READERS, the console's own job code under both (corridor_post): 400 km from home the way home's "
        + "read (passagePlanFor) and the coarse field's (coarseHomeBuild) are the SAME job, past the " + MAXT + " tiles the "
        + "field is measured over - and the build asking while the way home waits on it sends NO cancel, the read goes on, "
        + "and the way home is PLANNED; the build says the count and never searches. THE PAIR: 300 km out, within the "
        + "limit, the build JOINS that one read (each tile read once) and both are served. ALONE at 400 km the build's "
        + "ask starts nothing on the console: no job, no tile read, no poll",
        () => one16 && one16.readA.state === "running" && one16.readA.total > MAXT && one16.sameA.id === one16.readA.id
              && one16.askA.max_tiles === MAXT && one16.askA.grids === true
              && !one16.seenA.posts.some((b) => b && b.cancel) && one16.jobA.state === "running" && one16.jobA.cancel === false
              && one16.outA && one16.outA.plan && !one16.outA.error && one16.wA.workerMsgs.length === 1
              && one16.coarseA.busy === false && one16.coarseA.hf === null && !one16.wA.homeMsgs
              && one16.coarseA.note === "the way home is " + one16.readA.total + " chart tiles, past the " + MAXT + " it is measured over"
              && one16.readB.total <= MAXT && one16.readB.total > 0 && one16.joinB.id === one16.readB.id && one16.outB && one16.outB.plan
              && one16.coarseB.note === "ready" && (one16.wB.homeMsgs || []).length === 1
              && one16.seenB.reads - one16.reads0 === one16.readB.total && !one16.seenB.posts.some((b) => b && b.cancel)
              && one16.wC.posts.length === 1 && one16.wC.gets.length === 0 && one16.seenC.reads === one16.seenC0.reads
              && one16.seenC.jobs.length === one16.seenC0.jobs.length && one16.seenC.jobs.every((j) => j.state !== "running")
              && /^the way home is \d+ chart tiles, past the /.test(one16.coarseC.note || "")
              && /const points = \[\{lat: asv\.lat, lon: asv\.lon, port: true, t: 0\}, \{lat: S\.home\.lat, lon: S\.home\.lon, port: true, t: 1\}\];/.test(sfr16)
              && /passagePlanFor\(points, /.test(sfr16),
        () => !one16 ? "the console's code did not start: " + JSON.stringify(hello16).slice(0, 300)
          : JSON.stringify({ A: { tiles: one16.readA.total, same: one16.sameA.id === one16.readA.id, max_tiles: one16.askA.max_tiles,
                                  cancels: one16.seenA.posts.filter((b) => b && b.cancel).length, job: [one16.jobA.state, one16.jobA.cancel],
                                  wayHome: one16.outA && (one16.outA.plan ? "planned" : one16.outA), coarse: one16.coarseA.note },
                             B: { tiles: one16.readB.total, joined: one16.joinB.id === one16.readB.id, wayHome: one16.outB && (one16.outB.plan ? "planned" : one16.outB),
                                  coarse: one16.coarseB.note, read: one16.seenB.reads - one16.reads0 },
                             C: { posts: one16.wC.posts.length, gets: one16.wC.gets.length, read: one16.seenC.reads - one16.seenC0.reads,
                                  jobs: [one16.seenC0.jobs.length, one16.seenC.jobs.length], coarse: one16.coarseC.note } }));
  const STOP16 = "the chart read along it was stopped by a cancel from elsewhere";
  check("16t. A READ STOPPED FROM ELSEWHERE (the console's cancel, put to its own job code while the way home waits on the "
        + "read) is NOT a final refusal: the planner answers {error, late, kept: false} - the far RTH asks again on late - "
        + "in words naming the cause, logged, the worker never asked, the Passage tab's line 'stopped', not 'reading'; asked "
        + "again, the way home is PLANNED; Plan passage says to press again",
        () => stop16 && stop16.stopD.status === 200 && stop16.outD && stop16.outD.late === true && stop16.outD.kept === false && stop16.outD.error === STOP16
              && !stop16.outD.plan && stop16.workerD === 0 && stop16.wD.workerMsgs.length === 1 && stop16.logD && stop16.logD[1].id === stop16.readD.id
              && stop16.stD.corridorRead && stop16.stD.corridorRead.state === "canceled"
              && stop16.outD2 && stop16.outD2.plan && !stop16.outD2.error
              && last(stop16.wE) === "Passage NOT planned: " + STOP16 + " - press Plan passage again to ask again." && stop16.wE.workerMsgs.length === 0,
        () => !stop16 ? "the console's code did not start: " + JSON.stringify(hello16).slice(0, 300)
          : JSON.stringify({ stop: stop16.stopD.status, out: stop16.outD, log: stop16.logD && stop16.logD[1], line: stop16.stD.corridorRead && stop16.stD.corridorRead.state,
                             again: stop16.outD2 && (stop16.outD2.plan ? "planned" : stop16.outD2), worker: [stop16.workerD, stop16.wD.workerMsgs.length], press: last(stop16.wE) }));
  const jobOf = (seen, id) => ((seen && seen.jobs) || []).find((j) => j.id === id) || {};
  const asksOk = (w) => w.answers.filter((a) => a.status === 200).length === 1;       // the way home asked ONCE: planned on that ask
  const neverStopped = (w) => !w.logs.some((l) => l[0] === "passage_plan" && (l[1].state === "stopped" || l[1].state === "late"));
  check("16u. A WINDOW STILL ON THE OLD PAGE (its build's ask with no limit, then its cancel, put to the console's own job "
        + "code as it sends them) DOES NOT STOP THE WAY HOME'S READ. The way home first: the stale ask JOINS her read (2 "
        + "asks), its cancel takes that one back (1 left, the read running, not being stopped) and the way home is planned "
        + "on its FIRST ask. The stale window first: its read is being stopped, running still, when the way home asks - a "
        + "NEW read under the same name (1 ask, not being stopped), planned on its first ask. Neither is ever told "
        + "'canceled' - the answer an older page takes as final",
        () => stale16 && stale16.readF.state === "running" && stale16.joinF.id === stale16.readF.id && stale16.joinF.asks === 2
              && stale16.cancelF.state === "running" && stale16.cancelF.asks === 1 && jobOf(stale16.seenF, stale16.readF.id).cancel === false
              && stale16.outF && stale16.outF.plan && !stale16.outF.error && asksOk(stale16.wF) && neverStopped(stale16.wF)
              && stale16.startG.state === "running" && stale16.cancelG.asks === 0 && stale16.cancelG.state === "running"
              && stale16.readG.id === stale16.startG.id && stale16.readG.state === "running" && stale16.readG.asks === 1
              && jobOf(stale16.seenG, stale16.readG.id).cancel === false
              && stale16.outG && stale16.outG.plan && !stale16.outG.error && asksOk(stale16.wG) && neverStopped(stale16.wG),
        () => !stale16 ? "the console's code did not start: " + JSON.stringify(hello16).slice(0, 300)
          : JSON.stringify({ F: { joined: stale16.joinF.id === stale16.readF.id, asks: [stale16.joinF.asks, stale16.cancelF.asks], after: [stale16.cancelF.state, jobOf(stale16.seenF, stale16.readF.id).cancel],
                                  wayHome: stale16.outF && (stale16.outF.plan ? "planned" : stale16.outF), herAsks: stale16.wF.answers.filter((a) => a.status === 200).length },
                             G: { stopping: [stale16.cancelG.state, stale16.cancelG.asks], hers: [stale16.readG.id === stale16.startG.id, stale16.readG.state, stale16.readG.asks, jobOf(stale16.seenG, stale16.readG.id).cancel],
                                  wayHome: stale16.outG && (stale16.outG.plan ? "planned" : stale16.outG), herAsks: stale16.wG.answers.filter((a) => a.status === 200).length } }));

  // ── 17. the words ───────────────────────────────────────────────────────────────────────────────────────────────
  const plan17 = { points: P12, legs: [mkLeg(0, P12[0], P12[1], 20000), mkLeg(1, P12[1], P12[2], 0, { error: "blocked", pts: [] }),
                                       mkLeg(2, P12[2], P12[3], 30000, { narrow: [{ lenM: 700, at: P12[3] }, { lenM: 300, at: P12[3] }] }),
                                       mkLeg(3, P12[3], P12[4], 10000)],
                   lengthM: 60000, model, twKn: 7, level0: 150, missing: 0, failedTiles: 2 };
  plan17.fuelLegs = W12.api.passageFuelLegs(P12, plan17.legs);
  plan17.fuel = F.passageFuel(model, plan17.fuelLegs, 7, 150).map((x, k) => plan17.fuelLegs[k].whole ? x : null);
  const say17 = W12.api.passageSummary(plan17), line17 = W12.api.passageLine(plan17);
  check("17. THE WORDS: planned IN PART (how much of it); the fuel leg with the leg not planned NOT checked; the leg "
        + "refused, why, in words; the next fuel leg judged from a full tank; the ports planned in detail and the two "
        + "narrow stretches with their length; the tiles not read; the panel's line counts all of it",
        () => /^PASSAGE PLANNED IN PART, COARSE: .* of it from her position to P4/.test(say17)
              && /Her position to P2: its fuel is NOT checked/.test(say17) && /P1 to P2 could NOT be planned: no water way/.test(say17)
              && /P2 to P4: .* from a full tank/.test(say17) && /within .* of her position, P2, P4/.test(say17)
              && /2 narrow stretches \(0\.54 nm in all, yellow\)/.test(say17) && /2 chart tile\(s\) could not be read/.test(say17)
              && /1 leg\(s\) NOT planned/.test(line17) && /1 fuel leg\(s\) NOT checked/.test(line17),
        () => say17.slice(0, 600) + " || " + line17);

  // ── 18. the drawing ─────────────────────────────────────────────────────────────────────────────────────────────
  const W18 = world();
  W18.api.setPassage({ points: P12, reserveAt: [null, P12[3]],
    legs: [mkLeg(0, P12[0], P12[1], 1, { pts: [P12[0], { lat: 43.02, lon: -70.65 }, P12[1]] }), mkLeg(1, P12[1], P12[2], 0, { error: "blocked", pts: [] }),
           mkLeg(2, P12[2], P12[3], 1, { narrow: [{ lenM: 1, at: P12[3] }] })] });
  W18.api.drawPassage((lat, lon) => ({ x: lon, y: -lat }));
  const ops = W18.ops.map((o) => o[0]);
  const arcs = W18.ops.filter((o) => o[0] === "arc");
  const portR = Math.abs(C.PORT_R_M / 111320);
  check("18. THE DRAWING: each planned leg's line through its points; the failed leg straight; a mark per narrow stretch; "
        + "a circle per port (" + P12.filter((p) => p.port).length + ") the port's radius; the reserve mark, labelled 20%",
        () => ops.filter((k) => k === "lineTo").length === 2 + 1 + 1 && arcs.length === 1 + 3 + 1
              && arcs.filter((a) => Math.abs(a[3] - portR) < 1e-9).length === 3
              && W18.ops.some((o) => o[0] === "fillText" && o[1] === "20%"),
        () => "lineTo " + ops.filter((k) => k === "lineTo").length + ", arcs " + arcs.map((a) => +a[3].toFixed(4)).join("/"));

  // ── 19. the wiring ──────────────────────────────────────────────────────────────────────────────────────────────
  const WK = fs.readFileSync(path.join(APP, "static", "js", "coarse_worker.js"), "utf8");
  const wiring = {
    button: /<button class="ctl small" id="tr_plan"[^>]*>Plan passage<\/button>/.test(H) && /\$\("#tr_plan"\)\.onclick = \(\) => planPassageNow\(\);/.test(H),
    drawn: /drawTransit\(toScreen\);\s*\n\s*drawPassageWps\(toScreen\);\s*\n\s*drawPassage\(toScreen\);/.test(H),
    click: /const hit = passagePointAt\(.*\);\s*\n\s*if\(hit >= 0\) toggleFuelStop\(hit\);\s*\n\s*else \{ passageWps\.push\(\{lat:ll\.lat, lon:ll\.lon\}\); passageEdited\(\); \}/.test(H),
    undo: /passageWps\.pop\(\); passageEdited\(\);/.test(H) && /passageWps=\[\]; passageEdited\(\);/.test(H),
    // every edit of the passage's line drops the plan: the click, Add, Undo, Clear and a long Go-To's - and the declaration
    every_edit: (H.match(/passageWps(\.push\(|\.pop\(|\s*=\s*\[)/g) || []).length === 6
                && (H.match(/passageWps(\.push\([^;]*\)|\.pop\(\)|\s*=\s*\[[^;]*\]); passageEdited\(\)/g) || []).length === 5,
    imports: /passageFuel,\s*\n\s*FUEL_RESERVE_FRAC, FUEL_REARM_FRAC \} from "\/static\/js\/fuel\.js"/.test(H) && /import \{ PORT_R_M as PASSAGE_PORT_R_M, homeSections, coarseHomeDistM \} from "\/static\/js\/coarse\.js"/.test(H),
    // (the worker imports the coarse home field's functions too since 2026-10-12 - tests/fuel_rth.js 11)
    worker: /new Worker\("\/static\/js\/coarse_worker\.js", \{type: "module"\}\)/.test(H) && /import \{[^}]*\bplanPassage\b[^}]*\} from "\.\/coarse\.js"/.test(WK) && /id: d\.id/.test(WK),
  };
  check("19. THE WIRING: the Plan passage button and its handler; the passage's line drawn after the transit draft and "
        + "the plan after it; a click on a point a fuel stop, elsewhere a point - and every edit of the passage's line (a "
        + "click, Add, Undo, Clear, a long Go-To) drops the plan; the "
        + "imports; the worker a module, answering by id",
        () => Object.values(wiring).every(Boolean),
        () => Object.entries(wiring).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  // ── 20. OPEN WATER FIRST, COARSE (2026-10-14) ───────────────────────────────────────────────────────────────────
  // a cell's center's distance (m) from the nearest of a set of cells, and the route's least, over the cells it passes
  const KX = CD * 111320 * Math.cos(43.125 * Math.PI / 180), KY = CD * 111320;
  const leastFrom = (cells, set) => { let best = Infinity;
    for (const c of cells) for (const [sc, sr] of set) best = Math.min(best, Math.hypot((c.gx - TX * N - sc) * KX, (c.gy - TY * N - sr) * KY));
    return best; };
  const passed = (pts) => cellsOf(pts);
  // five islands of 2 x 2 cells down column 127, 6 rows apart (rows 119-144): the straight way crosses the chain at row 131
  const ch = grid(TX, TY), chain = [];
  for (let r0 = 119; r0 <= 143; r0 += 6) for (let r = r0; r < r0 + 2; r++) for (let c = 127; c < 129; c++) { setC(ch, c, r, C.GRID_HARD); chain.push([c, r]); }
  const aCh = ll(ch, 20, 131), bCh = ll(ch, 236, 131);
  const onCh = C.planPassage({ grids: [ch], floorDm: FLOOR, points: [aCh, bCh] }), offCh = C.planPassage({ grids: [ch], floorDm: FLOOR, points: [aCh, bCh], openWater: false });
  const crossRows = (pl) => passed(pl.legs[0].pts).filter((c) => c.gx - TX * N === 127).map((c) => c.gy - TY * N);
  const inSpan = (rows) => rows.some((r) => r >= 119 && r <= 144);
  const clrOn = leastFrom(passed(onCh.legs[0].pts), chain), clrOff = leastFrom(passed(offCh.legs[0].pts), chain);
  check("20. OPEN WATER FIRST, COARSE: an island chain across the way is gone ROUND - the route crosses the chain's line "
        + "beyond its end, at twice the least clearance the level rules thread a gap with, for under 5% more length; with "
        + "it off, through a gap as before",
        () => !onCh.legs[0].error && !offCh.legs[0].error && onCh.openWater === true && offCh.openWater === false
              && !inSpan(crossRows(onCh)) && inSpan(crossRows(offCh)) && clrOn >= 2 * clrOff
              && onCh.legs[0].lengthM < offCh.legs[0].lengthM * 1.05,
        () => "on: crosses at rows " + JSON.stringify(crossRows(onCh)) + ", " + clrOn.toFixed(0) + " m off, " + onCh.legs[0].lengthM.toFixed(0)
              + " m; off: rows " + JSON.stringify(crossRows(offCh)) + ", " + clrOff.toFixed(0) + " m off, " + offCh.legs[0].lengthM.toFixed(0) + " m");

  // a straight coast down column 60 and a headland out to column 80 (rows 120-135); the way past it runs 6 cells off its tip
  const hl = grid(TX, TY), head = [];
  for (let r = 0; r < N; r++) for (let c = 0; c <= 60; c++) setC(hl, c, r, C.GRID_HARD);
  for (let r = 120; r <= 135; r++) for (let c = 61; c <= 80; c++) { setC(hl, c, r, C.GRID_HARD); head.push([c, r]); }
  const aHl = ll(hl, 86, 10), bHl = ll(hl, 86, 245);
  const onHl = C.planPassage({ grids: [hl], floorDm: FLOOR, points: [aHl, bHl] }), offHl = C.planPassage({ grids: [hl], floorDm: FLOOR, points: [aHl, bHl], openWater: false });
  const fHlOn = C.buildField([hl], FLOOR), fHlOff = C.buildField([hl], FLOOR, 0, { openWater: false });
  const sHl = C.searchLeg(fHlOn, C.cellOf(aHl), C.cellOf(bHl), []);
  const pulledCost = C.pullTaut(fHlOn, sHl.cells, []), pulledLevel = C.pullTaut(fHlOff, sHl.cells, []);
  const cSearch = leastFrom(sHl.cells, head), cCost = leastFrom(passed(pulledCost.map((c) => C.cellLL(c.gx, c.gy))), head);
  const cLevel = leastFrom(passed(pulledLevel.map((c) => C.cellLL(c.gx, c.gy))), head);
  const cOn = leastFrom(passed(onHl.legs[0].pts), head), cOff = leastFrom(passed(offHl.legs[0].pts), head);
  check("20b. THE PULL KEEPS THE BERTH: past a headland the open-water search keeps " + cSearch.toFixed(0) + " m off, and the "
        + "taut route keeps within 10% of that; the level rule alone, pulling the SAME search's cells, cuts it back toward "
        + "the headland (the straight way past it), as the passage with it off runs",
        () => !sHl.error && cCost >= 0.9 * cSearch && cLevel < 0.75 * cSearch && pulledLevel.length === 2
              && Math.abs(cOn - cCost) < 1 && cOff < 0.75 * cOn,
        () => "search " + cSearch.toFixed(0) + " m, pulled by cost " + cCost.toFixed(0) + " m (" + pulledCost.length + " cells), by level "
              + cLevel.toFixed(0) + " m (" + pulledLevel.length + "); the passage on " + cOn.toFixed(0) + " m, off " + cOff.toFixed(0) + " m");

  // a dock 10 cells inside land (a port), an islet 1.3 km off it inside the port's circle, the sea 14 km east
  const pt = grid(TX, TY);
  for (let r = 0; r < N; r++) for (let c = 0; c < 60; c++) setC(pt, c, r, C.GRID_HARD);
  for (let r = 126; r <= 131; r++) for (let c = 66; c <= 68; c++) setC(pt, c, r, C.GRID_HARD);
  const fPtOn = C.buildField([pt], FLOOR), fPtOff = C.buildField([pt], FLOOR, 0, { openWater: false });
  const aPt = C.cellOf(ll(pt, 50, 128)), bPt = C.cellOf(ll(pt, 230, 128));
  const sPtOn = C.searchLeg(fPtOn, aPt, bPt, [aPt]), sPtOff = C.searchLeg(fPtOff, aPt, bPt, [aPt]);
  const key20 = (r) => (r.cells || []).map((c) => c.gx + "," + c.gy).join(" ");
  const WK20 = fs.readFileSync(path.join(APP, "static", "js", "coarse_worker.js"), "utf8"), posted20 = [];
  const self20 = { postMessage: (m) => posted20.push(m) };
  // eslint-disable-next-line no-new-func
  new Function("self", "buildField", "coarseHomeField", "decodeGrid", "planPassage", WK20.replace(/^import[^\n]*\n/m, ""))(
    self20, C.buildField, C.coarseHomeField, C.decodeGrid, C.planPassage);
  self20.onmessage({ data: { id: 1, grids: [ch], floorDm: FLOOR, points: [aCh, bCh] } });
  self20.onmessage({ data: { id: 2, grids: [ch], floorDm: FLOOR, points: [aCh, bCh], openWater: false } });
  check("20c. NOT IN A PORT'S CIRCLE: leaving a port past an islet inside its circle, the search's cells are the level rules' "
        + "own (the harbor is the detail planner's); with it off no tile carries the cost; the worker plans with it unless "
        + "told not to, and says which",
        () => !sPtOn.error && key20(sPtOn) === key20(sPtOff) && fPtOn.list.some((t) => t.nr) && fPtOff.list.every((t) => !t.nr)
              && posted20.length === 2 && posted20[0].openWater === true && posted20[1].openWater === false
              && JSON.stringify(posted20[1].legs[0].pts) === JSON.stringify(offCh.legs[0].pts)
              && JSON.stringify(posted20[0].legs[0].pts) === JSON.stringify(onCh.legs[0].pts),
        () => "cells " + (sPtOn.cells || []).length + "/" + (sPtOff.cells || []).length + " same " + (key20(sPtOn) === key20(sPtOff))
              + "; worker " + JSON.stringify(posted20.map((m) => [m.id, m.openWater, m.error || null])));

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED (" + ran + " ran)" : "all checks passed (" + ran + ")"));
  process.exit(fails ? 1 : 0);
})();
