// tests/planner_guard_seam.js - THE PLANNER AND THE GUARD AGREE ABOUT ONE NUMBER.
//
// Andy, 2026-09-19, item 3 of four: *"The planner/guard seam - one of the two numbers has
// to move, and the guard's is the arbitrary one: a weather reading times a fixed 45
// seconds."* The guard's moved first (tests/in_extremis.js 5-6b). Asked what to do about
// the rest, with the measurements below in front of him, he chose the second option on
// offer: **make the planner clip to what the guard needs.**
//
// WHAT THE SEAM WAS, measured on his own plans and his own recordings before any of this:
//
//   * the planner clipped to the buffer to within THREE CENTIMETRES - a 5.03 m minimum
//     waypoint clearance against a 5 m buffer on the Honolulu plan, zero waypoints inside
//     it anywhere;
//   * the guard judged the boat against a band reaching far further, so 398 of that plan's
//     415 waypoints (96%) sat inside the old helm band, and 189 (46%) inside the new one;
//   * and it is NOT the boat's tracking that eats the margin, which is the obvious reading
//     and is wrong. Over 19,128 running frames in 18 upload windows - each cut at any
//     escape / hold / RTH / Go-To, because every one of those REPLACES the route - the boat
//     is 0.03 m from its commanded route at the median, 0.09 m at p90 and 0.30 m at p95.
//     It holds the line. (A first cut that did NOT cut at those commands measured a 98 m
//     "tracking error", which was the escape legs: the boat deliberately somewhere else.)
//
// So the gap is not error, it is a question the planner never asked. A survey line 5 m off
// a pier is legal by construction however hard the water is setting onto it.
//
//   node tests/planner_guard_seam.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE CONTRACT THIS FILE HOLDS:
//   1. the standoff is DERIVED from the guard's own two constants, never a third copy;
//   2. calm water plans exactly as it always did - the buffer, to the meter;
//   3. a point at the standoff is NOT in extremis, and a point inside it IS. That is the
//      whole point of the number, and it is the check that ties the two modules together;
//   4. punchOut clips at it, and its memo key names it, so a set change cannot be served a
//      clip taken in a different one;
//   5. it is SAID on the card when it costs coverage.
//
// ⚠ AND IT IS NOT A PROMISE ABOUT THE WHOLE PLAN, which check 7 states so that a reader
// does not take it for one. It is applied to the COVERAGE LINES, THE LEADS AND THE TURNS -
// the turns since 2026-09-26, when his 09:38 New Castle record showed the promise "not on a
// line" kept and the boat escaped from the turn at the end of it (7, 7b). Transits go where
// the router sends them at the operator's plain buffer, and the guard is what covers them -
// which is what it is for.
//
// TEETH (recorded 2026-09-19; each mutation applied to a sidecar, the suite and the four
// punch/guard suites re-run, source restored and verified byte-identical after each):
//   guardStandoffM returns the bare buffer (the seam reopened)      -> 1, 3
//   guardStandoffM drops the buffer FLOOR (calm water narrows)      -> 1, 2
//   the standoff keyed to the full look-ahead again                 -> 1, 4
//   punchOut clips at `buffer` again                                -> 5
//   the clip standoff dropped from the memo key                     -> 5b
//   patClipBufM re-derives instead of asking the guard              -> 6
//   the card stops saying the clip widened                          -> 8
//
// ⚠ THESE ARE WHAT THE RUN PRINTED, not what was predicted for it - the first draft of
// this list had the first two lines as "-> 3, 4" and "-> 2" and both were wrong. Check 1
// catches every change to the FORMULA, which is why it appears three times; 3 and 4 are the
// two that catch a change to the MEANING, and 4 only fires because it tests the inside of
// the boundary as well as the outside.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");
const G = require("../static/js/guard.js");
const { bbOf } = require("../static/js/geometry.js");

const H = fs.readFileSync(process.env.ASV_HTML ||
                          path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  // A detail may be a function of what the check measured, CALLED here - 7f's printed its own source text for a
  // day, so its line never showed a number (2026-09-28).
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "the detail threw " + (e && e.message ? e.message : e); } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}
const kn = (x) => x * 0.514444;

console.log("The planner/guard seam - one number, owned by the guard, honoured by the planner:");

// ── 1. DERIVED, NOT DECIDED ─────────────────────────────────────────────────────────
check("1. the standoff is the guard's own two constants, not a third number",
      () => {
        for (const b of [3, 5, 20]) for (const s of [0, 0.3, 0.9, 1.5]) {
          const want = Math.max(b, b * G.HELM_ENTRY_FRAC + G.HELM_S * s);
          if (Math.abs(G.guardStandoffM(b, s) - want) > 1e-9) return false;
        }
        return true;
      },
      "guardStandoffM(buf, drift) = max(buf, buf*" + G.HELM_ENTRY_FRAC + " + " + G.HELM_S
        + "*drift) over 12 combinations - so moving HELM_S or HELM_ENTRY_FRAC moves the "
        + "planner with it, which is the whole point of it living in the guard");

// ── 2. CALM WATER IS UNCHANGED ──────────────────────────────────────────────────────
// The floor matters more than the formula: a console that has never seen a weather reading
// must plan exactly as it did before this existed, or the feature is a silent regression
// on every plan anyone has ever made.
check("2. with no set it is the operator's buffer, to the meter",
      () => [3, 5, 20, 0].every((b) => G.guardStandoffM(b, 0) === b)
            && G.guardStandoffM(5, undefined) === 5 && G.guardStandoffM(5, null) === 5,
      "0, null and undefined drift all give the buffer back unchanged (3->"
        + G.guardStandoffM(3, 0) + ", 5->" + G.guardStandoffM(5, 0) + ", 20->"
        + G.guardStandoffM(20, 0) + "). An absent weather reading may not narrow a survey");

// ── 3-4. THE TIE BETWEEN THE TWO MODULES ────────────────────────────────────────────
// A wall lying east-west; the boat sits south of it, stopped in the water and set onto it.
// `assess` is the REAL one, so this is the planner's number measured against the rung it
// exists to stay clear of.
const wall = (n0) => { const r = [{e:-4000,n:n0},{e:4000,n:n0},{e:4000,n:n0+300},{e:-4000,n:n0+300}];
  return { polys:[{ring:r, bb:bbOf(r), kind:"a dock / pier"}], lines:[], points:[], marks:[] }; };
const atRange = (m, buf, setKn) => {
  const drift = { e: 0, n: kn(setKn) };                 // setting NORTH, onto the wall
  const vel = { e: kn(3.0), n: kn(setKn) };             // 3 kn along it, way on, so canStop
  return G.assess({e:0,n:0}, vel, drift, wall(m), buf, { edge:false });
};
check("3. a line clipped AT the standoff is not in extremis, in the set it was clipped for",
      () => [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].every(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return atRange(d + 0.05, buf, s).level !== "helm";
      }),
      [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].map(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return buf + "m/" + s + "kn -> " + d.toFixed(1) + "m: " + atRange(d + 0.05, buf, s).level;
      }).join("  "));
// ⚠ PAIRED WITH ITS OPPOSITE, or "never in extremis anywhere" would pass check 3.
check("4. ... and a line INSIDE it is - so the number is the boundary, not a safe-looking margin",
      () => [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].every(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return atRange(d - 0.5, buf, s).level === "helm";
      }),
      [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].map(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return buf + "m/" + s + "kn -> " + (d - 0.5).toFixed(1) + "m: " + atRange(d - 0.5, buf, s).level;
      }).join("  "));

// ── 5-6. THE PLANNER ACTUALLY USES IT ───────────────────────────────────────────────
check("5. punchOut clips the coverage at the standoff, not at the bare buffer",
      () => /clipLine\(l\[0\],l\[1\],ref,koClip,clipBuf\)/.test(H)
            && /const clipBuf = patClipBufM\(\);/.test(H),
      "the clip call reads `clipBuf`, and `clipBuf` is patClipBufM() - the bare `buffer` "
        + "there is what made a 5 m plan legal in a 2 kn set");
// ⚠ 5b MOVED WITH THE MECHANISM (2026-09-22), AND IT IS THE SAME PROPERTY. It used to read
// "patStrikeKey() includes patClipBufM()". That was true, and it was the bug: the set is
// published rounded to 2 dp at 4 Hz and moves with the gusts, so over one 150 s capture the
// standoff ran 6.20-6.62 m at a 5 m buffer - FIVE distinct key terms, the strike key changing
// four times in six seconds - and every change silently discarded every run the operator had
// struck off. The standoff belongs to the CLIP, which must not be reused across a set change,
// and not to the STRIKE, which only asks whether the run the operator clicked still exists.
// Asserted three ways: the memo key names it, the strike key does NOT, and the memo key is
// DERIVED from the strike key so the two cannot come to name different inputs.
check("5b. ... and the CLIP MEMO names it while the STRIKE key does not - a set change "
      + "cannot be served a stale clip, and a gust cannot throw away a strike",
      () => {
        const si = H.indexOf("function patStrikeKey(){");
        const strike = H.slice(si, H.indexOf("\n}", si));
        const ci = H.indexOf("function patClipKey(){");
        const clip = H.slice(ci, H.indexOf("\n", ci));
        return /patClipBufM\(\)\.toFixed\(/.test(clip)
            && !/patClipBufM\(/.test(strike)
            && /patStrikeKey\(\)/.test(clip)
            && /const clipKey = patClipKey\(\);/.test(H);
      },
      "the memo reads patClipKey(), which is patStrikeKey() plus the standoff. Without the "
        + "standoff, two punches at the same buffer in different sets share one memo and the "
        + "second gets the first's runs; WITH it in the strike key, a gust discards the "
        + "operator's strikes every couple of seconds");
check("6. the page READS the guard's function rather than re-deriving it",
      () => {
        const i = H.indexOf("function patClipBufM(){");
        const body = H.slice(i, H.indexOf("\n}", i));
        // the body may CALL it, and must not arithmetic its way to the same answer...
        const derives = body.indexOf('guardStandoffM(') >= 0;
        const reDerives = body.indexOf('HELM_ENTRY_FRAC') >= 0
                          || body.indexOf(String(G.HELM_S) + ' *') >= 0
                          || body.indexOf('* 0.5') >= 0
                          || body.indexOf('*0.5') >= 0;
        // ...and the name must come from the GUARD's module, not a local of the same name.
        const k = H.indexOf('guardStandoffM');
        const imported = k >= 0 && H.slice(k, k + 260).indexOf('/static/js/guard.js') >= 0;
        return derives && !reDerives && imported;
      },
      "patClipBufM calls guardStandoffM and does no arithmetic of its own. Two numbers meant "
        + "to agree, kept in two files, IS the seam - re-deriving it here would reopen it the "
        + "first time either constant moved");

// ── 7. WHAT IT PROMISES, AND WHAT IT DOES NOT ────────────────────────────────────────────
// Stated as a check so nobody reads the feature as more or less than it is. Since 2026-09-26
// the LEADS and the TURNS are judged at the standoff too. MEASURED on his 09:38 New Castle
// plans against the real extract: 91 of 207 turn legs sat inside the 19.5 m the guard demanded
// at the 1.75 kn set, and a fly-through of the uploaded route at that set read helm 115 times
// in the turns against 28 on the lines - a line clipped at the standoff whose reversal loops
// outboard to the buffer is the helm rung waiting at every shoreward end. Transits still go
// where the router sends them at the operator's plain buffer, and the guard covers them.
check("7. lines, leads and turns take the standoff; hops and transits try it first and fall back to the buffer, said",
      () => /extendLead\(seg\[0\], seg\[1\], wantIn,\s*ref, koTurn, clipBuf\)/.test(H)
            && /extendLead\(seg\[1\], seg\[0\], wantOut, ref, koTurn, clipBuf\)/.test(H)
            && /turnWithRetry\(Ap, Bp, hE, hF, ref, koTurn, clipBuf, minTurnR/.test(H)
            && (H.match(/turnWithRetry\(sK\[1\], sK1\[0\], hE, hF, ref, koTurn, clipBuf,/g) || []).length === 2
            && (H.match(/ref, koTurn, clipBuf, fly\);/g) || []).length === 3
            && /firstBlockAlong\(t\.seg\[0\], t\.seg\[1\], ref, koTurn, clipBuf\)/.test(H)
            && !/koTurn, buffer, fly\)/.test(H)
            // the hops (2026-09-26, the live check): the standoff first, the buffer as the fallback, counted
            && /legSafeAt\(Ap,Bp,clipBuf\)/.test(H)
            && /routeAround\(Ap,Bp,ref,koHere,clipBuf\)/.test(H)
            && /routeAround\(Ap,Bp,ref,koHere,buffer\)/.test(H)
            && /nHopInside\+\+/.test(H) && /hop\(s\) inside the \$\{clipBuf\.toFixed\(1\)\} m standoff/.test(H)
            // and the transits the page routes itself: the approach, RTH, Go-To, the transit line - and,
            // since 2026-09-26 (the fifth planNogoRoute site), the resume-from-here way in (resumeFromHere);
            // since 2026-09-27 (the sixth), the running plan's way round a contact (aisAroundRunning).
            // Three of the six hand the router the charted model PLUS the contacts (koIn, 2026-09-27): the
            // resume from a chosen point, the held resume's way in (which the way round a contact rides), and
            // the running plan's way round - and those three are FLY-THROUGH targets (flyThrough: true, 7e):
            // a rejoin point is passed through, never held in, so it takes the buffer and not a berth's margin.
            && (H.match(/routePlan\(\{lat:asv\.lat, lon:asv\.lon\}, wps, false, patClipBufM\(\)\)/g) || []).length === 2
            && /routePlan\(\{lat:asv\.lat,lon:asv\.lon\}, line, true, patClipBufM\(\)\)/.test(H)
            && (H.match(/\{\.\.\.holdOpts\(\), standoffM: patClipBufM\(\)\}/g) || []).length === 2
            // the SEVENTH (2026-09-29): the routed re-approach onto station hands the router the charted model PLUS
            // the contacts, as the disc it answers now counts them (holdClearAt) - and it is NOT a fly-through: its
            // target is the hold point she is going back to hold in, so a berth's margin is the right one
            && /planNogoRoute\(\{lat:asv\.lat,lon:asv\.lon\}, \{lat:st\.hold\.lat, lon:st\.hold\.lon\},\s*\{\.\.\.holdOpts\(\), standoffM: patClipBufM\(\), ko: koWithAis\(\) \|\| nogo\.ko\}\)/.test(H)
            // the EIGHTH (2026-09-29): a held Go-To / RTH / transit's way in (resumeHeldLeg) - the leg's way round and
            // its return ride it - with the contacts in the model and a fly-through target, as the held survey's is
            && (H.match(/\{\.\.\.holdOpts\(\), standoffM: patClipBufM\(\), ko: koIn, flyThrough: true\}/g) || []).length === 4
            && /planNogoRoute\(from, tail\[0\], \{\.\.\.holdOpts\(\), standoffM: patClipBufM\(\), ko: koIn, flyThrough: true\}\)/.test(H)
            && !/planNogoRoute\([^)]*ko: koIn\}\)/.test(H)    // no way-in site is judged as a berth any more
            && /planNogoRoute\(from, target, \{\.\.\.holdOpts\(\), standoffM: patClipBufM\(\), ko: koIn, flyThrough: true\}\)/.test(H)
            && /planNogoRoute\(backFrom, firstWp, \{\.\.\.holdOpts\(\), standoffM: patClipBufM\(\), ko: koIn, flyThrough: true\}\)/.test(H)
            && /const turnMargin = Math\.max\(2, sp\.spacing\*0\.5\);/.test(H)
            && /legSafe=\(a,b\)=>\{[\s\S]{0,400}?blocked\(\{[^}]*\}, koTurn, buffer\)/.test(H),
      "extendLead (both ends), every turnWithRetry (the first rung, the lead give, the trim "
        + "rung), every judgeJoin and the red-join diagnostic read `clipBuf`; a hop is flown "
        + "straight only when legSafeAt clears the standoff, routed at clipBuf first and at the "
        + "buffer only as the fallback (nHopInside, said on the card); the approach, RTH, Go-To, "
        + "the transit line and the resume-from-here way in carry patClipBufM() into routePlan / "
        + "planNogoRoute. A plan built "
        + "this way cannot have the helm rung fire on a line, a lead, a turn or a hop the water "
        + "had room for; where it had not, the card says so, and the guard covers it");

// ── 7b. AND THE TIE TO THE GUARD HOLDS FOR A TURN, NOT ONLY A LINE ────────────────────────────
// The same reversal built at the buffer and at the standoff, at the end of two runs heading
// onto a wall the set is running onto. At the buffer it flies and loops to within a few meters
// of the wall, and walked under that set the guard reads helm on its arc. At the standoff the
// ladder either refuses it - which is what sends the punch's trim rung to pull the ends back -
// or flies it clear; and with the ends pulled back to where it flies, no point of the arc is
// in extremis. The control is the buffer-built arc: if THAT never reads helm, the walk is
// measuring nothing.
{
  const T = require("../static/js/turns.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const F = planeFrame({ lat: 43.07, lon: -70.71 });
  const at = (e, n) => F.fromEN(e, n);
  const ring = [{ e: -400, n: 0 }, { e: 400, n: 0 }, { e: 400, n: 300 }, { e: -400, n: 300 }];
  const ko = { polys: [{ ring, bb: bbOf(ring), kind: "a dock / pier" }],
               lines: [], points: [], marks: [], sys: [], chans: [] };
  const BUF = 3, setMs = kn(1.75), standoff = G.guardStandoffM(BUF, setMs);
  const drift = { e: 0, n: setMs };                       // setting onto the wall (north)
  const fly = { spdKey: "survey", approachM: 1 };
  const SP = 20;                                          // spacing: a 10 m loop
  const build = (endN, buf) => T.turnWithRetry(at(0, endN), at(SP, endN), 0, 180, F, ko, buf, 5, 60, 2.5, 0, fly);
  const walk = (t) => {
    if (!t || !t.pts || !t.pts.length) return null;
    const pts = t.pts.map(p => F.toEN(p));
    let min = Infinity, helm = 0;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], nx = pts[Math.min(i + 1, pts.length - 1)];
      const d = Math.hypot(nx.e - q.e, nx.n - q.n) || 1, tw = kn(1.5);
      const vel = { e: drift.e + tw * (nx.e - q.e) / d, n: drift.n + tw * (nx.n - q.n) / d };
      min = Math.min(min, K.clearanceM(q, ko, 100));
      if (G.assess(q, vel, drift, ko, BUF).level === "helm") helm++;
    }
    return { min, helm, n: pts.length };
  };
  const NEAR = -16, FAR = -45;
  const wBuf = walk(build(NEAR, BUF)), wStd = walk(build(NEAR, standoff)), wFar = walk(build(FAR, standoff));
  const fmt = (w) => (w ? w.n + " pts, min clearance " + w.min.toFixed(1) + " m, helm on " + w.helm : "refused");
  check("7b. a reversal built at the buffer is in extremis on its arc in that set; built at the standoff it is refused or clear, and pulled back to where it flies, never in extremis",
        () => standoff > BUF + 10
              && wBuf && wBuf.min < standoff && wBuf.helm > 0                      // the control
              && (!wStd || (wStd.min >= standoff - 0.5 && wStd.helm === 0))
              && wFar && wFar.min >= standoff - 0.5 && wFar.helm === 0,
        "standoff " + standoff.toFixed(1) + " m at 1.75 kn | ends 16 m off the face: at the buffer "
          + fmt(wBuf) + "; at the standoff " + fmt(wStd) + " | ends 45 m off, at the standoff: " + fmt(wFar));
}

// ── 7c. AND A TRANSIT IS ROUTED AT THE STANDOFF WHERE THE WATER ALLOWS, AT THE BUFFER WHERE IT DOES NOT ────
// The live check, 2026-09-26: the approach was routed at the bare buffer, a detour ran 9.9 m off
// Fort Point in a 1.75 kn set, and the helm rung escaped her from it. routePlan is driven here
// through the page's own state module: a leg 10 m off a wall, legal at the buffer, is routed
// out to the standoff when there is water for it; the same leg in a closed 20 m slot, where
// there is not, keeps the buffer and is COUNTED - the number the page's banner reads.
{
  const { nogo } = require("../static/js/state.js");
  const { routePlan } = require("../static/js/passage.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const F = planeFrame({ lat: 43.07, lon: -70.71 });
  const at = (e, n) => F.fromEN(e, n);
  const rect = (e0, e1, n0, n1) => { const r = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
    return { ring: r, bb: bbOf(r), kind: "a dock / pier" }; };
  const model = (polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });
  const BUF = 3, standoff = G.guardStandoffM(BUF, kn(1.75));
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  const walk = (route, from, ko) => {              // min clearance along the routed polyline, 1 m steps
    let min = Infinity, prev = F.toEN(from);
    for (const w of route) { const q = F.toEN(w); const L = Math.hypot(q.e - prev.e, q.n - prev.n), n = Math.max(1, Math.ceil(L));
      for (let i = 0; i <= n; i++) { const t = i / n; min = Math.min(min, K.clearanceM({ e: prev.e + (q.e - prev.e) * t, n: prev.n + (q.n - prev.n) * t }, ko, 100)); }
      prev = q; }
    return min;
  };
  let open, slot;
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = BUF;
    // open water south of a wall with a pier reaching 20 m out of it: the leg, 30 m off the
    // wall, passes the pier at 10 m - legal at the buffer, inside the standoff
    nogo.ko = model([rect(-400, 400, 0, 300), rect(-20, 20, -20, 0)]);
    const A = at(-100, -30), B = at(100, -30);
    const p1 = routePlan(A, [B], true, standoff);
    open = { p: p1, min: walk(p1.route, A, nogo.ko), plain: walk(routePlan(A, [B], true, BUF).route, A, nogo.ko) };
    // a closed slot 20 m wide: no water for the standoff, the buffer keeps her moving - counted
    nogo.ko = model([rect(-400, 400, 0, 300), rect(-400, 400, -320, -20), rect(-420, -400, -320, 300), rect(400, 420, -320, 300)]);
    const A2 = at(-100, -10), B2 = at(100, -10);          // inside the slot, 10 m off both walls
    const p2 = routePlan(A2, [B2], true, standoff);
    slot = { p: p2, min: walk(p2.route, A2, nogo.ko) };
  } finally {
    nogo.ready = saved.ready; nogo.frame = saved.frame; nogo.ko = saved.ko; nogo.buffer = saved.buffer;
  }
  check("7c. a transit leg legal at the buffer is routed out to the standoff where there is water for it; in a slot with none it keeps the buffer and is counted",
        () => open && open.p.insideStandoff === 0 && open.min >= standoff - 0.5 && open.plain < standoff
              && slot && slot.p.insideStandoff === 1 && slot.min >= BUF && slot.min < standoff,
        "open water: at the standoff the route keeps " + (open ? open.min.toFixed(1) : "?") + " m (the same leg at the buffer keeps "
          + (open ? open.plain.toFixed(1) : "?") + " m), insideStandoff " + (open ? open.p.insideStandoff : "?")
          + " | the 20 m slot: insideStandoff " + (slot ? slot.p.insideStandoff : "?") + ", " + (slot ? slot.p.route.length : "?")
          + " waypoint(s), keeping " + (slot ? slot.min.toFixed(1) : "?") + " m - the buffer, said, rather than a refusal or a silent hug");
}

// ── 7d. THE ROUTER TAKES AN EXPLICIT MODEL (2026-09-27) ────────────────────────────────────
// The AIS contacts live in the guard's model and never in nogo.ko. The way in round a contact that stays
// on the line - the console's own (aisAroundTick) or the operator's point beyond her (resumeFromHere on a
// held survey) - hands planNogoRoute the charted model plus the contacts as `opts.ko`, and holdTarget tests
// the target against that same model. Driven through state.js like 7c: the charted model EMPTY, the hull
// only in opts.ko.
{
  const { nogo } = require("../static/js/state.js");
  const { planNogoRoute } = require("../static/js/passage.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const F = planeFrame({ lat: 43.07, lon: -70.71 });
  const at = (e, n) => F.fromEN(e, n);
  const rect = (e0, e1, n0, n1) => { const r = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
    return { ring: r, bb: bbOf(r), kind: "AIS: KLEOS (20 x 8 m assumed)" }; };
  const model = (polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  const walk = (route, from, ko) => {
    let min = Infinity, prev = F.toEN(from);
    for (const w of route) { const q = F.toEN(w); const L = Math.hypot(q.e - prev.e, q.n - prev.n), n = Math.max(1, Math.ceil(L));
      for (let i = 0; i <= n; i++) { const t = i / n; min = Math.min(min, K.clearanceM({ e: prev.e + (q.e - prev.e) * t, n: prev.n + (q.n - prev.n) * t }, ko, 100)); }
      prev = q; }
    return min;
  };
  let plain, plainClear = -1, withKo, minClear = -1, held;
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = 3; nogo.ko = model([]);
    const A = at(-60, 0), B = at(60, 0);
    const ship = model([rect(-15, 15, -4, 4)]);            // a hull across the leg, charted nowhere
    plain = planNogoRoute(A, B, {});
    plainClear = (plain && plain.route) ? walk(plain.route, A, ship) : -1;   // a "direct" route is still several waypoints (the lane pipeline): the question is whether it passes THROUGH her
    withKo = planNogoRoute(A, B, { ko: ship });
    minClear = (withKo && withKo.route) ? walk(withKo.route, A, ship) : -1;
    held = planNogoRoute(A, at(0, 0), { ko: ship });       // the target ON her
  } finally {
    nogo.ready = saved.ready; nogo.frame = saved.frame; nogo.ko = saved.ko; nogo.buffer = saved.buffer;
  }
  check("7d. planNogoRoute routes round a model it is HANDED (opts.ko) where the charted model is empty - direct without it, a detour clear of the hull with it - and holdTarget holds a target ON her off her by the same model",
        () => plain && plain.direct && plainClear < 1
              && withKo && !withKo.error && withKo.route.length >= 2 && minClear >= 3 - 0.5
              && held && !held.error && held.heldOff && held.heldOff.m > 0,
        "without opts.ko: " + (plain ? (plain.direct ? "direct" : "routed") + ", " + plain.route.length + " wpt(s), through her at " + plainClear.toFixed(1) + " m" : "?")
          + "; with the hull in opts.ko: " + (withKo ? (withKo.error ? "REFUSED " + withKo.error : withKo.route.length + " wpts, keeping " + minClear.toFixed(1) + " m") : "?")
          + "; a target on her: " + (held ? (held.error ? "REFUSED" : held.heldOff ? "held off " + held.heldOff.m.toFixed(1) + " m" : "accepted where it stood") : "?"));
}

// ── 7e. A FLY-THROUGH TARGET IS NOT A BERTH (2026-09-27) ─────────────────────────────────────
// Found on the first live rehearsal with a test contact: ROUTE ROUND HER NOW pressed, the rejoin point on the
// line a standoff (3 m) beyond her ring, and holdTarget - which judges every target as a place to HOLD - wanted
// the 6 m hold margin and the hold disc, moved the point off the line, and the resume refused with "the first
// unflown waypoint is itself inside a keep-out". The automatic way round at the minute would have died the
// same way, on KLEOS too. The test worlds could not see it: their router is a stub. So this one is real.
{
  const { nogo } = require("../static/js/state.js");
  const { planNogoRoute } = require("../static/js/passage.js");
  const { planeFrame, distTo } = require("../static/js/geodesy.js");
  const F = planeFrame({ lat: 43.07, lon: -70.71 });
  const at = (e, n) => F.fromEN(e, n);
  const rect = (e0, e1, n0, n1, kind) => { const r = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
    return { ring: r, bb: bbOf(r), kind }; };
  const model = (polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  let berth, fly, onHer, T;
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = 3; nogo.ko = model([]);
    // her avoidance ring: a 30 x 8 m hull grown by her length, 20 m round her (the way round's own model)
    const ring = model([rect(-35, 35, -24, 24, "AIS: KLEOS (30 x 8 m), 20 m round her")]);
    const A = at(-60, 40);
    T = at(0, 28);                                       // 4 m off her ring: clear at the buffer, under the 6 m hold margin
    berth = planNogoRoute(A, T, { ko: ring, standoffM: 3 });
    fly = planNogoRoute(A, T, { ko: ring, standoffM: 3, flyThrough: true });
    onHer = planNogoRoute(A, at(0, 0), { ko: ring, standoffM: 3, flyThrough: true });
  } finally {
    nogo.ready = saved.ready; nogo.frame = saved.frame; nogo.ko = saved.ko; nogo.buffer = saved.buffer;
  }
  const flyEnd = (fly && fly.route && fly.route.length) ? fly.route[fly.route.length - 1] : null;
  check("7e. a rejoin point 4 m off a contact's ring is judged a BERTH by default (held off it - the 6 m margin), and a FLY-THROUGH target stands where it is: no heldOff, the route ending ON it; one on her is refused by name",
        () => !!berth && !berth.error && !!berth.heldOff && berth.heldOff.m > 0
              && !!fly && !fly.error && !fly.heldOff && !!flyEnd && distTo(flyEnd, T) < 0.5
              && !!onHer && /sits in AIS: KLEOS/.test(onHer.error || ""),
        "as a berth: " + (berth ? (berth.error ? "REFUSED " + berth.error : berth.heldOff ? "held off " + berth.heldOff.m.toFixed(1) + " m (" + berth.heldOff.kind + ")" : "accepted") : "?")
          + "; fly-through: " + (fly ? (fly.error ? "REFUSED " + fly.error : fly.heldOff ? "held off " + fly.heldOff.m.toFixed(1) + " m" : "ends " + (flyEnd ? distTo(flyEnd, T).toFixed(2) + " m from the target" : "nowhere")) : "?")
          + "; on her: " + (onHer ? (onHer.error || "ACCEPTED") : "?"));
}

// ── 7f. THE STANDOFF SURVIVES THE LANE PASS (2026-09-28) ─────────────────────────────────────
// planNogoRoute searched at the standoff, then ran the lane, the smoothing, the gate and the knot prune at the bare
// BUFFER - so every shortcut they took was clear of the buffer and nothing more. Measured on a hull-sized block
// across the leg, a 19.5 m standoff (a 1.75 kn set) and a 3 m buffer: the search held 19.7-23.1 m and the lane
// pass cut it to 6.3-14.1 m in every orientation tried; found on the tighter way round a contact, where it would
// have taken the boat inside the guard's standoff. Re-gated at the margin the leg was found at.
{
  const { nogo } = require("../static/js/state.js");
  const { planNogoRoute } = require("../static/js/passage.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const F = planeFrame({ lat: 43.07, lon: -70.71 });
  const at = (e, n) => F.fromEN(e, n);
  const block = (rotDeg) => { const r = rotDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const pts = [[-13, -7], [13, -7], [13, 7], [-13, 7]].map(([x, y]) => ({ e: x * c - y * s, n: x * s + y * c }));
    return { ring: pts, bb: bbOf(pts), kind: "a hull-sized block" }; };
  const model = (polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });
  const minClear = (route, from, ko) => { let m = Infinity, prev = F.toEN(from);
    for (const w of route) { const q = F.toEN(w), n = Math.max(1, Math.ceil(Math.hypot(q.e - prev.e, q.n - prev.n) / 0.5));
      for (let i = 0; i <= n; i++) { const t = i / n; m = Math.min(m, K.clearanceM({ e: prev.e + (q.e - prev.e) * t, n: prev.n + (q.n - prev.n) * t }, ko, 200)); }
      prev = q; }
    return m; };
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  const got = [];
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = 3;
    for (const rot of [-42, 30, 60]) {
      const ko = model([block(rot)]); nogo.ko = ko;
      const A = at(-58, 0), B = at(37, 0);
      const r = planNogoRoute(A, B, { standoffM: 19.5, ko });
      const calm = planNogoRoute(A, B, { ko });                      // no standoff: the buffer's own route, untouched
      got.push({ rot, m: r.route ? minClear(r.route, A, ko) : -1, err: r.error || null, inside: r.insideStandoff,
                 calm: calm.route ? minClear(calm.route, A, ko) : -1 });
    }
  } finally {
    nogo.ready = saved.ready; nogo.frame = saved.frame; nogo.ko = saved.ko; nogo.buffer = saved.buffer;
  }
  check("7f. a route the router found at the 19.5 m standoff KEEPS it through the lane pass - every leg at least 19.5 m off a hull-sized block across the leg, in three orientations (the lane pass used to cut it to 6-14 m) - and a calm route at the 3 m buffer is still routed at the buffer",
        () => got.length === 3 && got.every(g => !g.err && !g.inside && g.m >= 19.5 - 0.05 && g.calm >= 3 - 0.05 && g.calm < 19.5),
        () => got.map(g => "rot " + g.rot + ": " + (g.err || g.m.toFixed(1) + " m (calm " + g.calm.toFixed(1) + " m)")).join("; "));
}

// ── 7g. AND THROUGH THE UPLOAD ROUTER'S LANE PASS (2026-09-28) ─────────────────────────────────
// routePlan - Upload, Go-To's and RTH's plans, a drawn transit - had the same pass for its TRANSIT legs (every leg of a
// pure transit, the approach of a plan): found at the standoff, laned at the buffer. Measured before the fix on 7f's
// block: 6.3-14.1 m off it in every orientation, on the pure transit and on a plan's approach alike, with
// insideStandoff 0 - the plan said the standoff was kept. A plan's legs BETWEEN its waypoints keep the buffer, as they
// always have (the punch's own geometry), so only the approach is asked of a plan.
{
  const { nogo } = require("../static/js/state.js");
  const { routePlan } = require("../static/js/passage.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const F = planeFrame({ lat: 43.07, lon: -70.71 });
  const at = (e, n) => F.fromEN(e, n);
  const block = (rotDeg) => { const r = rotDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const pts = [[-13, -7], [13, -7], [13, 7], [-13, 7]].map(([x, y]) => ({ e: x * c - y * s, n: x * s + y * c }));
    return { ring: pts, bb: bbOf(pts), kind: "a hull-sized block" }; };
  const model = (polys) => ({ polys, lines: [], points: [], marks: [], sys: [], chans: [] });
  const minClear = (route, from, ko) => { let m = Infinity, prev = F.toEN(from);
    for (const w of route) { const q = F.toEN(w), n = Math.max(1, Math.ceil(Math.hypot(q.e - prev.e, q.n - prev.n) / 0.5));
      for (let i = 0; i <= n; i++) { const t = i / n; m = Math.min(m, K.clearanceM({ e: prev.e + (q.e - prev.e) * t, n: prev.n + (q.n - prev.n) * t }, ko, 200)); }
      prev = q; }
    return m; };
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  const got = [];
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = 3;
    for (const rot of [-42, 30, 60]) {
      const ko = model([block(rot)]); nogo.ko = ko;
      const A = at(-58, 0), B = at(37, 0), C = at(37, 60);
      const t = routePlan(A, [B], true, 19.5);                       // a pure transit: every leg is one
      const p = routePlan(A, [B, C], false, 19.5);                   // a plan: its approach is the transit
      const j = p.route.findIndex(w => { const q = F.toEN(w); return Math.abs(q.e - 37) < 0.01 && Math.abs(q.n) < 0.01; });
      const calm = routePlan(A, [B], true, 3);                       // no standoff: the buffer's own route
      got.push({ rot, t: minClear(t.route, A, ko), tIn: t.insideStandoff, a: j >= 0 ? minClear(p.route.slice(0, j + 1), A, ko) : -1,
                 aIn: p.insideStandoff, unr: t.unroutable.length + p.unroutable.length, calm: minClear(calm.route, A, ko) });
    }
  } finally {
    nogo.ready = saved.ready; nogo.frame = saved.frame; nogo.ko = saved.ko; nogo.buffer = saved.buffer;
  }
  check("7g. the Upload router keeps the 19.5 m standoff its transit legs were found at through its own lane pass - a pure transit and a plan's approach alike at least 19.5 m off the block in three orientations (they came out 6-14 m, with the plan saying the standoff was kept) - and a calm plan is still routed at the buffer",
        () => got.length === 3 && got.every(g => g.unr === 0 && g.tIn === 0 && g.aIn === 0 && g.t >= 19.5 - 0.05 && g.a >= 19.5 - 0.05
                                                  && g.calm >= 3 - 0.05 && g.calm < 19.5),
        () => got.map(g => "rot " + g.rot + ": transit " + g.t.toFixed(1) + " m, approach " + g.a.toFixed(1) + " m (calm " + g.calm.toFixed(1)
                           + " m; inside " + g.tIn + "/" + g.aIn + ", unroutable " + g.unr + ")").join("; "));
}

// ── 7h. A BUOYED CHANNEL IN A SET: THE LANE WHERE THE STANDOFF CANNOT BE KEPT, THE CENTERLINE WHERE ONLY IT CAN ──────────
// The two sides of 7g's re-gate, pinned so the trade is deliberate. A leg found only at the BUFFER (a 30 m channel: no
// line in it is 19.5 m off both banks) keeps the buffer's lane pass - the Rule 9 lane a quarter of the width in, as in
// calm water; re-gating it at a standoff nothing can keep dropped the lane and ran the centerline (the mutation that
// took the fallback's reset away). A leg the standoff CAN be kept on (a 40 m channel: the centerline is 20 m off each
// bank) keeps it: the lane a quarter in is 10 m off the starboard bank, inside the guard's 19.5 m, so the plan runs the
// centerline and reports the lane as partial. The guard's standoff is the speed-and-set margin the ladder acts on;
// keeping right inside it is the treadmill (2026-09-28).
{
  const { nogo } = require("../static/js/state.js");
  const { routePlan } = require("../static/js/passage.js");
  const K = require("../static/js/keepouts.js");
  const { planeFrame } = require("../static/js/geodesy.js");
  const F = planeFrame({ lat: 42.14, lon: -80.08 });
  const at = (e, n) => F.fromEN(e, n);
  const rect = (e0, e1, n0, n1) => { const r = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
    return { ring: r, bb: bbOf(r), kind: "a bank" }; };
  const channel = (HALF) => {                                         // tests/buoy_lane.js's buoyed channel, between banks
    const ns = [100, 300, 500, 700, 900];
    const port = ns.map((n, i) => ({ e: -HALF, n, side: -1, num: 2 * i + 1, sys: "CH" }));
    const stbd = ns.map((n, i) => ({ e: HALF, n, side: 1, num: 2 * (i + 1), sys: "CH" }));
    return { polys: [rect(-80, -HALF, -200, 1200), rect(HALF, 80, -200, 1200)], lines: [], points: [],
             marks: [...port, ...stbd], sys: [{ sys: "CH", port, stbd }], chans: [] };
  };
  const eAt = (route, nq) => { const q = route.map(w => F.toEN(w)); const m = q.find(x => x.n > nq - 60 && x.n < nq + 60); return m ? m.e : null; };
  const minClear = (route, from, ko) => { let m = Infinity, prev = F.toEN(from);
    for (const w of route) { const q = F.toEN(w), n = Math.max(1, Math.ceil(Math.hypot(q.e - prev.e, q.n - prev.n) / 2));
      for (let i = 0; i <= n; i++) { const t = i / n; m = Math.min(m, K.clearanceM({ e: prev.e + (q.e - prev.e) * t, n: prev.n + (q.n - prev.n) * t }, ko, 100)); }
      prev = q; }
    return m; };
  const saved = { ready: nogo.ready, frame: nogo.frame, ko: nogo.ko, buffer: nogo.buffer };
  let narrow, mid;
  try {
    nogo.ready = true; nogo.frame = F; nogo.buffer = 3;
    const A = at(0, 0), B = at(0, 1000);
    nogo.ko = channel(15);
    const n1 = routePlan(A, [B], true, 19.5), n0 = routePlan(A, [B], true, 3);
    narrow = { inside: n1.insideStandoff, lane: n1.lane, partial: n1.partial, e: eAt(n1.route, 500), eCalm: eAt(n0.route, 500) };
    nogo.ko = channel(20);
    const m1 = routePlan(A, [B], true, 19.5), m0 = routePlan(A, [B], true, 3);
    mid = { inside: m1.insideStandoff, lane: m1.lane, partial: m1.partial, clr: minClear(m1.route, A, nogo.ko), eCalm: eAt(m0.route, 500),
            eMax: Math.max(...m1.route.map(w => Math.abs(F.toEN(w).e))) };
  } finally {
    nogo.ready = saved.ready; nogo.frame = saved.frame; nogo.ko = saved.ko; nogo.buffer = saved.buffer;
  }
  check("7h. a buoyed channel in a 1.75 kn set: 30 m wide, where no line keeps the 19.5 m standoff, the leg is found at the buffer, SAID (insideStandoff), and rides the Rule 9 lane a quarter of the width in as in calm water; 40 m wide, where the centerline keeps it, she runs the centerline 19.5 m or more off both banks and the plan says the lane is partial - the lane 10 m off the starboard bank is inside the guard's standoff",
        () => narrow && narrow.inside === 1 && narrow.lane === true && narrow.partial === false
              && narrow.e != null && Math.abs(narrow.e - 7.5) < 0.5 && narrow.eCalm != null && Math.abs(narrow.eCalm - 7.5) < 0.5
              && mid && mid.inside === 0 && mid.lane === true && mid.partial === true && mid.clr >= 19.5 - 0.05 && mid.eMax < 0.5
              && mid.eCalm != null && Math.abs(mid.eCalm - 10) < 0.5,
        () => "30 m: inside " + (narrow && narrow.inside) + ", lane " + (narrow && narrow.lane) + ", partial " + (narrow && narrow.partial) + ", e at mid-channel "
            + (narrow && narrow.e != null ? narrow.e.toFixed(1) : "none") + " (calm " + (narrow && narrow.eCalm != null ? narrow.eCalm.toFixed(1) : "none") + ")"
            + " | 40 m: inside " + (mid && mid.inside) + ", lane " + (mid && mid.lane) + ", partial " + (mid && mid.partial) + ", " + (mid ? mid.clr.toFixed(1) : "?")
            + " m off the banks, widest " + (mid ? mid.eMax.toFixed(1) : "?") + " m off the centerline (calm lane at e " + (mid && mid.eCalm != null ? mid.eCalm.toFixed(1) : "none") + ")");
}

// ── 8. AND IT IS NEVER SILENT ───────────────────────────────────────────────────────
// Clipping coverage at more than the operator asked for COSTS THEM SURVEY. This console's
// standing rule is that dropping coverage somebody asked for is said out loud with the
// number and the threshold - the same rule nShort and nLeadCut answer to.
check("8. the card says when the set widened the clip, with the number and the set",
      () => /clipBuf > buffer \+ 0\.05/.test(H)
            && /clipped at \$\{clipBuf\.toFixed\(1\)\} m not \$\{buffer\} m/.test(H)
            && /setKnNow\.toFixed\(2\)\} kn set/.test(H),
      "the hint line carries the standoff actually used, the buffer it replaced and the set "
        + "that caused it - a thin survey with no explanation reads as a chart problem");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
