// tests/boundary_file.js - SURVEY AREAS FROM A FILE (static/js/boundary_file.js, and the page's use of it).
//
// Andy, 2026-10-16: "For some surveys the boundary box is critical and should have a draw mode or an input mode for
// pre-drawn surveys. Otherwise, allow the unbounded survey pattern 3 point draw functionality"; asked how a pre-drawn
// boundary should come in, he chose importing a file. 2026-11-27: "The boundary area I attempted to import has 5999
// corners. Can this be accommodated with an update ...?" and "a GEOJSON boundary survey file may come in with multiple
// survey areas. Generate a process to define each independently and sequence them for survey". The Survey tab's
// Bounded mode reads EVERY area out of a GeoJSON, KML or CSV file - one goes on the card, several make a list worked
// through into the plan, an area a survey; what it could not use is said, and a file it cannot read is refused in
// words - never turned into an area somewhere else. Here, over files written in the test:
//   1-1d  GEOJSON: a Polygon's outer ring, longitude first; a FeatureCollection's every area, named, holes said; a
//         MultiPolygon; a closed LineString as a ring, an open one refused; projected coordinates refused; not JSON refused;
//   2-2c  KML: each Placemark's Polygon - its name, its outer ring, "lon,lat,alt", its holes said; a namespace prefix; a
//         closed LinearRing / LineString with no Polygon; a KMZ refused with what to do;
//   3-3d  CSV: a header naming lat/lon in either order (and X/Y); none - latitude first, the console's order; a first
//         column past 90 read longitude-first and said; semicolons, tabs, spaces, comments, a byte-order mark; a line
//         that is not two numbers refused with its number;
//   4-4b  THE CORNERS: the closing corner and doubled ones dropped; fewer than 3, more than the cap, or all on one line
//         refused; the area and middle (ringAreaM2, ringMiddle); the kind by name, else by content;
//   6-6b  THE CORNERS ON A STRAIGHT EDGE dropped (within 1 mm), and only those; the cap counts the corners kept;
//   7-7c  A FILE OF MANY AREAS: each named (an id and a name), the unusable said, the list's area and corner budgets;
//   5-5e  THE PAGE: one area onto the card, a file of none refused, the picker in the window pressed, the wiring, the
//         corners' dots thinned;
//   5f-5k THE AREAS FROM A FILE: the list nearest first, Add to plan (the page's own commitPattern) naming, tagging and
//         bringing the next area on with the spacing carried, what is in the plan read from the plan, the card's link,
//         the rows' actions, the list read at startup.
//
//   node tests/boundary_file.js   # exit 0 = pass

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const path = require("path");
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const B = require(path.join(APP, "static", "js", "boundary_file.js"));

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
console.log("A survey area from a file:");

// a 1 km x 600 m box off New Castle, corners counter-clockwise, longitude first as GeoJSON and KML write them
const SW = [-70.70, 43.06], SE = [-70.6877, 43.06], NE = [-70.6877, 43.0654], NW = [-70.70, 43.0654];
const RING = [SW, SE, NE, NW, SW];
const LL = (c) => ({ lat: c[1], lon: c[0] });
const near = (p, c) => Math.abs(p.lat - c[1]) < 1e-9 && Math.abs(p.lon - c[0]) < 1e-9;
const corners = (r) => r && r.pts && r.pts.length === 4 && near(r.pts[0], SW) && near(r.pts[1], SE) && near(r.pts[2], NE) && near(r.pts[3], NW);
const say = (r) => JSON.stringify(r && (r.error ? { error: r.error } : { n: r.pts.length, kind: r.kind, name: r.name, notes: r.notes, p0: r.pts[0] }));

// ── 1. GeoJSON ───────────────────────────────────────────────────────────────────────────────────────────────────────
const poly = { type: "Polygon", coordinates: [RING] };
const g1 = B.parseBoundaryFile("area.geojson", JSON.stringify(poly));
const hole = [[-70.695, 43.062], [-70.693, 43.062], [-70.693, 43.063], [-70.695, 43.062]];
const fc = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { name: "Block A" }, geometry: { type: "Polygon", coordinates: [RING, hole] } },
  { type: "Feature", properties: { name: "Block B" }, geometry: { type: "Polygon", coordinates: [RING.map((c) => [c[0] + 0.02, c[1]])] } }] };
const g1b = B.parseBoundaryFile("blocks.json", JSON.stringify(fc));
const names = (r) => (r.areas || []).map((a) => a.name).join(" / ");
check("1. GEOJSON: a Polygon's outer ring, longitude first, the closing corner dropped - four corners in order; in a "
      + "FeatureCollection EVERY area, in the file's order, each with its name - the first's hole SAID",
      () => corners(g1) && g1.kind === "GeoJSON" && g1.notes.length === 0 && g1.areas.length === 1 && g1.name === ""
            && corners(g1b) && g1b.name === "Block A" && names(g1b) === "Block A / Block B"
            && Math.abs(g1b.areas[1].pts[0].lon - (SW[0] + 0.02)) < 1e-9 && g1b.areas[0].holes === 1 && g1b.areas[1].holes === 0
            && g1b.notes.some((n) => /1 of the areas have holes \(1 in all\), not used/.test(n))
            && !g1b.notes.some((n) => /were not used|first of/.test(n) && !/holes/.test(n)),
      () => say(g1) + " | " + say(g1b) + " | " + names(g1b));
const g1c = B.parseBoundaryFile("multi.geojson", JSON.stringify({ type: "Feature", properties: { area_id: "GOM-7" }, geometry: { type: "MultiPolygon", coordinates: [[RING], [RING.map((c) => [c[0], c[1] + 0.01])]] } }));
const g1d = B.parseBoundaryFile("ring.geojson", JSON.stringify({ type: "LineString", coordinates: RING }));
const g1e = B.parseBoundaryFile("track.geojson", JSON.stringify({ type: "LineString", coordinates: RING.slice(0, 4) }));
check("1b. a MultiPolygon gives ONE AREA A POLYGON, named by its feature (an area_id here) with its part - 'part 1 of 2', "
      + "'part 2 of 2'; a LineString that closes on itself is an area; one that does not is REFUSED - a line is not an area",
      () => corners(g1c) && names(g1c) === "GOM-7 (part 1 of 2) / GOM-7 (part 2 of 2)" && corners(g1d)
            && /holds no area - 1 line\(s\) that do not close on themselves/.test(g1e.error || ""),
      () => say(g1c) + " | " + names(g1c) + " | " + say(g1d) + " | " + say(g1e));
const proj = B.parseBoundaryFile("utm.geojson", JSON.stringify({ type: "Polygon", coordinates: [[[350000, 4770000], [351000, 4770000], [351000, 4771000], [350000, 4770000]]] }));
const bad = B.parseBoundaryFile("broken.geojson", "{ \"type\": \"Polygon\", ");
check("1c. coordinates that are not degrees (a projected file) are REFUSED, saying to export in WGS 84; a file that is not "
      + "JSON is refused as such",
      () => /not in degrees of latitude and longitude - export it in WGS 84/.test(proj.error || "")
            && /its GeoJSON could not be read: it is not valid JSON/.test(bad.error || ""),
      () => say(proj) + " | " + say(bad));

// ── 2. KML ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const kc = (r) => r.map((c) => c[0] + "," + c[1] + ",0").join(" ");
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Job 1016</name>
  <Placemark><name>North block</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
    ${kc(RING)}
  </coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>${kc(hole)}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
  <Placemark><name>South block</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${kc(RING)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
const k2 = B.parseBoundaryFile("job.kml", KML);
check("2. KML: each Placemark's Polygon - its name, its outer ring read 'lon,lat,alt' with the closing corner dropped - "
      + "both Placemarks listed in order, and the hole SAID",
      () => corners(k2) && k2.kind === "KML" && k2.name === "North block" && names(k2) === "North block / South block"
            && k2.notes.some((n) => /1 of the areas have holes/.test(n)),
      () => say(k2) + " | " + names(k2));
const k2b = B.parseBoundaryFile("ns.kml", `<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Placemark><kml:Polygon><kml:outerBoundaryIs><kml:LinearRing><kml:coordinates>${kc(RING)}</kml:coordinates></kml:LinearRing></kml:outerBoundaryIs></kml:Polygon></kml:Placemark></kml:kml>`);
const k2c = B.parseBoundaryFile("ring.kml", `<kml><Placemark><LineString><coordinates>${kc(RING)}</coordinates></LineString></Placemark></kml>`);
const k2d = B.parseBoundaryFile("open.kml", `<kml><Placemark><LineString><coordinates>${kc(RING.slice(0, 3))}</coordinates></LineString></Placemark></kml>`);
const kmz = B.parseBoundaryFile("job.kmz", "PK\u0003\u0004...");
check("2b. a namespace prefix (kml:Polygon) reads the same; a LineString that closes on itself is an area, one that does "
      + "not is refused; a KMZ is refused with what to do",
      () => corners(k2b) && corners(k2c) && /holds no area - 1 line/.test(k2d.error || "")
            && /a KMZ is a zipped KML - unzip it .* and import the \.kml inside/.test(kmz.error || ""),
      () => say(k2b) + " | " + say(k2c) + " | " + say(k2d) + " | " + say(kmz));

// ── 3. CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const rows = (fmt) => RING.slice(0, 4).map(fmt).join("\n");
const c3 = {
  latLon: B.parseBoundaryFile("a.csv", "lat,lon\n" + rows((c) => c[1] + "," + c[0])),
  lonLat: B.parseBoundaryFile("a.csv", "Longitude,Latitude\n" + rows((c) => c[0] + "," + c[1])),
  xy: B.parseBoundaryFile("a.csv", "name;X;Y\n" + rows((c, i) => "c" + i + ";" + c[0] + ";" + c[1])),
  bare: B.parseBoundaryFile("a.txt", rows((c) => c[1] + "\t" + c[0])),
  spaces: B.parseBoundaryFile("a.txt", "# corners of the block\n\n" + rows((c) => c[1] + "   " + c[0])),
  bom: B.parseBoundaryFile("a.csv", "﻿lat,lon\r\n" + RING.slice(0, 4).map((c) => c[1] + "," + c[0]).join("\r\n")),
};
check("3. CSV: a header names the columns in either order (lat/lon, Longitude/Latitude, X/Y with a name column); with "
      + "none, latitude then longitude - tabs or spaces, comments and blank lines skipped, a byte-order mark and CRLF read",
      () => Object.values(c3).every(corners) && Object.values(c3).every((r) => r.kind === "CSV" && r.notes.length === 0),
      () => Object.entries(c3).map(([k, r]) => k + ": " + say(r)).join(" | "));
// a longitude-first file west of 90 W: its first column passes 90, so it can only be longitude
const WEST = [[-122.4, 37.8], [-122.38, 37.8], [-122.38, 37.81], [-122.4, 37.81]];
const c3b = B.parseBoundaryFile("sf.csv", WEST.map((c) => c[0] + "," + c[1]).join("\n"));
const c3c = B.parseBoundaryFile("sf.csv", WEST.map((c) => c[1] + "," + c[0]).join("\n"));
check("3b. no header, a first column past 90 (longitude first, west of 90 W): read longitude-first and SAID; the same "
      + "corners latitude-first are read as they are, nothing said",
      () => c3b.pts && Math.abs(c3b.pts[0].lat - 37.8) < 1e-9 && Math.abs(c3b.pts[0].lon + 122.4) < 1e-9
            && c3b.notes.some((n) => /read as longitude, latitude/.test(n))
            && c3c.pts && Math.abs(c3c.pts[0].lat - 37.8) < 1e-9 && c3c.notes.length === 0,
      () => say(c3b) + " | " + say(c3c));
const c3d = B.parseBoundaryFile("a.csv", "lat,lon\n43.06,-70.70\n43.06,-70.6877\n43 03.9N,-70 41.3W\n43.0654,-70.70");
const c3e = B.parseBoundaryFile("a.csv", "depth,heading\n4,90\n5,180\n6,270");
check("3c. a line that is not two numbers in decimal degrees is REFUSED with its line number; a header naming no latitude "
      + "and longitude is refused",
      () => /line 4 \("43 03\.9N,-70 41\.3W"\) is not two numbers in decimal degrees/.test(c3d.error || "")
            && /names no latitude and longitude columns/.test(c3e.error || ""),
      () => say(c3d) + " | " + say(c3e));

// ── 4. the corners ───────────────────────────────────────────────────────────────────────────────────────────────────
const dup = B.parseBoundaryFile("d.csv", "lat,lon\n43.06,-70.70\n43.06,-70.70\n43.06,-70.6877\n43.0654,-70.6877\n43.0654,-70.70\n43.06,-70.70");
const two = B.parseBoundaryFile("t.csv", "lat,lon\n43.06,-70.70\n43.06,-70.6877\n43.06,-70.70");
const line = B.parseBoundaryFile("l.csv", "lat,lon\n43.06,-70.70\n43.06,-70.69\n43.06,-70.68");
// a saw-toothed ring - every corner ~100 m off its neighbors' edge, so none of them goes as straight
const many = B.parseBoundaryFile("m.csv", "lat,lon\n" + Array.from({ length: B.BOUNDARY_FILE_MAX_PTS + 1 },
  (_, i) => { const a = 2 * Math.PI * i / (B.BOUNDARY_FILE_MAX_PTS + 1), r = i % 2 ? 0.009 : 0.01; return (43.06 + r * Math.sin(a)) + "," + (-70.7 + r * Math.cos(a)); }).join("\n"));
const empty = B.parseBoundaryFile("e.csv", "");
check("4. THE CORNERS: a doubled corner and the closing one dropped (four left); two corners, three on one line, more "
      + "than the cap (" + B.BOUNDARY_FILE_MAX_PTS + "), or an empty file - each REFUSED in words",
      () => corners(dup) && /has 2 corner\(s\) - an area needs at least 3/.test(two.error || "")
            && /encloses nothing - its corners lie on one line/.test(line.error || "")
            && new RegExp("has " + (B.BOUNDARY_FILE_MAX_PTS + 1) + " corners, more than " + B.BOUNDARY_FILE_MAX_PTS).test(many.error || "")
            && /the file is empty/.test(empty.error || ""),
      () => [dup, two, line, many, empty].map(say).join(" | "));
const area = B.ringAreaM2(g1.pts), mid = B.ringMiddle(g1.pts);
const byContent = [B.parseBoundaryFile("export", JSON.stringify(poly)), B.parseBoundaryFile("export", KML), B.parseBoundaryFile("export", "lat,lon\n" + rows((c) => c[1] + "," + c[0]))];
check("4b. the area of the 1 km x 600 m box within 1% (ringAreaM2) and its middle (ringMiddle); a file with no telling "
      + "extension read by what it holds - GeoJSON, KML, CSV",
      () => Math.abs(area - 1000 * 600) / 600000 < 0.01 && Math.abs(mid.lat - 43.0627) < 1e-4 && Math.abs(mid.lon + 70.69385) < 1e-4
            && byContent.map((r) => r.kind).join(",") === "GeoJSON,KML,CSV" && byContent.every(corners),
      () => "area " + Math.round(area) + " m2 (want ~600000), middle " + JSON.stringify(mid) + ", kinds " + byContent.map((r) => r.kind || r.error).join(","));

// ── 6. THE CORNERS ON A STRAIGHT EDGE (2026-11-27, Andy's 5999-corner area) ────────────────────────────────────────────
// A corner within STRAIGHT_TOL_M (1 mm) of the edge its kept neighbors make goes - and only such a corner: every one
// dropped is held to the edge that replaces it, so the outline moves no more than that, either way.
{
  const MPD = 111320, lat0 = 43.06, kx = Math.cos(lat0 * Math.PI / 180) * MPD;
  const at = (e, n) => ({ lat: lat0 + n / MPD, lon: -70.70 + e / kx });           // meters east / north of SW
  const XY = (p) => ({ x: (p.lon + 70.70) * kx, y: (p.lat - lat0) * MPD });
  const dseg = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
  // the farthest any corner of `from` lies from the ring `to`'s edges, in millimeters
  const worstMm = (from, to) => { const T = to.map(XY); let w = 0;
    for (const p of from) { const q = XY(p); let d = Infinity; for (let i = 0, j = T.length - 1; i < T.length; j = i++) d = Math.min(d, dseg(q, T[j], T[i])); w = Math.max(w, d); }
    return w * 1000; };
  // a 1000 x 600 m box with a corner every meter along every edge (3200), as a GIS densifies one
  const box = [];
  for (let e = 0; e < 1000; e++) box.push(at(e, 0));
  for (let n = 0; n < 600; n++) box.push(at(1000, n));
  for (let e = 1000; e > 0; e--) box.push(at(e, 600));
  for (let n = 600; n > 0; n--) box.push(at(0, n));
  const kept = B.dropStraight(box);
  const off = (mm) => { const r = [at(0, 0), at(500, mm / 1000), at(1000, 0), at(1000, 600), at(0, 600)]; return B.dropStraight(r).length; };
  // a quarter of a 1 km circle, a corner every 0.3 m: a curve, not a straight edge - corners go only while they stay within 1 mm
  const arc = [at(0, 0)];
  for (let i = 0; i <= 5236; i++) { const a = (Math.PI / 2) * i / 5236; arc.push(at(1000 * Math.cos(a), 1000 * Math.sin(a))); }
  const arcKept = B.dropStraight(arc);
  // a spike: along the south edge to 600 m, back to 400 m (collinear, but it doubles back), then on to the east corner
  const spike = [at(0, 0), at(600, 0), at(400, 0.0001), at(1000, 0), at(1000, 600), at(0, 600)];
  // a raster's outline: 10 m steps, 50 m flat runs with a corner every meter along each
  const steps = [];
  for (let s = 0; s < 6; s++) { for (let m = 0; m < 50; m++) steps.push(at(s * 50 + m, s * 10)); steps.push(at(s * 50 + 50, s * 10)); }
  steps.push(at(300, 200), at(0, 200));
  const stepKept = B.dropStraight(steps), stepCorners = 2 * 6 + 2;
  // (a run of more than STRAIGHT_RUN_MAX keeps a corner ON its edge every so often: the box's 1000 m edges keep a few)
  const runCap = Math.ceil(box.length / (B.STRAIGHT_RUN_MAX + 1)) + 4;
  const corner4 = [at(0, 0), at(1000, 0), at(1000, 600), at(0, 600)].every((c) => kept.some((p) => Math.abs(p.lat - c.lat) < 1e-12 && Math.abs(p.lon - c.lon) < 1e-12));
  check("6. THE CORNERS ON A STRAIGHT EDGE GO: a box with a corner every meter (3200) keeps its 4 corners, in the file's "
        + "order, and only a few more - each ON its edge (at most " + B.STRAIGHT_RUN_MAX + " go in a row); a corner 0.5 mm "
        + "off an edge goes and one 2 mm off stays; a curve keeps every corner its outline needs - each one dropped within "
        + "1 mm of the edge that replaces it; a corner that doubles back along its edge stays; a raster outline keeps every step",
        () => corner4 && kept.length <= runCap && near(kept[0], [-70.70, lat0]) && worstMm(box, kept) < 1e-6
              && off(0.5) === 4 && off(2) === 5
              && arcKept.length < arc.length / 4 && arcKept.length > 50 && worstMm(arc, arcKept) <= 1.0005
              && B.dropStraight(spike).length === 6 && stepKept.length === stepCorners,
        () => "box " + box.length + " -> " + kept.length + "; 0.5 mm off -> " + off(0.5) + " corners, 2 mm -> " + off(2)
            + "; arc " + arc.length + " -> " + arcKept.length + ", worst " + worstMm(arc, arcKept).toFixed(4) + " mm; spike "
            + B.dropStraight(spike).length + " of 6; steps " + steps.length + " -> " + stepKept.length + " (want " + stepCorners + ")");
  // the cap counts the corners an area KEEPS: 30 000 in the file on four straight edges is a 4-corner area; a saw-tooth
  // past the cap with straight-edge corners added is refused, saying both counts
  const dense = [];
  for (let i = 0; i < 7500; i++) dense.push(at(1000 * i / 7500, 0));
  for (let i = 0; i < 7500; i++) dense.push(at(1000, 600 * i / 7500));
  for (let i = 0; i < 7500; i++) dense.push(at(1000 - 1000 * i / 7500, 600));
  for (let i = 0; i < 7500; i++) dense.push(at(0, 600 - 600 * i / 7500));
  const gDense = B.parseBoundaryFile("dense.geojson", JSON.stringify({ type: "Polygon", coordinates: [dense.map((p) => [p.lon, p.lat])] }));
  const saw = Array.from({ length: B.BOUNDARY_FILE_MAX_PTS + 1 }, (_, i) => { const a = 2 * Math.PI * i / (B.BOUNDARY_FILE_MAX_PTS + 1), r = i % 2 ? 900 : 1000;
    return at(1000 + r * Math.cos(a), 1000 + r * Math.sin(a)); });
  const sawPlus = [];
  saw.forEach((p, i) => { sawPlus.push(p); if (i < 10) { const q = saw[i + 1]; sawPlus.push({ lat: (p.lat + q.lat) / 2, lon: (p.lon + q.lon) / 2 }); } });
  const gSaw = B.parseBoundaryFile("saw.geojson", JSON.stringify({ type: "Polygon", coordinates: [sawPlus.map((p) => [p.lon, p.lat])] }));
  check("6b. THE CAP (" + B.BOUNDARY_FILE_MAX_PTS + ") COUNTS THE CORNERS KEPT: 30 000 corners on a box's four edges is "
        + "an area of a hundred or so, its counts kept (inFile, dropped); an area still past the cap is REFUSED, saying both counts",
        () => gDense.areas && gDense.pts.length <= Math.ceil(30000 / (B.STRAIGHT_RUN_MAX + 1)) + 4 && gDense.inFile === 30000
              && gDense.dropped === 30000 - gDense.pts.length && worstMm(dense, gDense.pts) < 1e-6
              && new RegExp("has " + sawPlus.length + " corners \\(" + saw.length + " once those on its straight edges go\\), more than "
                            + B.BOUNDARY_FILE_MAX_PTS).test(gSaw.error || ""),
        () => say(gDense) + " in " + gDense.inFile + " dropped " + gDense.dropped + " | " + (gSaw.error || say(gSaw)));
}

// ── 7. A FILE OF MANY AREAS (2026-11-27: "a GEOJSON boundary survey file may come in with multiple survey areas") ────
{
  const sq = (de, dn) => [[SW[0] + de, SW[1] + dn], [SE[0] + de, SE[1] + dn], [NE[0] + de, NE[1] + dn], [NW[0] + de, NW[1] + dn], [SW[0] + de, SW[1] + dn]];
  const F = (props, geometry, extra) => Object.assign({ type: "Feature", properties: props, geometry }, extra || {});
  const fc7 = { type: "FeatureCollection", features: [
    F({ name: "Alpha" }, { type: "Polygon", coordinates: [sq(0, 0)] }),
    F({ area_id: "GOM-US-002", jurisdiction: "US" }, { type: "Polygon", coordinates: [sq(0.02, 0)] }),
    F({ depth_m: 40 }, { type: "Polygon", coordinates: [sq(0.04, 0)] }),
    F({}, { type: "MultiPolygon", coordinates: [[sq(0, 0.02)], [sq(0.02, 0.02)]] }),
    F({ name: "Projected" }, { type: "Polygon", coordinates: [[[350000, 4770000], [351000, 4770000], [351000, 4771000], [350000, 4770000]]] }),
    F({}, { type: "Polygon", coordinates: [sq(0.04, 0.02)] }, { id: "blk-9" }),
    F({ name: "x".repeat(300) }, { type: "Polygon", coordinates: [sq(0.06, 0)] }),
    // an id AND a name (his target file: `target_id` on every area, a name on one); an id with an empty name; a name
    // that holds its id already
    F({ target_id: "T01", name: "North Ledge", area_km2: 12.5 }, { type: "Polygon", coordinates: [sq(0.08, 0)] }),
    F({ target_id: "T02", name: "" }, { type: "Polygon", coordinates: [sq(0.10, 0)] }),
    F({ area_id: "B7", name: "B7 north" }, { type: "Polygon", coordinates: [sq(0.12, 0)] }),
  ] };
  const r7 = B.parseBoundaryFile("areas.geojson", JSON.stringify(fc7));
  check("7. A FILE OF MANY AREAS: every area listed in the file's order, each named by its feature - a name, an area_id, "
        + "the feature's own id; an id AND a name 'T01 North Ledge', never the id twice - else 'Area <n>' by its place in the file, a MultiPolygon's polygons each an area of their "
        + "own ('part k of n'), a name cut to " + B.AREA_NAME_MAX + "; an area it cannot use is LEFT OUT and SAID, the rest "
        + "listed",
        () => r7.areas && names(r7) === ["Alpha", "GOM-US-002", "Area 3", "Area 4 (part 1 of 2)", "Area 4 (part 2 of 2)", "blk-9", "x".repeat(B.AREA_NAME_MAX),
                                            "T01 North Ledge", "T02", "B7 north"].join(" / ")
              && r7.areas.every((a) => a.pts.length === 4) && r7.name === "Alpha"
              && r7.notes.some((n) => /^1 area\(s\) in the file could not be used and are not listed: "Projected" \(a corner .* is not in degrees/.test(n)),
        () => names(r7).slice(0, 200) + " | notes " + JSON.stringify(r7.notes));
  const lots = { type: "FeatureCollection", features: Array.from({ length: B.AREA_LIST_MAX + 5 }, (_, i) =>
    F({ name: "B" + (i + 1) }, { type: "Polygon", coordinates: [sq(0.02 * (i % 20), 0.02 * Math.floor(i / 20))] })) };
  const rl = B.parseBoundaryFile("lots.geojson", JSON.stringify(lots));
  const none = B.parseBoundaryFile("none.geojson", JSON.stringify({ type: "FeatureCollection", features: [
    F({}, { type: "Polygon", coordinates: [[[350000, 4770000], [351000, 4770000], [351000, 4771000], [350000, 4770000]]] }),
    F({}, { type: "Polygon", coordinates: [[SW, SE, SW]] })] }));
  check("7b. past " + B.AREA_LIST_MAX + " areas the first " + B.AREA_LIST_MAX + " are listed and the rest SAID; a file whose "
        + "areas are ALL unusable is refused, naming the first and why",
        () => rl.areas && rl.areas.length === B.AREA_LIST_MAX && rl.areas[B.AREA_LIST_MAX - 1].name === "B" + B.AREA_LIST_MAX
              && rl.notes.some((n) => new RegExp("more areas than the " + B.AREA_LIST_MAX + " listed - the 5 after them were not read").test(n))
              && /^none of its 2 areas could be used - the first, "Area 1": a corner .* is not in degrees/.test(none.error || ""),
        () => (rl.areas ? rl.areas.length : rl.error) + " listed; " + JSON.stringify(rl.notes) + " | " + none.error);
  // 7c. THE LIST'S CORNER BUDGET: eight saw-tooth areas of 19 000 corners (none on a straight edge) and a small one after
  // them - seven fit; the eighth would pass the budget, so it and the small one after it are left out and SAID (a list
  // never skips one area to take a smaller one after it)
  const sawRing = (k, n) => Array.from({ length: n + 1 }, (_, j) => { const i = j % n, a = 2 * Math.PI * i / n, r = i % 2 ? 0.9 : 1;
    return [-70.7 + 0.07 * k + 0.0123 * r * Math.sin(a), 43.1 + 0.009 * r * Math.cos(a)]; });
  const big = { type: "FeatureCollection", features: Array.from({ length: 8 }, (_, k) => F({ name: "S" + (k + 1) }, { type: "Polygon", coordinates: [sawRing(k, 19000)] }))
    .concat([F({ name: "small" }, { type: "Polygon", coordinates: [sq(0, 0.1)] })]) };
  const rc = B.parseBoundaryFile("big.geojson", JSON.stringify(big));
  check("7c. past " + B.AREA_LIST_CORNERS_MAX + " corners in all the list STOPS: the area that would pass it and every one "
        + "after it are left out and SAID - seven of 19 000 corners listed, the eighth and the small one after it not",
        () => rc.areas && rc.areas.length === 7 && rc.areas.every((a) => a.pts.length === 19000) && rc.areas[6].name === "S7"
              && rc.notes.some((n) => n === "the file holds more corners than the " + B.AREA_LIST_CORNERS_MAX + " one list keeps - its last 2 area(s) were not read"),
        () => (rc.areas ? rc.areas.map((a) => a.name + ":" + a.pts.length).join(" ") : rc.error) + " | " + JSON.stringify(rc.notes));
}

// ── 5. THE PAGE: the area read onto the card, and the controls window's way to it ──────────────────────────────────────
// The page's own importBoundaryText / boundaryFilePicked / openBoundaryFile lifted out, over the real parser, with the
// card's state and its effects recorded.
const fs = require("fs");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");
function grab(name) {
  const start = H.search(new RegExp("(async )?function " + name + "\\("));
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  let k = H.indexOf("{", H.indexOf(")", start)), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
// ONE area - a file of several is a list (5f on)
const KML1 = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Job 1016</name>
  <Placemark><name>North block</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
    ${kc(RING)}
  </coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>${kc(hole)}</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
const pageWorld = (o) => {
  const w = Object.assign({ boundary: [], closed: false, bounded: false, patClip: ["a punch"], mode: "pan", asv: { lat: 43.07, lon: -70.71 },
    role: "chart", banners: [], logs: [], saves: 0, seeds: 0, views: 0, posted: [], picks: 0, hint: "", cardEnds: 0, lists: [] }, o || {});
  const src = [
    "let boundary = w.boundary, boundaryClosed = w.closed, surveyBounded = w.bounded, boundDrag = null, patClip = w.patClip, mode = w.mode;",
    "const asv = w.asv, UIROLE = w.role, uiBus = {postMessage: (m) => w.posted.push(m)};",
    "const parseBoundaryFile = B.parseBoundaryFile, ringAreaM2 = B.ringAreaM2, ringMiddle = B.ringMiddle, BOUNDARY_FILE_MAX_BYTES = B.BOUNDARY_FILE_MAX_BYTES;",
    "const hintEl = {textContent: ''}, fileEl = {value: 'old', click: () => { w.picks++; }};",
    "const $ = (s) => (s === '#bnd_hint' ? hintEl : s === '#bndFile' ? fileEl : null);",
    "const setMode = (m) => { mode = (mode === m) ? 'pan' : m; };",
    "const seedPatternFromBoundary = () => { w.seeds++; }, updatePatReadout = () => {}, saveMission = () => { w.saves++; };",
    "const viewBoundary = () => { w.views++; }, pathRender = () => {}, render = () => {};",
    "const showBanner = (t) => w.banners.push(t), logClient = (k, d) => w.logs.push([k, d]);",
    "const fmtBrgRange = () => '045° · 2.00 km';",
    "const areaCardEnd = () => { w.cardEnds++; }, importAreaList = (n, t, r) => { w.lists.push(r.areas.length); return true; };",
    grab("openBoundaryFile"), grab("boundaryFilePicked"), grab("importBoundaryText"),
    "return {openBoundaryFile, boundaryFilePicked, importBoundaryText, st: () => ({boundary, boundaryClosed, surveyBounded, patClip, mode, hint: hintEl.textContent, file: fileEl.value})};",
  ].join("\n");
  w.api = new Function("w", "B", src)(w, B);
  return w;
};
{
  const OLD = [{ lat: 43.1, lon: -70.6 }, { lat: 43.1, lon: -70.59 }, { lat: 43.105, lon: -70.59 }];
  const P5 = pageWorld({ boundary: OLD.slice(), closed: true, bounded: false, mode: "bound" });
  const ok = P5.api.importBoundaryText("job.kml", KML1), s5 = P5.api.st(), b5 = P5.banners[0] || "";
  // a densified box: its straight edges' corners dropped, and the banner says how many the file had
  const dense = [];
  for (let i = 0; i < 40; i++) dense.push([SW[0] + (SE[0] - SW[0]) * i / 40, SW[1]]);
  dense.push(SE, NE, NW, SW);
  const P5x = pageWorld();
  P5x.api.importBoundaryText("dense.geojson", JSON.stringify({ type: "Polygon", coordinates: [dense] }));
  const P5m = pageWorld({ boundary: OLD.slice(), closed: true });
  const many = P5m.api.importBoundaryText("job2.kml", KML);
  check("5. IMPORTED: a file of ONE area replaces the card's - closed, BOUNDED, the punch cut to the old one thrown away, an "
        + "area being drawn by hand stopped, a listed area's link to the card ended, the pattern seeded (if none is drawn), "
        + "saved, the chart taken to it - and the banner says the file, its kind and name, the corners (and how many the "
        + "file had, its straight edges' dropped), the area, where it is from her, what it replaced and what was not used; "
        + "a file of SEVERAL is made a list instead (importAreaList), the card untouched here",
        () => ok === true && s5.boundary.length === 4 && near(s5.boundary[0], SW) && s5.boundaryClosed && s5.surveyBounded
              && s5.patClip === null && s5.mode === "pan" && P5.seeds === 1 && P5.saves === 1 && P5.views === 1 && P5.cardEnds === 1
              && /^SURVEY AREA IMPORTED from job\.kml \(KML, "North block"\): 4 corners, 0\.60 km², its middle 045° · 2\.00 km from her; it replaced the area that was here\. NOTE: its 1 hole\(s\) were not used/.test(b5)
              && /Punch Out, then Add to plan\.$/.test(b5)
              && /^SURVEY AREA IMPORTED from dense\.geojson \(GeoJSON\): 4 corners \(43 in the file: the 39 on its straight edges dropped\), 0\.60 km²/.test(P5x.banners[0] || "")
              && P5.logs.some((l) => l[0] === "boundary_import" && l[1].ok && l[1].corners === 4)
              && many === true && P5m.lists.join() === "2" && P5m.api.st().boundary.length === 3 && P5m.saves === 0,
        () => JSON.stringify({ ok, n: s5.boundary.length, s5: [s5.boundaryClosed, s5.surveyBounded, s5.patClip, s5.mode], seeds: P5.seeds, ends: P5.cardEnds, banner: b5, dense: P5x.banners[0], lists: P5m.lists }));
  const P5b = pageWorld({ boundary: OLD.slice(), closed: true, bounded: false });
  const no = P5b.api.importBoundaryText("track.geojson", JSON.stringify({ type: "LineString", coordinates: RING.slice(0, 4) }));
  const s5b = P5b.api.st();
  check("5b. NOT IMPORTED: a file that holds no area changes nothing - the card's area, the switch, the punch, a listed "
        + "area's link; nothing saved - and the banner says why, and that the area is as it was",
        () => no === false && s5b.boundary === P5b.boundary && s5b.boundary.length === 3 && s5b.surveyBounded === false
              && s5b.patClip && s5b.patClip[0] === "a punch" && P5b.saves === 0 && P5b.views === 0 && P5b.cardEnds === 0
              && /^SURVEY AREA NOT IMPORTED from track\.geojson: the GeoJSON holds no area - 1 line\(s\).*\. The survey area is as it was\.$/.test(P5b.banners[0] || ""),
        () => JSON.stringify({ no, banner: P5b.banners[0] }));
}
{
  // 5e. ON PATTERN THE KEPT AREA IS NOT DRAWN (it is not applied - a purple ring there would claim it is); on Bounded it
  // is. ... AND ITS CORNERS' DOTS ARE THINNED (2026-11-27): one at least BOUND_DOT_GAP_PX from the last drawn, on the
  // chart only - always the first and the one being dragged - while the ring itself keeps every corner.
  const GAP = +(H.match(/const BOUND_DOT_GAP_PX = (\d+);/) || [])[1];
  const draw = (bounded, ring, drag, proj) => {
    const ops = [];
    ops.at = [];                                                                       // where each dot was drawn
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push(k); if (k === "arc") ops.at.push(a[0] + "," + a[1]); }),
                                set: (t, k, v) => { t[k] = v; return true; } });
    new Function("ctx", "boundary", "surveyBounded", "toScreen", "boundDrag", "BOUND_DOT_GAP_PX",
      "let boundaryShow = true, mode = 'pan', boundaryClosed = true; const viewSize = () => ({w: 1000, h: 800});"
      + grab("boundaryActive") + grab("drawBoundary") + "drawBoundary(toScreen);")(ctx, ring, bounded, proj, drag, GAP);
    return ops;
  };
  const px = (lat, lon) => ({ x: (lon + 70.71) * 1e4, y: (43.07 - lat) * 1e4 });    // SW at (100, 100), SE at (223, 100)
  const onPattern = draw(false, [LL(SW), LL(SE), LL(NE)], null, px), onBounded = draw(true, [LL(SW), LL(SE), LL(NE)], null, px);
  // a 600 x 400 px box with a corner every pixel (2000), from (100, 100); then the same box half off the chart's right side
  const sqPx = (x0) => { const r = [], P = (x, y) => r.push({ x, y });
    for (let x = 0; x < 600; x++) P(x0 + x, 100); for (let y = 0; y < 400; y++) P(x0 + 600, 100 + y);
    for (let x = 600; x > 0; x--) P(x0 + x, 500); for (let y = 400; y > 0; y--) P(x0, 100 + y); return r; };
  const asLL = (r) => r.map((p) => ({ lat: p.y, lon: p.x })), ident = (lat, lon) => ({ x: lon, y: lat });
  const dots = (ops) => ops.filter((k) => k === "arc").length, lines = (ops) => ops.filter((k) => k === "lineTo").length;
  const full = draw(true, asLL(sqPx(100)), null, ident), half = draw(true, asLL(sqPx(700)), null, ident);
  const dragged = draw(true, asLL(sqPx(100)), 3, ident);
  check("5e. on PATTERN the kept area is not drawn at all; on BOUNDED it is (its ring, filled, its corners); an area of 2000 "
        + "corners a pixel apart draws its ring through EVERY corner and a dot only every " + GAP + " px - fewer still half off "
        + "the chart, and the corner being dragged always",
        () => GAP > 0 && onPattern.length === 0 && onBounded.includes("stroke") && onBounded.includes("fill") && dots(onBounded) === 3
              && lines(full) === 1999 && dots(full) >= 2000 / GAP - 4 && dots(full) <= 2000 / GAP + 4
              && lines(half) === 1999 && dots(half) < dots(full) * 0.75 && dots(half) > dots(full) * 0.3
              && !full.at.includes("103,100") && dragged.at.includes("103,100"),
        () => "pattern: " + onPattern.length + " ops; bounded: " + dots(onBounded) + " dots; 2000 corners: " + lines(full) + " lines, "
            + dots(full) + " dots; half off: " + dots(half) + "; dragging corner 3 (103,100): drawn " + dragged.at.includes("103,100")
            + ", without the drag " + full.at.includes("103,100") + " (gap " + GAP + ")");
}

// ── 5f-5k. THE AREAS FROM A FILE (2026-11-27, Andy: "a GEOJSON boundary survey file may come in with multiple survey
// areas. Generate a process to define each independently and sequence them for survey") ─────────────────────────────
// The page's own list functions - and its own commitPattern - lifted out over the real parser, geodesy and survey
// labels; what they post to the console recorded.
const G = require(path.join(APP, "static", "js", "geodesy.js"));
const SVS = require(path.join(APP, "static", "js", "surveys.js"));
const LIST_FNS = ["boundaryActive", "seedPatternFromBoundary", "clearBoundary", "importBoundaryText", "importAreaList", "areaFileHash",
  "areaCarryOf", "areaFacts", "areaRunOrder", "areaInPlan", "areaOnCard", "areaCardEnd", "areaPatKey", "areaLoadLoses",
  "areaLoadAsked", "areaLoad", "areaAdvance", "areaAct",
  "areaReorderShortest", "areaListClear", "loadAreaList", "areaListOk", "saveAreaList", "saveAreaState", "postAreas",
  "renderAreaList", "commitPattern"];
const listWorld = (o) => {
  const w = Object.assign({ asv: { lat: 43.0627, lon: -70.80 }, role: "main", banners: [], notes: [], logs: [], saves: 0, views: 0,
    resets: 0, posts: [], confirm: true, asks: 0, busy: false, hold: false, held: [], postFail: null,
    get: { status: 200, body: { areas: null } } }, o || {});
  const src = [
    "let boundary = [], boundaryClosed = false, surveyBounded = false, boundDrag = null, patClip = null, mode = 'pan', boundaryShow = true;",
    "let pat = {A: null, B: null, C: null, align: 0}, editingSv = null, punchAllBusy = w.busy, cardSv = null, planKind = '';",
    "let patRepunchT = null, punchInFlight = null, patOnly = null, patPlanBName = '', patFunnel = null, patDefer = null;",
    "const sea = {waterOffset: 0}, mission = {lines: [], waypoints: [], surveys: []};",
    "let areaList = null, areaPick = null, areaListGen = 0, areaLinkHold = 0, _areaListKey = null, areaCardRing = null, areaSeed = null;",
    "const areaFactsMemo = new WeakMap(); let areaPostChain = Promise.resolve(), areaListUnsaved = null;",
    "const asv = w.asv, UIROLE = w.role;",
    "const {distTo, azTo, atDA} = G, {surveyLabel} = SVS;",
    "const parseBoundaryFile = B.parseBoundaryFile, ringAreaM2 = B.ringAreaM2, ringMiddle = B.ringMiddle;",
    "const els = {'#bnd_hint': {textContent: ''}, '#bnd_list': {innerHTML: '', style: {display: 'none'}}, '#sp_align': {value: '0'}, '#sp_add': {disabled: false}};",
    "const $ = (s) => els[s] || null;",
    "const setMode = (m) => { mode = (mode === m) ? 'pan' : m; };",
    "const resetPattern = () => { w.resets++; pat = {A: null, B: null, C: null, align: pat.align}; editingSv = null; patClip = null; };",
    // (the page's updatePatReadout redraws the survey table, which redraws the list - renderSurveyTable)
    "const updatePatReadout = () => renderAreaList(), saveMission = () => { w.saves++; }, viewBoundary = () => { w.views++; }, pathRender = () => {}, render = () => {};",
    "const showBanner = (t) => w.banners.push(t), flashNote = (t) => w.notes.push(t), logClient = (k, d) => w.logs.push([k, d]);",
    "const fmtBrgRange = () => '045° · 2.00 km';",
    "const rocEsc = (s) => String(s == null ? '' : s).replace(/[&<>\"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;'}[c]));",
    "const surveyById = (id) => mission.surveys.find((s) => s.id === id) || null;",
    "const guiConfirm = async () => { w.asks++; return w.confirm; };",
    // a POST is recorded as it is SENT; `hold` keeps its answer back until released (w.held), `postFail` refuses it
    "const fetch = async (u, opt) => { if(opt && opt.method === 'POST'){ const b = JSON.parse(opt.body); w.posts.push(b);",
    "    if(w.hold) await new Promise((res) => w.held.push(res));",
    "    if(w.postFail && w.postFail(b)) return {ok: false, status: 503, json: async () => ({error: 'the disk is full'})};",
    "    return {ok: true, status: 200, json: async () => ({ok: true})}; }",
    "  return {ok: w.get.status === 200, status: w.get.status, json: async () => w.get.body}; };",
    // commitPattern's world: a pattern drawn and punched, refused by nothing; its lines and waypoints one each
    "const planBDrawingCheck = () => false, stopClearingFor = () => {}, flushRepunch = async () => {}, punchRefusal = () => null;",
    "const currentPattern = () => (pat.A && pat.B ? {anchors: {A: pat.A, B: pat.B, C: pat.C, align: pat.align}} : null);",
    "const patternWaypoints = () => ({lines: [{a: 1}], wps: [{lat: pat.A.lat, lon: pat.A.lon}]});",
    "const commitWaitsForStart = () => false, surveySettingsNow = () => ({}), deferredRecord = () => null, patSourceIdx = () => [];",
    "const replaceSurvey = (m, id, nl, nw) => {}, noteSurveyUpdated = () => {}, recalcCommittedForSpeed = () => {};",
    "const surgeWhen = () => '', surveyStartT = () => null;",
    ...LIST_FNS.map(grab),
    "return {" + LIST_FNS.join(", ") + ", flush: () => areaPostChain,",
    "  st: () => ({boundary, boundaryClosed, surveyBounded, pat, areaList, areaPick, editingSv, mission, html: els['#bnd_list'].innerHTML, hint: els['#bnd_hint'].textContent}),",
    "  set: (k, v) => { if(k === 'pat') pat = v; else if(k === 'editingSv') editingSv = v; else if(k === 'surveyBounded') surveyBounded = v;",
    "                   else if(k === 'boundary') boundary = v; else if(k === 'hold') areaLinkHold = v;",
    "                   else if(k === 'closed') boundaryClosed = v; else if(k === 'patClip') patClip = v; else if(k === 'pick') areaPick = v; }};",
  ].join("\n");
  w.api = new Function("w", "B", "G", "SVS", src)(w, B, G, SVS);
  return w;
};
// four areas west to east - in the file's order Alpha (farthest east), Bravo, Charlie, Delta; she is west of them all
const sqR = (de) => RING.map((c) => [c[0] + de, c[1]]);
const FILE4 = JSON.stringify({ type: "FeatureCollection", features: [["Alpha", 0.06], ["Bravo", 0], ["Charlie", 0.02], ["Delta", 0.04]]
  .map(([n, de]) => ({ type: "Feature", properties: { name: n }, geometry: { type: "Polygon", coordinates: [sqR(de)] } })) });
const rowNames = (html) => [...html.matchAll(/class="alname">([^<]*)</g)].map((m) => m[1]);
const rowSt = (html) => [...html.matchAll(/class="alst[^"]*">([^<]*)</g)].map((m) => m[1]);
const sameRing = (a, b) => a.length === b.length && a.every((p, i) => p.lat === b[i].lat && p.lon === b[i].lon);
const commitAll = async (W, n) => { for (let i = 0; i < n; i++) { await W.api.commitPattern(); await W.api.flush(); } };
(async () => {
  // ── 5f. the import ─────
  const W = listWorld();
  const ok = W.api.importBoundaryText("blocks.geojson", FILE4);
  await W.api.flush();
  const s = W.api.st(), L = s.areaList || {}, b = W.banners[0] || "";
  check("5f. A FILE OF SEVERAL AREAS IS A LIST: every area listed in the SHORTEST RUN from her (Bravo, Charlie, Delta, Alpha - not "
        + "the file's order), the first put on the card - closed, BOUNDED, its pattern laid across it - the list sent to the "
        + "console WHOLE before the state that names its card; the banner says how many, where, and what to do",
        () => ok === true && L.order.join() === "A2,A3,A4,A1" && L.card === "A2" && /^blocks\.geojson#[0-9a-f]{8}\.\d+$/.test(L.key)
              && sameRing(s.boundary, L.rows[1].pts) && s.boundaryClosed && s.surveyBounded && s.pat.A && s.pat.B && s.pat.C
              && W.posts.length === 2 && W.posts[0].areas && W.posts[0].areas.rows.length === 4 && W.posts[0].areas.card === null
              && W.posts[1].state && W.posts[1].state.card === "A2" && W.posts[1].state.key === L.key
              && /^SURVEY AREAS IMPORTED from blocks\.geojson \(GeoJSON\): 4 areas, 16 corners, listed under the Area row in the SHORTEST RUN from her\. AREA 1, "Bravo" \(0\.60 km², 045° · 2\.00 km from her\), IS ON THE CARD: /.test(b)
              && rowNames(s.html).join() === "Bravo,Charlie,Delta,Alpha" && /class="alrow card on" id="bnd_lr0" data-area="A2"/.test(s.html)
              && rowSt(s.html).join() === "card,,,",
        () => JSON.stringify({ ok, order: L.order, card: L.card, key: L.key, posts: W.posts.map((p) => Object.keys(p)[0]), banner: b.slice(0, 260), rows: rowNames(s.html), st: rowSt(s.html) }));

  // ── 5g. Add to plan, through the page's own commitPattern ─────
  W.api.set("pat", Object.assign({}, s.pat, { C: G.atDA(s.pat.A, 25, 120) }));      // the operator sets 25 m lines at 030
  await commitAll(W, 1);
  const g1 = W.api.st(), sv1 = g1.mission.surveys[0] || {}, lastPost = W.posts[W.posts.length - 1] || {};
  check("5g. ADD TO PLAN (the page's own commitPattern) adds the area as a survey NAMED after it and TAGGED '<key>/A2'; the "
        + "NEXT area (Charlie) comes onto the card by itself at the SAME line spacing and direction (25 m, 120°) - kept for "
        + "the one after (carry) - and the banner says what was added and what is next; its row reads ✓ S1",
        () => sv1.name === "Bravo" && sv1.area === L.key + "/A2" && g1.areaList.card === "A3" && sameRing(g1.boundary, L.rows[2].pts)
              && Math.abs(G.distTo(g1.pat.A, g1.pat.C) - 25) < 0.01 && Math.abs(G.azTo(g1.pat.A, g1.pat.C) - 120) < 0.01
              && g1.areaList.carry && g1.areaList.carry.sp === 25 && Math.abs(g1.areaList.carry.ang - 120) < 1e-3
              && lastPost.state && lastPost.state.card === "A3" && lastPost.state.carry.sp === 25
              && /^S1 Bravo ADDED TO THE PLAN\. NEXT AREA ON THE CARD: 2 of 4, "Charlie", at the same line spacing and direction - check its pattern, Punch Out, then Add to plan\. 2 more after it to add\.$/.test(W.banners[W.banners.length - 1])
              && rowSt(g1.html).join() === "✓ S1,card,,",
        () => JSON.stringify({ sv1, card: g1.areaList.card, sp: G.distTo(g1.pat.A, g1.pat.C), az: G.azTo(g1.pat.A, g1.pat.C), banner: W.banners[W.banners.length - 1], st: rowSt(g1.html) }));
  await commitAll(W, 3);
  const g4 = W.api.st(), svs = g4.mission.surveys;
  check("5g-b. ... and on through the list: the plan's surveys are the areas IN THE LIST'S ORDER, each named and tagged; "
        + "after the last, nothing of the list is on the card and the banner and the row say every area is in the plan",
        () => svs.map((x) => x.name).join() === "Bravo,Charlie,Delta,Alpha" && svs.map((x) => x.area.split("/")[1]).join() === "A2,A3,A4,A1"
              && g4.areaList.card === null && /EVERY AREA IN THE LIST \(4\) is in the plan/.test(W.banners[W.banners.length - 1])
              && g4.hint === "Every area in the list is in the plan." && rowSt(g4.html).join() === "✓ S1,✓ S2,✓ S3,✓ S4"
              && / · 4 in the plan</.test(g4.html),
        () => JSON.stringify({ names: svs.map((x) => x.name), card: g4.areaList.card, banner: W.banners[W.banners.length - 1], st: rowSt(g4.html) }));

  // ── 5h. what is in the plan is read from the plan; the same file again is the same list ─────
  g4.mission.surveys = g4.mission.surveys.filter((x) => x.name !== "Charlie");
  W.api.renderAreaList();
  const h1 = W.api.st().html;
  W.banners.length = 0;
  W.api.importBoundaryText("blocks.geojson", FILE4);
  await W.api.flush();
  const h2 = W.api.st(), key2 = h2.areaList.key, card2 = h2.areaList.card, order2 = h2.areaList.order.join(), ring2 = sameRing(h2.boundary, L.rows[2].pts);
  const W5 = JSON.parse(FILE4); W5.features.push({ type: "Feature", properties: { name: "Echo" }, geometry: { type: "Polygon", coordinates: [sqR(0.08)] } });
  W.api.importBoundaryText("blocks.geojson", JSON.stringify(W5));
  await W.api.flush();
  const h3 = W.api.st();
  check("5h. WHAT IS IN THE PLAN IS READ FROM THE PLAN: a survey deleted puts its area back in the list's work (its row no "
        + "longer ✓); the SAME file imported again is the same list - its order kept, its areas in the plan known, the first "
        + "NOT in it (Charlie) put on the card, the banner says so; a CHANGED file is another list, the surveys from the "
        + "old one left in the plan",
        () => rowSt(h1).join() === "✓ S1,,✓ S3,✓ S4" && key2 === L.key && card2 === "A3" && order2 === "A2,A3,A4,A1" && ring2
              && /: the list that was here, read again - its order kept; 3 of them are in the plan already\. AREA 2, "Charlie"/.test(W.banners[0] || "")
              && h3.areaList.key !== L.key && h3.areaList.card === "A2" && h3.mission.surveys.length === 3
              && rowSt(h3.html).join() === "card,,,,"
              && /the list that was here \(blocks\.geojson\) is replaced - its surveys stay in the plan/.test(W.banners[1] || ""),
        () => JSON.stringify({ h1: rowSt(h1), card2: h2.areaList.card, b0: (W.banners[0] || "").slice(0, 200), key3: h3.areaList.key !== L.key, st3: rowSt(h3.html) }));

  // ── 5i. the card's link: ended by every other writer of the card's area, held through Punch all ─────
  const I = listWorld();
  I.api.importBoundaryText("blocks.geojson", FILE4); await I.api.flush();
  const iKey = I.api.st().areaList.key;
  // (each step's figures taken as it happens: the list is one object, changed by every step after)
  const snap = () => { const t = I.api.st(); return { card: t.areaList ? t.areaList.card : undefined, key: t.areaList && t.areaList.key,
    corners: t.boundary.length, post: I.posts[I.posts.length - 1] }; };
  I.api.importBoundaryText("job.kml", KML1); await I.api.flush();
  const i1 = snap();
  I.api.areaLoad("A3"); I.api.clearBoundary(); await I.api.flush();
  const i2 = snap();
  I.api.areaLoad("A4"); I.api.set("hold", 1); I.api.clearBoundary(); const i3 = snap(); I.api.set("hold", 0);
  // committed on PATTERN: not the list's area, not tagged, nothing advances
  I.api.areaLoad("A1"); I.api.set("surveyBounded", false); const nSv = I.api.st().mission.surveys.length;
  await I.api.commitPattern(); await I.api.flush();
  const i4 = snap(), i4sv = I.api.st().mission.surveys[nSv] || {};
  // a corner added by hand: no longer the list's area
  I.api.areaLoad("A1"); I.api.st().boundary.push({ lat: 43.0655, lon: -70.6299 });
  await I.api.commitPattern(); await I.api.flush();
  const i5 = snap(), i5sv = I.api.st().mission.surveys[nSv + 1] || {};
  // AN EDIT keeps the tag it had and advances nothing
  I.api.areaLoad("A2"); await I.api.commitPattern(); await I.api.flush();
  const tagged = Object.assign({}, I.api.st().mission.surveys.find((x) => x.area) || {}), cardBefore = snap().card;
  I.api.set("editingSv", tagged.id); I.api.set("pat", { A: { lat: 43.061, lon: -70.69 }, B: { lat: 43.065, lon: -70.688 }, C: null, align: 0 });
  await I.api.commitPattern(); await I.api.flush();
  const i6 = snap(), edited = I.api.st().mission.surveys.find((x) => x.id === tagged.id) || {};
  check("5i. THE CARD'S LINK is only an area this page put there: a one-area Import and Clear END it (the state says so); "
        + "it is HELD through Punch all; an area added on PATTERN or with a corner added by hand is not the list's - not "
        + "named or tagged, nothing advances; an EDIT keeps the tag it had and advances nothing",
        () => i1.card === null && i1.key === iKey && i1.corners === 4 && i1.post.state && i1.post.state.card === null
              && i2.card === null && i2.corners === 0 && i2.post.state && i2.post.state.card === null && i3.card === "A4"
              && i4sv.id && !("area" in i4sv) && i4sv.name === "" && i4.card === "A1"
              && i5sv.id && !("area" in i5sv) && i5sv.name === "" && i5.card === "A1"
              && tagged.area === iKey + "/A2" && cardBefore === "A3"
              && edited.area === iKey + "/A2" && edited.name === "Bravo" && i6.card === "A3",
        () => JSON.stringify({ c1: i1.card, c2: i2.card, c3: i3.card, c4: i4.card, c5: i5.card, i4sv: i4sv.name + "/" + i4sv.area,
                               i5sv: i5sv.name + "/" + i5sv.area, tagged: tagged.area, edited: edited.name + "/" + edited.area, card6: i6.card }));

  // ── 5j. the rows' actions ─────
  const J = listWorld();
  J.api.importBoundaryText("blocks.geojson", FILE4); await J.api.flush();
  const jL = () => J.api.st().areaList;
  J.api.areaAct("dn", "A2"); const o1 = jL().order.join();
  J.api.areaAct("up", "A3"); const o2 = jL().order.join();                                    // the top: nothing
  J.api.areaReorderShortest(); const o3 = jL().order.join();
  J.api.areaAct("x", "A2"); await J.api.flush(); const o4 = jL().order.join(), c4 = jL().card, p4 = J.posts[J.posts.length - 1];
  J.api.areaAct("load", "A4"); const c5 = jL().card;
  J.w = J; J.confirm = false; await J.api.areaListClear(); const kept = !!jL();
  J.confirm = true; await J.api.areaListClear(); await J.api.flush();
  const gone = J.api.st().areaList, pGone = J.posts[J.posts.length - 1];
  check("5j. THE ROWS: ↓ moves an area down the run order, ↑ at the top does nothing, Shortest run puts it back; Remove takes "
        + "an area out (the one on the card: its area stays there, no longer the list's) and the state says so; Load puts "
        + "any area on the card; Clear list ASKS - declined, nothing changes; accepted, the list is gone (posted as none)",
        () => o1 === "A3,A2,A4,A1" && o2 === o1 && o3 === "A2,A3,A4,A1" && o4 === "A3,A4,A1" && c4 === null
              && p4.state && p4.state.order.join() === "A3,A4,A1" && p4.state.card === null
              && c5 === "A4" && kept === true && gone === null && pGone.areas === null && J.api.st().html === "",
        () => JSON.stringify({ o1, o2, o3, o4, c4, c5, kept, gone: gone === null, pGone }));

  // ── 5l. the run's order: nearest first, then every crossing undone ─────
  // six areas (centers km east, km north of her) laid so nearest first CROSSES its own run: A3 A6 A1 A5 A2, then a long
  // leg back past them to A4; the shortest run takes A4 on the way out instead
  const KM = [[6, 2], [2.5, 3], [2.5, -1], [6.5, -0.5], [4.5, 4], [4.5, 0.5]], her = { lat: 43.0627, lon: -70.80 };
  const sqAt = ([e, n]) => { const c = G.atDA(G.atDA(her, e * 1000, 90), n * 1000, 0);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => { const p = G.atDA(G.atDA(c, x * 150, 90), y * 150, 0); return [p.lon, p.lat]; }); };
  const FILE6 = JSON.stringify({ type: "FeatureCollection", features: KM.map((k, i) => ({ type: "Feature", properties: { name: "P" + i },
    geometry: { type: "Polygon", coordinates: [sqAt(k)] } })) });
  const R = listWorld(); R.api.importBoundaryText("six.geojson", FILE6); await R.api.flush();
  const rL = R.api.st().areaList, mid = (id) => B.ringMiddle(rL.rows.find((r) => r.id === id).pts);
  const runLen = (ids) => ids.reduce((t, id, i) => t + G.distTo(i ? mid(ids[i - 1]) : her, mid(id)), 0);
  const nearestFirst = ["A3", "A6", "A1", "A5", "A2", "A4"], run = rL.order, rb = R.banners[0] || "";
  check("5l. THE SHORTEST RUN: where nearest first crosses its own run (six areas: A3 A6 A1 A5 A2, then a long leg back to "
        + "A4) the list's order undoes the crossing - A4 taken on the way out (A3 A6 A4 A1 A5 A2), the run between them "
        + "15% shorter - from the same first area, every area once; the banner names the order",
        () => run.join() === "A3,A6,A4,A1,A5,A2" && runLen(run) < runLen(nearestFirst) * 0.86 && new Set(run).size === 6
              && /listed under the Area row in the SHORTEST RUN from her\. AREA 1, "P2"/.test(rb),
        () => JSON.stringify({ run, km: (runLen(run) / 1000).toFixed(2), nearestKm: (runLen(nearestFirst) / 1000).toFixed(2), banner: rb.slice(0, 160) }));

  // ══ THE REVIEW OF 2026-11-27 (an adversarial review before the merge: five findings, four surviving mutants) ══
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const LIST4 = W.posts[0].areas, ringOf = (id) => LIST4.rows.find((r) => r.id === id).pts.map((p) => ({ lat: p.lat, lon: p.lon }));
  // ── 5m. finding 1: the card's area is the list's only if it IS that area ─────
  const planWith = async (card, ringId) => {
    const M = listWorld({ get: { status: 200, body: { areas: Object.assign({}, LIST4, { order: ["A2", "A3", "A4", "A1"], card, carry: null }) } } });
    M.api.set("boundary", ringOf(ringId)); M.api.set("closed", true); M.api.set("surveyBounded", true); M.api.seedPatternFromBoundary();
    await M.api.loadAreaList(); return M; };
  const Mw = await planWith("A3", "A2");                // the state names Charlie; the plan's card holds Bravo - four corners each
  const mwHtml = Mw.api.st().html; await Mw.api.commitPattern(); await Mw.api.flush();
  const mw = Mw.api.st(), mwSv = mw.mission.surveys[0] || {};
  const Mr = await planWith("A3", "A3");                // ... holds Charlie, read back from the plan (a new array)
  await Mr.api.commitPattern(); await Mr.api.flush();
  const mr = Mr.api.st(), mrSv = mr.mission.surveys[0] || {};
  const Md = listWorld(); Md.api.importBoundaryText("blocks.geojson", FILE4); await Md.api.flush();
  const bd = Md.api.st().boundary; bd[1] = { lat: bd[1].lat + 0.0002, lon: bd[1].lon };   // a corner DRAGGED, in place
  await Md.api.commitPattern(); await Md.api.flush();
  const mdSv = Md.api.st().mission.surveys[0] || {};
  check("5m. THE CARD'S AREA IS THE LIST'S ONLY IF IT IS THAT AREA (the review's finding 1): a state naming Charlie over a "
        + "plan whose card holds Bravo - four corners each - is not taken: no row reads 'card', the survey added is neither "
        + "named nor tagged and nothing advances; the plan's card holding Charlie corner for corner is (named, tagged, the "
        + "next on); a corner dragged in place is still the area",
        () => rowSt(mwHtml).join() === ",,," && mwSv.id && !("area" in mwSv) && mwSv.name === "" && sameRing(mw.boundary, ringOf("A2"))
              && rowSt(mw.html).join() === ",,,"
              && mrSv.name === "Charlie" && mrSv.area === LIST4.key + "/A3" && mr.areaList.card === "A4"
              && mdSv.area === LIST4.key + "/A2" && mdSv.name === "Bravo",
        () => JSON.stringify({ wrongRows: rowSt(mwHtml), wrong: mwSv.name + "/" + mwSv.area, right: mrSv.name + "/" + mrSv.area,
                               next: mr.areaList.card, dragged: mdSv.name + "/" + mdSv.area }));

  // ── 5n. finding 2 and the chain: a state waits for its list's answer, and follows no list the console refused ─────
  const N1 = listWorld({ hold: true });
  N1.api.importBoundaryText("blocks.geojson", FILE4); await tick(); await tick();
  const n1a = N1.posts.map((p) => Object.keys(p)[0]).join();           // the list sent; its state waits for its answer
  N1.held.shift()(); await tick(); await tick();
  const n1b = N1.posts.map((p) => Object.keys(p)[0]).join();
  N1.hold = false; while (N1.held.length) N1.held.shift()(); await N1.api.flush();
  const N2 = listWorld({ postFail: (b) => "areas" in b });
  N2.api.importBoundaryText("blocks.geojson", FILE4); await N2.api.flush();
  N2.api.areaAct("dn", "A2"); await N2.api.flush();
  const n2said = N2.banners.find((b) => /^⚠ THE SURVEY AREA LIST WAS NOT SAVED/.test(b)) || "";
  check("5n. ONE POST AT A TIME: the state waits for its list's answer (held: the list alone is sent until it answers); and "
        + "a list the console REFUSED is followed by none of its states (the review's finding 2) - the banner says the list "
        + "was not saved and to import the file again",
        () => n1a === "areas" && n1b === "areas,state" && N2.posts.length === 1 && "areas" in N2.posts[0]
              && /^⚠ THE SURVEY AREA LIST WAS NOT SAVED: the disk is full\. It stands on this page until it is reloaded - import the file again to keep it; the plan is saved as ever\.$/.test(n2said),
        () => JSON.stringify({ held: n1a, released: n1b, refused: N2.posts.map((p) => Object.keys(p)[0]), said: n2said.slice(0, 160) }));

  // ── 5o. finding 4: what the next area is given is what the banner says ─────
  const O = listWorld(); O.api.importBoundaryText("blocks.geojson", FILE4); await O.api.flush();
  const ow0 = O.api.st(); O.api.set("pat", Object.assign({}, ow0.pat, { C: G.atDA(ow0.pat.A, 25, 120) }));
  await commitAll(O, 1);                                               // Bravo at 25 m, 120: Charlie carries it
  const ow1 = O.api.st(), owCarry = Object.assign({}, ow1.areaList.carry); O.api.set("pat", { A: ow1.pat.A, B: ow1.pat.B, C: null, align: 0 });
  await commitAll(O, 1);                                               // Charlie with NO spacing point: Delta gets the default
  const ow2 = O.api.st(), owb = O.banners[O.banners.length - 1];
  check("5o. A SURVEY ADDED WITH NO SPACING POINT CARRIES NONE (the review's finding 4): the next area is laid at the DEFAULT "
        + "(5 m, 090) - not the spacing carried before it (25 m) - and its banner says so, never 'the same'",
        () => owCarry.sp === 25 && ow2.areaList.card === "A4" && ow2.areaList.carry === null
              && Math.abs(G.distTo(ow2.pat.A, ow2.pat.C) - 5) < 0.01 && Math.abs(G.azTo(ow2.pat.A, ow2.pat.C) - 90) < 0.01
              && /NEXT AREA ON THE CARD: 3 of 4, "Delta", at the DEFAULT line spacing and direction \(the survey added had no spacing point\) - set them, check its pattern, Punch Out, then Add to plan\./.test(owb)
              && !/the same line spacing/.test(owb),
        () => JSON.stringify({ carry: ow2.areaList.carry, sp: G.distTo(ow2.pat.A, ow2.pat.C), az: G.azTo(ow2.pat.A, ow2.pat.C), banner: owb.slice(0, 220) }));

  // ── 5p. finding 5: a load that would throw work away asks first ─────
  const Pq = listWorld(); Pq.api.importBoundaryText("blocks.geojson", FILE4); await Pq.api.flush();
  const a0 = Pq.asks, l0 = await Pq.api.areaLoadAsked("A3"), a0b = Pq.asks;          // nothing worked on the card: no question
  Pq.api.set("patClip", [[{ lat: 43.06, lon: -70.69 }, { lat: 43.061, lon: -70.69 }]]); Pq.confirm = false;
  const l1 = await Pq.api.areaLoadAsked("A4"), p1 = { card: Pq.api.st().areaList.card }, a1 = Pq.asks;         // a PUNCH: asked, declined
  Pq.confirm = true; const l2 = await Pq.api.areaLoadAsked("A4"), p2 = { card: Pq.api.st().areaList.card };    // ... accepted
  Pq.api.set("editingSv", "S9"); Pq.confirm = false;
  const l3 = await Pq.api.areaLoadAsked("A1"), p3 = { card: Pq.api.st().areaList.card, editingSv: Pq.api.st().editingSv }, a3 = Pq.asks;         // an EDIT: asked, declined
  Pq.api.set("editingSv", null); const ps = Pq.api.st().pat;
  Pq.api.set("pat", Object.assign({}, ps, { C: G.atDA(ps.A, 30, 45) }));
  const l4 = await Pq.api.areaLoadAsked("A1"), a4 = Pq.asks;                           // a pattern MOVED since it was laid
  const Q = listWorld(); Q.api.importBoundaryText("job.kml", KML1); await Q.api.flush();
  const qRing = Q.api.st().boundary; Q.api.set("editingSv", "S9"); Q.confirm = false;
  Q.api.importBoundaryText("blocks.geojson", FILE4); await Q.api.flush(); await tick();
  const q1 = Q.api.st(), qb = Q.banners[Q.banners.length - 1] || "";
  check("5p. A LOAD THAT WOULD THROW WORK AWAY ASKS FIRST (the review's finding 5), as ✎ and Plan B do: nothing worked on the "
        + "card - no question; a Punch Out, an edit, a pattern moved since it was laid - asked, and declined nothing changes; "
        + "an IMPORT of a list over an edit asks too - declined, the list is made and the card is left as it was, the banner "
        + "says so",
        () => l0 === true && a0b === a0 && l1 === false && a1 === a0 + 1 && p1.card === "A3" && l2 === true && p2.card === "A4"
              && l3 === false && a3 === a1 + 2 && p3.editingSv === "S9" && p3.card === "A4" && l4 === false && a4 === a3 + 1
              && Q.asks === 1 && q1.areaList && q1.areaList.rows.length === 4 && q1.areaList.card === null && q1.boundary === qRing
              && q1.editingSv === "S9"
              && /\. Nothing from it is on the card - the edit of S9 stays there, as asked: Load an area when ready\.$/.test(qb),
        () => JSON.stringify({ loads: [l0, l1, l2, l3, l4], asks: [a0, a0b, a1, a3, a4], cards: [p1.card, p2.card, p3.card],
                               importAsks: Q.asks, importCard: q1.areaList && q1.areaList.card, kept: q1.boundary === qRing, banner: qb.slice(-120) }));

  // ── 5q. the next area after the last in the order: from the top ─────
  const R2 = listWorld(); R2.api.importBoundaryText("blocks.geojson", FILE4); await R2.api.flush();   // A2 A3 A4 A1; A2 on
  await R2.api.areaLoadAsked("A4"); await commitAll(R2, 1);                     // the third added first: next after it, A1
  const q1c = R2.api.st().areaList.card;
  await commitAll(R2, 1);                                                       // A1, the last in the order: next from the TOP
  const q2c = R2.api.st().areaList.card, q2b = R2.banners[R2.banners.length - 1] || "";
  check("5q. AFTER THE LAST IN THE ORDER the next area is the first not yet in the plan FROM THE TOP (Bravo) - not 'every "
        + "area is in the plan' while two are not",
        () => q1c === "A1" && q2c === "A2" && /NEXT AREA ON THE CARD: 1 of 4, "Bravo"/.test(q2b) && !/EVERY AREA/.test(q2b),
        () => JSON.stringify({ afterThird: q1c, afterLast: q2c, banner: q2b.slice(0, 120) }));

  // ── 5k. the list read at startup ─────
  const K = listWorld({ get: { status: 200, body: { areas: Object.assign({}, W.posts[0].areas, { order: ["A4", "A1"], card: null, carry: null }) } } });
  await K.api.loadAreaList();
  const k1 = K.api.st();
  const K2 = listWorld({ get: { status: 503, body: { error: "the area list (mission.json.areas.json) could not be read: disk" } } });
  await K2.api.loadAreaList();
  const K3 = listWorld({ get: { status: 200, body: { areas: { key: "x", rows: "no", order: [] } } } });
  await K3.api.loadAreaList();
  const K4 = listWorld({ get: { status: 200, body: { areas: Object.assign({}, W.posts[0].areas, { key: "old#1" }) } } });
  const pend = K4.api.loadAreaList();
  K4.api.importBoundaryText("blocks.geojson", FILE4);
  await pend; await K4.api.flush();
  const KC = listWorld({ role: "controls" });
  KC.api.importBoundaryText("blocks.geojson", FILE4); await KC.api.flush();
  check("5k. AT STARTUP the console's list is read and shown (its order); one that cannot be read, or is not a list, is SAID "
        + "and taken for none, nothing written over it; an import made before the read answered is the list, not the read; "
        + "the controls window sends nothing and draws no list of its own (the chart's is mirrored)",
        () => k1.areaList && k1.areaList.order.join() === "A4,A1" && rowNames(k1.html).join() === "Delta,Alpha" && K.posts.length === 0
              && K2.api.st().areaList === null && /^THE SURVEY AREA LIST could not be read: the area list \(mission\.json\.areas\.json\) could not be read: disk\./.test(K2.banners[0] || "")
              && K2.posts.length === 0
              && K3.api.st().areaList === null && /not an area list/.test(K3.banners[0] || "")
              && K4.api.st().areaList.key !== "old#1" && K4.api.st().areaList.card === "A2"
              && KC.posts.length === 0 && KC.api.st().html === "",
        () => JSON.stringify({ k1: k1.areaList && k1.areaList.order, k2: K2.banners[0], k3: K3.banners[0], k4: K4.api.st().areaList.key, kc: KC.posts.length }));
  // ── 5k-b. read again (Take over reads it after the plan, as startup does): the row picked stays on the same list only
  const KP = listWorld({ get: { status: 200, body: { areas: Object.assign({}, W.posts[0].areas) } } });
  await KP.api.loadAreaList(); KP.api.set("pick", "A2");
  await KP.api.loadAreaList();
  const kpSame = KP.api.st().areaPick;
  KP.get = { status: 200, body: { areas: Object.assign({}, W.posts[0].areas, { key: "other#9" }) } };
  await KP.api.loadAreaList();
  const kpOther = KP.api.st().areaPick, kpKey = KP.api.st().areaList.key;
  KP.api.set("pick", "A1"); KP.get = { status: 200, body: { areas: null } };
  await KP.api.loadAreaList();
  const kpNone = KP.api.st().areaPick, kpList = KP.api.st().areaList;
  check("5k-b. THE LIST READ AGAIN (Take over reads it after the plan, as startup does) keeps the row picked when it is the "
        + "same list, and drops it for a different list or none - row ids are A1.. in every list",
        () => kpSame === "A2" && kpKey === "other#9" && kpOther === null && kpList === null && kpNone === null && KP.posts.length === 0,
        () => JSON.stringify({ same: kpSame, other: kpOther, key: kpKey, none: kpNone, posts: KP.posts.length }));

  // the picker: opened afresh (a file picked twice still fires change); in the CONTROLS window the file is read THERE and
  // its text sent to the chart - nothing imported in that window; in the chart window it is imported; too big - refused
  const file = (name, text, size) => ({ name, size: size == null ? text.length : size, text: async () => text });
  const C = pageWorld({ role: "controls" }), M = pageWorld(), Big = pageWorld();
  C.api.openBoundaryFile();
  await C.api.boundaryFilePicked(file("job.kml", KML1));
  await M.api.boundaryFilePicked(file("job.kml", KML1));
  await Big.api.boundaryFilePicked(file("huge.kml", "x", B.BOUNDARY_FILE_MAX_BYTES + 1));
  const sent = C.posted[0] || {};
  check("5c. THE FILE PICKER OPENS IN THE WINDOW PRESSED: opened afresh; in the controls window the file is read there and "
        + "its TEXT sent to the chart (kind 'file', bnd_import) - nothing imported in that window; in the chart window it is "
        + "imported; a file past the size limit (" + (B.BOUNDARY_FILE_MAX_BYTES >> 20) + " MB) is refused unread",
        () => C.picks === 1 && C.api.st().file === "" && sent.t === "ev" && sent.kind === "file" && sent.id === "bnd_import"
              && sent.name === "job.kml" && sent.text === KML1 && C.api.st().boundary.length === 0 && C.saves === 0
              && M.api.st().boundary.length === 4 && M.posted.length === 0
              && new RegExp("NOT IMPORTED from huge\\.kml: the file is larger than " + (B.BOUNDARY_FILE_MAX_BYTES >> 20) + " MB").test(Big.banners[0] || "")
              && Big.api.st().boundary.length === 0,
        () => JSON.stringify({ picks: C.picks, sent: { t: sent.t, kind: sent.kind, id: sent.id, name: sent.name, len: (sent.text || "").length },
                               chart: M.api.st().boundary.length, big: Big.banners[0] }));
  // the wiring: the controls window opens the picker itself and relays nothing; the chart imports what it is sent; the
  // input lives outside every bridged card (the sync never replaces it); the buttons are bound; and the list's own
  const split = grab("setupUISplit"), commit = grab("commitPattern"), kept2 = grab("withCardKept"), applyS = grab("applySurveySettings");
  const inputAt = H.indexOf('id="bndFile"'), panelAt = H.indexOf('id="pathPanel"'), panelEnd = H.indexOf('id="vcard"');
  const listAt = H.indexOf('<div id="bnd_list"'), bpAt = H.indexOf('id="boundPanel"'), mmAt = H.indexOf('id="sp_maxdepth"');
  const wiring = {
    controls: /if\(el\.id === "bnd_import"\)\{ openBoundaryFile\(\); e\.stopImmediatePropagation\(\); return; \}/.test(split),
    chart: /else if\(m\.kind==="file" && m\.id==="bnd_import"\)\{ importBoundaryText\(String\(m\.name \|\| "a file"\), String\(m\.text \|\| ""\)\); \}/.test(split),
    outside: inputAt > 0 && !(inputAt > panelAt && inputAt < panelEnd) && /<input type="file" id="bndFile" accept="\.geojson,\.json,\.kml,\.kmz,\.csv,\.txt"/.test(H),
    bound: /\$\("#bnd_import"\)\.onclick = openBoundaryFile;/.test(H) && /\$\("#bndFile"\)\.onchange = \(e\) => boundaryFilePicked\(/.test(H)
           && /\$\("#sv_mode_pattern"\)\.onclick = \(\) => surveySetBounded\(false\);/.test(H) && /\$\("#sv_mode_bounded"\)\.onclick = \(\) => surveySetBounded\(true\);/.test(H),
    imported: /import \{ parseBoundaryFile, ringAreaM2, ringMiddle, BOUNDARY_FILE_MAX_BYTES \} from "\/static\/js\/boundary_file\.js";/.test(H),
    // the list: in the Area row's panel (a bridged card: mirrored, its clicks relayed by id), its clicks delegated
    listIn: listAt > bpAt && bpAt > 0 && listAt < mmAt,
    listClicks: /\$\("#bnd_list"\)\.addEventListener\("click", /.test(H) && /if\(t\.closest\("#bnd_lorder"\)\)\{ areaReorderShortest\(\); return; \}/.test(H)
                && /if\(act === "load"\)\{ areaLoadAsked\(id\); return; \}/.test(grab("areaAct")),
    startup: /loadPorts\(\)\.then\(loadVessel\)\.then\(loadMission\)\.then\(loadAreaList\);/.test(H),
    takeOver: /if\(j && j\.you\)\{ await loadVessel\(\); await loadMission\(\); await loadAreaList\(\); \}/.test(H),
    redraw: /function renderSurveyTable\(\)\{\s+renderAreaList\(\);/.test(H) && /drawAreaList\(toScreen\);\s+drawBoundary\(toScreen\);/.test(H),
    // the commit names, tags and advances; the link ends where a survey's own area goes on the card, held through Punch all
    commit: /const fromArea = editing \|\| patOnly \? null : areaOnCard\(\);/.test(commit) && /if\(fromArea\)\{ areaList\.carry = carry; areaAdvance\(rec, fromArea\); \}/.test(commit),
    edits: /areaCardEnd\(\);/.test(applyS) && /areaLinkHold\+\+;/.test(kept2) && /applySurveySettings\(\{\.\.\.keep, only: null, outline_m: null, outline_low_m: null\}\); areaLinkHold--;/.test(kept2),
    reset: /areaList = null; areaPick = null; saveAreaList\(\);\s+try\{ await areaPostChain; \}catch\(e\)\{\}/.test(grab("resetMission")),
  };
  check("5d. THE WIRING: the controls window opens the picker itself and relays nothing; the chart imports the text it is "
        + "sent; the file input sits outside every bridged card; Import, the input and the Pattern / Bounded switch are bound; "
        + "the area list sits in the Area row's card, its clicks delegated, read after the plan at startup and at Take over, redrawn with the "
        + "survey table and drawn on the chart under the card's area; Add to plan names, tags and advances; a survey's own "
        + "area put on the card ends the link, held through Punch all; Reset clears the list before the reload",
        () => Object.values(wiring).every(Boolean),
        () => Object.entries(wiring).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all checks passed") + " (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
