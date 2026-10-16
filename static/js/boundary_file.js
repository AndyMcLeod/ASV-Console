// static/js/boundary_file.js - A SURVEY AREA FROM A FILE (Andy, 2026-10-16: "For some surveys the boundary box is critical
// and should have a draw mode or an input mode for pre-drawn surveys"; asked how a pre-drawn boundary should come in, he
// chose importing a file).
//
// ONE polygon out of a GeoJSON, KML or CSV file, as [{lat, lon}] - the ring the Survey tab's Bounded mode fills with lines.
// Pure (no DOM, no fetch), so the page and tests/boundary_file.js run the same code. It never guesses quietly: what it
// could not use is said in `notes` (the other areas in the file, an area's holes, a CSV read longitude-first), and a file
// it cannot read is refused in words (`error`), never turned into a boundary somewhere else.
//   GeoJSON (.geojson, .json): Polygon / MultiPolygon - the outer ring - in a Feature, a FeatureCollection or a
//     GeometryCollection; a closed LineString as a ring. Coordinates are longitude, latitude (the standard's order).
//   KML (.kml): each Placemark's Polygon (its outerBoundaryIs), or a closed LinearRing / LineString; "lon,lat[,alt]".
//   CSV / text (.csv, .txt): one corner a line. A header names the columns (lat/latitude/y, lon/long/lng/longitude/x);
//     with none, latitude then longitude - the order the console's own fields use - unless the first column passes 90
//     where the second never does, which can only be longitude first (then said).
// A KMZ is a zipped KML: refused, with what to do.

export const BOUNDARY_FILE_MAX_BYTES = 5 * 1024 * 1024;   // a survey area is a handful of corners; this is a lot of them
export const BOUNDARY_FILE_MAX_PTS = 2000;                // corners in the area used
const DUP_DEG = 1e-9;                                     // a corner repeated (the closing one, or doubled) is one corner

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

/** A candidate ring: its corners, a name, how many holes it had. */
const ring = (pts, name, holes) => ({pts, name: name || "", holes: holes || 0});

// ── GeoJSON ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function geojsonRings(text){
  let g;
  try{ g = JSON.parse(String(text).replace(/^﻿/, "")); }
  catch(e){ return {error: "it is not valid JSON (" + String(e.message || e).slice(0, 80) + ")"}; }
  const out = [], open = [];
  const pos = (c) => Array.isArray(c) && c.length >= 2 ? {lat: +c[1], lon: +c[0]} : {lat: NaN, lon: NaN};
  const walk = (o, name) => {
    if(!o || typeof o !== "object") return;
    const nm = (o.properties && (o.properties.name || o.properties.Name || o.properties.NAME)) || name;
    switch(o.type){
      case "FeatureCollection": (o.features || []).forEach((f) => walk(f, null)); break;
      case "Feature": walk(o.geometry, nm); break;
      case "GeometryCollection": (o.geometries || []).forEach((x) => walk(x, nm)); break;
      case "Polygon": if(Array.isArray(o.coordinates) && o.coordinates.length)
        out.push(ring(o.coordinates[0].map(pos), nm, o.coordinates.length - 1)); break;
      case "MultiPolygon": (o.coordinates || []).forEach((pc) => { if(Array.isArray(pc) && pc.length) out.push(ring(pc[0].map(pos), nm, pc.length - 1)); }); break;
      case "LineString": lineRing((o.coordinates || []).map(pos), nm); break;
      case "MultiLineString": (o.coordinates || []).forEach((lc) => lineRing((lc || []).map(pos), nm)); break;
      default: break;
    }
  };
  // a LINE is an area only when it closes on itself; an open one is said, not joined up
  const lineRing = (pts, nm) => { if(pts.length >= 4 && same(pts[0], pts[pts.length - 1])) out.push(ring(pts, nm, 0)); else open.push(pts); };
  walk(g, null);
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
  const fromPart = (s, nm) => {
    let found = false;
    for(const m of s.matchAll(reBlock("Polygon"))){
      found = true;
      const outer = new RegExp("<" + tag("outerBoundaryIs") + "\\b[^>]*>([\\s\\S]*?)</" + tag("outerBoundaryIs") + "\\s*>", "i").exec(m[1]);
      const pts = coordsIn(outer ? outer[1] : m[1]);
      const holes = (m[1].match(new RegExp("<" + tag("innerBoundaryIs") + "\\b", "gi")) || []).length;
      if(pts) out.push(ring(pts, nm, holes));
    }
    if(found) return;
    const rest = s;
    for(const m of rest.matchAll(reBlock("LinearRing"))){ const pts = coordsIn(m[1]); if(pts){ out.push(ring(pts, nm, 0)); found = true; } }
    if(found) return;
    for(const m of rest.matchAll(reBlock("LineString"))){
      const pts = coordsIn(m[1]);
      if(pts && pts.length >= 4 && same(pts[0], pts[pts.length - 1])) out.push(ring(pts, nm, 0)); else if(pts) open++;
    }
  };
  const marks = [...t.matchAll(reBlock("Placemark"))];
  if(marks.length) marks.forEach((m) => fromPart(m[1], nameIn(m[1])));
  else fromPart(t, "");
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
  return {rings: [ring(pts, "", 0)], open: 0, notes};
}

function same(a, b){ return Math.abs(a.lat - b.lat) < DUP_DEG && Math.abs(a.lon - b.lon) < DUP_DEG; }

/**
 * THE SURVEY AREA IN A FILE: {pts: [{lat, lon}], kind: "GeoJSON"|"KML"|"CSV", name, notes: [...]} - or {error}.
 * The first area in the file is used; the rest, and any holes, are said in `notes`.
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
  const notes = (r.notes || []).slice(), first = r.rings[0];
  // the corners: none repeated (the closing one, a doubled click), all real positions in degrees
  const pts = [];
  for(const p of first.pts){
    if(!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return {error: "a corner of its area is not a position"};
    if(Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)
      return {error: "a corner (" + p.lat + ", " + p.lon + ") is not in degrees of latitude and longitude - export it in WGS 84 (EPSG:4326)"};
    if(!pts.length || !same(pts[pts.length - 1], p)) pts.push({lat: p.lat, lon: p.lon});
  }
  if(pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
  if(pts.length < 3) return {error: "its area has " + pts.length + " corner(s) - an area needs at least 3"};
  if(pts.length > BOUNDARY_FILE_MAX_PTS) return {error: "its area has " + pts.length + " corners, more than " + BOUNDARY_FILE_MAX_PTS};
  if(ringAreaM2(pts) < 1) return {error: "its area encloses nothing - its corners lie on one line"};
  if(r.rings.length > 1) notes.push("the first of " + r.rings.length + " areas in the file" + (first.name ? " (\"" + first.name + "\")" : "")
    + " - the others were not used");
  if(first.holes) notes.push("its " + first.holes + " hole(s) were not used - the lines run through them unless Punch Out cuts them");
  return {pts, kind: label, name: first.name, notes};
}
