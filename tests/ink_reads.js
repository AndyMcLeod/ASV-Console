// tests/ink_reads.js - every chart read of the extract, KEPT and MERGED, and a plan too big for one read read in
// pieces (2026-10-02, sequenced surveys phase 1).
//
// The page read the chart image over each command's water and kept only the LAST read: a new one replaced it and a
// refused one emptied it. An Upload reads ONE box over the boat and every waypoint, and past the 256-tile budget
// (about 3.5 km across at 43 N) that box is refused - so a plan spread over a harbor read nothing, and dropped the
// piers each survey's punch had read. static/js/inkreads.js keeps every read (coveringRead, mergeReads) and cuts a plan
// too big for one box into boxes that are not (pathBoxes); the page's readPlanInk reads an Upload's plan through them.
// What ensureChartInk does with a read - kept, merged, a refusal adding nothing and taking nothing - is
// tests/chart_ink.js 14-14f.
//
// DRIVEN: static/js/inkreads.js directly (pure), and the page's own readPlanInk over the page's real inkTileGrid (the
// budget), with ensureChartInk stubbed to record what was asked for.
//
//   node tests/ink_reads.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_HTML and INKREADS_JS point this at SIDECAR copies for a mutation run - every read of those two files goes
// through them.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);
let __finished = false;
process.on("beforeExit", () => {
  if (__finished) return;
  console.log("  FAIL 0. the suite stopped before finishing - something waited on an answer it was never given");
  console.log("\n1 CHECK(S) FAILED (stopped before finishing)");
  process.exitCode = 1;
});

const fs = require("fs");
const path = require("path");
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const INKREADS_JS = process.env.INKREADS_JS || path.join(__dirname, "..", "static", "js", "inkreads.js");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const IR = require(INKREADS_JS);
const G = require("../static/js/geodesy.js");
const SV = require("../static/js/surveys.js");
const { bboxContains } = require("../static/js/geometry.js");

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
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

// A world in meters east/north of a point at 43 N.
const O = { lat: 43.07, lon: -70.71 };
const at = (e, n) => G.fromEN(e, n, O);
const inBox = (p, b) => p.lat >= b.S && p.lat <= b.N && p.lon >= b.W && p.lon <= b.E;
const spanM = (b) => Math.max(G.distTo({ lat: b.S, lon: b.W }, { lat: b.N, lon: b.W }),
                              G.distTo({ lat: b.S, lon: b.W }, { lat: b.S, lon: b.E }));

console.log("Every chart read kept and merged, and a plan too big for one read read in pieces:");

// ── 1. the box ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pts = [at(0, 0), at(800, 300), at(250, 900)];
  const b = IR.boxAround(pts, 300);
  // Measured with the console's own distTo, not by restating the formula: from the northernmost point to the box's
  // north edge, and from the easternmost to its east edge, is the pad.
  const north = G.distTo(pts[2], { lat: b.N, lon: pts[2].lon }), east = G.distTo(pts[1], { lat: pts[1].lat, lon: b.E });
  check("1. boxAround holds every point with the pad to spare on each side - 300 m north and east, measured",
        () => pts.every((p) => inBox(p, b)) && Math.abs(north - 300) < 1 && Math.abs(east - 300) < 1.5,
        () => "north " + north.toFixed(2) + " m, east " + east.toFixed(2) + " m");
}

// ── 2. is this water already read? ───────────────────────────────────────────────────────────────────────────────
{
  const big = IR.boxAround([at(0, 0), at(2000, 2000)], 0), small = IR.boxAround([at(900, 900), at(1000, 1000)], 0);
  const half = IR.boxAround([at(1900, 1900), at(2100, 2100)], 0);
  const r = (z, bb) => ({ z, bb: bb || big });
  check("2. a read COVERS a box it holds whole when it was read at least as finely - or at z18, detail enough for "
        + "anything finer; never a box it holds only in part, and never at z17 for water that would be read at z19",
        () => IR.readCovers(r(19), small, 19) && IR.readCovers(r(18), small, 19) && !IR.readCovers(r(17), small, 19)
              && IR.readCovers(r(17), small, 17) && !IR.readCovers(r(19), half, 19)
              && IR.coveringRead([r(17), r(18, small)], small, 19) !== null
              && IR.coveringRead([r(17)], small, 19) === null && IR.coveringRead([], small, 19) === null,
        "z19 / z18 / z17 against a z19 request, a box half outside, and the list form");
}

// ── 3. merging ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pier = (e, n, m, de) => ({ a: at(e + (de || 0), n), b: at(e + (de || 0), n + m), lengthM: m });
  const p19 = pier(100, 100, 40), p17 = pier(100, 100, 44, 3);      // one pier, read twice, 3 m apart
  const pLaterSameZ = pier(100, 100, 41, 1);
  const other = pier(400, 100, 30);
  const ring = (e, n, w) => [at(e, n), at(e + w, n), at(e + w, n + w), at(e, n + w)];
  const f19 = { ring: ring(600, 600, 60), lengthM: 60, widthM: 60 }, f17 = { ring: ring(605, 598, 66), lengthM: 66, widthM: 66 };
  const f2 = { ring: ring(900, 900, 40), lengthM: 40, widthM: 40 };
  const d19 = pier(1200, 100, 20), d17 = pier(1200, 100, 22, 2);
  const m = IR.mergeReads([
    { z: 17, seq: 1, lines: [p17, other], areas: [f17, f2], detached: [d17] },
    { z: 19, seq: 2, lines: [p19], areas: [f19], detached: [d19] }]);
  check("3. one pier read by a z19 and a z17 read is ONE line - the z19 read's - and a pier only the coarse read found is "
        + "kept; a footprint read twice is one footprint (the finer read's), another kept; detached marks merge alike",
        () => m.lines.length === 2 && m.lines.includes(p19) && m.lines.includes(other) && !m.lines.includes(p17)
              && m.areas.length === 2 && m.areas.includes(f19) && m.areas.includes(f2)
              && m.detached.length === 1 && m.detached[0] === d19,
        () => m.lines.length + " lines, " + m.areas.length + " areas, " + m.detached.length + " detached");
  const same = IR.mergeReads([{ z: 18, seq: 3, lines: [p19] }, { z: 18, seq: 5, lines: [pLaterSameZ] }]);
  const own = IR.mergeReads([{ z: 19, seq: 1, lines: [p19, pLaterSameZ] }]);
  check("3b. at ONE zoom the LATER read's version stands; and within one read nothing is merged - a read's own "
        + "structures are distinct by construction",
        () => same.lines.length === 1 && same.lines[0] === pLaterSameZ && own.lines.length === 2,
        () => "same zoom: " + same.lines.length + " (the later: " + (same.lines[0] === pLaterSameZ) + "); one read: "
              + own.lines.length);
  const longer = pier(100, 100, 120);                                // the pier chained with a reach beyond it
  const kept = IR.mergeReads([{ z: 17, seq: 1, lines: [longer] }, { z: 19, seq: 2, lines: [p19] }]);
  check("3c. a coarse structure that runs well PAST the fine read's is not merged into it - both stand, and the model "
        + "errs toward the keep-out",
        () => kept.lines.length === 2,
        () => kept.lines.length + " lines");
}

// ── 4. a plan too big for one read ───────────────────────────────────────────────────────────────────────────────
{
  const fits = (b) => spanM(b) <= 1500;                             // a stand-in budget, in meters
  const short = IR.pathBoxes([at(0, 0), at(300, 200)], 100, fits);
  const zig = [];
  for (let k = 0; k < 20; k++) zig.push(at(k % 2 ? 400 : 0, k * 15), at(k % 2 ? 0 : 400, k * 15));
  const dense = IR.pathBoxes(zig, 100, fits);
  check("4. a short path is ONE box, and so is a survey's dense zig-zag - a box grows point by point while it still fits",
        () => short.boxes.length === 1 && short.dropped === 0 && dense.boxes.length === 1
              && zig.every((p) => inBox(p, dense.boxes[0])),
        () => "short " + short.boxes.length + ", dense " + dense.boxes.length);
  const A = at(0, 0), B = at(14000, 9000);
  const long = IR.pathBoxes([A, B], 100, fits, Infinity);           // uncapped: 4c caps it
  const along = Array.from({ length: 401 }, (_, i) => ({ lat: A.lat + (B.lat - A.lat) * i / 400,
                                                        lon: A.lon + (B.lon - A.lon) * i / 400 }));
  const overlap = long.boxes.every((b, i) => i === 0 || !(b.W > long.boxes[i - 1].E || b.E < long.boxes[i - 1].W
                                                         || b.S > long.boxes[i - 1].N || b.N < long.boxes[i - 1].S));
  check("4b. a leg too long for any box is HALVED until every piece fits - and the pieces cover every point of the leg, "
        + "each overlapping the one before",
        // 16 = the halving's pieces and NOTHING MORE: the leg's end, already in its last piece, gets no box of its own
        () => long.boxes.length === 16 && long.dropped === 0 && long.boxes.every(fits)
              && along.every((p) => long.boxes.some((b) => inBox(p, b))) && overlap,
        () => long.boxes.length + " boxes, the widest " + Math.max(...long.boxes.map(spanM)).toFixed(0) + " m");
  const capped = IR.pathBoxes([A, B], 100, fits, 3);
  check("4c. past the most boxes it will read, the rest is NOT read and the count of what was dropped comes back - so "
        + "the page can say so rather than claim the water was read",
        () => capped.boxes.length === 3 && capped.dropped === long.boxes.length - 3,
        () => capped.boxes.length + " read, " + capped.dropped + " dropped of " + long.boxes.length);
  const none = IR.pathBoxes([], 100, fits), one = IR.pathBoxes([A], 100, fits);
  check("4d. no path, no box; one point, one box round it",
        () => none.boxes.length === 0 && one.boxes.length === 1 && inBox(A, one.boxes[0]),
        () => none.boxes.length + " / " + one.boxes.length);
  // Three points 1 km apart in a row: the first box holds two, and the next must START at the last point of the one
  // before, or the kilometer between them is in no box at all.
  const row = [at(0, 0), at(1000, 0), at(2000, 0), at(3000, 0)];
  const rb = IR.pathBoxes(row, 100, fits);
  const rowAlong = [];
  for (let i = 1; i < row.length; i++)
    for (let t = 0; t <= 20; t++) rowAlong.push({ lat: row[i - 1].lat + (row[i].lat - row[i - 1].lat) * t / 20,
                                                  lon: row[i - 1].lon + (row[i].lon - row[i - 1].lon) * t / 20 });
  check("4e. when a box closes, the next OPENS at its last point - every meter of the path between is in a box",
        () => rb.boxes.length >= 2 && rb.boxes.every(fits) && rowAlong.every((p) => rb.boxes.some((b) => inBox(p, b))),
        () => rb.boxes.length + " boxes; uncovered " + rowAlong.filter((p) => !rb.boxes.some((b) => inBox(p, b))).length);
}

// ── 5-8. the page reads an Upload's plan through them ───────────────────────────────────────────────────────────
(async () => {
  const asked = [], banners = [];
  let mission = { surveys: [] };
  // eslint-disable-next-line no-new-func
  const page = new Function("worldPx", "TILE", "pathBoxes", "boxAround", "pathThroughSurveys", "surveyPoints",
    "ensureChartInk", "showBanner", "getMission",
    "\"use strict\";\n"
    + decl(/^const CHART_INK_Z = [^;]*;/m) + "\n" + decl(/^const CHART_INK_MIN_Z = [^;]*;/m) + "\n"
    + decl(/^const CHART_INK_MAX_TILES = [^;]*;/m) + "\n" + decl(/^const INK_SURVEY_PAD_M = [^;]*;/m) + "\n"
    + grab("inkTileGrid") + "\n"
    + grab("readPlanInk").replace(/\bmission\.surveys\b/g, "getMission().surveys")
    + "\nreturn { readPlanInk, inkTileGrid, INK_SURVEY_PAD_M };")(
    G.worldPx, G.TILE, IR.pathBoxes, IR.boxAround, SV.pathThroughSurveys, SV.surveyPoints,
    async (bb) => { asked.push(bb); }, (t) => banners.push(t), () => mission);
  const ask = async (pts, opts, m) => {
    asked.length = 0; banners.length = 0; mission = m || { surveys: [] };
    const b = IR.boxAround(pts, 300);
    await page.readPlanInk(b, 300, pts, opts);
    return { b, asked: asked.slice(), banners: banners.slice() };
  };
  // A 300 x 150 m survey's waypoints, tagged: FOUR lines, so it ends back on its start side - its first and last
  // waypoints do not span it, and a path that kept its inside would read a different box (check 7).
  const survey = (id, e0, n0) => {
    const out = [];
    for (let k = 0; k < 4; k++) out.push({ ...at(e0 + (k % 2 ? 300 : 0), n0 + k * 50), sv: id },
                                         { ...at(e0 + (k % 2 ? 0 : 300), n0 + k * 50), sv: id });
    return out;
  };
  const boat = at(-200, -200);

  // 5. A commanded motion reads the one box, whatever its size.
  const far = await ask([boat, at(9000, 7000)], undefined);
  check("5. a Go-To, an RTH or a transit (no plan) reads the ONE box it always did - even one too big to read, whose "
        + "refusal stays prompt",
        () => far.asked.length === 1 && far.asked[0] === far.b && page.inkTileGrid(far.b).refused,
        () => far.asked.length + " request(s); the box " + (page.inkTileGrid(far.b).refused ? "is" : "is not")
              + " past the budget");

  // 6. An Upload whose box can be read: the box, then each survey's own water.
  const s1 = survey("S1", 0, 0), s2 = survey("S2", 700, 400);
  const plan6 = { surveys: [{ id: "S1", no: 1 }, { id: "S2", no: 2 }] };
  const up6 = await ask([boat, ...s1, ...s2, at(1200, 900)], { plan: true }, plan6);
  const box6 = (pts) => IR.boxAround(pts, page.INK_SURVEY_PAD_M);
  const sameBox = (x, y) => ["W", "S", "E", "N"].every((k) => Math.abs(x[k] - y[k]) < 1e-12);
  check("6. an Upload whose box CAN be read reads it, then EACH SURVEY'S OWN WATER - its own waypoints, padded - and "
        + "nothing for the free waypoint, which the box already holds",
        () => !page.inkTileGrid(up6.b).refused && up6.asked.length === 3 && up6.asked[0] === up6.b
              && sameBox(up6.asked[1], box6(s1)) && sameBox(up6.asked[2], box6(s2)) && !up6.banners.length,
        () => up6.asked.length + " request(s)");

  // 7. An Upload too big for one box: the transits leg by leg, then each survey.
  const s3 = survey("S3", 6000, 4000);
  const plan7 = { surveys: [{ id: "S1", no: 1 }, { id: "S3", no: 3 }] };
  const pts7 = [boat, ...s1, ...s3];
  const up7 = await ask(pts7, { plan: true }, plan7);
  const legs = up7.asked.slice(0, up7.asked.length - 2);
  const path = SV.pathThroughSurveys(boat, pts7.slice(1));
  const along = [];
  for (let i = 1; i < path.length; i++)
    for (let t = 0; t <= 20; t++) along.push({ lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t / 20,
                                               lon: path[i - 1].lon + (path[i].lon - path[i - 1].lon) * t / 20 });
  // ... and EXACTLY the boxes of that cut path: a survey's inside is its own read, never a transit's.
  const want7 = IR.pathBoxes(path, 300, (b) => !page.inkTileGrid(b).refused).boxes;
  check("7. an Upload TOO BIG for one box never asks for it: it reads the transits leg by leg - boat, each survey's first "
        + "and last waypoint - in boxes that can each be read and between them hold the whole path, then each survey",
        () => page.inkTileGrid(up7.b).refused && !up7.asked.includes(up7.b) && legs.length >= 2
              && legs.length === want7.length && legs.every((b, i) => sameBox(b, want7[i]))
              && legs.every((b) => !page.inkTileGrid(b).refused) && along.every((p) => legs.some((b) => inBox(p, b)))
              && sameBox(up7.asked[up7.asked.length - 2], box6(s1)) && sameBox(up7.asked[up7.asked.length - 1], box6(s3))
              && !up7.banners.length,
        () => up7.asked.length + " request(s): " + legs.length + " along the transits, then 2 surveys");

  // 8. ... and a path that runs past the most it will read says so.
  const pts8 = [boat, ...s1];
  for (let k = 1; k <= 40; k++) pts8.push(at(k * 9000 * (k % 2 ? 1 : -1) / 2, k * 4000));   // a long, wandering path
  const up8 = await ask(pts8, { plan: true }, { surveys: [{ id: "S1", no: 1 }] });
  check("8. a plan whose transits run past the most an Upload reads SAYS SO - how many stretches were read and how many "
        + "are left to the ENC alone",
        () => up8.banners.some((t) => /CHART IMAGE NOT COMPARED over the whole route/.test(t) && /the last \d+ are checked/.test(t)),
        () => (up8.banners[0] || "no banner").slice(0, 140));

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
