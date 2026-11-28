// static/js/boundary_file.js - SURVEY AREAS FROM A FILE (Andy, 2026-10-16: "For some surveys the boundary box is critical
// and should have a draw mode or an input mode for pre-drawn surveys"; asked how a pre-drawn boundary should come in, he
// chose importing a file. 2026-11-27: "The boundary area I attempted to import has 5999 corners. Can this be accommodated
// with an update or should the imported files have reduced corners?" - an update, then: "also a GEOJSON boundary survey
// file may come in with multiple survey areas. Generate a process to define each independently and sequence them for
// survey").
//
// EVERY AREA in a GeoJSON, KML or CSV file, each as [{lat, lon}] - the ring the Survey tab's Bounded mode fills with
// lines; the page lists them when there is more than one (asv.html, THE AREAS FROM A FILE). Pure (no DOM, no fetch), so
// the page and tests/boundary_file.js run the same code. It never guesses quietly: what it could not use is said in
// `notes` (an area it could not read and why, an area's holes, a CSV read longitude-first), and a file with no area it
// can use is refused in words (`error`), never turned into a boundary somewhere else.
//   GeoJSON (.geojson, .json): every Polygon - its outer ring - and every polygon of a MultiPolygon, in a Feature, a
//     FeatureCollection or a GeometryCollection; a closed LineString as a ring. Coordinates are longitude, latitude (the
//     standard's order). Each area is named by its feature - its id and its name, "T01 North Ledge", or the one
//     it has (ID_KEYS, TITLE_KEYS; else the feature's own id) - else "Area <n>", n its feature's place in the file;
//     and a feature of several polygons gives one area each, "(part k of n)".
//   KML (.kml): each Placemark's Polygons (their outerBoundaryIs), or a closed LinearRing / LineString; "lon,lat[,alt]".
//   CSV / text (.csv, .txt): one area, one corner a line. A header names the columns (lat/latitude/y,
//     lon/long/lng/longitude/x); with none, latitude then longitude - the order the console's own fields use - unless
//     the first column passes 90 where the second never does, which can only be longitude first (then said).
// A KMZ is a zipped KML: refused, with what to do.
//
// ⚠ THE CORNERS ON A STRAIGHT EDGE GO, AND ONLY THOSE (2026-11-27). An exported area often carries corners part-way
// along a straight edge - a densified line, a raster's run of steps. A corner within STRAIGHT_TOL_M (1 mm) of the edge
// its kept neighbors make is dropped (dropStraight): the edge moves no more than that, either way, and every corner
// dropped is held to that edge, not only to the one before it (at most STRAIGHT_RUN_MAX in a row - a longer run keeps a
// corner ON its edge every so often). Nothing else is simplified: the survey lines run to
// within 5 cm of the area's edge (AREA_EDGE_M), so an outline cut by a coarser simplifier would carry them past the
// boundary wherever it bulged out. The page clips lines to thousands of corners at a redraw's cost (geometry.js
// ringGrid), so an area keeps every corner it needs, up to BOUNDARY_FILE_MAX_PTS.

export const BOUNDARY_FILE_MAX_BYTES = 20 * 1024 * 1024;   // a region's survey areas in one file
export const BOUNDARY_FILE_MAX_PTS = 20000;               // corners in one area, once those on its straight edges are gone
export const AREA_LIST_MAX = 200;                          // areas listed out of one file
export const AREA_LIST_CORNERS_MAX = 150000;               // ... and corners, all its areas together (= asv_console.py
                                                           // AREA_CORNERS_MAX: the console holds a list that size as JSON)
export const AREA_NAME_MAX = 120;                          // = surveys.js SURVEY_NAME_MAX: a listed area names its survey
export const STRAIGHT_TOL_M = 0.001;                       // a corner this close to its neighbors' straight edge goes
export const STRAIGHT_RUN_MAX = 256;                       // corners dropped in a row, at most (bounds the work)
const DUP_DEG = 1e-9;                                      // a corner repeated (the closing one, or doubled) is one corner
// the properties that name an area - its NAME (first found wins) and its ID (first found wins, else the feature's own
// id): an area with both is "<id> <name>" ("T01 North Ledge"), with one, that one (2026-11-27: his target file
// names one area of thirteen, and numbers every one by `target_id`)
const TITLE_KEYS = ["name", "Name", "NAME", "label", "Label", "LABEL", "title", "Title", "TITLE"];
const ID_KEYS = ["area_id", "AREA_ID", "areaId", "target_id", "TARGET_ID", "targetId", "survey_id", "SURVEY_ID", "surveyId",
                 "block_id", "BLOCK_ID", "blockId", "id", "ID", "Id"];

const M_PER_DEG = 111320;
/** Square meters inside a ring of {lat, lon} (a local flat plane about its middle - survey scale). */
export function ringAreaM2(pts){
  if(!pts || pts.length < 3) return 0;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180) * M_PER_DEG;
  let a = 0;
  for(let i = 0; i < pts.length; i++){
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += (p.lon * k) * (q.lat * M_PER_DEG) - (q.lon * k) * (p.lat * M_PER_DEG);
  }
  return Math.abs(a) / 2;
}
/** The ring's middle (the mean of its corners) - where the chart is taken to look at it. */
export function ringMiddle(pts){
  return {lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length};
}

/**
 * The ring without the corners that lie on a straight edge: a corner goes when it, and every corner dropped since the
 * last one kept, is within `tolM` (STRAIGHT_TOL_M) of the SEGMENT from that kept corner to the next corner - so no
 * dropped corner is more than tolM off the edge that replaces it, and a spike (a corner past the segment's end) stays.
 * The walk starts at the corner first in (east, north) order, which no segment between two other corners passes
 * through, and the corners kept keep the file's order. A ring of fewer than 4 corners comes back as it is.
 */
export function dropStraight(pts, tolM){
  const tol = tolM == null ? STRAIGHT_TOL_M : tolM, n = pts ? pts.length : 0;
  if(n < 4 || !(tol > 0)) return (pts || []).map((p) => ({lat: p.lat, lon: p.lon}));
  const mid = ringMiddle(pts), kx = Math.cos(mid.lat * Math.PI / 180) * M_PER_DEG;
  const X = new Float64Array(n), Y = new Float64Array(n);
  for(let i = 0; i < n; i++){ X[i] = (pts[i].lon - mid.lon) * kx; Y[i] = (pts[i].lat - mid.lat) * M_PER_DEG; }
  let s = 0;
  for(let i = 1; i < n; i++) if(X[i] < X[s] || (X[i] === X[s] && Y[i] < Y[s])) s = i;
  const off = (c, a, b) => {
    const dx = X[b] - X[a], dy = Y[b] - Y[a], L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((X[c] - X[a]) * dx + (Y[c] - Y[a]) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(X[c] - X[a] - t * dx, Y[c] - Y[a] - t * dy);
  };
  const keep = [s];
  let a = s, run = [];
  for(let k = 1; k < n; k++){
    const c = (s + k) % n, q = (s + k + 1) % n;
    if(run.length < STRAIGHT_RUN_MAX && off(c, a, q) <= tol && run.every((r) => off(r, a, q) <= tol)) run.push(c);
    else { keep.push(c); a = c; run = []; }
  }
  keep.sort((x, y) => x - y);
  return keep.map((i) => ({lat: pts[i].lat, lon: pts[i].lon}));
}

/** The file's kind, by its name, else by what it starts with. */
function kindOf(name, text){
  const ext = (String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  if(ext === "kmz") return "kmz";
  if(ext === "geojson" || ext === "json") return "geojson";
  if(ext === "kml") return "kml";
  if(ext === "csv" || ext === "txt") return "csv";
  const t = String(text || "").replace(/^﻿/, "").trimStart();
  if(t.startsWith("{")) return "geojson";
  if(/<kml[\s>]|<coordinates[\s>]/i.test(t.slice(0, 4096))) return "kml";
  return "csv";
}

/** A candidate ring: its corners, its name, how many holes it had, and the feature (1, 2 ... in the file) it is part of. */
const ring = (pts, name, holes, feat) => ({pts, name: name || "", holes: holes || 0, feat: feat || 1});

/** A feature's name: its id and its name - the first of ID_KEYS (else its own id) and of TITLE_KEYS its properties hold,
 *  text or a number - "<id> <name>", or the one it has, else "". A name that already holds its id is not given it twice. */
function nameOf(o){
  const p = o && o.properties;
  const ok = (v) => (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && Number.isFinite(v));
  const first = (keys) => { if(p && typeof p === "object") for(const k of keys) if(ok(p[k])) return String(p[k]).trim(); return ""; };
  const title = first(TITLE_KEYS), id = first(ID_KEYS) || (o && ok(o.id) ? String(o.id).trim() : "");
  return title && id && !title.includes(id) ? id + " " + title : title || id;
}

// ── GeoJSON ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function geojsonRings(text){
  let g;
  try{ g = JSON.parse(String(text).replace(/^﻿/, "")); }
  catch(e){ return {error: "it is not valid JSON (" + String(e.message || e).slice(0, 80) + ")"}; }
  const out = [], open = [];
  const pos = (c) => Array.isArray(c) && c.length >= 2 ? {lat: +c[1], lon: +c[0]} : {lat: NaN, lon: NaN};
  // a LINE is an area only when it closes on itself; an open one is said, not joined up
  const lineRing = (pts, nm, f) => { if(pts.length >= 4 && same(pts[0], pts[pts.length - 1])) out.push(ring(pts, nm, 0, f)); else open.push(pts); };
  let feats = 0;
  const walk = (o, name, f) => {
    if(!o || typeof o !== "object") return;
    switch(o.type){
      case "FeatureCollection": (o.features || []).forEach((x) => walk(x, null, null)); break;
      case "Feature": walk(o.geometry, nameOf(o) || name, f || ++feats); break;
      case "GeometryCollection": { const ff = f || ++feats; (o.geometries || []).forEach((x) => walk(x, name, ff)); break; }
      case "Polygon": if(Array.isArray(o.coordinates) && o.coordinates.length)
        out.push(ring((o.coordinates[0] || []).map(pos), name, o.coordinates.length - 1, f || ++feats)); break;
      case "MultiPolygon": { const ff = f || ++feats;
        (o.coordinates || []).forEach((pc) => { if(Array.isArray(pc) && pc.length) out.push(ring((pc[0] || []).map(pos), name, pc.length - 1, ff)); }); break; }
      case "LineString": lineRing((o.coordinates || []).map(pos), name, f || ++feats); break;
      case "MultiLineString": { const ff = f || ++feats; (o.coordinates || []).forEach((lc) => lineRing((lc || []).map(pos), name, ff)); break; }
      default: break;
    }
  };
  walk(g, null, null);
  return {rings: out, open: open.length};
}

// ── KML ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Read with patterns, not a DOM parser (tests run in Node): the elements it needs are few and flat. A namespace prefix
// (<kml:Polygon>) is allowed on every one.
const tag = (n) => "(?:[A-Za-z0-9_]+:)?" + n;
function kmlCoords(s){
  return String(s).trim().split(/\s+/).filter(Boolean).map((t) => { const c = t.split(","); return {lat: +c[1], lon: +c[0]}; });
}
function kmlRings(text){
  const t = String(text).replace(/^﻿/, "").replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  let open = 0;
  const reBlock = (n) => new RegExp("<" + tag(n) + "\\b[^>]*>([\\s\\S]*?)</" + tag(n) + "\\s*>", "gi");
  const nameIn = (s) => { const m = new RegExp("<" + tag("name") + "\\b[^>]*>([\\s\\S]*?)</" + tag("name") + "\\s*>", "i").exec(s);
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : ""; };
  const coordsIn = (s) => { const m = new RegExp("<" + tag("coordinates") + "\\b[^>]*>([\\s\\S]*?)</" + tag("coordinates") + "\\s*>", "i").exec(s);
    return m ? kmlCoords(m[1]) : null; };
  const fromPart = (s, nm, f) => {
    let found = false;
    for(const m of s.matchAll(reBlock("Polygon"))){
      found = true;
      const outer = new RegExp("<" + tag("outerBoundaryIs") + "\\b[^>]*>([\\s\\S]*?)</" + tag("outerBoundaryIs") + "\\s*>", "i").exec(m[1]);
      const pts = coordsIn(outer ? outer[1] : m[1]);
      const holes = (m[1].match(new RegExp("<" + tag("innerBoundaryIs") + "\\b", "gi")) || []).length;
      if(pts) out.push(ring(pts, nm, holes, f));
    }
    if(found) return;
    const rest = s;
    for(const m of rest.matchAll(reBlock("LinearRing"))){ const pts = coordsIn(m[1]); if(pts){ out.push(ring(pts, nm, 0, f)); found = true; } }
    if(found) return;
    for(const m of rest.matchAll(reBlock("LineString"))){
      const pts = coordsIn(m[1]);
      if(pts && pts.length >= 4 && same(pts[0], pts[pts.length - 1])) out.push(ring(pts, nm, 0, f)); else if(pts) open++;
    }
  };
  const marks = [...t.matchAll(reBlock("Placemark"))];
  if(marks.length) marks.forEach((m, i) => fromPart(m[1], nameIn(m[1]), i + 1));
  else fromPart(t, "", 1);
  return {rings: out, open};
}

// ── CSV / text ───────────────────────────────────────────────────────────────────────────────────────────────────────
function csvRings(text){
  const lines = String(text).replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const rows = [];
  lines.forEach((ln, i) => { const s = ln.trim(); if(s && !s.startsWith("#")) rows.push({n: i + 1, s}); });
  if(!rows.length) return {error: "it holds no lines to read"};
  const sep = (s) => s.includes("\t") ? "\t" : s.includes(";") ? ";" : s.includes(",") ? "," : null;
  const split = (s) => { const d = sep(s); return (d ? s.split(d) : s.split(/\s+/)).map((x) => x.trim().replace(/^"(.*)"$/, "$1")); };
  const num = (x) => x !== "" && Number.isFinite(+x);
  let latCol = 0, lonCol = 1, header = false, notes = [];
  const first = split(rows[0].s);
  if(first.some((x) => !num(x))){
    header = true;
    const nm = first.map((x) => x.toLowerCase());
    const la = nm.findIndex((x) => /^(lat|latitude|y)\b|lat/.test(x) && !/lon|lng/.test(x));
    const lo = nm.findIndex((x) => /^(lon|long|lng|longitude|x)\b|lon|lng/.test(x));
    if(la < 0 || lo < 0) return {error: "its header (\"" + rows[0].s.slice(0, 60) + "\") names no latitude and longitude columns"};
    latCol = la; lonCol = lo;
  }
  const body = header ? rows.slice(1) : rows, pts = [];
  for(const r of body){
    const f = split(r.s);
    const a = f[latCol], b = f[lonCol];
    if(!num(a) || !num(b)) return {error: "line " + r.n + " (\"" + r.s.slice(0, 40) + "\") is not two numbers in decimal degrees"};
    pts.push({lat: +a, lon: +b});
  }
  // no header: latitude first, as the console's own fields - unless the FIRST column passes 90 where the second never
  // does, which only longitude can (in US waters both are inside 90, so this cannot rescue a longitude-first file there;
  // the banner says where the area landed, so a misread is seen)
  if(!header && pts.some((p) => Math.abs(p.lat) > 90) && pts.every((p) => Math.abs(p.lon) <= 90)){
    pts.forEach((p) => { const x = p.lat; p.lat = p.lon; p.lon = x; });
    notes.push("read as longitude, latitude - its first column passes 90 degrees");
  }
  return {rings: [ring(pts, "", 0, 1)], open: 0, notes};
}

function same(a, b){ return Math.abs(a.lat - b.lat) < DUP_DEG && Math.abs(a.lon - b.lon) < DUP_DEG; }

/** One candidate ring made an area: {pts, inFile, dropped} - the corners real positions in degrees, none repeated, its
 *  straight edges' corners gone - or {error} in words. */
function cleanRing(raw){
  const pts = [];
  for(const p of raw){
    if(!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return {error: "a corner of its area is not a position"};
    if(Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)
      return {error: "a corner (" + p.lat + ", " + p.lon + ") is not in degrees of latitude and longitude - export it in WGS 84 (EPSG:4326)"};
    if(!pts.length || !same(pts[pts.length - 1], p)) pts.push({lat: p.lat, lon: p.lon});
  }
  if(pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
  if(pts.length < 3) return {error: "its area has " + pts.length + " corner(s) - an area needs at least 3"};
  if(ringAreaM2(pts) < 1) return {error: "its area encloses nothing - its corners lie on one line"};
  const kept = dropStraight(pts);
  if(kept.length > BOUNDARY_FILE_MAX_PTS)
    return {error: "its area has " + pts.length + " corners" + (kept.length < pts.length ? " (" + kept.length + " once those on its straight edges go)" : "")
                 + ", more than " + BOUNDARY_FILE_MAX_PTS};
  if(kept.length < 3 || ringAreaM2(kept) < 1) return {error: "its area encloses nothing - its corners lie on one line"};
  return {pts: kept, inFile: pts.length, dropped: pts.length - kept.length};
}

/**
 * THE SURVEY AREAS IN A FILE: {kind: "GeoJSON"|"KML"|"CSV", areas: [{pts: [{lat, lon}], name, holes, inFile, dropped}],
 * notes: [...]} - or {error}. Every area the file holds, in its order, up to AREA_LIST_MAX of them and
 * AREA_LIST_CORNERS_MAX corners in all; one it cannot use is left
 * out and said in `notes`, and only a file with NO area it can use is refused. `pts`, `name`, `holes`, `inFile` and
 * `dropped` are also the FIRST area's - what a one-area import puts on the card.
 */
export function parseBoundaryFile(name, text){
  const kind = kindOf(name, text);
  if(kind === "kmz") return {error: "a KMZ is a zipped KML - unzip it (rename it .zip and open it) and import the .kml inside"};
  if(text == null || String(text).length === 0) return {error: "the file is empty"};
  if(String(text).length > BOUNDARY_FILE_MAX_BYTES) return {error: "the file is larger than " + (BOUNDARY_FILE_MAX_BYTES >> 20) + " MB"};
  const label = kind === "geojson" ? "GeoJSON" : kind === "kml" ? "KML" : "CSV";
  const r = kind === "geojson" ? geojsonRings(text) : kind === "kml" ? kmlRings(text) : csvRings(text);
  if(r.error) return {error: "its " + label + " could not be read: " + r.error};
  if(!r.rings.length)
    return {error: "the " + label + " holds no area" + (r.open ? " - " + r.open + " line(s) that do not close on themselves, which are not an area" : "")};
  const parts = new Map();
  r.rings.forEach((g) => parts.set(g.feat, (parts.get(g.feat) || 0) + 1));
  const many = r.rings.length > 1, k = new Map(), areas = [], skipped = [];
  // THE LIST STOPS AT ITS FIRST AREA PAST EITHER BUDGET - AREA_LIST_MAX areas, AREA_LIST_CORNERS_MAX corners - and
  // every area from there on is left out, said in `notes`: a list never skips one area to take a smaller one after it.
  let over = 0, stop = "", total = 0;
  for(const g of r.rings){
    const of = parts.get(g.feat), i = (k.get(g.feat) || 0) + 1;
    k.set(g.feat, i);
    const nm = ((g.name || (many ? "Area " + g.feat : "")) + (of > 1 ? " (part " + i + " of " + of + ")" : "")).slice(0, AREA_NAME_MAX);
    if(!stop && areas.length >= AREA_LIST_MAX) stop = "areas";
    if(stop){ over++; continue; }
    const c = cleanRing(g.pts);
    if(c.error){ skipped.push({name: nm, why: c.error}); continue; }
    if(total + c.pts.length > AREA_LIST_CORNERS_MAX){ stop = "corners"; over++; continue; }
    total += c.pts.length;
    areas.push({pts: c.pts, name: nm, holes: g.holes, inFile: c.inFile, dropped: c.dropped});
  }
  if(!areas.length){
    const w = skipped[0];
    return {error: many ? "none of its " + r.rings.length + " areas could be used - the first, \"" + w.name + "\": " + w.why : w.why};
  }
  const notes = (r.notes || []).slice();
  if(skipped.length)
    notes.push(skipped.length + " area(s) in the file could not be used and are not listed: "
      + skipped.slice(0, 3).map((x) => "\"" + x.name + "\" (" + x.why + ")").join("; ") + (skipped.length > 3 ? "; and " + (skipped.length - 3) + " more" : ""));
  if(over) notes.push(stop === "corners"
    ? "the file holds more corners than the " + AREA_LIST_CORNERS_MAX + " one list keeps - its last " + over + " area(s) were not read"
    : "the file holds more areas than the " + AREA_LIST_MAX + " listed - the " + over + " after them were not read");
  if(r.open) notes.push(r.open + " line(s) in the file do not close on themselves - they are not areas");
  const holed = areas.filter((a) => a.holes);
  if(areas.length === 1 && holed.length)
    notes.push("its " + holed[0].holes + " hole(s) were not used - the lines run through them unless Punch Out cuts them");
  else if(holed.length)
    notes.push(holed.length + " of the areas have holes (" + holed.reduce((s, a) => s + a.holes, 0) + " in all), not used - "
      + "their lines run through them unless Punch Out cuts them");
  const a0 = areas[0];
  return {kind: label, areas, notes, pts: a0.pts, name: a0.name, holes: a0.holes, inFile: a0.inFile, dropped: a0.dropped};
}
