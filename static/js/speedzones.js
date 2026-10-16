// static/js/speedzones.js - SPEED ZONES: the water where the law sets her speed (Andy, 2026-10-16: "for safe navigation
// and according to maritime law zone specific speed limits are imposed, such as no wake zones"; then "Try ingesting local
// data from state GIS portals and merge into the NOAA environment. Build a bounded area that overrides commanded speed
// and lowers to legal speed. this releases once the ASV is clear of the area and it returns to commanded speed").
//
// A ZONE is a GeoJSON feature the console serves with the chart (role "speed_zone": a state's no-wake / speed polygons,
// asv_console.py speed_zones) or reads off the chart itself (a restricted area whose text gives a speed - noaaZones):
//   props.rule      "limit" (a number of knots) | "no_wake" | "headway" | "idle" | "slow" | "restricted" (no number)
//   props.limit_kn  the limit in knots, or null - a rule with no number is flown at the hull's slowest
//   props.min_length_m  the rule binds only hulls this long or longer (NOAA's right whale areas: 19.8 m, 65 ft)
//   props.name, props.source, props.text  what the operator is told
// Pure, so the page's governor and tests/speed_zones.js run the same code. THE GOVERNOR ONLY EVER LOWERS with it:
// zoneDecision answers the speed the water allows, and the page commands the slower of that and what the job wants.

import { distTo, planeFrame } from "./geodesy.js";
import { ptInGeom, eachRing, eachPath, eachPoint, dSeg, pinp, bbOf, inBB } from "./geometry.js";

export const ZONE_SAMPLE_M = 5;          // the route ahead is tested every this many meters for the first zone on it
export const ZONE_ENTRY_MARGIN_M = 20;   // and the slower speed is commanded this much before her slow-down needs it
export const ZONE_RELEASE_MIN_M = 10;    // she is CLEAR when outside every zone by her length - and never less than this
const KN = 0.514444;
const QUALITATIVE = { no_wake: "no wake", headway: "headway speed", idle: "idle speed", slow: "slow speed",
                      restricted: "speed restricted" };

/** Does the zone bind this hull? {applies, why} - why says when it does not. */
export function zoneApplies(z, loaM){
  const p = (z && z.props) || {};
  if(p.min_length_m > 0 && loaM > 0 && loaM < p.min_length_m)
    return { applies: false, why: "it binds vessels " + Math.round(p.min_length_m * 10) / 10 + " m (" + Math.round(p.min_length_m / 0.3048)
                                  + " ft) and longer, and she is " + Math.round(loaM * 10) / 10 + " m" };
  return { applies: true, why: "" };
}

/** The rule in words: "5 kn", "no wake", "speed restricted". */
export function zoneRuleTxt(z){
  const p = (z && z.props) || {};
  if(p.rule === "limit" && p.limit_kn > 0) return (Math.round(p.limit_kn * 10) / 10) + " kn";
  return QUALITATIVE[p.rule] || "speed restricted";
}

/**
 * THE SPEED KEY A ZONE ALLOWS this hull (`speedsKn`: the vessel's key -> knots table): the FASTEST key at or under its
 * limit; a rule with no number ("no wake", "headway", "idle", "slow", "speed restricted") takes the hull's SLOWEST key -
 * the least wake she can make while still steering. {key, kn, below}: `below` when even her slowest is over the limit,
 * which the page says (the law asks for a speed she cannot make and keep steerage).
 */
export function zoneKey(z, speedsKn){
  // (of keys at the same speed - the DriX's "low" and "4" are both 4 kn - the whole knot, which the operator reads as "4 kn")
  const step = (k) => /^\d+$/.test(String(k));
  const keys = Object.keys(speedsKn || {}).filter((k) => Number.isFinite(speedsKn[k]) && speedsKn[k] > 0)
                                          .sort((a, b) => (speedsKn[a] - speedsKn[b]) || (step(b) - step(a)));
  if(!keys.length) return null;
  const p = (z && z.props) || {}, slowest = keys[0];
  if(!(p.rule === "limit" && p.limit_kn > 0)) return { key: slowest, kn: speedsKn[slowest], below: false };
  let best = null;
  for(const k of keys) if(speedsKn[k] <= p.limit_kn + 1e-9 && (best == null || speedsKn[k] > speedsKn[best])) best = k;
  return best ? { key: best, kn: speedsKn[best], below: false } : { key: slowest, kn: speedsKn[slowest], below: true };
}

export function inZone(pt, z){
  if(!pt || !z) return false;
  if(z.law){                                     // a state's law (lawZones): its water, its exemption, then its distance or area
    const q = z.law.frame.toEN(pt);
    if(!lawGate(z.law, q)) return false;
    if(z.law.within > 0) return shoreDistM(z.law.shore, q, z.law.within) < z.law.within;
  }
  return !!(z.geometry && ptInGeom(pt.lat, pt.lon, z.geometry));
}

/** Meters from `pt` to the zone's nearest edge (inside or out). A state's distance rule: how far she is from its line
 *  (her distance from shore less the rule's) - and Infinity out of its water or in its exemption, where she is released
 *  at once: being out by the law's own terms is clear, not a band to cross. */
export function zoneEdgeM(pt, z){
  if(!pt || !z) return Infinity;
  if(z.law){
    const q = z.law.frame.toEN(pt);
    if(!lawGate(z.law, q)) return Infinity;
    if(z.law.within > 0) return Math.abs(shoreDistM(z.law.shore, q, z.law.within + LAW_EDGE_REACH_M) - z.law.within);
  }
  if(!z.geometry) return Infinity;
  const fr = planeFrame(pt), p = { e: 0, n: 0 };
  let best = Infinity;
  eachRing(z.geometry, (rg) => {
    const ring = rg.map((c) => fr.toEN({ lat: c[1], lon: c[0] }));
    for(let i = 1; i < ring.length; i++) best = Math.min(best, dSeg(p, ring[i - 1], ring[i]));
  });
  return best;
}

/**
 * THE FIRST ZONE ON THE WAY AHEAD: `pts` her position then the route she flies from the waypoint she steers for,
 * walked every ZONE_SAMPLE_M up to `maxM` - {zone, d} for the first sample inside one of `zones`, or null.
 */
export function firstZoneAhead(pts, zones, maxM){
  if(!pts || pts.length < 2 || !zones || !zones.length || !(maxM > 0)) return null;
  let run = 0;
  for(let i = 1; i < pts.length; i++){
    const a = pts[i - 1], b = pts[i], L = distTo(a, b);
    const n = Math.max(1, Math.ceil(L / ZONE_SAMPLE_M));
    for(let j = 1; j <= n; j++){
      const d = run + L * j / n;
      if(d > maxM) return null;
      const q = { lat: a.lat + (b.lat - a.lat) * j / n, lon: a.lon + (b.lon - a.lon) * j / n };
      for(const z of zones) if(inZone(q, z)) return { zone: z, d };
    }
    run += L;
  }
  return null;
}

/**
 * WHAT THE WATER ALLOWS HER NOW - or null, where no zone binds her. Asked every frame by the page's governor.
 *   pos      her position; `ahead` the route she flies from the waypoint she steers for (may be empty)
 *   zones    every zone read for the water; `loaM` her length; `speedsKn` her key -> knots table
 *   leadM    how far before a zone the slower speed must be commanded for her to be AT it on the edge (the page's
 *            slow-down law plus the margin: zoneLeadM)
 *   held     the last answer (its zone's id), so a boundary ridden does not flap: she is CLEAR of a zone only once her
 *            position is outside it by her own length (ZONE_RELEASE_MIN_M at least) - and a zone she is slowing for stays
 *            AHEAD while her way still meets it, however short her slowing makes the lead
 * The answer is the most restrictive of the zones she is in, the zone she is still clearing, and the first zone ahead
 * within the lead: {key, kn, below, zone, where: "in" | "ahead" | "leaving", d}. Zones that do not bind her hull are
 * never an answer (`skipped` lists the ones she is in, for the page to say).
 */
export function zoneDecision({ pos, ahead, zones, loaM, speedsKn, leadM, held }){
  if(!pos || !zones || !zones.length) return null;
  const binding = [], skipped = [];
  for(const z of zones){ const a = zoneApplies(z, loaM); (a.applies ? binding : skipped).push(z); }
  const release = Math.max(ZONE_RELEASE_MIN_M, loaM || 0);
  const cands = [];
  for(const z of binding) if(inZone(pos, z)) cands.push({ zone: z, where: "in", d: 0 });
  const first = firstZoneAhead([pos, ...(ahead || [])], binding.filter((z) => !cands.some((c) => c.zone === z)), leadM);
  if(first) cands.push({ zone: first.zone, where: "ahead", d: first.d });
  // ... and the zone she is slowing for, KEPT while it is still on her way (within where it last was, and the margin)
  // until she reaches it - not dropped because her own slowing shortened the lead. Measured live 2026-10-16: an arrival
  // slowing her toward New Hampshire's shore band shrank the lead under the 20 m still to go, and the page said "Clear of
  // speed zone" of water she had not reached - and a zone that capped her would be let go and taken again, a flap.
  if(held && held.id != null && held.where === "ahead" && Number.isFinite(held.d)){
    const hz = binding.filter((z) => zoneId(z) === held.id && !cands.some((c) => c.zone === z));
    const again = hz.length ? firstZoneAhead([pos, ...(ahead || [])], hz, Math.max(leadM, held.d + ZONE_ENTRY_MARGIN_M)) : null;
    if(again) cands.push({ zone: again.zone, where: "ahead", d: again.d });
  }
  // ... and the zone she was held to, outside it but not yet clear by `release` - LEAVING only once she has been in it (a
  // zone she is still coming to is "ahead": measured live, the first cut said "leaving" for 3 s on the way in)
  if(held && held.id != null && held.where !== "ahead")
    for(const z of binding)
      if(zoneId(z) === held.id && !cands.some((c) => c.zone === z) && zoneEdgeM(pos, z) < release) cands.push({ zone: z, where: "leaving", d: 0 });
  let best = null;
  for(const c of cands){
    const k = zoneKey(c.zone, speedsKn);
    if(!k) continue;
    if(!best || k.kn < best.kn || (k.kn === best.kn && c.where === "in" && best.where !== "in")) best = { ...k, ...c };
  }
  if(best) best.skipped = skipped.filter((z) => inZone(pos, z));
  return best || (skipped.some((z) => inZone(pos, z)) ? { key: null, skipped: skipped.filter((z) => inZone(pos, z)) } : null);
}

/** A zone's identity: its source's id, else its name and source. */
export function zoneId(z){ const p = (z && z.props) || {}; return p.zone_id || ((p.source || "") + "|" + (p.name || "") + "|" + (p.text || "")); }

/**
 * HOW FAR AHEAD OF A ZONE THE SLOWER SPEED IS COMMANDED, m: the slow-down she needs from `vMs` to `zoneMs` (`slowM`,
 * the page's in-gear law - coast.js slowLeadM - or 0 for a hull that sheds speed on the engine's ramp), plus the
 * command's own latency at her speed, plus ZONE_ENTRY_MARGIN_M - so she is AT the zone's speed on its edge, not
 * reaching for it inside.
 */
export function zoneLeadM(vMs, slowM, latencyS){
  return Math.max(0, slowM || 0) + Math.max(0, vMs || 0) * Math.max(0, latencyS || 0) + ZONE_ENTRY_MARGIN_M;
}

// ── NOAA's own: a restricted area whose text gives a speed (the chart's only encoding of one) ───────────────────────────
// Measured 2026-10-16 over ENCDirect's harbour band: ~330 areas US-wide carry a speed in INFORM - nearly all the right
// whale Seasonal Management Areas ("All vessels greater than or equal to 65ft/19.8m in length must slow to speeds of 10
// knots or less"), a few regulated areas ("speed restricted, 5 knot speed limit"; "Regulated area;Speed restricted").
// The chart has a "no wake area" category (CATREA 24) and ENCDirect publishes it on no area in the US.
// ⚠ A REGULATED AREA THE CHART NAMES ONLY BY ITS CITATION. 33 CFR 165.101, Kittery, Maine - the water off the Naval
// Shipyard beside New Castle - is in the harbour chart as a restricted area whose text is "Regulated navigation area, 33
// CFR 165.101: Navigation regulations are published in Chapter 2 of the U.S. Coast Pilot", no category, no number; the
// regulation itself says "(b) No vessel may operate in this area at a speed in excess of five miles per hour" (eCFR, read
// 2026-10-16). A citation listed here is read as its rule; the text of one that is not is read as it is.
export const CFR_SPEED = {
  "33 CFR 165.101": { rule: "limit", limit_kn: Math.round(5 / 1.15078 * 10) / 10,
                      text: "33 CFR 165.101(b): no vessel may operate in this area at a speed in excess of five miles per hour" },
};
/** The speed rule in a chart text, or null: {rule, limit_kn, min_length_m}. */
export function parseSpeedText(text){
  const t = String(text || "");
  if(!t) return null;
  const up = t.toUpperCase();
  for(const cite of Object.keys(CFR_SPEED)){
    const m = /^(\d+)\s+CFR\s+([\d.]+)$/.exec(cite);
    if(m && new RegExp("\\b" + m[1] + "\\s*CFR\\s*" + m[2].replace(/\./g, "\\.") + "(?![\\d.]*\\d)").test(up))
      return { rule: CFR_SPEED[cite].rule, limit_kn: CFR_SPEED[cite].limit_kn, cfr: cite };
  }
  const kn = /(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:KNOTS?|KTS?|KN)\b/.exec(up);
  const mph = /(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:MPH|MILES PER HOUR)\b/.exec(up);
  const wake = /\bNO[\s-]*WAKE\b/.test(up), headway = /\bHEADWAY\b/.test(up), idle = /\bIDLE\b/.test(up);
  const restricted = /\bSPEED\s+(RESTRICT|LIMIT)/.test(up) || /\bSLOW\b/.test(up);
  const len = /(\d+(?:\.\d+)?)\s*(?:FT|FEET|FOOT)\b[^.]{0,40}?(?:IN LENGTH|LONG)|(?:LENGTH|LONG)[^.]{0,20}?(\d+(?:\.\d+)?)\s*(?:FT|FEET)/.exec(up);
  const lenM = /(\d+(?:\.\d+)?)\s*(?:M|METRES|METERS)\b[^.]{0,10}?(?:IN LENGTH|\/)|\/\s*(\d+(?:\.\d+)?)\s*(?:M|METRES|METERS)\b/.exec(up);
  let out = null;
  if(kn && (restricted || /SPEEDS? OF|SPEED LIMIT|NOT EXCEED|OR LESS/.test(up))) out = { rule: "limit", limit_kn: +kn[1] };
  else if(mph && (restricted || /SPEED|NOT EXCEED|OR LESS/.test(up))) out = { rule: "limit", limit_kn: Math.round(+mph[1] / 1.15078 * 10) / 10 };
  else if(wake) out = { rule: "no_wake", limit_kn: null };
  else if(idle) out = { rule: "idle", limit_kn: null };
  else if(headway) out = { rule: "headway", limit_kn: null };
  else if(restricted) out = { rule: "restricted", limit_kn: null };
  if(!out) return null;
  const m = lenM ? +(lenM[1] || lenM[2]) : (len ? +(len[1] || len[2]) * 0.3048 : 0);
  if(m > 0 && /GREATER THAN OR EQUAL|OR (?:MORE|LONGER|GREATER)|AND OVER|AND LONGER|≥/.test(up)) out.min_length_m = Math.round(m * 10) / 10;
  return out;
}
/** The chart's own speed zones: its restricted areas whose text gives a speed rule, as zones. */
export function noaaZones(features){
  const out = [];
  for(const f of features || []){
    if(f.role !== "restricted" || !f.geometry) continue;
    const pr = f.props || {};
    const r = parseSpeedText(pr.INFORM);
    if(!r) continue;
    const text = r.cfr ? CFR_SPEED[r.cfr].text : String(pr.INFORM || "").slice(0, 300);
    out.push({ role: "speed_zone", geometry: f.geometry,
               props: { ...r, name: pr.OBJNAM || (r.cfr ? r.cfr + " regulated area" : "a charted regulated area"), source: "NOAA ENC", text,
                        zone_id: "noaa|" + (pr.OBJNAM || "") + "|" + String(pr.INFORM || "").slice(0, 80) } });
  }
  return out;
}
// ── THE STATES' SHORE-DISTANCE RULES (Andy, 2026-10-16: "model the NH and ME shore distance rules") ─────────────────────
// Neither state publishes its speed rules as GIS; the law is a distance, read here from the chart's OWN shore:
//   NEW HAMPSHIRE, RSA 270-D:2 VI(a): "all vessels shall maintain headway speed when within 150 feet from ... (3) Shore.
//     (4) Docks." VI(b)(2): not "in the federal deepwater shipping channel of the Piscataqua River between navigation
//     buoys R2, Wood Island at the mouth of the river and R12, opposite the Sprague Terminal". And I: "headway speed only,
//     while passing under all bridges". Headway speed (270-D:1 VI): "the slowest speed that a boat can be operated and
//     maintain steerage way" - the hull's slowest speed (zoneKey), floored where the set needs more (the page's
//     makesWayKey).
//   MAINE, 12 MRSA 13068-A(13)(A): no "greater than headway speed while within the water safety zone"; 13001(29): "the
//     area of water within 200 feet of shoreline, whether the shoreline of the mainland or of an island".
// Which state's water she is in is the Census boundary served with the chart (role "state_water", asv_console.py /
// speed_zones.py state_waters_for_bbox). THE SHORE is the chart's land, islets and coastline (and, in New Hampshire, its
// shoreline constructions - docks, piers, wharves). THE EXEMPTION is the channel the chart draws between the two buoys: the
// fairway named "Piscataqua River Channel" and the deep dredged reaches (8 m and more) - not the shallow side channels;
// where the chart draws no channel, the 150 ft rule stands (the safe side).
// NOT MODELED, and said where it is read: NH's rafts, swimmers, swimming areas, mooring fields and other vessels; ME's
// marinas and approved anchorages - the chart does not say where they are.
// ⚠ IN THEIR WATER THAT NO BOUNDARY READ CLAIMS (the Census service down and no old copy, for one state or both) the
// STRICTER rule - 200 ft of any shore, docks included, no exemption - and the bridges: safety before efficiency.
export const NH_SHORE_M = 150 * 0.3048;           // 45.72 m
export const ME_SHORE_M = 200 * 0.3048;           // 60.96 m
export const LAW_REGION = [-71.6, 42.69, -66.9, 47.5];   // New Hampshire's and Maine's water, roughly (speed_zones.py too)
export const PISCATAQUA_R2 = { lat: 43.06106, lon: -70.70118 };   // Wood Island Lighted Buoy 2 (the chart, 2026-10-16)
export const PISCATAQUA_R12 = { lat: 43.11986, lon: -70.81059 };  // Piscataqua River Buoy 12, opposite Sprague Terminal
const SHORE_ROLES = ["land", "land_point", "land_line", "shore_line"];
const DOCK_ROLES = ["dock", "dock_line"];
const SHORE_CELL_M = 50;
const SHORE_STEP_M = SHORE_CELL_M / 2;
const LAW_EDGE_REACH_M = 40;                       // how far past a rule's line her distance from shore is still measured
const EXEMPT_CORRIDOR_M = 1500;                    // a channel piece counts as between R2 and R12 within this of their line
const cellKey = (cx, cy) => (cx + 32768) * 65536 + (cy + 32768);   // a number, not a string: 1,600 km each way of the middle

/**
 * THE SHORE, for distance: every edge of the features with `roles` in the frame's plane (a point as an edge of no
 * length) - {xy, grid, n}: edge i is xy[4i..4i+3] (east, north of each end), and the grid lists it in SHORE_CELL_M cells.
 * An edge is walked every SHORE_STEP_M and listed in the cell of each step - its own band of cells, not its box - so the
 * build is one pass. Measured 2026-10-16: the New Castle chart ~98,000 edges, a 0.7 x 0.45 deg read ~181,000.
 */
export function shoreModel(features, roles, frame){
  const xy = [], grid = new Map();
  const put = (e, n, idx) => {
    const k = cellKey(Math.floor(e / SHORE_CELL_M), Math.floor(n / SHORE_CELL_M));
    const l = grid.get(k);
    if(!l) grid.set(k, [idx]); else if(l[l.length - 1] !== idx) l.push(idx);
  };
  const add = (ae, an, be, bn) => {
    const idx = xy.length / 4;
    xy.push(ae, an, be, bn);
    const n = Math.max(1, Math.ceil(Math.hypot(be - ae, bn - an) / SHORE_STEP_M));
    for(let j = 0; j <= n; j++) put(ae + (be - ae) * j / n, an + (bn - an) * j / n, idx);
  };
  const addLine = (cs) => {
    let a = null;
    for(const c of cs){ const b = frame.toEN({ lat: c[1], lon: c[0] }); if(a) add(a.e, a.n, b.e, b.n); a = b; }
  };
  for(const f of features || []){
    if(!roles.includes(f.role) || !f.geometry) continue;
    eachRing(f.geometry, addLine);
    eachPath(f.geometry, addLine);
    eachPoint(f.geometry, (c) => { const p = frame.toEN({ lat: c[1], lon: c[0] }); add(p.e, p.n, p.e, p.n); });
  }
  return { xy: Float64Array.from(xy), grid, n: xy.length / 4 };
}
/**
 * Meters from `q` (in the models' plane) to the nearest shore of `models` (one, or a list), if within `maxM` - else
 * Infinity. Every point of an edge is within half a step of one of its steps, so the cells within maxM + half a step of q
 * hold every edge that close.
 */
export function shoreDistM(models, q, maxM){
  if(!(maxM > 0)) return Infinity;
  const r = maxM + SHORE_STEP_M / 2;
  let best = Infinity;
  for(const m of Array.isArray(models) ? models : [models]){
    if(!m || !m.n) continue;
    const xy = m.xy;
    for(let cx = Math.floor((q.e - r) / SHORE_CELL_M); cx <= Math.floor((q.e + r) / SHORE_CELL_M); cx++)
      for(let cy = Math.floor((q.n - r) / SHORE_CELL_M); cy <= Math.floor((q.n + r) / SHORE_CELL_M); cy++){
        const l = m.grid.get(cellKey(cx, cy));
        if(!l) continue;
        for(const i of l){
          const ae = xy[4 * i], an = xy[4 * i + 1], dx = xy[4 * i + 2] - ae, dy = xy[4 * i + 3] - an;
          let t = ((q.e - ae) * dx + (q.n - an) * dy) / (dx * dx + dy * dy || 1);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(q.e - (ae + t * dx), q.n - (an + t * dy));
          if(d < best) best = d;
        }
      }
  }
  return best <= maxM ? best : Infinity;
}
/** Is `q` (the plane) in the law's water and not in its exemption? */
function lawGate(law, q){
  if(law.region && !inBB(q, law.region, 0)) return false;
  if(law.state && !law.state.some((r) => inBB(q, r.bb, 0) && pinp(q, r.ring))) return false;
  if(law.notIn && law.notIn.some((r) => inBB(q, r.bb, 0) && pinp(q, r.ring))) return false;
  if(law.exempt && law.exempt.some((r) => inBB(q, r.bb, 0) && pinp(q, r.ring))) return false;
  return true;
}
const ringsEN = (geom, frame) => {
  const out = [];
  eachRing(geom, (rg) => { const ring = rg.map((c) => frame.toEN({ lat: c[1], lon: c[0] })); if(ring.length > 2) out.push({ ring, bb: bbOf(ring) }); });
  return out;
};
/** The channel pieces New Hampshire exempts: the charted federal channel between R2 and R12 (see above). */
export function piscataquaExempt(features, frame){
  const a = frame.toEN(PISCATAQUA_R2), b = frame.toEN(PISCATAQUA_R12);
  const L2 = (b.e - a.e) ** 2 + (b.n - a.n) ** 2;
  const out = [];
  for(const f of features || []){
    if(!f.geometry) continue;
    const p = f.props || {};
    const isChannel = (f.role === "fairway" && /piscataqua river channel/i.test(p.OBJNAM || ""))
                   || (f.role === "dredged" && +p.DRVAL1 >= 8);
    if(!isChannel) continue;
    const rings = ringsEN(f.geometry, frame);
    if(!rings.length) continue;
    const bb = rings[0].bb, m = { e: (bb.x0 + bb.x1) / 2, n: (bb.y0 + bb.y1) / 2 };
    const t = L2 > 0 ? ((m.e - a.e) * (b.e - a.e) + (m.n - a.n) * (b.n - a.n)) / L2 : -1;
    const off = dSeg(m, a, b);
    if(t >= -0.02 && t <= 1.02 && off <= EXEMPT_CORRIDOR_M) out.push(...rings);
  }
  return out;
}
/**
 * THE ZONES NEW HAMPSHIRE'S AND MAINE'S LAW MAKES OF THE CHART: each state's shore-distance rule in its own water and New
 * Hampshire's bridges - and, in their water that no boundary read says is one state's or the other's (the Census service
 * down and no old copy: speed_zones.py names the state `unread`), the STRICTER rule and the bridges. [] for a chart
 * nowhere near them. Zones as the rest are ({role, props}), with `law` for inZone / zoneEdgeM and the page's drawing:
 * {frame, within (m, a distance rule), shore (its models), roles (its features' roles), state / notIn (the water it
 * holds in / not in, rings in the plane), exempt (rings), region (a plane box)}.
 */
export function lawZones(features){
  const f = features || [];
  const states = f.filter((x) => x.role === "state_water" && x.geometry && x.props && x.props.state);
  // the chart's shore: its middle for the plane, its box for "is any of this their water"
  let s0 = 90, n0 = -90, w0 = 180, e0 = -180;
  for(const x of f){ if(!SHORE_ROLES.includes(x.role) || !x.geometry) continue;
    const scan = (c) => { if(c[1] < s0) s0 = c[1]; if(c[1] > n0) n0 = c[1]; if(c[0] < w0) w0 = c[0]; if(c[0] > e0) e0 = c[0]; };
    eachRing(x.geometry, (r) => r.forEach(scan)); eachPath(x.geometry, (r) => r.forEach(scan)); eachPoint(x.geometry, scan); }
  if(s0 > n0) return [];                            // no shore on the chart: no shore rule
  const mid = { lat: (s0 + n0) / 2, lon: (w0 + e0) / 2 };
  const touches = e0 >= LAW_REGION[0] && w0 <= LAW_REGION[2] && n0 >= LAW_REGION[1] && s0 <= LAW_REGION[3];
  if(!states.length && !touches) return [];
  const frame = planeFrame(mid);
  const shore = shoreModel(f, SHORE_ROLES, frame), docks = shoreModel(f, DOCK_ROLES, frame);   // shared by every rule
  const zone = (id, name, source, text, law, geometry) => ({ role: "speed_zone", geometry: geometry || null, law,
    props: { rule: "headway", limit_kn: null, name, source, text, zone_id: "law|" + id } });
  const stateRings = (st) => states.filter((x) => x.props.state === st).flatMap((x) => ringsEN(x.geometry, frame));
  const nh = stateRings("NH"), me = stateRings("ME"), out = [];
  const unread = !states.length || states.some((x) => (x.props.unread || []).length);
  // New Hampshire's bridges under `law`'s gate: the chart's bridge areas with any of their span in that water (a bridge
  // drawn only as a line has no water under it to test) - not exempted in the channel: the exemption is VI's, bridges I
  const bridges = (law, tag, why) => {
    for(const b of f){
      if(b.role !== "bridge_span" || !b.geometry || (b.geometry.type !== "Polygon" && b.geometry.type !== "MultiPolygon")) continue;
      const rings = ringsEN(b.geometry, frame);
      if(!rings.some((r) => r.ring.some((q) => lawGate(law, q)))) continue;
      const nm = (b.props && b.props.OBJNAM) || "", bb = rings[0].bb, c = frame.fromEN((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
      out.push(zone(tag + "|bridge|" + (nm || c.lat.toFixed(5) + "," + c.lon.toFixed(5)), why + "under a bridge" + (nm ? " (" + nm + ")" : ""),
        "NH RSA 270-D:2 I", "New Hampshire: headway speed only while passing under all bridges", law, b.geometry));
    }
  };
  if(nh.length){
    out.push(zone("NH|shore", "New Hampshire, within 150 ft of shore or a dock", "NH RSA 270-D:2 VI",
      "New Hampshire: headway speed within 150 feet of shore and docks - not in the federal deepwater channel of the "
      + "Piscataqua between R2 (Wood Island) and R12 (opposite Sprague Terminal)",
      { frame, within: NH_SHORE_M, state: nh, exempt: piscataquaExempt(f, frame), shore: [shore, docks], roles: [...SHORE_ROLES, ...DOCK_ROLES] }));
    bridges({ frame, state: nh }, "NH", "New Hampshire, ");
  }
  if(me.length)
    out.push(zone("ME|shore", "Maine's water safety zone, within 200 ft of shore", "ME 12 MRSA 13068-A(13)",
      "Maine: no greater than headway speed within 200 feet of the shoreline of the mainland or of an island",
      { frame, within: ME_SHORE_M, state: me, shore: [shore], roles: SHORE_ROLES }));
  if(unread){                                       // their water no boundary read claims: the stricter of the two rules
    const region = bbOf([frame.toEN({ lat: LAW_REGION[1], lon: LAW_REGION[0] }), frame.toEN({ lat: LAW_REGION[3], lon: LAW_REGION[2] })]);
    const notIn = [...nh, ...me], why = "the state line could not be read: ";
    out.push(zone("NHME|unread", "within 200 ft of shore or a dock (" + why.replace(": ", "") + ")", "NH / ME law",
      "Maine's 200 ft water safety zone, the stricter of the two states' shore rules, applied with docks and no exemption, "
      + "because which state's water she is in could not be read", { frame, within: ME_SHORE_M, region, notIn, shore: [shore, docks], roles: [...SHORE_ROLES, ...DOCK_ROLES] }));
    bridges({ frame, region, notIn }, "NHME", why);
  }
  return out;
}
export { KN as ZONE_KN_MS };
