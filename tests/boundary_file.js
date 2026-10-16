// tests/boundary_file.js - A SURVEY AREA FROM A FILE (static/js/boundary_file.js).
//
// Andy, 2026-10-16: "For some surveys the boundary box is critical and should have a draw mode or an input mode for
// pre-drawn surveys. Otherwise, allow the unbounded survey pattern 3 point draw functionality"; asked how a pre-drawn
// boundary should come in, he chose importing a file. The Survey tab's Bounded mode reads ONE area out of a GeoJSON,
// KML or CSV file; what it could not use is said, and a file it cannot read is refused in words - never turned into an
// area somewhere else. Here, over files written in the test:
//   1-1d  GEOJSON: a Polygon's outer ring, longitude first; in a FeatureCollection the first area named, the others and
//         its holes said; a MultiPolygon; a closed LineString as a ring, an open one refused; projected coordinates
//         (not degrees) refused; not JSON refused;
//   2-2c  KML: a Placemark's Polygon - its name, its outer ring, "lon,lat,alt", its holes said; a namespace prefix; a
//         closed LinearRing / LineString with no Polygon; a KMZ refused with what to do;
//   3-3d  CSV: a header naming lat/lon in either order (and X/Y); none - latitude first, the console's order; a first
//         column past 90 read longitude-first and said; semicolons, tabs, spaces, comments, a byte-order mark; a line
//         that is not two numbers refused with its number;
//   4-4b  THE CORNERS: the closing corner and doubled ones dropped; fewer than 3, more than the cap, or all on one line
//         refused; the area and middle (ringAreaM2, ringMiddle); the kind by name, else by content.
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
check("1. GEOJSON: a Polygon's outer ring, longitude first, the closing corner dropped - four corners in order; in a "
      + "FeatureCollection the FIRST area, its name kept, the second area and its hole SAID",
      () => corners(g1) && g1.kind === "GeoJSON" && g1.notes.length === 0
            && corners(g1b) && g1b.name === "Block A"
            && g1b.notes.some((n) => /first of 2 areas in the file \("Block A"\) - the others were not used/.test(n))
            && g1b.notes.some((n) => /its 1 hole\(s\) were not used/.test(n)),
      () => say(g1) + " | " + say(g1b));
const g1c = B.parseBoundaryFile("multi.geojson", JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[RING], [RING]] } }));
const g1d = B.parseBoundaryFile("ring.geojson", JSON.stringify({ type: "LineString", coordinates: RING }));
const g1e = B.parseBoundaryFile("track.geojson", JSON.stringify({ type: "LineString", coordinates: RING.slice(0, 4) }));
check("1b. a MultiPolygon gives its first polygon (the rest said); a LineString that closes on itself is an area; one "
      + "that does not is REFUSED - a line is not an area",
      () => corners(g1c) && g1c.notes.some((n) => /first of 2 areas/.test(n)) && corners(g1d)
            && /holds no area - 1 line\(s\) that do not close on themselves/.test(g1e.error || ""),
      () => say(g1c) + " | " + say(g1d) + " | " + say(g1e));
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
check("2. KML: the first Placemark's Polygon - its name, its outer ring read 'lon,lat,alt' with the closing corner "
      + "dropped - and the other Placemark and the hole SAID",
      () => corners(k2) && k2.kind === "KML" && k2.name === "North block"
            && k2.notes.some((n) => /first of 2 areas in the file \("North block"\)/.test(n)) && k2.notes.some((n) => /1 hole/.test(n)),
      () => say(k2));
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
const many = B.parseBoundaryFile("m.csv", "lat,lon\n" + Array.from({ length: B.BOUNDARY_FILE_MAX_PTS + 1 },
  (_, i) => { const a = 2 * Math.PI * i / (B.BOUNDARY_FILE_MAX_PTS + 1); return (43.06 + 0.01 * Math.sin(a)) + "," + (-70.7 + 0.01 * Math.cos(a)); }).join("\n"));
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
const pageWorld = (o) => {
  const w = Object.assign({ boundary: [], closed: false, bounded: false, patClip: ["a punch"], mode: "pan", asv: { lat: 43.07, lon: -70.71 },
    role: "chart", banners: [], logs: [], saves: 0, seeds: 0, views: 0, posted: [], picks: 0, hint: "" }, o || {});
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
    grab("openBoundaryFile"), grab("boundaryFilePicked"), grab("importBoundaryText"),
    "return {openBoundaryFile, boundaryFilePicked, importBoundaryText, st: () => ({boundary, boundaryClosed, surveyBounded, patClip, mode, hint: hintEl.textContent, file: fileEl.value})};",
  ].join("\n");
  w.api = new Function("w", "B", src)(w, B);
  return w;
};
{
  const OLD = [{ lat: 43.1, lon: -70.6 }, { lat: 43.1, lon: -70.59 }, { lat: 43.105, lon: -70.59 }];
  const P5 = pageWorld({ boundary: OLD.slice(), closed: true, bounded: false, mode: "bound" });
  const ok = P5.api.importBoundaryText("job.kml", KML), s5 = P5.api.st(), b5 = P5.banners[0] || "";
  check("5. IMPORTED: the file's area replaces the card's - closed, BOUNDED, the punch cut to the old one thrown away, an area "
        + "being drawn by hand stopped, the pattern seeded (if none is drawn), saved, the chart taken to it - and the banner "
        + "says the file, its kind and name, the corners, the area, where it is from her, what it replaced and what was not used",
        () => ok === true && s5.boundary.length === 4 && near(s5.boundary[0], SW) && s5.boundaryClosed && s5.surveyBounded
              && s5.patClip === null && s5.mode === "pan" && P5.seeds === 1 && P5.saves === 1 && P5.views === 1
              && /^SURVEY AREA IMPORTED from job\.kml \(KML, "North block"\): 4 corners, 0\.60 km², its middle 045° · 2\.00 km from her; it replaced the area that was here\. NOTE: the first of 2 areas/.test(b5)
              && /hole\(s\) were not used/.test(b5) && /Punch Out, then Add to plan\.$/.test(b5)
              && P5.logs.some((l) => l[0] === "boundary_import" && l[1].ok && l[1].corners === 4),
        () => JSON.stringify({ ok, n: s5.boundary.length, s5: [s5.boundaryClosed, s5.surveyBounded, s5.patClip, s5.mode], seeds: P5.seeds, banner: b5 }));
  const P5b = pageWorld({ boundary: OLD.slice(), closed: true, bounded: false });
  const no = P5b.api.importBoundaryText("track.geojson", JSON.stringify({ type: "LineString", coordinates: RING.slice(0, 4) }));
  const s5b = P5b.api.st();
  check("5b. NOT IMPORTED: a file that holds no area changes nothing - the card's area, the switch, the punch; nothing saved "
        + "- and the banner says why, and that the area is as it was",
        () => no === false && s5b.boundary === P5b.boundary && s5b.boundary.length === 3 && s5b.surveyBounded === false
              && s5b.patClip && s5b.patClip[0] === "a punch" && P5b.saves === 0 && P5b.views === 0
              && /^SURVEY AREA NOT IMPORTED from track\.geojson: the GeoJSON holds no area - 1 line\(s\).*\. The survey area is as it was\.$/.test(P5b.banners[0] || ""),
        () => JSON.stringify({ no, banner: P5b.banners[0] }));
}
{
  // 5e. ON PATTERN THE KEPT AREA IS NOT DRAWN (it is not applied - a purple ring there would claim it is); on Bounded it is
  const draw = (bounded) => {
    const ops = [];
    const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => ops.push(k)), set: (t, k, v) => { t[k] = v; return true; } });
    new Function("ctx", "boundary", "surveyBounded", "toScreen", "let boundaryShow = true, mode = 'pan', boundaryClosed = true;"
      + grab("boundaryActive") + grab("drawBoundary") + "drawBoundary(toScreen);")(ctx, [LL(SW), LL(SE), LL(NE)], bounded, (lat, lon) => ({ x: lon, y: lat }));
    return ops;
  };
  const onPattern = draw(false), onBounded = draw(true);
  check("5e. on PATTERN the kept area is not drawn at all; on BOUNDED it is (its ring, filled, its corners)",
        () => onPattern.length === 0 && onBounded.includes("stroke") && onBounded.includes("fill") && onBounded.filter((k) => k === "arc").length === 3,
        () => "pattern: " + onPattern.length + " ops; bounded: " + onBounded.length + " ops");
}
(async () => {
  // the picker: opened afresh (a file picked twice still fires change); in the CONTROLS window the file is read THERE and
  // its text sent to the chart - nothing imported in that window; in the chart window it is imported; too big - refused
  const file = (name, text, size) => ({ name, size: size == null ? text.length : size, text: async () => text });
  const C = pageWorld({ role: "controls" }), M = pageWorld(), Big = pageWorld();
  C.api.openBoundaryFile();
  await C.api.boundaryFilePicked(file("job.kml", KML));
  await M.api.boundaryFilePicked(file("job.kml", KML));
  await Big.api.boundaryFilePicked(file("huge.kml", "x", B.BOUNDARY_FILE_MAX_BYTES + 1));
  const sent = C.posted[0] || {};
  check("5c. THE FILE PICKER OPENS IN THE WINDOW PRESSED: opened afresh; in the controls window the file is read there and "
        + "its TEXT sent to the chart (kind 'file', bnd_import) - nothing imported in that window; in the chart window it is "
        + "imported; a file past the size limit is refused unread",
        () => C.picks === 1 && C.api.st().file === "" && sent.t === "ev" && sent.kind === "file" && sent.id === "bnd_import"
              && sent.name === "job.kml" && sent.text === KML && C.api.st().boundary.length === 0 && C.saves === 0
              && M.api.st().boundary.length === 4 && M.posted.length === 0
              && /NOT IMPORTED from huge\.kml: the file is larger than 5 MB/.test(Big.banners[0] || "") && Big.api.st().boundary.length === 0,
        () => JSON.stringify({ picks: C.picks, sent: { t: sent.t, kind: sent.kind, id: sent.id, name: sent.name, len: (sent.text || "").length },
                               chart: M.api.st().boundary.length, big: Big.banners[0] }));
  // the wiring: the controls window opens the picker itself and relays nothing; the chart imports what it is sent; the
  // input lives outside every bridged card (the sync never replaces it); the buttons are bound
  const split = grab("setupUISplit");
  const inputAt = H.indexOf('id="bndFile"'), panelAt = H.indexOf('id="pathPanel"'), panelEnd = H.indexOf('id="vcard"');
  const wiring = {
    controls: /if\(el\.id === "bnd_import"\)\{ openBoundaryFile\(\); e\.stopImmediatePropagation\(\); return; \}/.test(split),
    chart: /else if\(m\.kind==="file" && m\.id==="bnd_import"\)\{ importBoundaryText\(String\(m\.name \|\| "a file"\), String\(m\.text \|\| ""\)\); \}/.test(split),
    outside: inputAt > 0 && !(inputAt > panelAt && inputAt < panelEnd) && /<input type="file" id="bndFile" accept="\.geojson,\.json,\.kml,\.kmz,\.csv,\.txt"/.test(H),
    bound: /\$\("#bnd_import"\)\.onclick = openBoundaryFile;/.test(H) && /\$\("#bndFile"\)\.onchange = \(e\) => boundaryFilePicked\(/.test(H)
           && /\$\("#sv_mode_pattern"\)\.onclick = \(\) => surveySetBounded\(false\);/.test(H) && /\$\("#sv_mode_bounded"\)\.onclick = \(\) => surveySetBounded\(true\);/.test(H),
    imported: /import \{ parseBoundaryFile, ringAreaM2, ringMiddle, BOUNDARY_FILE_MAX_BYTES \} from "\/static\/js\/boundary_file\.js";/.test(H),
  };
  check("5d. THE WIRING: the controls window opens the picker itself and relays nothing; the chart imports the text it is "
        + "sent; the file input sits outside every bridged card; Import, the input and the Pattern / Bounded switch are bound",
        () => Object.values(wiring).every(Boolean),
        () => Object.entries(wiring).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all checks passed") + " (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
