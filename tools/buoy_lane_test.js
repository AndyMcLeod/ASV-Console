#!/usr/bin/env node
// Headless test for the IALA-B buoy-line keep-right (Rule 9) in static/asv.html.
//
// The in-app browser is policy-blocked from localhost, so the routing math is
// validated by pulling the REAL page functions out of the HTML with a
// brace-balance grabber and running them against a CACHED REAL ENC extract. No
// browser, no server, no dependencies - just:
//
//     node tools/buoy_lane_test.js
//
// The transit under test is the Erie Harbor entrance (the buoyage system the
// keep-right was developed against), so the picker wants the largest
// charts/enc/features_v3_*.json whose bbox covers that transit - NOT the
// largest cache outright (a vessel based elsewhere fills the store with its
// own home-water caches). Regenerate one by running the console against the
// area once.
//
// What it checks, per direction of travel:
//   * the buoyage direction inferred from the buoy numbering is right
//   * the line that must be kept to STARBOARD really is to starboard
//   * how far inside that buoy line the lane actually rides (target ~BUOY_KEEP)
//   * the path is smooth (no waypoint knots) and crosses no nogo zone
//   * planning time
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "static", "asv.html");
const ENCDIR = path.join(ROOT, "charts", "enc");

// ---- pull the real functions out of the page ------------------------------ //
const src = fs.readFileSync(HTML, "utf8");
function grabFn(name){
  const m = new RegExp("^function\\s+" + name + "\\s*\\(", "m").exec(src);
  if(!m) throw new Error("function not found in asv.html: " + name);
  let i = src.indexOf("{", m.index), depth = 0, inS = null, esc = false;
  for(let j = i; j < src.length; j++){
    const c = src[j];
    if(esc){ esc = false; continue; }
    if(inS){ if(c === "\\") esc = true; else if(c === inS) inS = null; continue; }
    if(c === '"' || c === "'" || c === "`"){ inS = c; continue; }
    if(c === "/" && src[j+1] === "/"){ j = src.indexOf("\n", j); if(j < 0) break; continue; }
    if(c === "{") depth++;
    else if(c === "}" && --depth === 0) return src.slice(m.index, j+1);
  }
  throw new Error("unbalanced braces reading " + name);
}
function grabLine(pat){
  const m = new RegExp(pat, "m").exec(src);
  if(!m) throw new Error("declaration not found in asv.html: " + pat);
  return src.slice(m.index, src.indexOf("\n", m.index));
}
const FNS = ["eachRing","eachPath","eachPoint","depthExcluded","llEN","bbOf","fromEN","nogoKind",
             "markId","markSystems","crossToLine","buildKeepouts","pinp","dSeg","inBB","blocked",
             "stampSeg","dilateGrid","rasterKeepouts","routeAround","featuresBboxRef","legClear",
             "legPath","pruneStitch","routeAroundSeg","snapClearLL","azTo","channelEndExtend","buoyageDir","buoyLaneAt","keepRight","pairGates","gateProject"];
const PRELUDE = `
const SEG_LEN_M = 2200;
const M_PER_DEG_LAT = 111320;
const NOGO_MIN_DEPTH_M = 1.0;
let CHANNEL_REACH_M = null;                   // vessel-config override; null = derive from buffer
let waterOffset = 0.94;                       // typical Lake Erie LWD correction
let enc = {features: []};
function distTo(a,b){ const dx=(b.lon-a.lon)*M_PER_DEG_LAT*Math.cos(a.lat*Math.PI/180),
                            dy=(b.lat-a.lat)*M_PER_DEG_LAT; return Math.hypot(dx,dy); }
`;
const P = {};
new Function("exports", PRELUDE
  + grabLine("^const MARK_TAIL=.*$") + "\n"
  + grabLine("^let lastBuoyage = 0;.*$") + "\n"
  + FNS.map(grabFn).join("\n\n") + "\n"
  + `Object.assign(exports, {${FNS.join(",")}, getBuoyage:()=>lastBuoyage});`)(P);

// ---- the transit under test ----------------------------------------------- //
// Erie Harbor entrance: seaward of buoys 1/2 <-> inside, off buoy 14.
const SEA = {lat: 42.1668, lon: -80.0505};
const HARBOR = {lat: 42.1425, lon: -80.0955};
const SYSTEM = "erie harbor";

// ---- build the keep-out model exactly like rebuildNogo() ------------------- //
// Largest cache whose filename bbox covers BOTH transit endpoints.
const covers = (f, p) => {
  const m = /^features_v3_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)\.json$/.exec(f);
  if(!m) return false;
  const [x0, y0, x1, y1] = m.slice(1).map(Number);
  return p.lon >= x0 && p.lon <= x1 && p.lat >= y0 && p.lat <= y1;
};
const caches = fs.readdirSync(ENCDIR)
  .filter(f => covers(f, SEA) && covers(f, HARBOR))
  .map(f => ({f, size: fs.statSync(path.join(ENCDIR, f)).size}))
  .sort((a,b) => b.size - a.size);
if(!caches.length){
  console.error("No charts/enc/features_v3_*.json cache covers the Erie Harbor transit. " +
                "Run the console once against that area to fetch one.");
  process.exit(2);
}
const encFile = path.join(ENCDIR, caches[0].f);
const feats = JSON.parse(fs.readFileSync(encFile, "utf8")).features;
const ref = P.featuresBboxRef(feats);
const buf = 3;                                          // the console's scaled default
const ko = P.buildKeepouts(ref, {land:true, depth:true, haz:true, area:false}, {min:1.0, max:null}, feats);

console.log("ENC        : " + path.basename(encFile) + "  (" + feats.length + " features)");
console.log("keep-outs  : " + ko.polys.length + " polys, " + ko.lines.length + " lines, " +
            ko.points.length + " points, " + ko.marks.length + " lateral marks");
for(const s of ko.sys)
  console.log("  system " + JSON.stringify(s.sys) +
              "  port/green [" + s.port.map(m=>m.num).join(",") + "]" +
              "  stbd/red [" + s.stbd.map(m=>m.num).join(",") + "]");

let failures = 0;
function check(ok, msg){ console.log((ok ? "    PASS  " : "    FAIL  ") + msg); if(!ok) failures++; }

function densify(pts){                                  // ~5 m ENU samples + starboard unit
  const e = pts.map(p => P.llEN(p.lat, p.lon, ref)), out = [];
  for(let i = 1; i < e.length; i++){
    const a = e[i-1], b = e[i], L = Math.hypot(b.e-a.e, b.n-a.n), n = Math.max(1, Math.round(L/5));
    const te = (b.e-a.e)/(L||1), tn = (b.n-a.n)/(L||1);
    for(let k = 0; k < n; k++){ const t = k/n;
      out.push({e: a.e+(b.e-a.e)*t, n: a.n+(b.n-a.n)*t, sb: [tn,-te], t: [te,tn]}); }
  }
  return out;
}

function transit(tag, from, to, wantDir){
  console.log("\n=== " + tag + " ===");
  const t0 = Date.now();
  const leg = P.legPath(from, to, ref, ko, buf);
  if(!leg){ console.log("    FAIL  unroutable"); failures++; return; }
  const raw = P.gateProject([{lat:from.lat, lon:from.lon}, ...leg], ref, ko, buf);
  const kr = P.keepRight(raw, ref, ko, buf);
  const ms = Date.now() - t0;
  const dir = P.getBuoyage();

  console.log("    buoyage " + (dir > 0 ? "INBOUND (red to starboard)" :
                                dir < 0 ? "OUTBOUND (green to starboard)" : "UNKNOWN") +
              ", " + kr.length + " waypoints, " + ms + " ms");
  check(dir === wantDir, "direction of travel read correctly from the buoy numbering");
  check(ms < 2000, "planned in under 2 s (" + ms + " ms)");

  const sy = ko.sys.find(s => s.sys === SYSTEM);
  const S = dir > 0 ? sy.stbd : sy.port;                 // line to keep to STARBOARD
  const Pl = dir > 0 ? sy.port : sy.stbd;

  const sm = densify(kr);            // keepRight returns the path INCLUDING `from`
  let inFair = 0, correct = 0, offs = [], cum = 0, wrongRun = 0, worstRun = 0;
  for(const s of sm){
    cum += 5;
    const cs = P.crossToLine(s, s.sb, S, 150), cp = P.crossToLine(s, s.sb, Pl, 150);
    if(!cs || !cp) continue;
    const w = cs.cross - cp.cross;
    if(!(w > 10 && w < 900)) continue;
    const u = -cp.cross / w;
    if(u < -0.15 || u > 1.15) continue;                  // only score inside the buoyed fairway
    inFair++;
    if(cs.cross > 0){ correct++; wrongRun = 0; }
    else { wrongRun += 5; worstRun = Math.max(worstRun, wrongRun); }
    offs.push(cs.cross);
  }
  offs.sort((a,b) => a-b);
  const med = offs[Math.floor(offs.length/2)];
  const pct = 100*correct/inFair;
  console.log("    in the buoyed fairway for " + inFair + " of " + sm.length + " samples; " +
              "median standoff inside that buoy line " + med.toFixed(1) + " m");
  check(pct >= 90, "right side of the starboard-hand buoy line for " + pct.toFixed(0) + "% of the fairway");
  check(med > 4 && med < 45, "lane rides close inside the buoy line (median " + med.toFixed(1) + " m)");
  // Any wrong-side stretch should only be the pinned endpoints ramping in/out.
  check(worstRun <= 400, "longest wrong-side stretch is an endpoint ramp (" + worstRun + " m)");

  let maxTurn = 0;
  for(let i = 1; i < sm.length; i++){
    const a = sm[i-1].t, b = sm[i].t;
    maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(a[0]*b[1]-a[1]*b[0], a[0]*b[0]+a[1]*b[1]))*180/Math.PI);
  }
  check(maxTurn <= 60, "no waypoint knots (max heading step " + maxTurn.toFixed(0) + " deg)");

  let viol = 0;
  for(const s of sm) if(P.blocked(s, ko, buf)) viol++;
  check(viol === 0, "path crosses no nogo zone (" + viol + " blocked samples)");
}

transit("INBOUND  sea -> harbour", SEA, HARBOR, +1);
transit("OUTBOUND harbour -> sea", HARBOR, SEA, -1);

// Regression: the entrance-harbour buoy GAP (no #6; entrance marks 1-5 join harbour
// marks 7-14) inflates the computed fairway, and a big buoy offset carried through the
// routed path's bend there once spat out a 175 deg hairpin. The curvature limit must
// keep it a smooth, followable course change.
console.log("\n=== transition (entrance-harbour buoy gap): no hairpin ===");
{
  const MARINA = {lat:42.137132, lon:-80.087286};
  const MIDCHAN = {lat:42.1528, lon:-80.0771};        // a target IN the channel at the gap
  const leg = P.legPath(MARINA, MIDCHAN, ref, ko, buf);
  if(!leg){ check(false, "transition target routable"); }
  else {
    const kr = P.keepRight(P.gateProject([MARINA, ...leg], ref, ko, buf), ref, ko, buf);
    const e = kr.map(p => P.llEN(p.lat, p.lon, ref));
    let maxTurn = 0, prev = null;
    for(let i = 1; i < e.length; i++){
      const L = Math.hypot(e[i].e-e[i-1].e, e[i].n-e[i-1].n) || 1;
      const t = [(e[i].e-e[i-1].e)/L, (e[i].n-e[i-1].n)/L];
      if(prev) maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(prev[0]*t[1]-prev[1]*t[0], prev[0]*t[0]+prev[1]*t[1]))*180/Math.PI);
      prev = t;
    }
    let viol = 0; for(const s of e) if(P.blocked(s, ko, buf)) viol++;
    check(maxTurn <= 90, "no hairpin through the buoy gap (max heading step " + maxTurn.toFixed(0) + " deg, was 175)");
    check(viol === 0, "transition path crosses no nogo zone (" + viol + " blocked samples)");
  }
}

// Short local hops must NOT guess a direction off a couple of distant marks.
console.log("\n=== confidence guard: short hops near the marina ===");
for(const [tag, A, B] of [
  ["600 m hop", {lat:42.137083, lon:-80.087367}, {lat:42.1400, lon:-80.0850}],
  ["200 m hop", {lat:42.137083, lon:-80.087367}, {lat:42.1382, lon:-80.0880}]]){
  const leg = P.legPath(A, B, ref, ko, buf);
  if(!leg){ console.log("    (" + tag + " unroutable - skipped)"); continue; }
  P.keepRight(P.gateProject([A, ...leg], ref, ko, buf), ref, ko, buf);
  check(P.getBuoyage() === 0, tag + ": no buoyage claimed without enough marks along the route");
}

console.log("\n" + (failures ? failures + " CHECK(S) FAILED" : "all checks passed"));
process.exit(failures ? 1 : 0);
