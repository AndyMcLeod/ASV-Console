// tests/skin_gaps.js - the skin of the earth has no gaps, so a gap in it is an object the console does not hold.
//
// Andy, 2026-10-01, at Pepperrell Cove: "The ENC check routine that catches features not represented in layers
// missed these dock features and ran transits and survey lines across them. review the routine and improve."
//
// The floats off the Kittery Point piers are PONTOONS, which NOAA's vector service does not serve in any band. But
// S-57's Group 1 - depth areas, dredged areas, land, floating docks, hulks, pontoons, unsurveyed areas - tiles the
// chart with no gaps and no overlaps, so every pontoon is cut out of the depth areas round it, and the depth areas
// ARE served. skinGaps (static/js/skin.js) cancels every edge two Group 1 polygons share and reads the floats off
// what is left: a 62 m2 hole in one depth area, a 194 m2 Z-shaped gap between two of them.
//
//   node tests/skin_gaps.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE RULES THIS SUITE ENCODES, one scene each, in meters round a point at Pepperrell Cove:
//   * a HOLE in one depth area is a gap (1), and so is a gap BETWEEN two of them that neither has as a hole - the
//     Z float's own topology (2);
//   * a hole FILLED by any Group 1 polygon the console holds is not: an island, a dredged area, an unsurveyed area,
//     a floating dock (3-3d) - and the filler's winding does not matter, nor the depth area's own (3e, 3f);
//   * a pier drawn OVER a hole does not fill it - piers are not seabed (4);
//   * a hole reaching OUTSIDE the extract box is not judged, because its filler may lie beyond the box, unfetched
//     (5, 5b);
//   * a PARTIAL extract missing a Group 1 layer is refused in words, and a missing non-seabed layer is not (6, 6b);
//   * two gaps touching at a corner are two gaps, not one (7); a sliver is arithmetic, not an object (8);
//   * a gap becomes a `dock` feature with its OWN kind, the keep-out model takes that kind, and it follows the
//     structure toggle (9-9c).
//
// TEETH (each a mutation of static/js/skin.js or keepouts.js, run against this suite):
//   * no edge cancels, every ring left standing                              -> 3-3e fail (2 does not: with the
//     shared edges left in, the turn rule still traces the Z gap out of the raw rings - 2 is the multi-polygon
//     gap's check, 3 is the cancellation's)
//   * Land_Area / Dredged_Area / Unsurveyed_Area / Floating_Dock_area dropped from SKIN_CLASSES -> 3 / 3b / 3c / 3d
//   * the winding normalization removed                                       -> 3e, 3f fail
//   * the inside-the-box test removed                                         -> 5, 5b fail
//   * the partial refusal removed                                             -> 6 fails
//   * the turn rule at a shared vertex replaced by "any edge"                 -> 7 fails
//   * MIN_GAP_M2 zeroed                                                       -> 8 fails
//   * buildKeepouts back to nogoKind alone (no `f.kind`)                      -> 9b fails

process.on("uncaughtException", (e) => {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
});

const S = require("../static/js/skin.js");
const { buildKeepouts } = require("../static/js/keepouts.js");
const { planeFrame } = require("../static/js/geodesy.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); } catch (e) { ok = false; detail = "THREW: " + e.message; }
  let d = detail;
  if (typeof d === "function") { try { d = d(); } catch (e) { d = "(detail threw: " + e.message + ")"; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   [" + d + "]" : ""));
  if (!ok) fails++;
}

// ── A SEABED, IN METERS ROUND PEPPERRELL COVE ──────────────────────────────────────
const LAT0 = 43.0817, LON0 = -70.7032, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const ll = (e, n) => [LON0 + e / KX, LAT0 + n / 111320];
/** A closed ring through the given [e, n] corners, in order. */
const ring = (...pts) => { const r = pts.map(p => ll(p[0], p[1])); r.push(r[0]); return r; };
/** An axis-aligned rectangle, counter-clockwise; `cw` reverses it. */
const rect = (e0, n0, w, h, cw = false) => {
  const r = ring([e0, n0], [e0 + w, n0], [e0 + w, n0 + h], [e0, n0 + h]);
  return cw ? r.slice().reverse() : r;
};
const poly = (cls, ...rings) => ({ role: cls === "Depth_Area" ? "depth_area" : "extra", cls, props: {},
                                   geometry: { type: "Polygon", coordinates: rings } });
const BOX = (() => { const a = ll(-500, -500), b = ll(500, 500); return { W: a[0], S: a[1], E: b[0], N: b[1] }; })();
const gapsOf = (feats, opts) => S.skinGaps(feats, BOX, opts || {});
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const areas = (r) => r.gaps.map(g => g.areaM2.toFixed(1)).join(", ") || "none";

console.log("The seabed's own gaps - the objects the ENC charts and the vector service does not serve:");

// 1. A HOLE IN ONE DEPTH AREA - the small float off the west pier: 12.6 x 9.0 m in his extract; 10 x 6 here.
{
  const hole = rect(-5, -3, 10, 6, true);
  const r = gapsOf([poly("Depth_Area", rect(-200, -200, 400, 400), hole)]);
  const g = r.gaps[0];
  const same = g && g.ring.length === hole.length
    && hole.every(c => g.ring.some(q => near(q[0], c[0], 1e-7) && near(q[1], c[1], 1e-7)));
  check("1. a HOLE in one depth area is a gap: one gap, its area, and the hole's own vertices",
        r.gaps.length === 1 && near(g.areaM2, 60, 0.3) && same && !r.refused,
        () => r.gaps.length + " gap(s): " + areas(r) + " m2; the hole's vertices returned: " + same);
}

// 2. A GAP BETWEEN TWO DEPTH AREAS - the Z float's topology. Neither polygon has a hole; each has a NOTCH in the
// edge they share, and the two notches together enclose 20 x 20 m that no polygon covers.
{
  const west = poly("Depth_Area", ring([-200, -200], [0, -200], [0, -10], [-10, -10], [-10, 10], [0, 10], [0, 200], [-200, 200]));
  const east = poly("Depth_Area", ring([0, -200], [200, -200], [200, 200], [0, 200], [0, 10], [10, 10], [10, -10], [0, -10]));
  const r = gapsOf([west, east]);
  check("2. ⚠ a gap BETWEEN two depth areas is found too - neither has it as a hole; their shared edge cancels "
        + "and the two notches close round it (the Z float)",
        r.gaps.length === 1 && near(r.gaps[0].areaM2, 400, 2) && west.geometry.coordinates.length === 1
        && east.geometry.coordinates.length === 1,
        () => r.gaps.length + " gap(s): " + areas(r) + " m2; " + r.edges + " edges, " + r.cancelled + " cancelled");
}

// 3-3d. A HOLE ANY GROUP 1 POLYGON FILLS IS NOT A GAP.
{
  const seabed = (fillerCls, cwFill = false) => [
    poly("Depth_Area", rect(-200, -200, 400, 400), rect(-5, -3, 10, 6, true)),
    poly(fillerCls, rect(-5, -3, 10, 6, cwFill))];
  for (const [n, cls, what] of [["3", "Land_Area", "an island"], ["3b", "Dredged_Area", "a dredged area"],
                                ["3c", "Unsurveyed_Area", "an unsurveyed area"],
                                ["3d", "Floating_Dock_area", "a floating dock NOAA served"]]) {
    const r = gapsOf(seabed(cls));
    check(n + ". a hole " + what + " fills is NOT a gap - it is seabed the console holds (" + cls + ")",
          r.gaps.length === 0, () => r.gaps.length + " gap(s): " + areas(r));
  }
  // 3e. THE FILLER WOUND THE OTHER WAY: the cancellation pairs edges by DIRECTION, so a ring left as the service
  // sent it would fail to cancel and leave a false gap.
  const r3e = gapsOf(seabed("Land_Area", true));
  check("3e. ... and the filler's winding does not matter: a clockwise island still fills its hole",
        r3e.gaps.length === 0, () => r3e.gaps.length + " gap(s): " + areas(r3e));
  // 3f. THE DEPTH AREA WOUND BACKWARDS (outer clockwise, its hole counter-clockwise): the hole is still a gap.
  const r3f = gapsOf([poly("Depth_Area", rect(-200, -200, 400, 400, true), rect(-5, -3, 10, 6, false))]);
  check("3f. ... nor the depth area's own: wound backwards, its hole is still the one gap",
        r3f.gaps.length === 1 && near(r3f.gaps[0].areaM2, 60, 0.3), () => r3f.gaps.length + " gap(s): " + areas(r3f));
}

// 4. A PIER OVER A HOLE DOES NOT FILL IT. Shoreline constructions are not seabed (S-57 Group 2): a pier on piles
// stands over a depth area, so a hole under one is something else again, and still a keep-out.
{
  const r = gapsOf([poly("Depth_Area", rect(-200, -200, 400, 400), rect(-5, -3, 10, 6, true)),
                    { role: "dock", cls: "Shoreline_Construction_area", props: {},
                      geometry: { type: "Polygon", coordinates: [rect(-5, -3, 10, 6)] } }]);
  check("4. a pier drawn OVER a hole does not fill it - piers are not seabed",
        r.gaps.length === 1, () => r.gaps.length + " gap(s): " + areas(r));
}

// 5-5b. A HOLE REACHING OUTSIDE THE BOX IS NOT JUDGED. A feature is fetched if it touches the box, so an island
// just beyond the edge is absent and its hole in a big depth area looks empty: 156 such holes in his New Castle
// extract, every one crossing its edge.
{
  const r = gapsOf([poly("Depth_Area", rect(-2000, -2000, 4000, 4000), rect(480, -3, 40, 6, true))]);
  check("5. a hole that reaches OUTSIDE the extract box is not judged - its filler may lie beyond it",
        r.gaps.length === 0 && r.crossing === 1, () => r.gaps.length + " gap(s), " + r.crossing + " crossing");
  const r2 = gapsOf([poly("Depth_Area", rect(-2000, -2000, 4000, 4000), rect(800, 800, 40, 40, true))]);
  check("5b. ... nor one wholly outside it",
        r2.gaps.length === 0 && r2.crossing === 1, () => r2.gaps.length + " gap(s), " + r2.crossing + " crossing");
}

// 6-6b. A PARTIAL EXTRACT. The server serves an extract with a failed layer once and names the layer.
{
  const feats = [poly("Depth_Area", rect(-200, -200, 400, 400), rect(-5, -3, 10, 6, true))];
  const r = gapsOf(feats, { partial: ["Depth_Area"] });
  check("6. ⚠ an extract that arrived WITHOUT a seabed layer is refused in words - a missing depth layer would "
        + "read as one gap over the whole area",
        r.gaps.length === 0 && /Depth_Area/.test(r.refused || "") && /NOT checked/.test(r.refused || ""),
        () => "refused: " + r.refused);
  const r2 = gapsOf(feats, { partial: ["Sounding_point"] });
  check("6b. ... but a missing layer that is not seabed does not stop the check",
        !r2.refused && r2.gaps.length === 1, () => "refused: " + r2.refused + "; " + r2.gaps.length + " gap(s)");
}

// 7. TWO GAPS TOUCHING AT A CORNER. At the shared vertex two leftover edges leave; the turn that keeps the
// uncovered side on the right separates them, and any other choice traces both as one figure-eight of twice the
// area. ⚠ IN EVERY ARRANGEMENT, not one: which edge happens to be FIRST at that vertex depends on the order the
// vertices arrived in, and a single layout let "take the first" pass (the mutation sweep found it). Both
// diagonals, each with its holes listed both ways round.
{
  // ⚠ AND EVERY STARTING VERTEX: four arrangements were still not enough - a chain that STARTS at the shared corner
  // never has a choice there, so every ring is run from each of its own vertices in turn (the order the ids are
  // handed out in is what decides where a chain starts).
  const rot = (r, k) => { const o = r.slice(0, -1); const s = o.slice(k).concat(o.slice(0, k)); s.push(s[0]); return s; };
  const outer = rect(-200, -200, 400, 400);
  const SW = ring([-10, -10], [-10, 0], [0, 0], [0, -10]), NE = ring([0, 0], [0, 10], [10, 10], [10, 0]);
  const NW = ring([-10, 0], [-10, 10], [0, 10], [0, 0]), SE = ring([0, 0], [0, -10], [10, -10], [10, 0]);
  const res = [];
  for (const [a, b] of [[SW, NE], [NE, SW], [NW, SE], [SE, NW]])
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
      res.push(gapsOf([poly("Depth_Area", outer, rot(a, i), rot(b, j))]));
  const bad = res.filter(r => !(r.gaps.length === 2 && r.gaps.every(g => near(g.areaM2, 100, 0.5))));
  check("7. two gaps touching at ONE corner are two gaps, each its own ring - in every arrangement and from every "
        + "starting vertex (" + res.length + " ways)",
        res.length === 64 && bad.length === 0,
        () => bad.length + " of " + res.length + " wrong" + (bad.length ? ", e.g. " + bad[0].gaps.length + " gap(s) " + areas(bad[0]) : ""));
  // 7b. A HOLE TOUCHING THE OUTER LIMIT AT ONE VERTEX. Tracing the outer ring, the chain reaches that vertex with
  // the hole's edge beside its own; the wrong turn merges the hole into the outer limit, whose area is positive -
  // and the gap is lost without a word.
  const keyOuter = ring([-200, -200], [0, -200], [200, -200], [200, 200], [-200, 200]);
  const keyHole = ring([0, -200], [-10, -190], [0, -180], [10, -190]);         // clockwise, its tip ON the limit
  const res2 = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++)
    res2.push(gapsOf([poly("Depth_Area", rot(keyOuter, i), rot(keyHole, j))]));
  const bad2 = res2.filter(r => !(r.gaps.length === 1 && near(r.gaps[0].areaM2, 200, 1)));
  check("7b. ... and a hole whose tip touches the depth area's OUTER limit is still its own gap, from every starting "
        + "vertex (" + res2.length + " ways)",
        res2.length === 20 && bad2.length === 0,
        () => bad2.length + " of " + res2.length + " wrong" + (bad2.length ? ", e.g. " + bad2[0].gaps.length + " gap(s)" : ""));
}

// 8. A SLIVER: 0.6 m2 between two polygons is arithmetic, not an object.
{
  const r = gapsOf([poly("Depth_Area", rect(-200, -200, 400, 400), rect(0, 0, 2, 0.3, true))]);
  check("8. a gap under MIN_GAP_M2 is a sliver, counted but not reported",
        r.gaps.length === 0 && r.slivers === 1, () => r.gaps.length + " gap(s), " + r.slivers + " sliver(s)");
}

// 9-9c. A GAP AS A KEEP-OUT.
{
  const r = gapsOf([poly("Depth_Area", rect(-200, -200, 400, 400), rect(-5, -3, 10, 6, true))]);
  const f = S.skinGapFeature(r.gaps[0]);
  check("9. a gap becomes a `dock` feature under its OWN class and kind - nothing mistakes it for one NOAA served",
        f.role === "dock" && f.cls === S.SKIN_GAP_CLASS && f.kind === S.SKIN_KIND && f.derived === "skin_gap"
        && f.geometry.type === "Polygon" && f.geometry.coordinates[0] === r.gaps[0].ring,
        () => JSON.stringify({ role: f.role, cls: f.cls, derived: f.derived }));
  const frame = planeFrame({ lat: LAT0, lon: LON0 });
  const ko = buildKeepouts(frame, [f], { enforce: { land: true } });
  check("9b. the keep-out model takes the feature's own kind, so a refusal names the float for what it is",
        ko.polys.length === 1 && ko.polys[0].kind === S.SKIN_KIND,
        () => ko.polys.length + " poly(s), kind: " + (ko.polys[0] && ko.polys[0].kind));
  const off = buildKeepouts(frame, [f], { enforce: { land: false } });
  check("9c. ... and it follows the structure toggle, because that is what it is",
        off.polys.length === 0, () => off.polys.length + " poly(s) with structures off");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
