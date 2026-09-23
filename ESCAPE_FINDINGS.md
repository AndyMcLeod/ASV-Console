# WHY THE IN-EXTREMIS ESCAPE KEEPS FIRING — the evidence, 2026-09-19

Andy, 2026-09-19: *"start with the escapes."* His console had been taking the helm on his own runs. This
file is the evidence and what it indicts. **⚠ ITEMS 1, 2 AND 3 OF THE ORDER OF WORK ARE NOW FIXED**
(the turn geometry `d7d3f905`; the helm rung's selection test `f2fb80cd`; the planner/guard seam, this commit) — each marked where it
sits below, with what it does and does not close. `DEPARTURE_PARADIGM.md` is the design for one more
class of it, and this file's ORDER OF WORK outranks that file's staging.

Method: seven agents reconstructed every recorded escape from the session logs and read the guard path;
one synthesized. Their measurements come from **rebuilding Andy's own keep-out model** in node from the
cached ENC extracts (`charts/enc/features_v5_*.json`) with the console's own modules, and replaying the
recorded frames through the real `assess`. Raw transcripts:
`.claude/projects/C--Users-Andy-McLeod-Starlink/<session>/subagents/workflows/wf_cfb80832-12f/` (escapes)
and `wf_49c7cc9c-627/` (design). **The session log is the fixture nobody has to build** — the
`/api/cmd/upload` body IS the route the vessel was given, and telemetry is ~1 Hz beside it.

## THE CENSUS — 11 escapes, not 6

| session | port | escapes | note |
|---|---|---|---|
| asv_20260916-102925 | pago_pago, then erie_pa | 4 in 5 starts | **not reconstructed — do this first if you reopen the file** |
| asv_20260916-185954 | honolulu_harbor | 1 | in a generated turn, 414 s in |
| asv_20260917-213929 | — | **0 in 10 starts** | the most informative session in the record |
| asv_20260918-100307 | new_castle_nh | 2 | both on the routed approach |
| asv_20260918-130610 | pago_pago | 4 | includes a chain of three |

- **NOT ONE escape happened on a coverage line.** Four on the ENC-routed approach, one in a generated
  turn, one on the escape leg itself, one while station-keeping at an escape hold point.
- **Only 2 of 11 came within 2 s of Start** (0.45 s and 1.17 s). The rest: t+6.5, 56.6, 83.3, 92.8,
  106.8, 239.7, 288.8, 413.9, 682.4 s.
- **Every reconstructed escape was on a PUNCHED plan** (250, 185, 150, 78, 62 turn vertices). The only
  un-punched plan in the whole record — `mission.json.bak3`, 22 lines x 113 m at ~2 m spacing, zero turn
  points — ran 30 minutes to an RTH with no escape.
- Andy's 09-17/18 sessions ran build `15ddf3ff44eb`, which is the tree as committed, so the
  Add-to-plan refusal (`035878f1`) was live for all of them.

## WHAT WAS VERIFIED DIRECTLY (by hand, not by an agent)

1. **A berthed boat is in extremis by construction.** `timeToEntry` returns 0 on `blocked(p,ko,buf)`
   at static/js/guard.js:194 — *before* the stationary test at :198 — and `projectRoute` short-circuits
   the same way at :246. Inside a buffer both projections read 0 and `assess` lands on `helm` with no
   threshold consulted. **There is no number to tune.**
2. **With no course the guard reads CLEAR, not blind.** `groundVel(null, sog)` returns null
   (guard.js:178-182) and `clearanceGuard` substitutes `{level:"clear"}` (asv.html:1814-1815). A
   stopped boat reports `cog_deg: null`, so the readout says clear exactly when she is stopped.
3. **`guardTrack()` returns null with no way on** (asv.html:1617-1631, `twMs > 0.05`), which is why the
   paradigm keys its regimes on it.
4. **The escape at 14:03:22 was not "before she moved"**: the last telemetry reads `sog 0 / cog null /
   run idle`, but the guard cannot assess without a course, and the next frame (14:03:23) reads
   `sog 1.1 / cog 142`. She had just begun to move. The same second carries `start`, three `speed high`
   commands and the `escape`.
5. **The generated turns ship with reversals at both joins** — see below.

## THE TURN GEOMETRY IS WRONG, AND IT IS IN HIS CURRENT PLANS

From the Honolulu uploaded route (415 pts), legs 14..22 measured with the console's own geodesy:

```
 14->15   47.94 m  bearing 005.0   (coverage line 1)
 15->16    2.59 m  bearing 200.0   turn -165   <-- snap
 16->17    2.59 m  bearing 230.0        +30
 ... four more +30 steps ...
 20->21    2.59 m  bearing 350.0        +30
 21->22    5.99 m  bearing 185.0   turn -165   <-- snap
 22->23   43.94 m  bearing 185.0   (coverage line 2)
```

And in `mission.json.bak5` (09-18, punched, 20 lines), the same signature at 2.8 m spacing: the boat
runs the line on 335, **snaps 172** to 147, arcs left through ~164 in 11 vertices, arrives on 343, and
**snaps 172** again onto the next line at 155.

The arc is correctly ORDERED and correctly PLACED: its points run monotonically from line 1's end
(1.1 m away) to line 2's start (2.8 m away), bulging south of the 20 m gap. What is wrong is the SIDE it
bulges: **its entry tangent matches the outgoing line's stored direction and its exit tangent matches the
incoming one** — i.e. the shape belongs to the opposite transition. Reversing the point order does NOT
fix it (measured: 10 bad joints become 12); the shape itself is mirrored.

### ⇒ ESTABLISHED 2026-09-19, THE GUESS BELOW IT WAS WRONG, AND IT IS FIXED

This paragraph used to end: *"the likely origin is the pair's headings being taken from the lines' stored
`a->b` direction rather than the direction the runs are FLOWN after `regionOrder` re-orients them —
unverified, and the first thing to establish."* **That is not the cause and `regionOrder` is not
involved.** What was done instead of reading: `mission.json.bak5` carries BOTH the flown `waypoints` and
its 20 source `lines`, so every turn can be re-derived from its own pair and matched to the rung that
produced it. Fed the pair's real `(E, F, hE, hF)`, the page's own `turnWithRetry` returns a **correct**
turn every time — including for all six that shipped wrong. The shape functions and the headings are
both fine.

**Every shipped turn matches a LADDER RUNG to the millimetre** (max vertex deviation <= 5 mm):

| plan | arc outboard | racetrack | racetrack slow | **arc INBOARD** |
|---|---|---|---|---|
| `mission.json.bak5` | 11 | 2 | - | **4** |
| `mission.json.bak4` | 11 | 3 | 2 | **1** |
| `mission.json.bak1` | 8 | - | 1 | **1** |
| Honolulu 2026-09-16 (415 wpts) | 21 | 14 | 4 | **4** |

The mirrored shape is `teardropTurn(..., 'inboard')` — **rungs 5 and 6**, the "turn AWAY from the dock"
rung the wharf incident bought. Its semicircle branch reverses the **sweep** about a center that stays
midway between the two lines. That keeps both endpoints and reverses **both tangents**, so the boat is
told to reverse at the line end, fly the arc backwards, and reverse again onto the next line. To sweep
the other way *and* stay tangent, the center has to move to the far side of the line — and a semicircle
from there ends 2R on the wrong side of the next line, not on it. **There is no inboard variant of a
tangent reversal**, which is exactly what `racetrackTurn`'s own header has said about its own shape all
along; the semicircle's `side` option contradicted it. Over 450 reversal geometries x 3 vessel profiles,
**every** inboard semicircle asks more of the hull than it can hold (93-212 deg/s against a 60/20/25
deg/s hull); every other shape asks at most 22.

**⚠ WHERE THE HONOLULU ESCAPE FIRED, AND WHAT THE TURN DID NOT DO.** Route vertex 18 — the 4th of the six
arc vertices of the rung-5 turn at wpts 14-23 — with the boat tracking the commanded polyline to
**0.26 m**. So the turn did **not** throw her off her route, and any account that says so is wrong (an
earlier draft of this work said it). What it did was ask for a 165-degree reversal at the join, which
cost her half her way (**sog 1.98 -> 0.94 kn**, recorded) and swung her COG through ~205 degrees — and an
instantaneous COG mid-pirouette is exactly what the guard's reach test projects on. That is the seam with
H1, and it is why the turns were worth doing first.

Joints over 90 degrees, counted over whole plans: Honolulu route 38 of 413; `bak5` 10; `bak4` 4;
`bak1` 6. ⚠ **Those counts are THREE defects, not one**, and all 38 of Honolulu's are now attributed:

| producer | joints | vertices |
|---|---|---|
| **A** — inside a mirrored INBOARD arc (rungs 5/6) — **the only one this work fixes** | 8 | 15, 21, 59, 65, 286, 292, 372, 378 |
| **B** — a reversal INSIDE the gate that got no turn at all (18 pairs, the straight-180) | 19 | 31, 32, 35, 36, 39, 40, 42, 46, 56, 57, 67, 79, 88, 97, 106, 301, 333, 365, 397 |
| **C** — a reversal that FAILED the gate, so no turn was attempted | 7 | 174, 304 (straight); 138, 329, 332, 342, 406 (routed by `around`) |
| **D** — a same-direction hop between two parallel runs | 3 | 28, 29 (straight); 70 (routed by `around`) |
| **E** — the ENC-routed approach meeting coverage line 1 | 1 | 14 |

**So this removes 8 of the 38.** B is the still-open "staggered reversals judged as hops" chip.
C + D + E = 11 are the junction class: they are not reversals the gate accepted, so no turn is
generated for them at all, and `pruneJunctionKnots` reaches only the ones that came out of
`routeAround`.

**⚠ THE FIRST CUT OF THIS TABLE HAD SIX VERTICES IN THE WRONG BUCKET, AND IT IS FIXED HERE
(2026-09-19).** Its counts — 8 / 19 / 11 — were right and stand. Its enumerated list for the third
class was a clean six-for-six swap: `32, 36, 42, 301, 365, 397` are B (the chip's class, not a new
one) and `28, 29, 138, 174, 342, 406` are the junction class. Re-derived from the plan's own
structure, not from the route alone: the session log carries the committed plan beside the upload
(`/api/mission` rev 69 — 398 waypoints, 74 lines, buffer 5, min depth 3, lead 0/0, ease arc, every
speed `survey`), all 398 plan waypoints match into the 415-point route, each of the 74 lines is
exactly two ADJACENT waypoints, and the 17 remaining route points are Upload's own insertions. So
every join is either "n joining points" or "none", with no inference. Spacing measures 10.00 m, so
punchOut's gate is `10.00 × 4.6 + 3 + 0 = 49.00 m`; the 18 B-pairs inside it with zero joining
points are exactly the 18 the 2026-09-16 handoff counted on his console that evening.

**Why nothing caught it:** `turnFlyable` (static/js/turns.js) asks whether the *projected track clears
keep-outs*, not whether the hull can *join* the shape — measured, it passed **120 of 120** cusped shapes.
`legClear` passes every chord, because every chord is lawful water. And `junctionKnot` /
`pruneJunctionKnots` (static/js/passage.js), exactly a ">150 degrees with <12 m on the shorter leg"
detector, is applied ONLY to routed detours in punchOut's `around` branch, never to generated turns. The
Add-to-plan refusal (`035878f1`) does not check turn shape either — only that a turn exists.

**THE FIX, SHIPPED:** `turnJoinable` in `static/js/turns.js`, asked by `turnWithRetry` ahead of
`turnFlyable`. A generated reversal must leave the line on `hE` and arrive on `hF`. Clause 1 refuses a
join past a quarter turn — a sign change rather than a tuned threshold, and the populations are nowhere
near it (worst legitimate join 45 deg, mirrored 175). Clause 2 refuses a join tighter than the hull's own
rate over the leg it has to turn on, judged at the PLAN's speed so a slowed rung cannot buy itself a
join. Held by `tests/turn_geometry.js` 50-57 (nine mutations recorded, nothing surviving) and
`tests/direct_turn.js` 10/10a/10b/10c.

**⚠ OPERATIONAL CONSEQUENCE: the 10 turns in the table above now REFUSE.** Those pairs go red and Add to
plan refuses the pattern until the operator moves the line ends, strikes a run or widens the spacing.
That is the intended trade, and it is only safe because `035878f1` made a refused reversal visible
instead of shipping it as a straight leg.

### ⇒ THE JUNCTION CLASS (C + D + E), MEASURED 2026-09-19 — THEY ARE ALL FLYABLE

The 11 were opened on the assumption that they were knots nobody had measured. They are not knots,
and they are not unflyable. **Nothing was changed for them; what follows is the measurement.**

**The hull tracks every one of them at the plan speed.** The recorded route was flown through the
REAL simulator in-process (`SimVcu.tick` on a temp copy of the program, `zboat_1800hs`, calm —
`ENV.field()` None, `CURRENTS.snapshot().ok` false), so the only question asked is whether the hull
can hold the corner. Departure from the commanded polyline:

| | @ low 1.5 kn | @ survey 3.0 kn (the plan) | @ high 6.0 kn |
|---|---|---|---|
| the 11 junctions | 0.18–0.56 m | **0.90–1.95 m** | 2.55–4.48 m |
| the 8 A-joints (now refused) | 1.22–1.27 m | 2.69–2.77 m | 4.23–5.84 m |
| max over all 414 vertices | **1.41 m** | **2.88 m** | **5.88 m** |

29 403 m of route flown in 19 099 s against 19 052 s of pure transit — **+47 s over 414 corners, and
the follower captures every leg.** The plan-wide maximum is `1.4 × minTurnRadiusM(planSpeed)`
(measured ratios 1.37 / 1.40 / 1.42), i.e. the 2R overshoot — a number the planner already holds.

**Checked against the recording, not only against itself.** She flew vertices 14 and 15 at speed key
`low` (the console commanded it at 19:10:35, four seconds after the 103 s page stall ended). Recorded
departure at v14 **0.32 m** against 0.19 m simulated; at v15 **1.58 m** against 1.27 m; every other
flown vertex agrees within ~0.3 m. The calm model understates, as it must with a set running.

**What the corner costs, against his own chart.** The keep-out model was rebuilt from
`charts/enc/features_v5_-157.9177_21.2616_-157.8212_21.3515.json` at buffer 5 / min depth 3: **1044
zones against the 1043 the page logged that session**, minimum waypoint clearance 5.03 m, and **265 of
415 waypoints within 10 m of a keep-out** — the same 265 H3 reports, so it is his model.

* commanded route: **0 waypoints inside the buffer** (H3 again).
* flown at 1.5 kn: **0 of 413 vertices** take the hull inside the buffer.
* flown at 3.0 kn: **12 of 413 — and all 12 are at over-90 joints, none anywhere else.**

Those 12 are 4 in A (already refused), **7 in B** (the chip), and **exactly one of the 11** — v332,
5.10 m of commanded clearance down to 3.93 m flown.

**⚠ THE KNOT RULE CANNOT REACH THEM AT ANY WIRING, AND THAT IS THE ANSWER TO "SHOULD IT".**
`junctionKnot` over all 38 fires at **15, 21, 59, 65, 286, 292, 372, 378 and nothing else** — the 8
`turnJoinable` already refuses at generation. So wiring `pruneJunctionKnots` into the `legSafe`
branch, the parallel-hop branch or `routePlan`'s approach seam would change **nothing** on this route.
At v70, v138, v329/332, v342 and v406 it ALREADY RAN (they came out of `around`) and correctly
declined: none exceeds 150° and the legs are 15–65 m, not under 12. Reaching the 11 needs about
120° / 30 m, which flags 29 of the 38 — at which point it is not a knot detector, it is "every joint
over 90°". **Do not widen the thresholds.**

**WHAT IS ACTUALLY MISSING IS A CALL THE CONSOLE ALREADY OWNS.** `projectRoute`'s own header states
this failure — *"a corner waypoint the hull cannot turn at … routeAround puts its corner waypoints ON
the buffer edge, 7 m off a pier face, where a 10 m turn circle reaches 3 m INSIDE the structure"* —
and `turnFlyable` asks it, at the vessel's real rate, for every GENERATED TURN. No junction ever gets
that call, at plan time or at Upload. The measured harm is not a knot; it is an unasked projection.

**⚠ AND THE COVERAGE STANDOFF (`ea5e361f`) DOES NOT COVER IT — BY THAT COMMIT'S OWN STATED SCOPE.**
The measurements above were taken at `3b15a8d4`, before item 3 landed, so the question has to be asked
again against the tip. Two things keep the answer the same. (1) `guardStandoffM(buf, 0)` =
`max(buf, buf/2 + 0)` = **the buffer**: in calm water the clip is exactly where it was, so all 12
breaches stand unchanged. The set that would buy enough room to swallow a 2.88 m corner on a 5 m
buffer is **0.52 kn** (`2.5 + 20d >= 7.88`), and the census says the 13 sessions at or under 0.46 kn
produced no escapes at all — so the low-set case is precisely the one the standoff does not help and
precisely the one nothing else was watching. (2) Item 3's own note says it: *"It is the COVERAGE LINES
only: turns and transits still answer to the plain buffer."* Every junction here is a line END joined
by a transit or a turn — the water the clip deliberately did not move.

**NO OVERLAP WITH `DEPARTURE_PARADIGM.md`, STRUCTURALLY.** R2 would latch no grant at Honolulu at all
— the 19:04:48 launch point has `holdClearM` **48.30 m** against `need0` 6.00 m, so the console
certifies that water for itself. And R6 caps the corridor at `snapCapM(5) = 150 m` while the nearest
of the 11 (v14) is **518 m** along the route; the rest are 876 m, 1171 m, 1698 m, 3987 m and 21–28 km.
**One thing goes back the other way:** R5's half-width is `max(loa 1.90, minTurnRadiusM("low") 1.03)
= 1.90 m` for this hull, and the measured corner departure is 1.41 m at low but **2.88 m at survey**.
R5's corridor holds only because R8 flies the departure at `low`. The two rules are load-bearing on
each other and the document does not say so.

## THE RANKED CAUSES (from the reconstruction; measurements are the agents')

1. **H1 — the helm rung is a REACH test, not a danger test. ⚠ FIXED 2026-09-19 — see item 2 of the
   ORDER OF WORK; everything below describes the rung AS IT WAS.** `assess` (guard.js:489, :509) returns
   `helm` on the mere existence of a drift-only entry inside the 45 s horizon, with no margin, no
   depth-of-entry, and no comparison with `tEntry`. Its reach is `buffer + 45 s x |set|`.
   **Census:** every escaping session had max `status.env_set_kn` >= 0.58 kn (1.75, 0.58, 1.00, 1.75);
   all 13 sessions with max set <= 0.46 kn produced 0 escapes in 17 starts. Two sessions at 0.59-0.79 kn
   escaped zero times, so a big set is necessary-ish, not sufficient — geometry is the second term.
   **And the set is never a tidal current**: `state.current.ok` is FALSE at every port, for three
   different reasons, so the drift the top rung rests on is the simulator's wind/wave forcing, published
   only while `_running` — it goes 0.00 to full value in the frame the run starts.
   The banner's asserted cause ("being set onto <kind>") is therefore not what the code established.
2. **H2 — containment is scored in extremis with no projection at all** (verified above). Real danger at
   Pago Pago (4.67 m from a LAND polygon inside a 20 m buffer), answered with the wrong rung.
3. **H3 — the planner/guard seam. ⚠ FIXED 2026-09-19 — see item 3 of the ORDER OF WORK.
   ⚠ AND ITS HEADLINE RATIO IS STALE TWICE OVER: the 3-12x below was measured against the OLD helm
   rung; item 2 cut it to about 1.7x, and item 3 then closed it for the coverage lines.** Plans are clipped to the buffer to within centimetres (measured
   minimum waypoint clearance: 5.05 m against a 5 m buffer; 20.28 m against 20 m; zero waypoints inside
   the buffer anywhere) while the guard's helm rung reaches 3-12x further. 34% and 67% of two routes'
   waypoints sit inside the helm band; 265 of Honolulu's 415 lie within 10 m of a keep-out.
   **One of the two numbers has to move, and the guard's is the arbitrary one.**
4. **H5 — no dwell, no hysteresis, no margin on the top rung.** Honolulu: the route projection entered
   8 s ahead where clearance was 4.95 m — **clipping the 5 m buffer by 5 cm**; the drift-only track
   clipped it by 1 cm. Every gentler rung is damped (release 4 s, edge 2 s, slow-in-lieu 2 s); the helm
   rung fires on one frame.
5. **H6 — escapes chain.** The escape point is never required to survive the guard's own test, and a
   boat that arrives and station-keeps loses its route model (`guardTrack` null), so it is re-judged on
   the straight projection of its own wander plus the drift. Pago Pago 14:04:18 fired 3.5 s after
   arriving at the previous escape's hold point.
6. **H4 — New Castle is UNEXPLAINED. ⚠ AND SO IS HONOLULU (established 2026-09-19).**
   The turn work re-derived the Honolulu escape from the record and could not reproduce its trigger
   either: at the frame the escape fired on, a keep-out model rebuilt from the cached ENC gives the
   boat **12.0 m of clearance and `clear`**. That model is not wrong - it reproduces the console's own
   logged `hold_clear_m` at the escape target to **4 mm** (48.961 m raw against a logged 43.965 m,
   which is the same number less the 5 m buffer). The only model input that differs is `chartInk`,
   the raster-read structures `foldChartInk` pushes into `nogo.ko` - and **nothing records it, in any
   session log, ever** (checked across all of `logs/`). So the class is wider than this entry said:
   an escape that fired against chart ink cannot be reconstructed at all, which is why item 5 below
   is now a prerequisite for VERIFYING any guard change against the recordings rather than a tidy-up.
   The original New Castle wording follows. Both escapes fail to reproduce: the ENC-only rebuild gives the
   boat 10.87 m and 13.09 m of clearance, not blocked, drift-only track clear — `assess` would return
   `clear`. Yet the same model reproduces both escape targets' `hold_clear_m` exactly. The suspect is
   `foldChartInk` (asv.html:6612-6624) pushing raster-read structures into the same model, which
   **nothing logs**. Rebuild the ink before concluding anything about these two.
7. **H7 — the start transient** (no way on, set appears with the first COG, no acceleration model) is
   real but explains only the 2 escapes inside 2 s.

## DO NOT CONCLUDE (each of these was tested and is wrong or unsupported)

- That `escapeCourse` or the command path is at fault: 8 of 10 escape targets reproduce from the cached
  ENC alone, 6 of them at 0.00 m, and every logged `hold_clear_m` reproduces exactly.
- That raising `buffer_m` 5 -> 20 caused the Pago Pago trio: the same spot escaped three times on
  2026-09-16 at `buffer_m` 3.
- That the escape was flown at 6 kn: at Honolulu the guard's `speed high` was overwritten by the
  governor with `low` 5 ms later and `survey` 128 ms after that; `speed_key` never reads `high` in any
  of that session's 1279 frames, max sog after the escape 2.57 kn. (So the rung's own "steerage to beat
  the set" argument was not delivered either.)
- That `status.hold_clear_m` is a live clearance readout: it is the console-supplied disc for the last
  commanded point, echoed back (asv.html:9344, asv_console.py:3670), and it lags one command behind.
- That the 103 s Honolulu page stall caused that escape: it ended 79 s earlier and the guard
  demonstrably evaluated frames in between.
- That `enforce.area` explains New Castle: tested and killed — `escapeCourse` then returns null
  (BOXED IN, no command) and the zone count comes out 1547 against a logged 1463.

## ORDER OF WORK — ANDY'S, 2026-09-19: turns, then the helm rung, then the seam, then the launch grant

1. ~~**The turn geometry.**~~ **DONE 2026-09-19** — see the ESTABLISHED block above. It was the INBOARD
   rung, not a heading-derivation bug; `turnJoinable` now refuses any shape that does not join both
   lines. ⚠ The other half of the over-90-degree joints is the zero-turn straight-180 class and is
   untouched (see STILL OPEN).
2. ~~**The helm rung's selection test**~~ **DONE 2026-09-19.** All four: the reach test is now a danger
   test (`HELM_S` = `HOLD_S` = 20 s, not the 45 s look-ahead), it needs a real depth of entry
   (`HELM_ENTRY_FRAC` = half the operator's buffer, not a 2 mm graze), it is damped like every other
   rung (`HELM_DWELL_MS` 1.5 s, on the ACTION - the alarm still fires on the frame), and the banner
   quotes the projection instead of asserting a set it never measured.
   ⚠ **Trigger distance drops from `buf + 45 s x set` to `buf/2 + 20 s x set`** - 18.4 m to 8.5 m at
   his 0.58 kn set, 45.5 m to 20.5 m at 1.75 kn. A boat with NO WAY ON is exempt from both new tests
   (its drift track IS its ground track, so a hold is what she is already doing - the Eastport case).
   ⚠ **AND IT IS UNVERIFIED AGAINST THE RECORD**, by Andy's decision: see H4 below - the escapes do
   not reproduce, so this is measured on synthetic fixtures only.
3. ~~**The planner/guard seam (H3)**~~ **DONE 2026-09-19.** Andy's choice of four options: make the PLANNER
   clip to what the guard needs. The coverage clip is now taken at `guardStandoffM(buffer, set)` =
   `max(buffer, buffer/2 + HELM_S x set)` - 8.5 m at his 0.58 kn set, 20.5 m at 1.75 kn, on a 5 m buffer -
   and that number is DERIVED from the helm rung's own constants rather than written down twice.
   ⚠ **It costs coverage and the card says so.** ⚠ **It is the COVERAGE LINES only**: turns and transits
   still answer to the plain buffer, so a clipped plan cannot have the helm rung fire ON A LINE in that set,
   but it can still fire in a turn, on a transit, or if the set rises afterwards.
4. **The launch grant** (`DEPARTURE_PARADIGM.md`) for the berth/containment class.
5. **Chart ink at New Castle** — rebuild it; nothing records it today.

## STILL OPEN FROM BEFORE

- Staggered reversals judged as hops (task chip, 2026-09-16): `bak1`-era lines 34->35, next entry 81.9 m
  behind the exit and 10 m across, gap beyond the 4.6-spacing gate, so no turn is tried and nothing is
  flagged. **It is also class B + C above, i.e. 26 of Honolulu's 38 bad joints and 7 of the 12 places
  the hull leaves the certified water — the largest remaining share of both counts.**
- THE CORNER PROJECTION IS NEVER ASKED AT PLAN TIME (opened 2026-09-19, the junction measurement
  above). `turnFlyable` asks `projectRoute` for every generated turn; no junction gets that call, so
  the flown corner is unchecked at the approach seam, at every hop, and at every reversal that did
  not get a turn. Measured consequence at Honolulu: 12 of 413 vertices take the hull inside the
  operator's 5 m buffer at the plan speed, 0 of 413 at `low`. Andy's call, 2026-09-19: **slow through
  the breaching corner** rather than refuse it — the flyability is not in doubt, the speed is.
- A folded detour (`nKnotFold`) still ships with its fold and a banner.
- A punch is dropped on ANY water-level change (`TIDE_REBUILD_M` is 0.1 m for the model rebuild, but
  `patClip` goes on any delta).
- 217 `page_stall` records over 09-17/18, 120 in one 66-minute session — `render()` redraws the whole
  chart every frame, visible or not.

## ⇒ THE REPLAY, DONE — 2026-09-19, ITEM 4 STAGE 1

The paradigm's "How to prove it" asks for three recorded escapes to be replayed from the REAL
ENC extracts, per upload window. Done. The headline is not the one the plan expected.

**THE MODEL IS IDENTIFIED, NOT ASSUMED, AND THE ORACLE IS THE CONSOLE'S OWN NUMBER.** Nothing in
any session log records which extract was loaded, nor the buffer, nor the min depth. But every
`/api/cmd/escape` body carries `hold_clear_m` for its target — a number the console computed and
the vessel acted on — so the model is found by search: the combination that reproduces it IS the
model the console had, and a combination that does not is the wrong model, on which no rung level
means anything. All three reproduce:

| episode | extract | buffer | min depth | logged `hold_clear_m` | rebuilt | error |
|---|---|---|---|---|---|---|
| New Castle 10:47:15 | `features_v5_-70.7118_43.0715_-70.7098_43.0730` | **3 m** | 2.0 m | 43.342772 m | 43.342638 m | **0.1 mm** |
| Pago Pago 14:03:22 | `features_v5_-170.7407_-14.3167_-170.6480_-14.2269` | **20 m** | 1.0 m | 22.799859 m | 22.799861 m | **0.002 mm** |
| Erie 13:54:23 | `features_v5_-80.1263_42.1146_-80.0052_42.2044` | **3 m** | 1.0 m | 19.160262 m | 19.165377 m | **5.2 mm** |

⚠ **THE BUFFERS ARE 3 m, 20 m AND 3 m — NOT THE 5 m THE PARADIGM'S WORKED EXAMPLES ASSUME.** Every
metre figure in that document's lifecycle section is a DriX at 5 m and should be read as an
illustration, not as a record of these sessions.

**⚠⚠ TWO OF THE THREE ESCAPES STILL DO NOT REPRODUCE, ON THEIR OWN IDENTIFIED MODELS.** Asked of
the shipped `assess` at every telemetry frame within ±30 s of the escape command:

| episode | frames | highest rung reached | reproduces? |
|---|---|---|---|
| New Castle | 54 | **HOLD** (t+26.8 s, 17.5 m clear) | **no** |
| Pago Pago | 57 | **HELM on 6 frames** | **YES** |
| Erie | 55 | **SLOW** (t+15.3 s, 26.9 m clear) | **no** |

This CONFIRMS and EXTENDS the finding already recorded above for Honolulu and New Castle, and it
settles Erie into the same class. The only input that differs is `chartInk`, which nothing records
in any session log, ever — so item 5 (record the chart ink) remains a PREREQUISITE for verifying
any guard change against the record. Do not read a "does not reproduce" row as "the guard was
wrong"; read it as "the console saw something this repo cannot see".

**⇒ AND PAGO PAGO, THE ONE THAT DOES REPRODUCE, IS DECISIVE.**

Spawn 14:01:57 → upload 14:03:20 (92 waypoints) → Start 14:03:22.200 → escape 14:03:22.649,
**0.449 s after Start**. On the identified model the launch latches (R2): the boat has **0.00 m**
of certified clear water against a 6.0 m need. Four features are granted — `land` and three
`a dock / pier` — and **none is refused**, so nothing un-grantable is holding the departure. The
corridor is 1.9 m half-width (the small-class boat's own scale, buffer-INDEPENDENT — note it is
1.9 m against a 20 m buffer, which is the point of R5) and the gate lands 30.0 m along the spine.

| t vs escape | sog | cog | clearance | FULL model | GRANTED model | in corridor |
|---|---|---|---|---|---|---|
| +1.13 s | 1.10 kn | 142.2° | 3.9 m | **HELM** | CLEAR | yes |
| +2.14 s | 3.16 kn | 256.0° | 4.7 m | **HELM** | CLEAR | yes |
| +3.14 s | 5.34 kn | 276.8° | 7.1 m | **HELM** | CLEAR | yes |
| +4.15 s | 5.61 kn | 273.8° | 10.0 m | **HELM** | CLEAR | yes |
| +5.16 s | 5.56 kn | 272.0° | 12.9 m | **HELM** | CLEAR | yes |
| +7.17 s | 5.54 kn | 271.3° | 18.6 m | **HELM** | CLEAR | yes |

**6 of 6 in-extremis frames are disarmed by the grant, and every one of them is inside the
corridor.** 124 features in the true model, 120 in the one the ladder is handed.

⚠ **BE PRECISE ABOUT WHICH FRAMES THESE ARE.** They are the frames DURING the escape, not the
frame that triggered it — the trigger frame does not reproduce either. What reproduces is the
sustained in-extremis condition the escape ran through, and that is what the grant removes.

**⚠⚠ AND THE 20 s BEFORE START IS THE WHOLE STAGE 0 ARGUMENT, MEASURED.** Every one of the
**19 consecutive telemetry frames** in the 20 s before Start reads `sog 0.0, cog null` — a stopped
boat lying **4.9 m off a pier**. On today's console those frames read **BLIND**. Before
`49d542ce` they read **CLEAR**: for twenty seconds the console told the operator the water was
clear while the boat lay four metres off a dock and it could not see at all, and then commanded a
14 kn escape 0.449 s after Start. The escape fires on the first frame she has a course.

**WHAT THE REPLAY CANNOT BE.** `charts/` and `logs/` are gitignored, so none of this can ship as a
suite — a check that reads them fails for anyone who clones the repo, and would fail in the hook.
It is recorded here as evidence and the scripts are disposable. `tests/berth_grant.js` holds the
INVARIANTS on fixtures; this section holds the measurement against the record.

**ERIE IS NOT A LAUNCH-GRANT CASE AT ALL, AND THE PARADIGM IS WRONG TO LIST IT.** Its escape
followed a `/api/cmd/goto` at 13:54:23, from a position **151.7 m** from the 13:52:00 spawn, and
there is **no upload after that spawn** in the whole window. `certifyDeparture()` runs at Upload,
so no grant is ever armed, the boat is outside any corridor, and the launch grant leaves that
escape exactly as it is. Whatever fires it, it is not a departure.

