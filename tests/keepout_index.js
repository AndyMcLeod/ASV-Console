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
check("4. after those asks the big rings and the long shoreline carry an index, and the small features never do",
      () => K.ringIndexed(BIG) && K.ringIndexed(BIG2) && K.ringIndexed(SHORE) && !K.ringIndexed(SMALL) && !K.ringIndexed(SHORT)
            && BIG.length >= K.RING_INDEX_MIN_VERTS && SMALL.length < K.RING_INDEX_MIN_VERTS,
      () => "BIG " + K.ringIndexed(BIG) + ", BIG2 " + K.ringIndexed(BIG2) + ", SHORE " + K.ringIndexed(SHORE) + ", SMALL " + K.ringIndexed(SMALL)
          + ", SHORT " + K.ringIndexed(SHORT) + " (threshold " + K.RING_INDEX_MIN_VERTS + " vertices)");

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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
