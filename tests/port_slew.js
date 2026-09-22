// tests/port_slew.js - a port change is a JOURNEY, and it has to arrive.
//
// Andy, 2026-08-31: "On selection of a new survey port show some more obvious and overt
// indication that a shift of port is in process and move is happening. Perhaps a scaled
// speed slew towards the new area."
//
// Before this the port change was a teleport with a one-line note over it: `center` was
// assigned, the next paint was a different sea, and nothing said where it had gone or that
// the work of getting there was still running. The slew is the answer, and an animation is
// exactly the kind of code that looks right in a demo and strands the operator in anger -
// so the properties this suite pins are the ones that make it safe rather than the ones
// that make it pretty:
//
//   * IT ARRIVES. Every exit lands on the destination at the original zoom - the end of the
//     flight, an operator's hand on the chart, a second port picked mid-flight. Half a
//     journey is not a place; a chart stranded between two bases is worse than a teleport.
//   * IT IS COMPUTED FROM ELAPSED TIME, NOT FROM FRAMES. The console has a standing rule
//     against requestAnimationFrame (suspended in a hidden or occluded window - the same
//     trap that froze the window-split mirror and the card-size observer). A slew driven by
//     a frame counter would stop dead mid-flight; one driven by the clock draws fewer
//     frames in a throttled window and lands on the same spot at the same moment. That is
//     testable without a browser: sample the same flight at 16 ms and at 1000 ms and the
//     positions at equal elapsed times must be IDENTICAL.
//   * IT SCALES. "Scaled speed" is the ask: the pan runs at a constant SCREEN speed, so a
//     longer move buys more zoom levels rather than more seconds of panning, and ground
//     speed scales with distance while the glass looks the same.
//   * IT TAKES THE SHORT WAY. worldPx wraps at the antimeridian, and this console offers
//     ports BY NAME ("Nome, Alaska"), so a move the long way round the planet is a real
//     failure mode, not a curiosity.
//   * AND THE MOVE IS NOT FINISHED WHEN THE CHART ARRIVES. resetForNewArea() must fetch the
//     new area's keep-out model. It did not until this commit - see check 12.
//
//   node tests/port_slew.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH. Thirteen whole-function mutations run against a sidecar copy of the page; the
// check numbers below are the ones that ACTUALLY went red, not the ones that looked likely:
//   planSlew: drop the antimeridian unwrap (fly the long way)  -> 8, 9
//   planSlew: never zoom out (a straight pan at survey zoom)   -> 3, 4, 6, 7
//   planSlew: always zoom to MINZ, whatever the distance       -> 1b, 5, 6
//   slewAt:   clamp t at total-1, so it never quite arrives    -> 1b
//   slewAt:   no clamp at all                                  -> 1
//   slewAt:   drop Math.round on the zoom step                 -> 11
//   slewAt:   drop the longitude normalisation                 -> 11b
//   slewAt:   linear ramp instead of ease-in-out               -> 10b
//   endSlew:  leave the chart where the flight stopped         -> 13
//   resetForNewArea: THE REPORTED DEFECT - fetch nothing       -> 12
//   resetForNewArea: extract around the BOAT, not the new base -> 12, 12c
//   resetForNewArea: fire into a busy extract                  -> 12c
//   onState:  let BOAT-follow take the centre back mid-slew    -> 15
//
// AND SIX MORE, 2026-09-21, for the REFUSED-REQUEST family - all six killed:
//   switchPort loses its catch (the shipped defect)           -> 17, 17b, 17c
//   the catch clears nothing, it only logs                    -> 17, 17b, 17c
//   the catch does not say WHICH port is still current        -> 17b
//   findPortByName loses its catch                            -> 17, 17b, 17c
//   addPortHere loses its catch                               -> 17c, 17d
//   the picker is not restored on a refusal                   -> 17c
//
// ⚠ AND THE FIRST SWEEP OF THOSE SIX SCORED ALL SIX AS SURVIVED, for a reason that had
// nothing to do with the checks: this suite had no ASV_HTML override, so every mutant
// page was written to a sidecar the suite never read. The thirteen above cannot have
// been produced the way this header says either. The override is in now.
//
// TWO OF THEM SURVIVED THE FIRST PASS, and both were gaps in the checks rather than dead
// mutations - which is the whole reason to run them:
//   * "clamp at total-1" was invisible because check 1 flies a LONG move, whose last phase
//     is the zoom-in, and that phase pins the position to the destination whatever its
//     progress. Landing exactly is only a real property on a hop with no zoom levels, where
//     the flight ends inside the interpolated pan. Check 1b is that hop.
//   * the ease-in-out had NO check at all - a linear ramp passed everything. It is a stated
//     property (the chart sets off and comes to rest), so check 10b measures it where it
//     shows: ground covered in the first tenth of the pan against the middle tenth.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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

// The REAL projection the slew flies through - a stub here would let the arc be checked
// against maths the console does not use.
const { TILE, worldPx, worldToLatLon, distTo } = require("../static/js/geodesy.js");

// ASV_HTML points this at a SIDECAR copy for a mutation run. The header above says the
// teeth were verified against one -- and there was no way to point it at one: every
// mutation had to be made in static/asv.html itself. A sweep run without this reads the
// REAL page and scores every mutant as SURVIVED, which is how six of them looked when
// check 17 was written (2026-09-21).
const H = fs.readFileSync(process.env.ASV_HTML
                          || path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
// asv.html's own async functions, for the resetForNewArea check
function grabAsync(name) {
  const start = H.indexOf("async function " + name + "(");
  if (start < 0) throw new Error("test setup: async function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

// THE VIEWPORT IS THE ONE INPUT THAT IS NOT GEOMETRY - the fit zoom is chosen against it,
// so it is stated here rather than left to a headless window's idea of a size.
const VIEW = { w: 1200, h: 800 };
function viewSize(){ return VIEW; }

// ONE eval, so the two functions close over the REAL tuning constants. A `const` declared
// inside a direct eval stays in the EVAL's scope - only the function declarations are bound
// out here - so __consts() is how the checks below read the same values the flight actually
// flies by. Restating them in this file would be a reference that reads its subject's own
// numbers back to it, which is not a check.
eval(grabDecl("MINZ") + "\n" + grabDecl("SLEW_STEP_MS") + "\n" + grabDecl("SLEW_PX_PER_S") + "\n" +
     grabDecl("SLEW_FIT") + "\n" + grab("planSlew") + "\n" + grab("slewAt") + "\n" +
     "function __consts(){ return {MINZ, SLEW_STEP_MS, SLEW_PX_PER_S, SLEW_FIT}; }");
const { MINZ, SLEW_STEP_MS, SLEW_PX_PER_S, SLEW_FIT } = __consts();

let fails = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}

// Real bases from the shipped registry's home water, and one that makes the move a
// hemisphere-crossing rather than a coastal hop.
const NEWCASTLE = { lat: 43.0730, lon: -70.7100 };   // New Castle, NH - the default base
const LEWES     = { lat: 38.7800, lon: -75.1400 };   // Lewes, DE      - the other shipped one
const NOME      = { lat: 64.5000, lon: -165.4000 };  // Nome, AK       - the by-name example
const KAMCHATKA = { lat: 53.0200, lon:  158.6500 };  // across the antimeridian from Nome
const NEARBY    = { lat: 43.0730 + 0.045, lon: -70.7100 };  // ~5 km up the coast
const Z0 = 13;

const near = (v, w, tol) => Math.abs(v - w) <= (tol || 1e-9);
const fmtP = p => p.lat.toFixed(5) + "," + p.lon.toFixed(5);

console.log("Port slew - the chart flies to the new base, and it always arrives:");

// 1. IT ARRIVES, EXACTLY. The end of the flight is the destination at the zoom it started
//    from - not near it, not one level out. Everything else here is decoration; this is
//    the check that says the operator can trust the animation not to lose them.
{
  const s = planSlew(NEWCASTLE, LEWES, Z0);
  const end = slewAt(s, s.total), past = slewAt(s, s.total + 60000);
  check("1. the flight ends ON the destination, at the zoom it started from",
        () => near(end.lat, LEWES.lat, 1e-6) && near(end.lon, LEWES.lon, 1e-6) && end.zoom === Z0
              && near(past.lat, LEWES.lat, 1e-6) && past.zoom === Z0,
        "t=total -> " + fmtP(end) + " z" + end.zoom + "; and it stays there past the end");
}

// 1b. ... AND THE SHORT HOP LANDS TOO, which is a different claim. On a long move the last
//     phase is the zoom-in, and that phase pins the position to the destination whatever
//     its progress - so "it ends on the destination" is nearly free there. A hop with no
//     zoom levels at all ends INSIDE the pan, where the position is interpolated, and that
//     is the only path where landing exactly is a real property. (Found by mutation: a
//     flight clamped one millisecond short passes check 1 and fails this.)
{
  const s = planSlew(NEWCASTLE, NEARBY, Z0);
  const end = slewAt(s, s.total);
  check("1b. ... and so does a hop too short to need any zoom-out, where the pan IS the end",
        () => s.outMs === 0 && s.inMs === 0
              && near(end.lat, NEARBY.lat, 1e-9) && near(end.lon, NEARBY.lon, 1e-9) && end.zoom === Z0,
        s.km.toFixed(1) + " km, no zoom levels, ends at " + fmtP(end)
          + " vs the base at " + fmtP(NEARBY));
}

// 2. ... and it BEGINS on the old base, at the same zoom. A slew that jumps on frame one
//    has already told the operator the chart teleported.
{
  const s = planSlew(NEWCASTLE, LEWES, Z0);
  const a = slewAt(s, 0), b = slewAt(s, -5000);
  check("2. it begins on the base it is leaving, at the same zoom",
        () => near(a.lat, NEWCASTLE.lat, 1e-6) && near(a.lon, NEWCASTLE.lon, 1e-6) && a.zoom === Z0
              && Number.isInteger(a.zoom) && near(b.lat, NEWCASTLE.lat, 1e-6),
        "t=0 -> " + fmtP(a) + " z" + a.zoom + " (integer: tile levels are not fractional)");
}

// 3-5. IT ZOOMS OUT TO CROSS, and that is what makes the move legible: at the top of the
// arc BOTH bases are on the glass, which is the picture that says "from here, to there".
{
  const s = planSlew(NEWCASTLE, LEWES, Z0);
  const mid = slewAt(s, s.outMs + s.panMs / 2);
  check("3. it rises before it crosses - mid-flight is zoomed OUT",
        () => mid.zoom < Z0 && s.zOut < Z0,
        "z" + Z0 + " -> z" + s.zOut + " (" + (Z0 - s.zOut) + " levels) for " + s.km.toFixed(0) + " km");
  // The fit is the WHOLE POINT of the zoom-out: check it against the viewport, not against
  // a remembered level number, so a changed SLEW_FIT or viewport is still honoured.
  const a = worldPx(NEWCASTLE.lat, NEWCASTLE.lon, s.zOut), b = worldPx(LEWES.lat, LEWES.lon, s.zOut);
  const sep = Math.hypot(b.x - a.x, b.y - a.y);
  check("4. ... far enough out that BOTH bases fit on the glass",
        () => sep <= Math.min(VIEW.w, VIEW.h) * SLEW_FIT + 1,
        "separation " + sep.toFixed(0) + " px vs fit " + (Math.min(VIEW.w, VIEW.h) * SLEW_FIT).toFixed(0) + " px");
  check("5. ... and not one level further than it needs",
        () => { const a2 = worldPx(NEWCASTLE.lat, NEWCASTLE.lon, s.zOut + 1),
                      b2 = worldPx(LEWES.lat, LEWES.lon, s.zOut + 1);
                return s.zOut === Z0 ||
                       Math.hypot(b2.x - a2.x, b2.y - a2.y) > Math.min(VIEW.w, VIEW.h) * SLEW_FIT; },
        "one level in from z" + s.zOut + " would not fit");
}

// 6-7. SCALED. A hop up the coast is not the same journey as a hemisphere, and the arc says
// so: further means further out, and longer - but by the LOG of the distance, not by it, or
// a 5,000 km move would be a coffee break.
{
  const hop = planSlew(NEWCASTLE, NEARBY, Z0);
  const run = planSlew(NEWCASTLE, LEWES, Z0);
  const far = planSlew(NEWCASTLE, NOME, Z0);
  check("6. a longer move zooms out further and takes longer",
        () => hop.zOut >= run.zOut && run.zOut > far.zOut && hop.total < run.total && run.total < far.total,
        [hop, run, far].map(s => s.km.toFixed(0) + " km -> z" + s.zOut + " " + s.total + " ms").join(" | "));
  check("7. ... but sub-linearly - 10x the distance is nowhere near 10x the time",
        () => far.km > run.km * 5 && far.total < run.total * 2.5,
        far.km.toFixed(0) + " km is " + (far.km / run.km).toFixed(1) + "x the distance and "
          + (far.total / run.total).toFixed(2) + "x the time");
}

// 8-9. THE SHORT WAY ROUND. Nome to Kamchatka is 40° of longitude across the dateline and
// 320° the other way. worldPx knows nothing about that - it projects a bare longitude - so
// without an explicit unwrap the chart flies the long way, across the whole Atlantic, and
// the fit zoom is dragged out to MINZ to contain a journey that isn't happening.
{
  const s = planSlew(NOME, KAMCHATKA, Z0);
  const spanOut = TILE * Math.pow(2, s.zOut);
  check("8. an antimeridian move is planned the SHORT way",
        () => Math.abs(s.bx - s.ax) <= spanOut / 2,
        "pan " + Math.abs(s.bx - s.ax).toFixed(0) + " px of a " + spanOut.toFixed(0)
          + " px world (the long way would be " + (spanOut - Math.abs(s.bx - s.ax)).toFixed(0) + ")");
  // ... and it actually GOES that way: no sample mid-crossing may land in the Atlantic.
  // Sampling the flown longitudes is the behavioural half - check 8 only reads the plan.
  const lons = [];
  for (let k = 0; k <= 10; k++) lons.push(slewAt(s, s.outMs + s.panMs * k / 10).lon);
  const crossedWest = lons.some(L => L > -100 && L < 100);   // the Atlantic / Europe / Africa side
  check("9. ... and every point it flies through is on the Pacific side",
        () => !crossedWest && s.km > 3000,
        "longitudes " + lons.map(L => L.toFixed(0)).join(" ") + " over " + s.km.toFixed(0) + " km");
}

// 10. ELAPSED TIME, NOT FRAMES - the property that survives an occluded window. A browser
// that gives this 60 frames a second and one that clamps it to one per second must produce
// the SAME chart position at the same instant; the throttled one just draws fewer of them.
// This is why slewAt() takes `ms` and is pure, and why the console drives it on setTimeout.
{
  const s = planSlew(NEWCASTLE, LEWES, Z0);
  const smooth = [], coarse = [];
  for (let t = 0; t <= s.total; t += 16) smooth.push([t, slewAt(s, t)]);
  for (let t = 0; t <= s.total; t += 1000) coarse.push([t, slewAt(s, t)]);
  // compare the coarse samples against the smooth flight at the SAME elapsed times
  const agree = coarse.every(([t, p]) => { const q = slewAt(s, t);
    return near(p.lat, q.lat, 1e-12) && near(p.lon, q.lon, 1e-12) && p.zoom === q.zoom; });
  const landed = near(slewAt(s, s.total).lat, LEWES.lat, 1e-6);
  check("10. a 1-frame-per-second window flies the same path and lands in the same place",
        () => agree && landed && smooth.length > coarse.length * 5,
        smooth.length + " smooth samples vs " + coarse.length + " coarse, identical at equal t");
}

// 11. THE ZOOM IS ALWAYS A TILE LEVEL. `zoom` goes into the tile KEY and the tile URL, so a
// fractional value does not render slowly - it requests tiles that do not exist. And it
// never goes below MINZ, which would ask for a level the source does not publish.
{
  const s = planSlew(NOME, KAMCHATKA, Z0);          // the deepest zoom-out available here
  let allInt = true, floorOk = true, seen = new Set();
  for (let t = 0; t <= s.total; t += 7) { const p = slewAt(s, t);
    if (!Number.isInteger(p.zoom)) allInt = false;
    if (p.zoom < MINZ || p.zoom > Z0) floorOk = false;
    seen.add(p.zoom); }
  check("11. every zoom the flight passes through is an integer tile level >= MINZ",
        () => allInt && floorOk,
        "levels used: " + [...seen].sort((a, b) => b - a).join(",") + " (MINZ " + MINZ + ")");
}

// 11b. ... and every longitude it flies through is a longitude. The pan interpolates an
// UNWRAPPED x - that is what makes it take the short way over the dateline - so without a
// normalisation on the way out, a Nome -> Kamchatka crossing hands `center` -201°. The
// tile layer copes (the key wraps); the cursor readout, fmtLL and every other consumer of
// `center` do not, and the operator sees the bug.
{
  const s = planSlew(NOME, KAMCHATKA, Z0);
  let worst = 0;
  for (let t = 0; t <= s.total; t += 7) worst = Math.max(worst, Math.abs(slewAt(s, t).lon));
  check("11b. every longitude the flight passes through is inside +/-180",
        () => worst <= 180,
        "largest |lon| flown: " + worst.toFixed(1) + "° (unwrapped it reaches 201)");
}

// 10b. THE CROSSING EASES IN AND OUT, and that is a stated property rather than decoration:
// the chart should look like it sets off and comes to rest over the new base, not like it
// was cut mid-pan. A linear ramp survives every other check in this file, so without this
// one the ease would be untested code. Measured where it shows: ground covered in the first
// tenth of the pan against the middle tenth.
{
  const s = planSlew(NEWCASTLE, LEWES, Z0);
  const px = f => { const p = slewAt(s, s.outMs + s.panMs * f); return worldPx(p.lat, p.lon, s.zOut); };
  const seg = (a, b) => { const p = px(a), q = px(b); return Math.hypot(q.x - p.x, q.y - p.y); };
  const first = seg(0, 0.1), middle = seg(0.45, 0.55), last = seg(0.9, 1.0);
  check("10b. the crossing accelerates away and decelerates onto the new base",
        () => middle > first * 2 && middle > last * 2 && first > 0 && last > 0,
        "first tenth " + first.toFixed(0) + " px, middle " + middle.toFixed(0)
          + " px, last " + last.toFixed(0) + " px (a linear ramp makes all three equal)");
}

// 13-16. THE PAGE ITSELF: four places an animation like this goes wrong, each pinned to the
// construct rather than to a statement that could sit inside a dead branch.
{
  // EVERY exit lands. There is exactly one place that ends a slew, and its landing arm must
  // set the centre to the DESTINATION, not to wherever the flight had reached.
  const es = grab("endSlew");
  check("13. ending a slew - for any reason - lands the chart on the destination",
        () => /if\(land\)\{[^}]*center\s*=\s*\{lat:\s*s\.to\.lat,\s*lon:\s*s\.to\.lon\}/.test(es)
              && /zoom\s*=\s*s\.z0/.test(es),
        "endSlew(land) restores s.to and s.z0");
  const gestures = H.split("\n").filter(l => /endSlew\(/.test(l) && !/function endSlew/.test(l));
  const landing = gestures.filter(l => /endSlew\(true\)/.test(l));
  check("13b. ... and every operator gesture that interrupts one asks it to land",
        () => landing.length >= 2 && gestures.length - landing.length <= 1,
        gestures.length + " call site(s), " + landing.length + " landing (the one that does "
          + "not is startPortSlew superseding its own earlier flight)");
}
{
  // THE rAF RULE. This console has been bitten three times by rendering-driven callbacks in
  // an occluded window; a slew is the worst place for it yet, because it would strand the
  // chart between two bases with no way back but a manual pan.
  const src = grab("startPortSlew") + grab("slewAt") + grab("planSlew") + grab("endSlew");
  check("14. the slew is driven by a TIMER, never requestAnimationFrame",
        () => !/requestAnimationFrame/.test(src) && /setTimeout\(tick,\s*SLEW_TICK_MS\)/.test(src)
              && /Date\.now\(\)\s*-\s*slew\.t0/.test(src),
        "position comes from Date.now() - t0, so a throttled window still lands (check 10)");
}
{
  // BOAT-follow would take the centre straight back: a port change respawns the sim boat at
  // the new base, so a telemetry frame carrying the destination arrives almost at once.
  check("15. BOAT-follow does not fight the slew for the centre",
        () => /if\(follow\s*&&\s*!slew\s*&&\s*!portMoving\)\s*center\s*=/.test(H)
              && /if\(!haveFix\)\{\s*haveFix=true;\s*if\(!slew\s*&&\s*!portMoving\)/.test(H),
        "both recentring paths in onState are gated on !slew AND !portMoving");
}
{
  // 15b. ⚠ AND !slew ALONE WAS NOT ENOUGH - this is the bug that made the whole feature a
  // no-op in the running console, found by sampling the live zoom (it never left z13) and
  // invisible to every other check here. The respawn happens INSIDE the /api/ports request,
  // so its telemetry frame can land BEFORE the fetch promise resolves - and at that instant
  // `slew` is still null, because the slew is created from the reply. Follow moved the
  // centre to the destination first; startPortSlew then planned a flight from the new base
  // to the new base, total 0 ms, short-circuited. A perfect teleport with a card over it.
  //
  // Two things close it, and both are asserted: a flag set BEFORE the request rather than
  // after it, and a departure point captured before the request rather than read off
  // `center` after it.
  const sp = grab("switchPort"), st = grab("startPortSlew");
  const beforeFetch = s => { const i = s.indexOf("await fetch("); return i < 0 ? "" : s.slice(0, i); };
  check("15b. ... and the departure point and the follow-hold are both taken BEFORE the request",
        () => /portMoving\s*=\s*true;/.test(beforeFetch(sp))
              && /const wasName[^;]*fromLL\s*=\s*\{lat:center\.lat,\s*lon:center\.lon\}/.test(beforeFetch(sp))
              && /startPortSlew\(d\.spawn,\s*nm,\s*wasName,\s*fromLL\)/.test(sp)
              && /function startPortSlew\(to,\s*label,\s*fromLabel,\s*from\)/.test(st),
        "reading center.lat after the reply is the no-op bug: by then the respawn has "
          + "already moved it, and the flight plans from the destination to the destination");
}
{
  // The card IS the overt indication. It must not be a flash: it goes up when the move
  // starts and comes down only when the new area is ready.
  check("16. the MOVING BASE card outlives the flight and is cleared by the area, not a timer",
        () => /id="portMove"/.test(H) && /function portMoveDone/.test(H)
              && !/setTimeout\([^)]*portMoveDone/.test(H)
              && /portMoveDone\(note\);/.test(grabAsync("resetForNewArea"))
              && /sel\.disabled\s*=\s*true/.test(grab("portMoveShow")),
        "resetForNewArea() takes it down; the port picker is disabled while it is up");
}

// 12. THE MOVE IS NOT OVER WHEN THE CHART ARRIVES, and this is the check that says so.
// resetForNewArea() clears the old area's keep-out model - and until this commit fetched
// NOTHING to replace it. Both arms of the re-extract in onState() are unreachable
// afterwards: the first is behind the one-shot `nogoInit`, already spent, and the second
// requires the `nogo.ready` this function has just cleared. So the console sat at the new
// base reading "nogo not loaded" and planned `degraded` - "driving DIRECT, unverified
// against the chart" - in a sea it had never read, until the operator happened to press
// NOGO or Punch Out.
//
// DRIVEN, NOT GREPPED: the real function runs with its collaborators stubbed, and what is
// asserted is that an extract happened AND that it was aimed at the NEW BASE - not at the
// boat, which is still 600 km away on the old one until a later telemetry frame.
// Last because it is the only async check; everything above has already reported.
var track, runRoute, planIntent, runUnsafe, nogo, asv, __asked, __staged, __done;
function updateNogoUI(){}
function render(){}
function portMoveStage(){ __staged++; }
function portMoveDone(){ __done++; }
function refreshNogo(ll){ __asked = ll; return Promise.resolve(); }
// ⚠ THE TRAIL IS DROPPED THROUGH THE PAGE'S OWN clearTrack NOW, not a bare `track = []` -
// the assignment left the localStorage mirror and the armed 800 ms save alive to write the
// trail back (see tests/spawn_trail.js). So the REAL clearTrack is eval'd here with its two
// dependencies, NOT stubbed: a stub would hold check 12b green while the thing it stands in
// for was broken, which is exactly the trap nogo_readout fell into with foldChartInk. When
// this suite went red at "clearTrack is not defined" it was reporting a genuine new
// dependency in the function it drives, and that is the suite working.
var trackSaveTimer;
globalThis.localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
eval(grabDecl("TRACK_KEY") + "\n" + grab("lsDel") + "\n" + grab("clearTrack"));
eval(grabAsync("resetForNewArea"));

const NEWBASE = { lat: 38.7800, lon: -75.1400 };
(async function () {
  track = [1, 2, 3]; runRoute = [{}]; planIntent = {}; runUnsafe = [{}];
  nogo = { ready: true, features: [{}], note: "12 nogo zone(s)", busy: false };
  asv = { lat: 43.0730, lon: -70.7100 };            // the boat, still at the OLD base
  __asked = null; __staged = 0; __done = 0;
  await resetForNewArea(NEWBASE, "moved");
  check("12. a port change FETCHES the new area's keep-out model, aimed at the new base",
        () => __asked && near(__asked.lat, NEWBASE.lat, 1e-9) && near(__asked.lon, NEWBASE.lon, 1e-9)
              && __done === 1,
        __asked ? ("extract at " + fmtP(__asked) + " - and NOT at the boat's " + fmtP(asv)
                   + ", which is 600 km away on the base being left")
                : "no extract was requested at all (the reported defect)");
  check("12b. ... and the old area's derived state is dropped with it",
        () => track.length === 0 && runRoute === null && planIntent === null
              && runUnsafe.length === 0 && nogo.features === null,
        "track, run route, intent, unsafe legs and the feature snapshot all describe the old sea");

  // 12c. AN EXTRACT ALREADY IN FLIGHT IS FOR THE OLD AREA, and refreshNogo() no-ops while
  // one is running - so firing straight into it would return instantly and leave the new
  // base holding the OLD sea's keep-outs, which is worse than holding none. The wait is
  // bounded, so a stuck extract cannot hang the port change either.
  nogo = { ready: true, features: [{}], note: "old area", busy: true };
  __asked = null; __done = 0;
  let landed = false;
  const p = resetForNewArea(NEWBASE, null).then(() => { landed = true; });
  await new Promise(r => setTimeout(r, 250));
  const heldOff = (__asked === null && !landed);
  nogo.busy = false;                                 // the old extract finishes
  await p;
  check("12c. it waits out an extract already running for the OLD area, then fetches",
        () => heldOff && __asked && near(__asked.lat, NEWBASE.lat, 1e-9) && landed,
        heldOff ? "held off while busy, then extracted at " + fmtP(__asked)
                : "fired into a busy extract - refreshNogo() would have no-opped and the "
                  + "new base would hold the old sea's keep-outs");

  await (async () => {
  // ── 17. A REJECTED REQUEST DOES NOT LATCH THE FOLLOW-HOLD ─────────────────────────
  //
  // 15b above is what made this reachable: `portMoving = true` is set BEFORE the request,
  // deliberately, so the hold starts at the operator's click rather than at the slew. Only
  // portMoveDone clears it - and a DROPPED LINK makes `fetch` REJECT rather than answer
  // `r.ok === false`, so the refusal arm is never reached. The call site is
  // `onchange = (e)=>switchPort(e.target.value)`, fire and forget, and the page installs no
  // unhandledrejection handler, so the exception went to the browser console and nowhere
  // the operator could see. `portMoving` then stayed true FOR THE LIFE OF THE PAGE:
  // `if(follow && !slew && !portMoving) center = ...` is the BOAT-follow gate, so the chart
  // stopped following the boat, the moving-base card sat on "asking the console…", and the
  // picker still showed the port the operator chose - which never happened.
  //
  // ⚠ DRIVEN, NOT GREPPED. A source check for `catch` passes just as happily with the catch
  // swallowing the error and leaving the flag set. All three entry points are run in a vm
  // against a fetch that rejects exactly as a browser's does.
  const vm = require("vm");
  const ctx = {};
  const mk = () => ({
    console, JSON, Math, Date, String, Number, Object, Array, Promise, setTimeout,
    PORT_FIND: "__find__", PORT_ADD: "__add__",
    portMoving: false, portActive: "home", portList: [{ id: "home", name: "Home" }],
    center: { lat: 43.07, lon: -70.76 }, follow: true, slew: null,
    cards: [], picker: 0, banners: [], notes: [],
    portName: (id) => "port:" + id,
    portMoveShow: () => {}, portMoveStage: () => {},
    portMoveDone: (note) => { ctx.cards.push(note); ctx.portMoving = false; },
    fillPortPicker: () => { ctx.picker++; },
    startPortSlew: () => {}, showBanner: (b) => ctx.banners.push(b),
    flashNote: (n) => ctx.notes.push(n), fmtLL: () => "x",
    resetForNewArea: async () => {},
    window: { prompt: () => "Nome, Alaska" },
    fetch: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  Object.assign(ctx, mk());
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext([grabAsync("switchPort"), grabAsync("findPortByName"),
                   grabAsync("addPortHere")].join("\n"), ctx);

  const drive = async (call) => {
    Object.assign(ctx, mk());
    let threw = null;
    try { await vm.runInContext(call, ctx); } catch (e) { threw = String(e); }
    return { threw, moving: ctx.portMoving, said: ctx.cards[ctx.cards.length - 1] || null,
             picker: ctx.picker,
             follows: ctx.follow && !ctx.slew && !ctx.portMoving };   // the page's own gate
  };

  // ⚠ ONE AT A TIME. The three drives share ONE vm context, so running them through
  // Promise.all let the last one's state overwrite the other two: every case read the same
  // `said` and a picker count of 3, so 17 passed for the WRONG REASON while 17b failed for
  // a reason that had nothing to do with its subject. Caught by reading the detail line
  // rather than the tick.
  return (async () => {
    const sw = await drive('switchPort("lewes")');
    const fp = await drive("findPortByName()");
    const ap = await drive("addPortHere()");
    check("17. a port change whose request is REFUSED BY THE LINK does not latch the "
          + "follow-hold - the chart goes on following the boat",
          () => sw.threw === null && sw.moving === false && sw.follows === true
                && fp.threw === null && fp.moving === false && fp.follows === true,
          "switchPort: threw " + sw.threw + ", portMoving " + sw.moving
              + "; findPortByName: threw " + fp.threw + ", portMoving " + fp.moving
              + ". `fetch` REJECTS on a dropped link - it does not answer r.ok === false - "
              + "so the refusal arm is never reached and only portMoveDone clears the flag");
    check("17b. ... and the operator is TOLD, and told which port they are still on",
          () => /Port change failed/.test(sw.said || "") && /still on port:home/.test(sw.said || "")
                && /Find port failed/.test(fp.said || "") && /still on port:home/.test(fp.said || ""),
          "switchPort said \"" + sw.said + "\"; findPortByName said \"" + fp.said
              + "\". Silence here is a console that has stopped following the boat for a "
              + "reason nothing on screen explains");
    check("17c. ... and the picker is put back, so it does not show a port that was never "
          + "reached",
          () => sw.picker >= 1 && fp.picker >= 1 && ap.picker >= 1,
          "fillPortPicker called: switchPort " + sw.picker + ", findPortByName "
              + fp.picker + ", addPortHere " + ap.picker
              + " - the selection is the operator's evidence of where they are");
    check("17d. ... and ADD-PORT is caught too: it latches nothing, but a rejection left "
          + "\"+ Save this view as a port…\" selected as though it were the base",
          () => ap.threw === null && ap.moving === false
                && /Add port failed/.test(ap.said || "") && /nothing was added/.test(ap.said || ""),
          "addPortHere: threw " + ap.threw + ", said \"" + ap.said + "\"");
  })();
})();

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})();
