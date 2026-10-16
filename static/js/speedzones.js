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
import { ptInGeom, eachRing, dSeg } from "./geometry.js";

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

export function inZone(pt, z){ return !!(pt && z && z.geometry && ptInGeom(pt.lat, pt.lon, z.geometry)); }

/** Meters from `pt` to the zone's nearest edge (inside or out). */
export function zoneEdgeM(pt, z){
  if(!pt || !z || !z.geometry) return Infinity;
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
 *            position is outside it by her own length (ZONE_RELEASE_MIN_M at least)
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
export { KN as ZONE_KN_MS };
