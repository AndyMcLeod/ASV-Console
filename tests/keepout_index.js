// tests/keepout_index.js - the row-band index for big rings answers EXACTLY as the plain edge walk
// (2026-09-26), and only the big rings get one. AND THE GRID OVER EVERY FEATURE LIST (2026-10-13, Andy: "build the
// spatial index for the floor model") answers exactly as the walk of every feature: checks 8-14, on a chart of thousands
// of features and on his own charts about Oak Rock and the Dog Bar, at buffers and caps either side of GRID_PAD_M, as wide
// as GRID_WIDE_CELLS and past it; which lists are filed, a list that grows, and the first offender named in the list's order.
//
// Andy: "The current instance of ASV Console has frozen. This has happened the last few times."
// MEASURED on his New Castle chart at the boat's recorded position in the frozen session: the land
// and shallow-water rings there run to 5,000-9,000 vertices, their bounding boxes cover the whole
// harbor, and every point test walked every edge of every one of them - 0.3 ms a point, 4.6 s for
// one deviation search, and the guard ran that search on every frame. keepouts.js now indexes a
// ring of RING_INDEX_MIN_VERTS or more vertices by horizontal band on first use, so a point test
// touches only the edges near it. A faster wrong answer here is a route through a pier, so this
// suite is the proof of IDENTITY: the module's blocked / clearanceM / blockedInfo against a plain
// re-walk of the same primitives (core pinp and dSeg, exported), over thousands of points, several
// buffers, big rings, big polylines and the small features that must stay on the plain walk.
//
//   node tests/keepout_index.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ASV_KEEPOUTS names a sidecar copy of the module for a mutation run (it must sit in static/js so
// its own imports resolve).

// --- crash guard: a throw outside a check() must still REPORT ------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const path = require("path");
const MOD = process.env.ASV_KEEPOUTS || path.join(__dirname, "..", "static", "js", "keepouts.js");
const K = require(MOD);
const { pinp, dSeg, bbOf } = require("../static/js/core_geometry.js");

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

// ---- a deterministic world ------------------------------------------------------------------
let seed = 20260926;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;

// A big, concave, noisy ring: a radius-300 m coast with bays and headlands, 4,000 vertices.
function coast(cx, cn, nVerts, r0) {
  const ring = [];
  for (let i = 0; i < nVerts; i++) {
    const a = (i / nVerts) * 2 * Math.PI;
    const r = r0 * (1 + 0.25 * Math.sin(7 * a) + 0.12 * Math.sin(23 * a) + 0.03 * (rnd() - 0.5));
    ring.push({ e: cx + r * Math.cos(a), n: cn + r * Math.sin(a) });
  }
  ring.push({ ...ring[0] });                    // GeoJSON-style: the first point repeated
  return ring;
}
// A big polyline: a wandering shoreline of 2,000 points running east.
function shore(e0, n0, nPts) {
  const pts = [];
  let n = n0;
  for (let i = 0; i < nPts; i++) { n += (rnd() - 0.5) * 4; pts.push({ e: e0 + i * 0.5, n }); }
  return pts;
}
const BIG = coast(0, 0, 4000, 300);
const BIG2 = coast(900, 400, 3000, 200);
const SMALL = [{ e: 500, n: -500 }, { e: 540, n: -500 }, { e: 540, n: -460 }, { e: 500, n: -460 }];
const SHORE = shore(-600, -700, 2000);
const SHORT = [{ e: 700, n: 700 }, { e: 760, n: 720 }, { e: 800, n: 700 }];
const polys = [
  { ring: BIG, bb: bbOf(BIG), kind: "land" },
  { ring: BIG2, bb: bbOf(BIG2), kind: "water shallower than 3.0 m" },
  { ring: SMALL, bb: bbOf(SMALL), kind: "a dock / pier" },
];
const lines = [
  { pts: SHORE, bb: bbOf(SHORE), kind: "a shoreline" },
  { pts: SHORT, bb: bbOf(SHORT), kind: "a dock / pier" },
];
const points = [{ e: -700, n: 600, r: 20, kind: "a wreck" }];
const KO = { polys, lines, points, marks: [], sys: [], chans: [] };

// ---- THE REFERENCE: the plain walk, from the exported primitives ------------------------------
const inBB = (p, bb, buf) => p.e >= bb.x0 - buf && p.e <= bb.x1 + buf && p.n >= bb.y0 - buf && p.n <= bb.y1 + buf;
function refBlocked(p, ko, buf) {
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (pinp(p, poly.ring)) return true;
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) if (dSeg(p, rg[j], rg[i]) < buf) return true;
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, buf)) continue;
    for (let i = 1; i < ln.pts.length; i++) if (dSeg(p, ln.pts[i - 1], ln.pts[i]) < buf) return true;
  }
  for (const pt of ko.points) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) return true;
  }
  return false;
}
function refClearance(p, ko, cap) {
  let best = cap;
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, best)) continue;
    if (pinp(p, poly.ring)) return 0;
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) { const d = dSeg(p, rg[j], rg[i]); if (d < best) best = d; }
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, best)) continue;
    for (let i = 1; i < ln.pts.length; i++) { const d = dSeg(p, ln.pts[i - 1], ln.pts[i]); if (d < best) best = d; }
  }
  for (const pt of ko.points) {
    const r = pt.r || 0;
    if (Math.abs(p.e - pt.e) > best + r || Math.abs(p.n - pt.n) > best + r) continue;
    const d = Math.max(0, Math.hypot(p.e - pt.e, p.n - pt.n) - r);
    if (d < best) best = d;
  }
  return best;
}
function refInfoKind(p, ko, buf) {
  for (const poly of ko.polys) {
    if (!inBB(p, poly.bb, buf)) continue;
    if (pinp(p, poly.ring)) return poly.kind;
    const rg = poly.ring;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) if (dSeg(p, rg[j], rg[i]) < buf) return poly.kind;
  }
  for (const ln of ko.lines) {
    if (!inBB(p, ln.bb, buf)) continue;
    for (let i = 1; i < ln.pts.length; i++) if (dSeg(p, ln.pts[i - 1], ln.pts[i]) < buf) return ln.kind;
  }
  for (const pt of ko.points) {
    const R = buf + (pt.r || 0);
    if (Math.abs(p.e - pt.e) > R || Math.abs(p.n - pt.n) > R) continue;
    if (Math.hypot(p.e - pt.e, p.n - pt.n) < R) return pt.kind;
  }
  return null;
}

// ---- the points: everywhere, and DENSE along the edges where the answers flip ----------------
const pts = [];
for (let i = 0; i < 2500; i++) pts.push({ e: rnd() * 2400 - 1200, n: rnd() * 2000 - 1000 });
for (let i = 0; i < 1500; i++) {                              // within a few meters of BIG's edge
  const v = BIG[Math.floor(rnd() * (BIG.length - 1))];
  pts.push({ e: v.e + (rnd() - 0.5) * 12, n: v.n + (rnd() - 0.5) * 12 });
}
for (let i = 0; i < 600; i++) {                               // and of the shoreline's
  const v = SHORE[Math.floor(rnd() * SHORE.length)];
  pts.push({ e: v.e + (rnd() - 0.5) * 10, n: v.n + (rnd() - 0.5) * 10 });
}
for (let i = 0; i < 300; i++) {                               // and exactly on a band boundary of BIG, where a rounding slip would show
  const v = BIG[Math.floor(rnd() * (BIG.length - 1))];
  pts.push({ e: v.e + (rnd() - 0.5) * 6, n: v.n });
}
const BUFS = [0, 0.5, 3, 5, 12];

console.log("The keep-out index answers exactly as the plain walk:");

// ── 1. IDENTITY ────────────────────────────────────────────────────────────────────────────
{
  let bad = [], n = 0, blockedN = 0;
  for (const p of pts) for (const buf of BUFS) {
    n++;
    const a = K.blocked(p, KO, buf), b = refBlocked(p, KO, buf);
    if (a) blockedN++;
    if (a !== b) bad.push({ p, buf, got: a, want: b });
  }
  check("1. blocked(): the same yes/no as the plain walk at every point and buffer (" + n + " asks, " + blockedN + " blocked)",
        () => bad.length === 0, () => bad.length + " disagreement(s): " + JSON.stringify(bad.slice(0, 3)));
}
{
  let bad = [], worst = 0;
  for (const p of pts) for (const cap of [500, 40, 3]) {
    const a = K.clearanceM(p, KO, cap), b = refClearance(p, KO, cap);
    const d = Math.abs(a - b); if (d > worst) worst = d;
    if (d > 1e-9) bad.push({ p, cap, got: a, want: b });
  }
  check("2. clearanceM(): the same distance to the nearest edge, to a nanometer, at every point and cap",
        () => bad.length === 0, () => "worst difference " + worst + " m; " + bad.length + " disagreement(s): " + JSON.stringify(bad.slice(0, 3)));
}
{
  let bad = [];
  for (const p of pts) for (const buf of BUFS) {
    const a = K.blockedInfo(p, KO, buf), b = refInfoKind(p, KO, buf);
    if ((a ? a.kind : null) !== b) bad.push({ p, buf, got: a && a.kind, want: b });
  }
  check("3. blockedInfo(): names the same feature (or none) at every point and buffer",
        () => bad.length === 0, () => bad.length + " disagreement(s): " + JSON.stringify(bad.slice(0, 3)));
}

// ── 2. WHO IS INDEXED ──────────────────────────────────────────────────────────────────────
// (two indexes since 2026-11-24: the band index the crossing test reads - a ring's - and the grid of edges the nearest-
//  edge search reads - a ring's and a line's; a big feature carries the ones it was asked through, a small one neither)
const idxd = (x) => K.ringIndexed(x) || K.ringGridded(x);
check("4. after those asks the big rings and the long shoreline carry an index, and the small features never do",
      () => K.ringIndexed(BIG) && K.ringGridded(BIG) && K.ringIndexed(BIG2) && K.ringGridded(BIG2) && K.ringGridded(SHORE)
            && !idxd(SMALL) && !idxd(SHORT)
            && BIG.length >= K.RING_INDEX_MIN_VERTS && SMALL.length < K.RING_INDEX_MIN_VERTS,
      () => "BIG " + K.ringIndexed(BIG) + "/" + K.ringGridded(BIG) + ", BIG2 " + K.ringIndexed(BIG2) + "/" + K.ringGridded(BIG2)
          + ", SHORE " + K.ringGridded(SHORE) + ", SMALL " + idxd(SMALL) + ", SHORT " + idxd(SHORT) + " (threshold " + K.RING_INDEX_MIN_VERTS + " vertices)");

// ── 3. THE EDGE CASES A BAND INDEX CAN GET WRONG ───────────────────────────────────────────
{
  // points outside the ring's northing span but inside its bbox-with-buffer, above and below
  const bb = bbOf(BIG);
  const probes = [{ e: 0, n: bb.y1 + 1 }, { e: 0, n: bb.y0 - 1 }, { e: 0, n: bb.y1 + 0.001 }, { e: 0, n: bb.y0 - 0.001 },
                  { e: bb.x1 + 1, n: 0 }, { e: bb.x0 - 1, n: 0 }, { e: 0, n: bb.y1 }, { e: 0, n: bb.y0 }];
  let bad = [];
  for (const p of probes) for (const buf of [0, 3, 12]) {
    if (K.blocked(p, KO, buf) !== refBlocked(p, KO, buf) || Math.abs(K.clearanceM(p, KO, 200) - refClearance(p, KO, 200)) > 1e-9)
      bad.push({ p, buf });
  }
  check("5. a point just outside the ring's northing span (its band would not exist) reads as the plain walk does, inside or out, near or far",
        () => bad.length === 0, () => JSON.stringify(bad));
}
{
  // a ring that is a single horizontal band tall (degenerate height): still indexed, still right
  const flat = []; for (let i = 0; i < 600; i++) flat.push({ e: i, n: 2000 + (i % 2) * 0.001 });
  for (let i = 599; i >= 0; i--) flat.push({ e: i, n: 2000.5 });
  const ko2 = { polys: [{ ring: flat, bb: bbOf(flat), kind: "a sliver" }], lines: [], points: [] };
  let bad = [];
  for (let i = 0; i < 400; i++) {
    const p = { e: rnd() * 700 - 50, n: 2000.25 + (rnd() - 0.5) * 8 };
    for (const buf of [0, 1, 3]) if (K.blocked(p, ko2, buf) !== refBlocked(p, ko2, buf)) bad.push({ p, buf });
  }
  check("6. a 600-vertex sliver half a meter tall - one band - answers as the plain walk",
        () => bad.length === 0 && K.ringIndexed(flat), () => bad.length + " disagreement(s); indexed " + K.ringIndexed(flat));
}
{
  // legClear and firstBlockAlong go through the same primitives: a leg grazing the big ring
  const frame = { toEN: (q) => q, fromEN: (e, n) => ({ e, n }) };
  const a = { e: -400, n: 0 }, b = { e: 400, n: 0 };
  const legRef = (() => { const L = 800, n = Math.max(1, Math.ceil(L / 1.5)); for (let i = 0; i <= n; i++) { const t = i / n; if (refBlocked({ e: a.e + 800 * t, n: 0 }, KO, 3)) return false; } return true; })();
  check("7. legClear reads through the index too: a leg across the big ring is blocked, exactly as the plain walk says",
        () => K.legClear(a, b, frame, KO, 3) === legRef && legRef === false
              && K.firstBlockAlong(a, b, frame, KO, 3).info.kind === "land",
        () => "legClear " + K.legClear(a, b, frame, KO, 3) + " (plain " + legRef + "); first block: " + JSON.stringify(K.firstBlockAlong(a, b, frame, KO, 3).info.kind));
}

// ── 5. THE GRID OVER EVERY FEATURE LIST (2026-10-13) ────────────────────────────────────────
// A chart of thousands of features over 6 km: small rings (islets, docks), short lines, points with and without an
// extent, a few big rings among them - so a cell holds a handful and the big ring sits in hundreds of cells.
const MANY = (() => {
  const ps = [], ls = [], qs = [];
  for (let i = 0; i < 900; i++) {
    const c = { e: rnd() * 6000 - 3000, n: rnd() * 6000 - 3000 }, r = 5 + rnd() * 60, nv = 5 + Math.floor(rnd() * 12);
    const ring = []; for (let k = 0; k < nv; k++) { const a = k / nv * 2 * Math.PI, rr = r * (0.6 + 0.4 * rnd()); ring.push({ e: c.e + rr * Math.cos(a), n: c.n + rr * Math.sin(a) }); }
    ps.push({ ring, bb: bbOf(ring), kind: "ring " + i });
  }
  for (const [cx, cn] of [[-1500, 1200], [1800, -900]]) { const ring = coast(cx, cn, 1500, 450); ps.push({ ring, bb: bbOf(ring), kind: "big ring at " + cx }); }
  for (let i = 0; i < 700; i++) {
    let e = rnd() * 6000 - 3000, n = rnd() * 6000 - 3000; const pts = [{ e, n }];
    for (let k = 0; k < 6; k++) { e += (rnd() - 0.5) * 80; n += (rnd() - 0.5) * 80; pts.push({ e, n }); }
    ls.push({ pts, bb: bbOf(pts), kind: "line " + i });
  }
  for (let i = 0; i < 1500; i++) qs.push({ e: rnd() * 6000 - 3000, n: rnd() * 6000 - 3000, r: rnd() < 0.5 ? 0 : rnd() * 50, kind: "point " + i });
  return { polys: ps, lines: ls, points: qs };
})();
// his own charts, built as the console builds them (tests/fixtures: his tile clipped about Oak Rock and the Dog Bar)
const CH = require(path.join(__dirname, "..", "static", "js", "chart.js"));
const { V, sea } = require(path.join(__dirname, "..", "static", "js", "state.js"));
const { planeFrame } = require(path.join(__dirname, "..", "static", "js", "geodesy.js"));
V.NOGO_MIN_DEPTH_M = 3.15; V.OPER_MIN_DEPTH_M = 4.0; V.NOGO_BUFFER_M = 5; V.AIR_DRAFT_M = 2.85; V.OVERHEAD_CLEARANCE_M = 1.0;
const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
const his = (file, lat, lon) => {
  const fx = JSON.parse(require("fs").readFileSync(path.join(__dirname, "fixtures", file), "utf8"));
  const was = sea.waterOffset; sea.waterOffset = 0.33;
  try { return CH.buildKeepouts(planeFrame({ lat, lon }), ENF, { min: 4.0, max: 0 }, fx.features); } finally { sea.waterOffset = was; }
};
const OAKM = his("enc_oak_rock.json", 42.642, -70.582), DOGM = his("enc_dog_bar.json", 42.582, -70.671);
const extent = (ko) => { const all = [...ko.polys.map((q) => q.bb), ...ko.lines.map((q) => q.bb)]; return { x0: Math.min(...all.map((b) => b.x0)), x1: Math.max(...all.map((b) => b.x1)), y0: Math.min(...all.map((b) => b.y0)), y1: Math.max(...all.map((b) => b.y1)) }; };
const probesIn = (ko, n) => {
  const bb = extent(ko), out = [];
  for (let i = 0; i < n; i++) out.push({ e: bb.x0 - 200 + rnd() * (bb.x1 - bb.x0 + 400), n: bb.y0 - 200 + rnd() * (bb.y1 - bb.y0 + 400) });
  // and near the features' edges, where the answers flip
  for (let i = 0; i < n / 2; i++) { const q = ko.polys[Math.floor(rnd() * ko.polys.length)], v = q.ring[Math.floor(rnd() * q.ring.length)]; out.push({ e: v.e + (rnd() - 0.5) * 30, n: v.n + (rnd() - 0.5) * 30 }); }
  for (let i = 0; i < n / 4; i++) { const q = ko.points[Math.floor(rnd() * ko.points.length)]; if (q) out.push({ e: q.e + (rnd() - 0.5) * 120, n: q.n + (rnd() - 0.5) * 120 }); }
  return out;
};
const GBUFS = [0, 3, 5, 20, 99.9, 100, 100.1, 150, 400, 2000];
const GCAPS = [3, 50, 100, 101, 300, 500, 1000, 5000];
for (const [name, ko, n] of [["8. a chart of 3,100 features over 6 km", MANY, 2400], ["9. his chart about Oak Rock", OAKM, 1600], ["10. his chart about the Dog Bar", DOGM, 1600]]) {
  const P = probesIn(ko, n);
  for (const p of P.slice(0, 80)) K.blocked(p, ko, 5);                    // (asked past GRID_AFTER: the lists are filed)
  let bad = [], asks = 0, hits = 0;
  for (const p of P) {
    for (const buf of GBUFS) {
      asks++;
      const a = K.blocked(p, ko, buf), b = refBlocked(p, ko, buf);
      if (a) hits++;
      if (a !== b) bad.push({ what: "blocked", p, buf, got: a, want: b });
      const ia = K.blockedInfo(p, ko, buf), ib = refInfoKind(p, ko, buf);
      if ((ia ? ia.kind : null) !== ib) bad.push({ what: "blockedInfo", p, buf, got: ia && ia.kind, want: ib });
    }
    for (const cap of GCAPS) {
      const a = K.clearanceM(p, ko, cap), b = refClearance(p, ko, cap);
      if (Math.abs(a - b) > 1e-9) bad.push({ what: "clearanceM", p, cap, got: a, want: b });
    }
  }
  check(name + ": THE GRID ANSWERS AS THE WALK OF EVERY FEATURE - blocked and the feature blockedInfo names at buffers "
        + "either side of GRID_PAD_M, as wide as GRID_WIDE_CELLS and past it, and clearanceM to a nanometer at caps from 3 m to "
        + "5 km (" + P.length + " points, " + asks + " buffer asks, " + hits + " blocked); every list it holds filed",
        () => bad.length === 0 && hits > 500 && K.listGridded(ko.polys) && K.listGridded(ko.lines) && K.listGridded(ko.points)
              && K.GRID_PAD_M === 100 && K.GRID_CELL_M === 250 && K.GRID_WIDE_CELLS === 64,
        () => bad.length + " disagreement(s) " + JSON.stringify(bad.slice(0, 2)) + "; filed " + [K.listGridded(ko.polys), K.listGridded(ko.lines), K.listGridded(ko.points)]
              + " (" + ko.polys.length + " areas, " + ko.lines.length + " lines, " + ko.points.length + " points)");
}
{
  // which lists are filed: one shorter than GRID_MIN never; a long one only once asked GRID_AFTER times
  const short = { polys: MANY.polys.slice(0, K.GRID_MIN - 1), lines: [], points: [] };
  const fresh = { polys: MANY.polys.slice(0, 400), lines: [], points: [] };
  const q = { e: 0, n: 0 };
  for (let i = 0; i < K.GRID_AFTER - 2; i++) K.blocked(q, fresh, 5);
  const before = K.listGridded(fresh.polys);
  K.blocked(q, fresh, 5); K.blocked(q, fresh, 5);
  for (let i = 0; i < 3 * K.GRID_AFTER; i++) K.blocked(q, short, 5);
  check("11. A LIST IS FILED ONLY WHEN IT EARNS IT: a list of fewer than GRID_MIN features never is, however often it is asked; a "
        + "long one is walked for its first GRID_AFTER asks (a short-lived view of the model) and filed then",
        () => !K.listGridded(short.polys) && before === false && K.listGridded(fresh.polys) && K.GRID_MIN === 16 && K.GRID_AFTER === 64,
        () => "short " + K.listGridded(short.polys) + "; long before " + before + ", after " + K.listGridded(fresh.polys));
}
{
  // a list that GROWS after it was filed is filed afresh: the feature added is found
  const grow = { polys: MANY.polys.slice(0, 300), lines: [], points: [] };
  for (let i = 0; i < K.GRID_AFTER + 5; i++) K.blocked({ e: 5000, n: 5000 }, grow, 5);
  const filed = K.listGridded(grow.polys);
  const added = [{ e: 4990, n: 4990 }, { e: 5010, n: 4990 }, { e: 5010, n: 5010 }, { e: 4990, n: 5010 }];
  grow.polys.push({ ring: added, bb: bbOf(added), kind: "added after filing" });
  const inside = { e: 5000, n: 5000 };
  check("12. A LIST THAT GROWS IS FILED AFRESH: a feature pushed onto a list already filed is found at once - inside it blocked, "
        + "named, its clearance 0 - and not lost to the grid filed before it",
        () => filed && K.blocked(inside, grow, 0) && (K.blockedInfo(inside, grow, 0) || {}).kind === "added after filing" && K.clearanceM(inside, grow) === 0,
        () => "filed before " + filed + "; blocked " + K.blocked(inside, grow, 0) + ", named " + JSON.stringify((K.blockedInfo(inside, grow, 0) || {}).kind));
}
{
  // several features block one point: the one named is the FIRST in the list's order, through the grid as on the walk
  const sq = (e0, n0, w, kind) => { const r = [{ e: e0, n: n0 }, { e: e0 + w, n: n0 }, { e: e0 + w, n: n0 + w }, { e: e0, n: n0 + w }]; return { ring: r, bb: bbOf(r), kind }; };
  const stack = { polys: [...MANY.polys.slice(0, 40), sq(4000, -4000, 900, "the big one, first"), sq(4400, -3600, 50, "the small one, second"),
                          ...MANY.polys.slice(40, 80)], lines: [], points: [] };
  for (let i = 0; i < K.GRID_AFTER + 5; i++) K.blocked({ e: 4420, n: -3580 }, stack, 5);
  const named = [0, 5, 60].map((buf) => (K.blockedInfo({ e: 4420, n: -3580 }, stack, buf) || {}).kind);
  check("13. THE FIRST OFFENDER IN THE LIST'S ORDER: where two features block a point, blockedInfo through the grid names the "
        + "one the walk names - the first in the list - at every buffer",
        () => K.listGridded(stack.polys) && named.every((k) => k === "the big one, first"),
        () => JSON.stringify(named));
}
{
  // the planner, end to end, on the grid: the route it ships across his Oak Rock chart is clear by the walk's own answers
  const P = require(path.join(__dirname, "..", "static", "js", "passage.js"));
  const F = planeFrame({ lat: 42.642, lon: -70.582 }), { nogo } = require(path.join(__dirname, "..", "static", "js", "state.js"));
  const box = { W: -70.6, S: 42.628, E: -70.564, N: 42.656 };
  Object.assign(nogo, { ready: true, frame: F, ko: OAKM, buffer: 5, bbox: box, unread: null, ais: null });
  const A = { lat: 42.6520, lon: -70.5855 }, B = { lat: 42.6320, lon: -70.5840 };
  const filed = P.planNogoRoute(A, B, { standoffM: 20 });
  check("14. THE PLANNER ON THE GRID: Go-To bound south across his Oak Rock chart, every leg of it clear of the model by the walk "
        + "(refBlocked at her 5 m buffer, sampled every meter) and the two offshore marks kept - the grid changes no answer the "
        + "route stands on",
        () => !filed.error && filed.route.length > 3 && (() => { const r = [A, ...filed.route].map((q) => F.toEN(q));
          for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i], m = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n)));
            for (let k = 1; k < m; k++) if (refBlocked({ e: a.e + (b.e - a.e) * k / m, n: a.n + (b.n - a.n) * k / m }, OAKM, 5)) return false; } return true; })()
              && filed.how.marks.offshore === 2 && filed.how.marks.offshoreWrong === 0 && K.listGridded(OAKM.polys),
        () => filed.error || (filed.route.length + " waypoints; " + JSON.stringify(filed.how.marks)));
}

// ── 4. THE COST, said rather than asserted (a timing assertion is a flaky check) ───────────
{
  const probe = { e: 250, n: 40 };
  let t0 = Date.now(); for (let i = 0; i < 2000; i++) K.blocked(probe, KO, 3); const tIdx = Date.now() - t0;
  t0 = Date.now(); for (let i = 0; i < 2000; i++) refBlocked(probe, KO, 3); const tRef = Date.now() - t0;
  console.log("  (2000 point tests beside the 4,000-vertex ring: indexed " + tIdx + " ms, plain walk " + tRef + " ms)");
  const ps = probesIn(MANY, 2000);
  t0 = Date.now(); for (const p of ps) K.blocked(p, MANY, 5); const tG = Date.now() - t0;
  t0 = Date.now(); for (const p of ps) refBlocked(p, MANY, 5); const tW = Date.now() - t0;
  console.log("  (" + ps.length + " point tests on the chart of 3,100 features: through the grid " + tG + " ms, the walk " + tW + " ms)");
}

// ── 6. THE GRID OF A BIG RING'S EDGES (2026-11-24, the river Go-To's planning time) ─────────────────────────────────
// A Corps river area is ONE feature, tens of thousands of vertices, running across the bands: a band held kilometers of
// bank and ringDist walked them all; legCrossesEN walked every edge. Both now read a grid of the edges (RING_CELL_M).
// THE PROOF IS IDENTITY again, on a river-like ring and a ring of diagonal edges: one long enough for the long list, and
// five that cross a dozen cells each, filed by points along them.
{
  // a meandering river 20 km long and 76 m wide, one ring of 24,000 vertices, running east-west across the bands
  const RIV = [];
  const mid = (e) => 300 * Math.sin(e / 700) + 40 * Math.sin(e / 97);
  for (let i = 0; i <= 12000; i++) { const e = i * 20000 / 12000; RIV.push({ e, n: mid(e) - 38 + (rnd() - 0.5) * 0.6 }); }
  for (let i = 12000; i >= 0; i--) { const e = i * 20000 / 12000; RIV.push({ e, n: mid(e) + 38 + (rnd() - 0.5) * 0.6 }); }
  // a ring of diagonal edges and a dense wiggle (306 vertices): the first edge across more than RING_LONG_CELLS cells
  // (on the long list), the next five across a dozen each (filed by points along them), and the wiggle back
  const DIAG = [{ e: 2000, n: 1500 }, { e: 8000, n: 6500 }];
  for (let i = 1; i <= 5; i++) DIAG.push({ e: 8000 + 1000 * i, n: 6500 - 800 * i });
  for (let i = 0; i < 300; i++) DIAG.push({ e: 13000 - i * (10000 / 300), n: 2500 - 500 * (i / 300) + 15 * Math.sin(i) });
  // and the same river turned to run north and south, 40 km east: 20 km tall, its inside test's bands at their most,
  // RING_BAND_MAX_M (128 of them were 156 m)
  const RIVNS = RIV.map((q) => ({ e: q.n + 40000, n: q.e }));
  const KR = { polys: [{ ring: RIV, bb: bbOf(RIV), kind: "a river's margin water" }, { ring: DIAG, bb: bbOf(DIAG), kind: "land" },
                       { ring: RIVNS, bb: bbOf(RIVNS), kind: "a river's margin water" }], lines: [], points: [] };
  const P = [];
  for (let i = 0; i < 2500; i++) { const e = rnd() * 20400 - 200; P.push({ e, n: mid(Math.max(0, Math.min(20000, e))) + (rnd() - 0.5) * 220 }); }
  for (let i = 0; i < 1500; i++) { const e = rnd() * 20000; P.push({ e, n: mid(e) + (rnd() < 0.5 ? -38 : 38) + (rnd() - 0.5) * 30 }); }
  for (let i = 0; i < 1000; i++) P.push({ e: 2500 + rnd() * 11000, n: 1500 + rnd() * 5500 });
  for (let i = 0; i < 300; i++) P.push({ e: Math.round(rnd() * 600) * K.RING_CELL_M, n: Math.round(rnd() * 40 - 20) * K.RING_CELL_M });   // on cell corners
  const PNS = P.slice(0, 4000).map((q) => ({ e: q.n + 40000, n: q.e }));                 // beside and in the turned river
  let badB = [], badC = [], nB = 0;
  for (const p of [...P, ...PNS]) {
    for (const buf of [0, 3, 12.8, 23.1, 32, 64]) { const r = refBlocked(p, KR, buf); if (r) nB++; if (K.blocked(p, KR, buf) !== r) badB.push({ p, buf }); }
    for (const cap of [5, 13, 32, 60, 64, 128, 129, 500, 800]) { const a = K.clearanceM(p, KR, cap), b = refClearance(p, KR, cap); if (!Object.is(a, b)) badC.push({ p, cap, a, b }); }
  }
  check("15. ON A RIVER-LIKE RING, THE SAME RIVER RUNNING NORTH AND LONG DIAGONAL EDGES, through the grid: blocked and "
        + "clearanceM answer as the plain walk at every point, buffer and cap, to the last bit (" + (P.length + PNS.length) * 6 + " and " + (P.length + PNS.length) * 9 + " asks, "
        + nB + " blocked) - and the three rings carry a grid",
        () => badB.length === 0 && badC.length === 0 && K.ringGridded(RIV) && K.ringGridded(DIAG) && K.ringGridded(RIVNS)
              && K.ringGridSize(DIAG).long === 1,
        () => badB.length + " blocked / " + badC.length + " clearance disagreement(s): " + JSON.stringify([...badB, ...badC].slice(0, 2))
              + "; DIAG " + JSON.stringify(K.ringGridSize(DIAG)));
  // legCrossesEN against its own plain walk: the same crossing test (segX, copied) on every edge, the same rule
  const segX = (A, B, Pq, Q) => {
    const d1x = B.e - A.e, d1y = B.n - A.n, d2x = Q.e - Pq.e, d2y = Q.n - Pq.n, den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12 || Math.abs(den) <= 1e-12 * (Math.abs(d1x * d2y) + Math.abs(d1y * d2x))) return null;
    const t = ((Pq.e - A.e) * d2y - (Pq.n - A.n) * d2x) / den, u = ((Pq.e - A.e) * d1y - (Pq.n - A.n) * d1x) / den;
    return (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u < 1) ? t : null;
  };
  const refCross = (A, B, ko) => {
    for (const poly of ko.polys) {
      const rg = poly.ring, n = rg.length;
      let cuts = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) if (segX(A, B, rg[j], rg[i]) != null) cuts++;
      if (!cuts) continue;
      if (cuts > (pinp(A, rg) ? 1 : 0) + (pinp(B, rg) ? 1 : 0)) return true;
    }
    return false;
  };
  let badX = [], nX = 0;
  for (let i = 0; i < 2500; i++) {
    const A = P[Math.floor(rnd() * P.length)], ang = rnd() * 2 * Math.PI, L = [5, 40, 300, 3000][i % 4] * (0.5 + rnd());
    const B = { e: A.e + L * Math.cos(ang), n: A.n + L * Math.sin(ang) };
    const r = refCross(A, B, KR); if (r) nX++;
    if (K.legCrossesEN(A, B, KR) !== r) badX.push({ A, B });
  }
  // along the river's own centerline, kilometers at a time: inside the ring the whole way, crossing nothing
  for (let e = 0; e < 19000; e += 950) { const A = { e, n: mid(e) }, B = { e: e + 900, n: mid(e + 900) }; if (K.legCrossesEN(A, B, KR) !== refCross(A, B, KR)) badX.push({ A, B, along: true }); }
  check("16. AND A LEG'S CROSSINGS through the grid: legCrossesEN answers as the same test walked over every edge, over 2,520 "
        + "legs of 2.5 m to 4.5 km across, along and beside the river and the diagonal edges (" + nX + " crossing)",
        () => badX.length === 0 && nX > 200, () => badX.length + " disagreement(s): " + JSON.stringify(badX.slice(0, 2)));
  // (the cost, said and not judged: beside the river's bank)
  const ps = P.slice(2500, 3500);
  let t0 = Date.now(); for (const p of ps) K.blocked(p, KR, 12.8); const tG = Date.now() - t0;
  t0 = Date.now(); for (const p of ps) refBlocked(p, KR, 12.8); const tW = Date.now() - t0;
  console.log("  (" + ps.length + " point tests beside the 24,000-vertex river: through the grid " + tG + " ms, the plain walk " + tW + " ms)");
}

// ── 7. A CORNER OF A CELL, AND A POINT A PLANET AWAY ──────────────────────────────────────────────────────────────────
// Points along a leg are no more than a cell apart, so the leg can pass through a cell's very corner between two of
// them; each point's cell AND the cells round it are read, so that corner's cell is among them. Built here, not left to
// chance: a pier 0.2 m wide hangs 50 m off a square of land, its sides in short edges, each filed in ONE cell, and a
// leg 15.6 m long cuts the corner of the pier's cell (0.7 m of it) between its ends, crossing the pier inside it. The
// square is drawn in meter edges, 12,000 of them, so a leg this short is counted through the grid (RING_LEG_COST).
// And the points along a leg must be no more than a cell apart, not just close: a leg 94 m long at 45 degrees, from the
// water onto the land, crosses both sides of the pier in a cell (40, 0) that is two cells from each end's in one axis
// or the other, so the cells round its two ends alone miss it (two crossings lost: three became one, no more than the
// one its end on the land allows). Points three cells apart answered so; a cell apart, the points between read it.
// And a point past a million cells off (a corrupt position: 32,000 km) walks the edges: there a ring of cells more is
// lost in the rounding, and off the grid's diagonal no ring is ever far enough to stop - a capless clearance must answer,
// not spin.
{
  const g = K.RING_CELL_M, X = 40 * g;
  const SQ = [];
  for (let x = 0; x <= X; x += 10) SQ.push({ e: x, n: 0 });                              // the south side, west to east
  const west = [];                                                                        // the pier's west side, down
  for (let y = 0; y >= -17; y--) west.push(y);
  west.push(-18.1, -18.9);                                                                // one edge across y -18.4, in row 0 alone
  for (let y = -20; y >= -50; y--) west.push(y);
  for (const y of west) SQ.push({ e: X + 0.1, n: y });
  for (const y of [...west].reverse()) SQ.push({ e: X + 0.3, n: y });                     // and up its east side
  for (let x = X + 10; x <= 4000; x += 10) SQ.push({ e: x, n: 0 });
  for (let y = 1; y <= 4000; y += 1) SQ.push({ e: 4000, n: y });
  for (let x = 3999; x >= 0; x -= 1) SQ.push({ e: x, n: 4000 });
  for (let y = 3999; y > 0; y -= 1) SQ.push({ e: 0, n: y });
  const KS = { polys: [{ ring: SQ, bb: bbOf(SQ), kind: "land" }], lines: [], points: [] };
  const A = { e: X - 6, n: -24.5 }, B = { e: X + 5, n: -13.5 };                         // y = x - X - 18.5: the pier at -18.4 and -18.2
  const across = K.legCrossesEN(A, B, KS);
  // (the same leg nudged along itself and across, so the pier is met in the cell's corner at other points of the leg)
  // (the crossing test walked over every edge of the square)
  const refCross17 = (A2, B2) => { let cuts = 0; for (let i = 0, j = SQ.length - 1; i < SQ.length; j = i++) {
      const d1x = B2.e - A2.e, d1y = B2.n - A2.n, d2x = SQ[i].e - SQ[j].e, d2y = SQ[i].n - SQ[j].n, den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12 || Math.abs(den) <= 1e-12 * (Math.abs(d1x * d2y) + Math.abs(d1y * d2x))) continue;
      const t = ((SQ[j].e - A2.e) * d2y - (SQ[j].n - A2.n) * d2x) / den, u = ((SQ[j].e - A2.e) * d1y - (SQ[j].n - A2.n) * d1x) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u < 1) cuts++; }
    return cuts > (pinp(A2, SQ) ? 1 : 0) + (pinp(B2, SQ) ? 1 : 0); };
  let badN = 0, nN = 0;
  for (let s = -3; s <= 3; s += 0.25) for (const c of [-0.2, 0, 0.15]) {
    const A2 = { e: A.e + s, n: A.n + s + c }, B2 = { e: B.e + s, n: B.n + s + c };
    const ref = refCross17(A2, B2);
    if (ref) nN++;
    if (K.legCrossesEN(A2, B2, KS) !== ref) badN++;
  }
  const DA = { e: 1246.72, n: -51.88 }, DB = { e: 1312.96, n: 14.36 };                  // n = e - 1298.6: the pier at -18.5 and -18.3
  const diag17 = K.legCrossesEN(DA, DB, KS), diagRef = refCross17(DA, DB);
  const g17 = K.ringGridSize(SQ), viaGrid17 = !!g17 && (Math.ceil(Math.hypot(66.24, 66.24) / g17.g) + 5) * K.RING_LEG_COST < SQ.length;
  check("17. A LEG THROUGH A CELL'S VERY CORNER, between its ends, crosses the pier there: legCrossesEN through the grid "
        + "says so (the cells round each point read), and the same at 75 nudges of it (" + nN + " crossing); and a leg 94 m "
        + "long at 45 degrees crosses the pier in a cell two from each end's, read because its points are a cell apart",
        () => across === true && badN === 0 && nN > 20 && diag17 === true && diagRef === true && viaGrid17 && g17.g === g,
        () => "across " + across + ", " + badN + " disagreement(s); at 45 degrees " + diag17 + " (the walk " + diagRef + "); grid " + JSON.stringify(g17) + ", " + SQ.length + " vertices, through the grid " + viaGrid17);
  // a point a long way off, the clearance uncapped: through the grid within a million cells, and past them by the plain
  // walk - the same answer, and an answer (off the diagonal too, where the nearest edge is further than the ring's reach)
  const far = [{ e: -3e7, n: 2e7 }, { e: 5000, n: -9e6 }, { e: 1e300, n: 5 }, { e: 2000, n: -1e300 }, { e: 2e6, n: 2e6 },
               { e: 1e300, n: 1e300 }, { e: -3e299, n: 3e299 }, { e: -4e7, n: -4e7 }];
  const t0 = Date.now(), bad = [];
  for (const p of far) {
    const a = K.clearanceM(p, KS, Infinity), b = refClearance(p, KS, Infinity);
    if (!Object.is(a, b)) bad.push({ p, a, b });
  }
  const ms = Date.now() - t0;
  check("18. A POINT A LONG WAY OFF, its clearance uncapped: the same distance as the plain walk at 30,000 km and at 1e300 m, on and off the diagonal, "
        + "in under a second (" + ms + " ms)", () => bad.length === 0 && ms < 1000, () => JSON.stringify(bad.slice(0, 2)));
}

// ── 8. WHAT THE REVIEW OF 2026-11-24 FOUND ─────────────────────────────────────────────────────────────────────────────
// Before the merge, an adversarial review (599,040 fuzzed asks and his five charts held) found where the grid did NOT
// answer as the walk: a vertex that is not a number, or one far off, hung or exhausted the filing; a buffer of a whole
// cell (32 m) lost a tie to rounding; and a crossing test the walk answered from rounding noise. A second review, of
// the final code (4.5 million fuzzed asks), found two more on corrupt rings: two vertices 1.8e308 m apart made the cell
// infinite and the search found nothing (blocked false beside the ring), and a run of vertices 1e7 m off filed its
// edges in thousands of 32 m bands each (281 MB). Each is held here.
{
  const REL = (d1x, d1y, d2x, d2y, den) => Math.abs(den) < 1e-12 || Math.abs(den) <= 1e-12 * (Math.abs(d1x * d2y) + Math.abs(d1y * d2x));
  const segXr = (A, B, Pq, Q) => {
    const d1x = B.e - A.e, d1y = B.n - A.n, d2x = Q.e - Pq.e, d2y = Q.n - Pq.n, den = d1x * d2y - d1y * d2x;
    if (REL(d1x, d1y, d2x, d2y, den)) return null;
    const t = ((Pq.e - A.e) * d2y - (Pq.n - A.n) * d2x) / den, u = ((Pq.e - A.e) * d1y - (Pq.n - A.n) * d1x) / den;
    return (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u < 1) ? t : null;
  };
  const plainCross = (A, B, rg) => {
    let cuts = 0;
    for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) if (segXr(A, B, rg[j], rg[i]) != null) cuts++;
    return cuts > (pinp(A, rg) ? 1 : 0) + (pinp(B, rg) ? 1 : 0);
  };
  const plainDist = (p, rg, closed, cap) => {
    let best = cap;
    if (closed) { for (let i = 0, j = rg.length - 1; i < rg.length; j = i++) { const d = dSeg(p, rg[j], rg[i]); if (d < best) best = d; } }
    else for (let i = 1; i < rg.length; i++) { const d = dSeg(p, rg[i - 1], rg[i]); if (d < best) best = d; }
    return best;
  };

  // 19. A BAD VERTEX in a ring of 300, two 1.8e308 m apart, and every third of 600 far off, asked in a child process
  //     with a time limit and a heap cap, so a hang or an exhausted heap is a FAIL here and not a suite that never ends;
  //     and the heap each case keeps (its ring, its bands and its grid) measured
  const { spawnSync } = require("child_process");
  const GEO = path.join(path.dirname(MOD), "core_geometry.js");
  const childSrc = [
    "const K = require(process.argv[1]), { pinp, dSeg, bbOf } = require(process.argv[2]);",
    "const REL = " + REL.toString() + ";",
    "const segXr = " + segXr.toString() + ";",
    "const plainCross = " + plainCross.toString() + ";",
    "const plainDist = " + plainDist.toString() + ";",
    "const res = [], keep = [];",
    "const one = (q) => [[150, q]], every3 = (nv, d) => { const o = []; for (let i = 0; i < nv; i += 3) o.push([i, { n: d + i }]); return o; };",
    "for (const [name, nv, bads] of [['e Infinity', 300, one({e: Infinity})], ['n Infinity', 300, one({n: Infinity})],",
    "    ['e -Infinity', 300, one({e: -Infinity})], ['e NaN', 300, one({e: NaN})], ['n NaN', 300, one({n: NaN})],",
    "    ['e 1e9', 300, one({e: 1e9})], ['n 1e8', 300, one({n: 1e8})], ['e 2e7', 300, one({e: 2e7})],",
    "    ['e +-9e307', 300, [[40, {e: 9e307}], [220, {e: -9e307}]]], ['n +-9e307', 300, [[40, {n: 9e307}], [220, {n: -9e307}]]],",
    "    ['every 3rd of 600 n 1e7', 600, every3(600, 1e7)]]) {",
    "  global.gc(); const h0 = process.memoryUsage().heapUsed;",
    "  const ring = []; for (let i = 0; i < nv; i++) { const a = i / nv * 2 * Math.PI; ring.push({ e: 200 * Math.cos(a), n: 200 * Math.sin(a) }); }",
    "  for (const [i, bad] of bads) ring[i] = { e: bad.e !== undefined ? bad.e : ring[i].e, n: bad.n !== undefined ? bad.n : ring[i].n };",
    "  const line = ring.map((q) => ({ e: q.e, n: q.n }));",
    "  const ko = { polys: [{ ring, bb: bbOf(ring), kind: 'land' }], lines: [], points: [] };",
    "  const kl = { polys: [], lines: [{ pts: line, bb: bbOf(line), kind: 'a shoreline' }], points: [] };",
    "  const t0 = Date.now(), bad1 = [];",
    "  for (const p of [{ e: 210, n: 3 }, { e: 260, n: 3 }, { e: -150, n: 90 }, { e: 0, n: 0 }, { e: 230, n: -40 }]) {",
    "    const inn = pinp(p, ring);",
    "    for (const buf of [5, 12.8, 64]) if (K.blocked(p, ko, buf) !== (inn || plainDist(p, ring, true, Infinity) < buf)) bad1.push(['blocked', p, buf]);",
    "    for (const cap of [60, 500, Infinity]) {",
    "      if (!Object.is(K.clearanceM(p, ko, cap), inn ? 0 : plainDist(p, ring, true, cap))) bad1.push(['clearance', p, cap]);",
    "      if (!Object.is(K.clearanceM(p, kl, cap), plainDist(p, line, false, cap))) bad1.push(['line', p, cap]);",
    "    }",
    "  }",
    "  for (const [A, B] of [[{ e: 150, n: 0 }, { e: 250, n: 1 }], [{ e: -250, n: 10 }, { e: 250, n: -10 }], [{ e: 0, n: -300 }, { e: 5, n: 300 }]])",
    "    if (K.legCrossesEN(A, B, ko) !== plainCross(A, B, ring)) bad1.push(['leg', A, B]);",
    "  const ms = Date.now() - t0; keep.push(ring, line);",
    "  global.gc(); const mb = (process.memoryUsage().heapUsed - h0) / 1048576;",
    "  res.push({ name, ms, mb: +mb.toFixed(1), bad: bad1.length, ex: bad1[0] || null });",
    "}",
    "console.log(JSON.stringify(res));",
  ].join("\n");
  const r19 = spawnSync(process.execPath, ["--max-old-space-size=256", "--expose-gc", "-e", childSrc, MOD, GEO], { encoding: "utf8", timeout: 60000 });
  let rows19 = null;
  try { rows19 = JSON.parse((r19.stdout || "").trim().split("\n").pop()); } catch (e) { rows19 = null; }
  check("19. A VERTEX NOT A NUMBER (Infinity, NaN) OR FAR OFF (1e9, 1e8, 2e7 m) in a ring of 300, TWO 1.8e308 m APART "
        + "(east and west, north and south), AND EVERY THIRD OF 600 1e7 m OFF: blocked, clearanceM, a line's clearance and "
        + "legCrossesEN answer as the plain walk, each case in under 5 s and keeping under 32 MB, in a child process with a "
        + "60 s limit and a 256 MB heap (before the reviews: hung, exhausted the heap, blocked false beside the ring, 281 MB)",
        () => r19.status === 0 && Array.isArray(rows19) && rows19.length === 11 && rows19.every((x) => x.bad === 0 && x.ms < 5000 && x.mb < 32),
        () => "status " + r19.status + (r19.error ? " " + r19.error.code : "") + "; " + (rows19 ? JSON.stringify(rows19.filter((x) => x.bad || x.ms >= 5000 || x.mb >= 32))
              + "; heap kept " + rows19.map((x) => x.mb).join("/") + " MB" : (r19.stderr || "").slice(0, 300)));

  // 20. A BUFFER OF A WHOLE CELL, rounded apart: the point's cell index rounds down, the edge's up, and the edge two cells
  //     off is 32 m less 3e-13 away (the review's construction: a ring whose west edge starts at x0 = -8000.3)
  const x0 = -8000.3, pe = (8192 + x0) - 5e-13, ae = pe + 32 - 3e-13;
  const TR = [];
  for (let y = 100; y >= -1990; y -= 10) TR.push({ e: ae, n: y });                     // the west wall, down
  for (let x = ae - 10; x > x0 + 5; x -= 10) TR.push({ e: x, n: -1990 });              // west along the strip's top
  TR.push({ e: x0, n: -1990 }, { e: x0, n: -2000 });
  for (let x = x0 + 10; x < 1000; x += 10) TR.push({ e: x, n: -2000 });               // east along its bottom
  for (let y = -2000; y <= 100; y += 10) TR.push({ e: 1000, n: y });                   // up the east side
  for (let x = 990; x > ae + 5; x -= 10) TR.push({ e: x, n: 100 });                    // and back west along the top
  const KT = { polys: [{ ring: TR, bb: bbOf(TR), kind: "land" }], lines: [], points: [] };
  const TL = TR.map((q) => ({ e: q.e, n: q.n }));
  const pt = { e: pe, n: 0 }, wall = plainDist(pt, TR, true, Infinity);
  const gotB = K.blocked(pt, KT, 32), gotC = K.clearanceM(pt, KT, 32), gotI = K.blockedInfo(pt, KT, 32);
  const gotR = K.deepReleased(pt, [{ pts: TL, r: 32, bb: bbOf(TL) }]);
  const g20 = K.ringGridSize(TR);
  check("20. A BUFFER OF A WHOLE CELL, the point and the edge rounded into cells two apart, the edge " + (32 - wall).toExponential(1)
        + " m inside 32 m: blocked, clearanceM, blockedInfo and deepReleased at 32 find it, as the walk does (before the "
        + "review: false / 32 / null / false)",
        () => wall < 32 && g20 && g20.g === K.RING_CELL_M && gotB === true && Object.is(gotC, wall) && gotI && gotI.kind === "land" && gotR === true,
        () => "wall " + wall + ", cell " + (g20 && g20.g) + "; blocked " + gotB + ", clearance " + gotC + ", info " + JSON.stringify(gotI && gotI.kind) + ", released " + gotR);

  // 21. A RING OF 300 VERTICES ACROSS TWO CELLS (a dock drawn finely, 60 m across): there the search stops when its
  //     window has covered the grid - a stop one ring early answered 10 asks of 30,000 wrong (the review's M7)
  let sd = 5; const rs = () => (sd = (sd * 48271) % 2147483647) / 2147483647;
  const ST = [];
  for (let i = 0; i < 300; i++) { const a = i / 300 * 2 * Math.PI, rr = i % 2 ? 30 : 4 + 20 * rs(); ST.push({ e: 30 + rr * Math.cos(a), n: 30 + rr * Math.sin(a) }); }
  const KS2 = { polys: [{ ring: ST, bb: bbOf(ST), kind: "a dock / pier" }], lines: [], points: [] };
  let bad21 = 0, n21 = 0, ex21 = null;
  for (let i = 0; i < 3000; i++) {
    const p = { e: -20 + rs() * 100, n: -20 + rs() * 100 }, inn = pinp(p, ST);
    for (const cap of [5, 30, 100, 500, Infinity]) {
      n21++;
      const a = K.clearanceM(p, KS2, cap), b = inn ? 0 : plainDist(p, ST, true, cap);
      if (!Object.is(a, b)) { bad21++; ex21 = ex21 || { p, cap, a, b }; }
      const bl = K.blocked(p, KS2, Math.min(cap, 1e6)), rb = inn || plainDist(p, ST, true, Infinity) < Math.min(cap, 1e6);
      if (bl !== rb) { bad21++; ex21 = ex21 || { p, cap, blocked: bl, want: rb }; }
    }
  }
  const g21 = K.ringGridSize(ST);
  check("21. A RING OF 300 VERTICES ACROSS TWO CELLS (" + (g21 ? g21.cells : "?") + " cells): clearanceM and blocked answer as "
        + "the walk at " + n21 + " points and caps, to the last bit", () => bad21 === 0 && g21 && g21.cells <= 4,
        () => bad21 + " disagreement(s): " + JSON.stringify(ex21));

  // 22. RINGS WITH LONG EDGES, AND THE GRID'S SIZE. A box 12 km by 10 km whose south side is 600 vertices and whose
  //     other three are one edge each (its cell the mean of its edges), and a strip of land 60 m wide and 12 km long north
  //     of it, its long sides one edge each and its ends 3,000 vertices each: the long sides on the long lists, read by
  //     every search. A leg across the strip crosses BOTH long sides, through the grid (the strip has the vertices for it,
  //     RING_LEG_COST): one crossing lost never changes the answer, two do. And the grid bounded by the ring's edges, not
  //     their length: a smooth coast 600 km across in 2,000 vertices and a jagged ring 200 km across in 300 (before the
  //     review: 93 MB and 80 MB).
  const BX = [], SP = [];
  for (let i = 0; i <= 600; i++) BX.push({ e: i * 20, n: 12 * Math.sin(i / 3) });
  BX.push({ e: 12000, n: 10000 }, { e: 0, n: 10000 });
  SP.push({ e: 0, n: 20000 }, { e: 12000, n: 20000 });                                    // the south side, one edge
  for (let i = 1; i < 3000; i++) SP.push({ e: 12000 + 15 * (i % 2), n: 20000 + 60 * i / 3000 });   // the east end
  SP.push({ e: 12000, n: 20060 }, { e: 0, n: 20060 });                                    // the north side, one edge
  for (let i = 1; i < 3000; i++) SP.push({ e: -15 * (i % 2), n: 20060 - 60 * i / 3000 });         // the west end
  const KB = { polys: [{ ring: BX, bb: bbOf(BX), kind: "land" }, { ring: SP, bb: bbOf(SP), kind: "land" }], lines: [], points: [] };
  let bad22 = 0, ex22 = null, nx22 = 0, nxS22 = 0, Lmax22 = 0;
  for (let i = 0; i < 4000; i++) {
    const side = i % 5, s = rs();
    const p = side === 0 ? { e: s * 12000, n: (rs() - 0.5) * 80 } : side === 1 ? { e: 12000 + (rs() - 0.5) * 80, n: s * 10000 }
            : side === 2 ? { e: s * 12000, n: 10000 + (rs() - 0.5) * 80 } : side === 3 ? { e: (rs() - 0.5) * 80, n: s * 10000 }
            : { e: s * 12000, n: 19950 + rs() * 160 };
    const inn = pinp(p, BX) || pinp(p, SP), dd = (cap) => Math.min(plainDist(p, BX, true, cap), plainDist(p, SP, true, cap));
    const dInf = dd(Infinity);
    for (const buf of [3, 12.8, 32, 100]) if (K.blocked(p, KB, buf) !== (inn || dInf < buf)) { bad22++; ex22 = ex22 || { p, buf }; }
    for (const cap of [13, 60, 500]) if (!Object.is(K.clearanceM(p, KB, cap), inn ? 0 : dd(cap))) { bad22++; ex22 = ex22 || { p, cap }; }
    const B = side === 4 ? { e: p.e + (rs() - 0.5) * 100, n: 19900 + (p.n < 20030 ? 260 : 0) + rs() * 40 }
                         : { e: p.e + (rs() - 0.5) * 300, n: p.n + (rs() - 0.5) * 300 };
    const want = plainCross(p, B, BX) || plainCross(p, B, SP);
    if (want) nx22++;
    if (side === 4 && want && !pinp(p, SP) && !pinp(B, SP)) nxS22++;
    if (side === 4) Lmax22 = Math.max(Lmax22, Math.hypot(B.e - p.e, B.n - p.n));
    if (K.legCrossesEN(p, B, KB) !== want) { bad22++; ex22 = ex22 || { A: p, B }; }
  }
  const gB = K.ringGridSize(BX), gS = K.ringGridSize(SP);
  const viaGrid22 = !!gS && (Math.ceil(Lmax22 / gS.g) + 5) * K.RING_LEG_COST < SP.length;
  const COAST = [], JAG = [];
  for (let i = 0; i < 2000; i++) { const a = i / 2000 * 2 * Math.PI; COAST.push({ e: 3e5 * Math.cos(a), n: 3e5 * Math.sin(a) }); }
  for (let i = 0; i < 300; i++) { const a = i / 300 * 2 * Math.PI, rr = 1e4 + 9e4 * rs(); JAG.push({ e: rr * Math.cos(a), n: rr * Math.sin(a) }); }
  const tB = Date.now();
  // (a point outside each ring and inside its box, so the edge test - and its grid - is asked)
  const bC = bbOf(COAST), bJ = bbOf(JAG);
  K.clearanceM({ e: 0.95 * bC.x1, n: 0.95 * bC.y1 }, { polys: [{ ring: COAST, bb: bC, kind: "land" }], lines: [], points: [] }, 60);
  K.clearanceM({ e: 0.99 * bJ.x1, n: 0.99 * bJ.y1 }, { polys: [{ ring: JAG, bb: bJ, kind: "land" }], lines: [], points: [] }, 60);
  const msB = Date.now() - tB, gC = K.ringGridSize(COAST), gJ = K.ringGridSize(JAG);
  // (the plain walk's own crossing test, the parallel test relative: an edge on the leg's line 209 m past its end is no
  //  crossing - the review's case, A inside, one real way out)
  const CA = { e: -1413.2876002291628, n: -805.7506619048072 }, CB = { e: -1274.8215863502467, n: -914.5516994108494 };
  const CP = { e: -1110.2859900789076, n: -1043.837168671569 }, CQ = { e: -919.7061081351158, n: -1193.5871925394904 };
  const cL = Math.hypot(CB.e - CA.e, CB.n - CA.n), cdx = (CB.e - CA.e) / cL, cdy = (CB.n - CA.n) / cL;
  const CW = (u, v) => ({ e: CA.e + u * cdx - v * cdy, n: CA.n + u * cdy + v * cdx });
  const uP = (CP.e - CA.e) * cdx + (CP.n - CA.n) * cdy, uQ = (CQ.e - CA.e) * cdx + (CQ.n - CA.n) * cdy;
  const CR = [];
  const run = (u0, v0, u1, v1, k) => { for (let i = 0; i < k; i++) CR.push(CW(u0 + (u1 - u0) * i / k, v0 + (v1 - v0) * i / k)); };
  run(-50, 50, 0.5 * cL, 50, 100); run(0.5 * cL, 50, 0.5 * cL, -40, 40); run(0.5 * cL, -40, uP, -40, 40); run(uP, -40, uP, 0, 10);
  CR.push(CP, CQ); run(uQ, 0, uQ, -50, 10); run(uQ, -50, -50, -50, 60); run(-50, -50, -50, 50, 40);
  const KC = { polys: [{ ring: CR, bb: bbOf(CR), kind: "land" }], lines: [], points: [] };
  const colNew = K.legCrossesEN(CA, CB, KC), colPlain = plainCross(CA, CB, CR);
  check("22. LONG EDGES AND THE GRID'S SIZE: a box and a strip whose long sides are on their long lists (" + (gB ? gB.long : "?")
        + " and " + (gS ? gS.long : "?") + "; cells of " + (gB ? gB.g.toFixed(0) : "?") + " and " + (gS ? gS.g.toFixed(0) : "?")
        + " m) answer blocked, clearanceM and legCrossesEN as the walk at 4,000 points ("
        + nx22 + " legs crossing, " + nxS22 + " of them across the strip from water to water, through its grid); a 600 km coast in 2,000 vertices files " + (gC ? gC.filed : "?") + " edges in " + (gC ? gC.cells : "?")
        + " cells of " + (gC ? gC.g.toFixed(0) : "?") + " m and a jagged ring 200 km across " + (gJ ? gJ.filed : "?") + " (" + msB
        + " ms for both); and a collinear edge past the leg's end is no crossing, as the walk's own test now says",
        () => bad22 === 0 && gB && gB.long === 3 && gS && gS.long === 2 && nx22 > 300 && nxS22 > 100 && viaGrid22 && gC && gC.filed <= 12 * COAST.length && gC.cells <= 12 * COAST.length
              && gJ && gJ.filed <= 12 * JAG.length && msB < 2000 && colNew === false && colPlain === false && pinp(CA, CR),
        () => bad22 + " disagreement(s) " + JSON.stringify(ex22) + "; box " + JSON.stringify(gB) + ", strip " + JSON.stringify(gS)
              + " (" + SP.length + " vertices, legs to " + Lmax22.toFixed(0) + " m, through the grid " + viaGrid22 + "), coast " + JSON.stringify(gC)
              + ", jagged " + JSON.stringify(gJ) + ", " + msB + " ms; collinear new " + colNew + " plain " + colPlain);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
