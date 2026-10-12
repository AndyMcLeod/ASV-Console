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
//   6    A PORT: a start 1 km inside land is left by water when it is a port; the same start NOT a port, refused;
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
  const fmtDist = (m) => m < 1000 ? Math.round(m) + " m" : (m / 1852).toFixed(2) + " nm";
  const fmtDur = (s) => Math.floor(s / 3600) + "h " + String(Math.round((s % 3600) / 60)).padStart(2, "0") + "m";
  const world = (o) => {
    const w = Object.assign({ posts: [], gets: [], fetches: [], banners: [], notes: [], logs: [], renders: 0, workerMsgs: [],
                              asv: { lat: 43.07, lon: -70.71 }, transit: [], seq: [], model, kn: 7, status: { fuel_l: 200 },
                              grid404: [], worker: null, ops: [] }, o || {});
    const src = "let passage = null, passageBusy = false, passageStatus = \"\", transitGen = 0, corridorRead = null;\n"
      + "const PASSAGE_HALF_KM = 5, PASSAGE_GRID_FETCHES = 6, CORRIDOR_POLL_MS = 0;\n"
      + "const PASSAGE_LEG_WHY = " + /const PASSAGE_LEG_WHY = (\{[\s\S]*?\});/.exec(H)[1] + ";\n"
      + fuelSrc + "\n"
      + ["transitEdited", "transitPointAt", "toggleFuelStop", "passageRefusal", "passagePoints", "passageName", "passageFuelLegs",
         "passageAlong", "passageSummary", "passageLine", "passageGrids", "planPassageNow", "drawPassage"].map(grab).join("\n")
      + "\nreturn {transitEdited, transitPointAt, toggleFuelStop, passageRefusal, passagePoints, passageFuelLegs, passageAlong,"
      + " passageSummary, passageLine, planPassageNow, drawPassage, state: () => ({passage, passageBusy, transitGen}),"
      + " setPassage: (p) => { passage = p; }, bump: () => { transitGen++; }};";
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { w.ops.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } });
    w.api = new Function("asv", "transit", "fuelModel", "V", "roleSpeed", "S", "energyLevel", "passageFuel", "FUEL_RESERVE_FRAC",
      "fmtDist", "fmtDur", "fmtMS", "distTo", "PASSAGE_PORT_R_M", "M_PER_DEG_LAT", "nogoDR", "postCorridor", "getCorridor",
      "corridorSummary", "toCorridor", "fetch", "passageInWorker", "showBanner", "flashNote", "logClient", "updateTransitPanel",
      "render", "worldPx", "zoom", "ctx", "airNeedM", src)(
      w.asv, w.transit, () => w.model, { SPEED_KN: { transit: w.kn } }, () => "transit", { status: w.status }, F.energyLevel,
      F.passageFuel, F.FUEL_RESERVE_FRAC, fmtDist, fmtDur, (s) => s + "s", flat, C.PORT_R_M, 111320, () => ({ min: 3.15 }),
      async (b) => { w.posts.push(b); return w.seq.length ? w.seq.shift() : { id: "j", state: "done", total: 0, done: 0, tiles: [] }; },
      async (id) => { w.gets.push(id); return w.seq.shift(); }, (st) => "SUMMARY " + JSON.stringify(st), (st) => st,
      async (url) => { w.fetches.push(url); const bad = w.grid404.some((t) => url.endsWith(t)); return { ok: !bad, arrayBuffer: async () => new ArrayBuffer(8) }; },
      async (msg) => { w.workerMsgs.push(msg); if (w.duringWorker) w.duringWorker(w); return w.worker; },
      (t) => w.banners.push(t), (t) => w.notes.push(t), (k, d) => w.logs.push([k, d]), () => {}, () => { w.renders++; },
      (lat, lon) => ({ x: lon * 1000, y: -lat * 1000 }), 9, ctx, () => 3.85);
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
  const hit = W14.api.transitPointAt(-70.35 * 1000 + 4, -43.3 * 1000 + 3), miss = W14.api.transitPointAt(0, 0);
  check("14. A FUEL STOP is a click on a point: T2 made one, the line's plan dropped, the note says so; the arrival "
        + "(the last point) refused with a note, nothing changed; a click within a few pixels of a point finds it",
        () => W14.transit[1].fuel === true && s14.passage === null && s14.transitGen === 1 && /T2 is a FUEL STOP/.test(W14.notes[0])
              && !W14.transit[3].fuel && s14b.passage !== null && s14b.transitGen === 1 && /T4 is the arrival/.test(W14.notes[1])
              && hit === 1 && miss === -1,
        () => JSON.stringify({ fuel: W14.transit.map((p) => !!p.fuel), gen: [s14.transitGen, s14b.transitGen], notes: W14.notes, hit, miss }));

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
        () => W16.posts.length === 1 && W16.posts[0].grids === true && W16.posts[0].half_km === 5
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
  check("16b. REFUSED AND SAID, NOTHING KEPT: the line edited while it was planned; a worker that failed; a chart read "
        + "that stopped (the worker never asked)",
        () => W16b.api.state().passage === null && /edited while it was being planned/.test(W16b.banners.pop() || "")
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
              && /Her position to T2: its fuel is NOT checked/.test(W16e.banners.pop() || ""),
        () => JSON.stringify(pl16e && pl16e.fuel));

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
        () => /^PASSAGE PLANNED IN PART, COARSE: .* of it from her position to T4/.test(say17)
              && /Her position to T2: its fuel is NOT checked/.test(say17) && /T1 to T2 could NOT be planned: no water way/.test(say17)
              && /T2 to T4: .* from a full tank/.test(say17) && /within .* of her position, T2, T4/.test(say17)
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
    drawn: /drawTransit\(toScreen\);\s*\n\s*drawPassage\(toScreen\);/.test(H),
    click: /const hit = transitPointAt\(.*\);\s*\n\s*if\(hit >= 0\) toggleFuelStop\(hit\);\s*\n\s*else \{ transit\.push\(\{lat:ll\.lat, lon:ll\.lon\}\); transitEdited\(\); \}/.test(H),
    undo: /transit\.pop\(\); transitEdited\(\);/.test(H) && /transit=\[\]; transitEdited\(\);/.test(H),
    every_edit: (H.match(/transit\.push\(|transit\.pop\(|transit=\[\]/g) || []).length === 3,
    imports: /passageFuel,\s*\n\s*FUEL_RESERVE_FRAC, FUEL_REARM_FRAC \} from "\/static\/js\/fuel\.js"/.test(H) && /import \{ PORT_R_M as PASSAGE_PORT_R_M \} from "\/static\/js\/coarse\.js"/.test(H),
    worker: /new Worker\("\/static\/js\/coarse_worker\.js", \{type: "module"\}\)/.test(H) && /import \{ planPassage \} from "\.\/coarse\.js"/.test(WK) && /id: d\.id/.test(WK),
  };
  check("19. THE WIRING: the Plan passage button and its handler; the plan drawn right after the transit draft; a click "
        + "on a point a fuel stop, elsewhere a point - and every edit of the line (add, undo, clear) drops the plan; the "
        + "imports; the worker a module, answering by id",
        () => Object.values(wiring).every(Boolean),
        () => Object.entries(wiring).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED (" + ran + " ran)" : "all checks passed (" + ran + ")"));
  process.exit(fails ? 1 : 0);
})();
