// static/js/units.js — the DISPLAY EDGE for distances and durations.
//
// THIS MODULE OWNS `distUnit`. It is the one piece of operator preference that a pure
// formatter needs, and keeping it here rather than in the shared state module is the whole
// point: the value and the only functions entitled to read it live in one file, so nothing
// else can drift from it. The page sets it through setDistUnit() and asks with distUnit().
//
// THE SCOPE DECISIONS BELOW ARE SETTLED - DO NOT WIDEN THEM. Canonical is METRES
// everywhere: vessel files, the mission store, the wire, every calculation. The operator's
// choice is applied HERE, at the display edge, exactly like the feet on chart tiles and the
// nm on the AIS card. SHORT distances (line spacing, buffers, draft, depths, the LINES
// table) always read in METRES - 25 m of spacing is 0.0135 nm, which is unusable - and the
// AIS card reads nm ALWAYS, because its contact list has never been anything else.
// fmtDist() is THE formatter for a long distance; a new readout that hand-rolls its own
// divide-by-1000 kilometre string beside it will not follow the pill.
// (tests/units_toggle.js checks none has crept back in.)

export const M_PER_NM = 1852;                  // one definition, shared with the AIS helpers

let _distUnit = "km";                          // module-private; reach it via the accessors

export function distUnit(){ return _distUnit; }
// Returns the normalised value actually adopted, so a caller does not have to re-derive it.
export function setDistUnit(u){
  _distUnit = (u === "nm") ? "nm" : "km";
  return _distUnit;
}

export function fmtDist(m, dp){
  if(m==null) return "--";
  if(m < 1000) return Math.round(m)+" m";      // short stays METRIC in both modes
  const d = dp==null ? 2 : dp;
  return _distUnit==="nm" ? (m/M_PER_NM).toFixed(d)+" nm" : (m/1000).toFixed(d)+" km";
}

// The AIS card's own range formatter: ALWAYS nautical miles, never the pill (see above).
export function fmtNm(m){ const nm=m/1852; return nm<10 ? nm.toFixed(1) : ""+Math.round(nm); }

// nm <-> km at the display edge. The WIRE stays in kilometres: /api/ais/radius still takes
// `km`, AIS_SHOW_RADIUS_KM and the --ais-radius-km / --ais-collect-km flags are unchanged,
// and every wire field is still named _km. That is why the flags keep their names.
export function nmFromKm(km){ return km * 1000 / M_PER_NM; }
export function kmFromNm(nm){ return nm * M_PER_NM / 1000; }
export function nmRound(km){ return Math.round(nmFromKm(km)); }  // whole nm, for a display field

// --- durations ------------------------------------------------------------------------
export function fmtETA(sec){ sec=Math.max(0,Math.round(sec)); const m=Math.floor(sec/60), s=sec%60;
  return m>0 ? m+"m "+String(s).padStart(2,"0")+"s" : s+"s"; }
export function fmtDur(sec){ sec=Math.max(0,Math.round(sec)); const h=Math.floor(sec/3600), m=Math.round((sec%3600)/60);
  return h>0 ? h+"h "+String(m).padStart(2,"0")+"m" : (m>0 ? m+"m" : "<1m"); }
export function fmtMS(s){ s=Math.max(0,Math.round(s)); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }

// --- position -------------------------------------------------------------------------
export function fmtLL(lat, lon){                 // decimal degrees (5 dp ≈ 1 m)
  const f=(v,pos,neg)=> `${Math.abs(v).toFixed(5)}° ${v>=0?pos:neg}`;
  return `${f(lat,'N','S')}  ${f(lon,'E','W')}`;
}
