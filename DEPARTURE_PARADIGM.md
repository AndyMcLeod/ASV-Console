# THE LAUNCH GRANT - the paradigm for leaving (and returning to) a berth

Designed 2026-09-19. Andy set the axiom it rests on:

> "Assume all starts are close to a pier or other feature. Assume this for water depth, too.
> If a user places the ASV in the water for a mission start, it is by definition safe."

**NOTHING HERE IS BUILT.** This is the design, its evidence, and the decisions still open.
**Read `ESCAPE_FINDINGS.md` FIRST**: the evidence says this paradigm answers 2-4 of the 11 recorded
escapes and NOT the largest class, so the order of work in that file outranks the staging in this one.

Produced by a nine-agent design panel (four independent proposals from distinct angles, three judges,
one synthesis) reading the real code. Every file:line below came from that reading; the load-bearing
ones were re-verified by hand - see ESCAPE_FINDINGS.md, "What was verified directly".

## The model

THE LAUNCH GRANT — one object, three conjuncts, four regimes.

SAYABLE IN FIVE SENTENCES. The water a person put the boat in is certified by that act and by nothing else, so the console records the launch as a POINT and works out, at plan time, the way OUT of it — the plan's own first legs, as far as the first water the console can certify for itself. While the boat is on that checked way out, `clearanceGuard` hands `guardAssess` a keep-out model with the launched-against features REMOVED; the ladder, its thresholds and its arithmetic are untouched, it answers a true question about a smaller world, and it answers the full question about everything else in the same frame. The grant is bounded three ways at once — by IDENTITY (only the features that make the launch point uncertifiable), by PLACE (only inside the corridor the planner drew out of it), and by PROOF (only until the console can certify the water she is in for itself). Where the proof never arrives the grant ends by recession, by leaving the corridor, or by a clock — and no end is silent and none is instant. The same object, run backwards, is the recovery.

THE PRINCIPLE THAT DECIDES EVERY BOUNDARY: the console may stand down only against the thing the operator's act certified, only where the planner checked the way out of it, and only until the console can certify the water itself. All three, or the suppression goes.

THE FOUR REGIMES, and who is responsible in each.

  OPEN — no grant stands. Today's console, byte for byte: the five-rung ladder, the escape, the gate `armed && !estop && supervising()` (static/asv.html:1820). No second model is built and no extra call is made. Responsible: THE CONSOLE, entirely. This is the overwhelming majority of every mission and it is the default at every ambiguity.

  BERTHED — a grant stands and `guardTrack()` is null (static/asv.html:1617-1631): she is not being steered along anything — before Start, paused, stopped, holding, or on RC. Responsible: THE OPERATOR for the granted features, THE CONSOLE for everything else, simultaneously, on the same frame.

  DEPARTING — a grant stands and `guardTrack()` is non-null: she is making way along the route the planner checked. Responsible: THE PLAN, under the console's supervision.

  RECOVERING — the mirror: the same object with the spine reversed, entered only by an operator's press or by arriving at a berth latched in this session, and ending in a STOP rather than a hold.

WHY `guardTrack() !== null` IS THE REGIME KEY AND NOT A NEW PREDICATE. That function's three conditions are exactly what decides whether `assess` uses `projectRoute` or the straight `timeToEntry` (static/js/guard.js:476-481). Keying the regime on it means the regime and the projection model agree BY CONSTRUCTION: you are DEPARTING exactly when the guard can see the route you are departing on, and BERTHED exactly when it cannot. It also keeps the strings `run === "running"` and `st.holding` out of `clearanceGuard` itself, which tests/clearance_guard.js:427-431 greps the raw source for.

WHY THE SUPPRESSION IS A MODEL AND NOT A BRANCH. The escape at a berth is reached by a POSITION test, not a threshold: `blocked(p, ko, buf)` short-circuits BOTH projections to zero (static/js/guard.js:194 and :246) before the stationary test at :198, before the horizon, the step, the speed or the set are consulted — so `tEntry = tDrift = 0` and `assess` lands on `helm` with nothing else read. There is no number to tune. Handing the ladder a different keep-out VIEW is the only change that reaches the mechanism without putting a deletable `if` where the safety is.

## The rules

### R1

THE LATCH IS AT THE LAUNCH AND ONLY THERE. A berth is `{at:{lat,lon}, t, by}` taken at one instant and never re-derived, the same discipline as `pauseMark` (static/asv.html:1463) and `markGuardHeld` (static/asv.html:1712). It fires on exactly three events: (a) the first telemetry frame in which there is a fix, `nogo.ready` is true, and NO motion has ever been commanded this session (`run_seq === 0`, asv_console.py:4741) — the console already records that instant as `self.home` (asv_console.py:4614-4616) and has never read it for anything else; (b) `/api/cmd/spawn` in sim; (c) the operator's SHE IS BERTHED HERE. Checkable: a boat set onto a pier at 14:30 has `run_seq > 0` and is hundreds of metres from `berth.at`, so she gets NO grant and today's full ladder, including the helm. That single rule is what stops this being a licence.

### R2

NO GRANT IS ISSUED WHERE THE CONSOLE CAN ALREADY CERTIFY THE WATER. The latch requires `blockedInfo(p, ko, buf) || holdClearM(p, ko, buf) < need0` — `holdTarget`'s own two-line berth test (static/js/passage.js:322-323), lifted whole so the planner and the grant cannot disagree about what a berth IS. If the launch water certifies, nothing is latched, nothing is suppressed, and the case needs no handling because the guard would not have fired.

### R3

MEMBERSHIP IS RE-DERIVED EVERY FRAME, NEVER REMEMBERED. A feature `f` of the LIVE `nogo.ko` is GRANTED iff `featureClearanceM(berthEN, f) - buf < need0`: it is one of the features that makes the launch point uncertifiable. `rebuildNogo` replaces `nogo.ko` wholesale on 0.1 m of tide (static/asv.html:5396, TIDE_REBUILD_M at :5430, fired by applyWaterOffset at :5452-5453), so a remembered feature object, signature or bounding box is a gate keyed on invalidated state. Remember the POINT; re-derive the MODEL. Memoized on `ko` object identity + `berthEN` + `buf` + `need0`, all of which are stable between rebuilds — so the ~800 µs model walk runs once per rebuild, not per frame.

### R4

SOME KINDS CAN NEVER BE GRANTED. `a charted hazard`, `a channel buoy`, `a dredged area` and `a restricted area` (static/js/keepouts.js:591-602) are excluded by name, permanently, and the operator cannot name them either. A wreck at a berth is still a wreck, and none of those four is a thing a person standing on a float certified by looking at the water. Grantable: `a dock / pier`, `the shoreline`, `land`, `a bridge support`, and the depth kinds `water shallower than N m`. Checkable: if the ONLY reason the launch water is uncertifiable is an un-grantable kind, the Upload is REFUSED by name.

### R5

THE GRANT'S PLACE IS THE CORRIDOR, AND THE CORRIDOR IS THE PLANNER'S OWN ROUTE. Spine = `berth.at` then the uploaded `plan.route`, walked until the GATE; half-width `halfM = max(hull.loa_m, minTurnRadiusM("low"))` (static/js/turns.js:89 over static/js/core_turns.js:230-235, TRACKING_MARGIN 1.4 at :187). DriX max(7.71, 8.25) = 8.25 m; Z-Boat max(1.90, 1.03) = 1.90 m; the 4 m USV max(4.00, 3.30) = 4.00 m. Buffer-INDEPENDENT by construction, which is the direct repair of the judged defect that raising the buffer for safety widened the exemption. Nothing is invented: because `legClear` samples i=0 (static/js/keepouts.js:836-838), a blocked start always fails `legPath`'s fast path (static/js/routing.js:496-497) and routes from `routeAround`'s snapped free cell (:244-262, path emitted at :388-391), and `routePlan` emits `seg[1..]` only (static/js/passage.js:414) — verified live at New Castle, where the first uploaded waypoint sat 44 m from a boat lying 0.97 m off a pier.

### R6

THE GATE IS THE FIRST WATER THE CONSOLE WOULD ITSELF ACCEPT AS A HOLD POINT: the first spine sample with `holdClearM(q, ko, buf) >= need0`, sampled at `max(2, buf/2)` m — the rate `legClear` and `clipLine` already walk flown water at. `need0 = holdMarginM(setMs)` at the latch = `max(HOLD_MARGIN_MIN_M 6.0, setMs × HOLD_S)` (static/js/hold.js:65-70, tied to the guard's own decision budget by import at :44). Searched no further along the spine than `snapCapM(buf) = max(150, 20·buf)` (static/js/hold.js:92) — the cap the hold-point search already refuses beyond. No gate within the cap: REFUSED at Upload.

### R7

TWO GRANTS, ONE CORRIDOR, TWO ENDS, ONE EXTRA CONDITION. The STRUCTURE grant runs to the gate. The DEPTH grant runs only to the DEPTH GATE — the first spine sample not blocked at the buffer by a keep-out whose kind begins `water shallower than` — and holds only while the VESSEL REPORTS `speed_key === "low"` (the rule the hold rung already follows at static/asv.html:1952-1953: a role configured low says nothing about a boat running faster), with `commandedSpeed` (static/asv.html:2148) as the fallback on a link that reports no key, and a missing key with no commanded speed failing CLOSED. The depth grant is precisely the permission to run with `V.NOGO_MIN_DEPTH_M = hull.draft_m + planning.under_keel_clearance_m` (static/asv.html:2737-2738) unverified, and the only speed at which that is defensible is the slowest the hull has.

### R8

THE DEPARTURE IS FLOWN AT LOW, THROUGH THE MACHINERY THAT ALREADY EXISTS. `SPEED_ROLES` (static/asv.html:1175) gains `depart`; `currentActivity()` (static/asv.html:3959) returns `role:"depart"` while a grant stands; `speedGovernor` (static/asv.html:2170-2199) needs no edit. Because `speedRole()` is the classifier's own answer and not a second reading (the one-line rule at static/asv.html:1176-1181), the activity the recorder logs and the speed the boat runs describe one moment. ⚠ NOTHING IS SENT TO THE VESSEL. No `depart_until_m`, no `depart_speed_key`: a range the boat measured from `_plan[0]` and a range the console measured from `berth.at` would be two numbers with one name, measured from different points. The recorded `start 14:03:22.200 → speed high 14:03:22.207` race (logs/asv_20260918-130610.jsonl) is answered by the page never commanding `high`, not by a second enforcer.

### R9

THE EDGE RUNG IS OFF INSIDE ANY GRANT (`edge:false`). `edgeAround` SEARCHES and VERIFIES every candidate against the model it was handed (static/js/guard.js:323, 425, 426), so a dog-leg computed in a model without the launch pier can be routed straight through the launch pier. Stated cost: a second feature during a departure is answered by slow or stop rather than by three metres of deviation, which is a heavier intervention exactly where interventions are most expensive. Taken deliberately.

### R10

YOU MAY NOT STATION-KEEP INSIDE A GRANT. A hold commanded anywhere in the corridor — by the operator's Hold button, by the guard's hold rung, or by an end-of-plan loiter — becomes `/api/cmd/stop`, and the reason is said. Warrant, measured: a hold at a berth ships `hold_clear_m = holdClearAt(asv)` (static/asv.html:2061), recorded as 0.9724 m at New Castle at 10:47:25 (logs/asv_20260918-100307.jsonl), which the vessel answers with `hold_wants_route` (asv_console.py:3451-3457) and the console with a routed re-approach every 3 s (REAPPROACH_MIN_MS, static/asv.html:8322). `hold_clear_m` is NEVER inflated: it is the one console-side number that becomes a vessel-side action with no further check, and its warrant is a geometric construction written into the source (asv_console.py:3436-3441).

### R11

THE PROOF IS THE ONLY SUCCESSFUL END. `holdClearM(boat, UNFILTERED ko, buf) >= holdMarginM(live setMs)`, held `RELEASE_HOLD_MS` = 4000 ms through the existing `releaseSettled(ok, now)` (static/asv.html:1664-1676). Membership uses the FROZEN `need0`; proof uses the LIVE need — both in the conservative direction, so a building set can make proof harder but can never enlarge the granted set. One-shot: once proved, the grant does not re-arm for this run. Checkable, and it is literally the second half of `snapClearRadial`'s own acceptance test (static/js/hold.js:121-126), so a departure ends in water the console would have chosen as a hold point.

### R12

RECESSION ENDS THE GRANT OUTRIGHT, AND ITS GIVE SELF-SCALES. `berthClearM(p) = clearanceM(p, grantedOnlyKo, cap)` against a model of the granted features ALONE (three or four entries, microseconds); `cMax` is its running maximum since the latch, damped over the existing `CLEAR_CLOSING_MS` = 4000 ms window (static/asv.html:1443, 1496-1499). The grant ends when `berthClearM < cMax - give`, `give = max(0.5, min(OVERRIDE_GIVE_M 5.0, 0.5 × cMax))`. Both numbers are the console's own: 5 m is `guardOverrideOk`'s statement of how much worse a situation may get before a permission lapses (static/asv.html:1769-1781), and 0.5 m is `updateClearance`'s own jitter floor (static/asv.html:1497). ⚠ THE HALVING IS THE REPAIR OF A JUDGED DEFECT: a flat 5 m give can never arm at a berth with 0.97 m of water, so the best set-back detector in the set could not fire in the one place it was needed. She loses half the water she has made, or 5 m, whichever is less.

### R13

NOTHING IN THE LIFECYCLE READS A COURSE OR A SPEED OVER GROUND. `groundVel(null, sog)` returns null (static/js/guard.js:178-182) and `clearanceGuard` then substitutes `{level:"clear"}` (static/asv.html:1814-1815), so a model keyed on course would be blind exactly when the boat is alongside and stopped. Every latch, place, proof, recession and stall test is a distance between two positions or a clearance computed from one. Speed enters in exactly one place — the depth grant's cap — and there it reads a reported KEY, not a derived vector.

### R14

THE CLOCK STOPS THE BOAT; IT NEVER RESTORES THE HELM. `until = latch + 3 × spineLenM / (V.SPEED_KN.low × 0.514444)`, floored at 60 s — three times how long the checked way out takes at the only speed it may be flown at, and the one bound that needs NO telemetry at all. DriX on a 47 m corridor: 68 s. At expiry, and on a stall (`cMax` not improved by `halfM` in `HOLD_S` = 20 s, static/js/guard.js:102), the console commands `/api/cmd/stop` and names three physical causes. It does NOT hand the helm back: a boat that is not getting out but is not getting worse is a boat the operator placed and can see, and steering her off the berth she was deliberately put on is the wrong verb. Only R11 (proof), R12 (recession), leaving the corridor, a new commanded motion, loss of the model, or the operator ends the grant itself.

### R15

NO END IS SILENT AND NONE IS INSTANT. Every failure end is announced, and where the full ladder would immediately steer, the helm rung is held for `HOLD_S` = 20 s with a live count on the guard bar and three controls (TAKE THE HELM NOW · HOLD THE GRANT · DROP THE GRANT). Handing a boat still inside a slip's buffer to a guard that commands `V.SPEED_KN.high` on the next frame is the original defect with a delay on it. The PROOF end is the exception: it is a success, it restores everything at once, and it is worded so the operator can never confuse it with a giving-up.

### R16

THE GRANT LIVES ON THE SERVER. Published beside `run_seq` (asv_console.py:4741) and set through a supervisor-gated `POST /api/cmd/berth`, so a supervision handover or a page reload inherits it with its budget where it was. A page-local grant is dropped silently by a handover, and the inheriting tab — which never saw the launch — commands an escape from the berth with nothing in its own UI able to explain it. It also joins `SessionLogger.SALIENT` (asv_console.py:763-766), because the recording must answer "why did the console NOT act" as well as "why did it act", and the 1.0 s state throttle against the 4 Hz tick (asv_console.py:3752) is exactly what made the recorded escape frames ambiguous.

## What the guard may do, regime by regime

WHAT THE GUARD MAY DO, RUNG BY RUNG. "Granted" means a feature passing R3 and R4; "inside" means inside the corridor of R5.

| rung | OPEN | BERTHED | DEPARTING | RECOVERING |
|---|---|---|---|---|
| clearance READOUT + 8 s alarm (TRUE model) | yes | YES, always | YES, always | YES, always |
| edge — /api/cmd/amend | yes | n/a (no route) | SUPPRESSED (R9) | SUPPRESSED |
| slow — commandSpeed("low") | yes | yes | yes (already at low) | yes |
| hold — /api/cmd/hold | yes | becomes /api/cmd/stop | becomes /api/cmd/stop | becomes /api/cmd/stop |
| helm — /api/cmd/escape | yes | SUPPRESSED vs granted | SUPPRESSED vs granted | SUPPRESSED vs granted |

HOW THE SUPPRESSION IS BUILT, AND WHY IT IS NOT A BRANCH. `clearanceGuard` computes `koG = grantFilter(nogo.ko, granted)` and passes it to `guardAssess` (static/asv.html:1815) and to both counterfactuals (:1854, :2012, :2043). The rungs are unreachable against a granted feature because that feature is not in the model they were handed — so there is no `if (departing)` inside a rung for a future edit to delete, and the ladder's source is unchanged apart from which model it reads. `static/js/guard.js` is NOT MODIFIED AT ALL: `timeToEntry` still returns 0 from inside a buffer (tests/in_extremis.js pins that as a killed mutation), `projectRoute` still short-circuits, `assess` still returns `helm` for a boat inside a buffer of a model that contains the thing. The guard's ANSWER stays true; only the MODEL it is asked about, and the console's authority to act on it, move.

AND BECAUSE IT IS A FILTER, THE LOOK-AHEAD GETS LONGER, NOT SHORTER. `projectRoute` stops at the FIRST entry (static/js/guard.js:259). Today at a berth it stops at the launch pier and never looks past it. Under the grant it marches through and finds whatever is thirty seconds further along — which is how a second structure beyond the berth still earns a full-authority rung on the same frame.

SCOPED FOUR WAYS, ALL FOUR REQUIRED FOR A SINGLE FRAME'S SUPPRESSION:
  IDENTITY — the feature makes the launch point uncertifiable (R3), and its kind is grantable (R4).
  PLACE — the boat is inside the corridor (R5). Outside it, nothing is suppressed, ever.
  LIFE — the grant has not been ended by R11 proof, R12 recession, corridor exit, a new commanded motion, loss of the model, or the operator.
  SPEED — for depth only: the vessel reports `low`, and a null key with no commanded speed fails closed (R7).

UNTOUCHABLE IN EVERY REGIME, WITHOUT EXCEPTION:
  * `updateClearance()` (static/asv.html:1484-1508) on the UNFILTERED model. The metres and the `kind` the operator reads are always the true ones. The 8-second re-say (static/asv.html:1884) is not suppressed; while a grant stands it gains the sentence naming what is standing down and against what.
  * `escapeCourse` (static/js/guard.js:566-638) on the TRUE model at its one call site (static/asv.html:2086), so an escape driven by an UNGRANTED feature never steers toward a granted one, and its refusal (`null` = BOXED IN, :636-637) remains a real answer.
  * `holdClearAt(ll)` (static/asv.html:1341-1344) on the TRUE model at all eight call sites. NEVER inflated. It is the only console-side number that becomes a vessel-side action with no further check (asv_console.py:3436-3457), and its warrant is the geometric construction at :3438-3441.
  * `snapClearRadial`, `holdTarget`, `holdMarginM` — the TRUE model, always.
  * The `act` gate, `!!(S && S.armed && !S.estop) && supervising()` (static/asv.html:1820), unchanged. NO RUN-STATE CONDITION IS ADDED ANYWHERE: that is the recorded killed mutation at tests/in_extremis.js ("the old run/holding gate comes back → 14"), and its reason is Eastport — a station-keeping boat being set into a pier (static/asv.html:1519-1523).
  * Every rung against every UNGRANTED feature, on the same frame, at full strength: a second pier, the far bank, a bridge support 40 m along, a charted hazard, a wreck, a channel buoy, a restricted area, and the plan's own legs once she is making way.
  * E-STOP, Stop, Pause and the RC transmitter. The RC transmitter remains master.

WHAT THE GRANT CANNOT REACH, BY CONSTRUCTION. `buildKeepouts` (static/js/keepouts.js:621) is built from ENC features only; AIS and ROC contacts never enter `ko`, and `grantFilter` only ever filters `ko`. So the grant cannot quiet a moving-contact alarm even if someone wanted it to — and the honest corollary, which must be said rather than glossed: the guard does not watch moving contacts inside a grant because it does not watch them outside one either.

SPOKEN, OR IT IS A DISABLED SAFETY. While a grant stands, the console assesses the TRUE model once per `EDGE_REASSESS_MS` = 2000 ms with `edge:false` — one straight projection, about 9 ms — purely so the bar can say "the guard WOULD be IN EXTREMIS against your launch berth". Printed only when the true-model assess earns it, so it is evidence and not decoration. Every suppression ACTUALLY EXERCISED is logged with its rung, the feature's kind and the metres.

## Decided before the prop turns

EVERYTHING THAT IS A JUDGEMENT IS DECIDED BEFORE THE PROP TURNS, at the one moment the operator can still fix it — the precedent `punchRefusal` set on 2026-09-16 (static/asv.html:5010-5056: refuse where the pattern is still live and every remedy is one press away, and name only remedies that can work). Run time performs OBSERVATIONS only: a distance to a polyline, one `holdClearM`, one three-entry `clearanceM`, and two clock comparisons. THE RULE, one sentence: RUN TIME MAY ONLY SPEND A GRANT, NEVER ISSUE OR WIDEN ONE.

COMPUTED IN `doUpload` (static/asv.html:9296-9348), after `routePlan` and before the `/api/cmd/upload` POST — beside the existing `runUnsafe` refusal at :9331-9340, with the same consequence:
  1. IS SHE BERTHED — `blockedInfo(boatEN, ko, buf) || holdClearM(boatEN, ko, buf) < need0` (static/js/passage.js:322-323). No → no grant, ship exactly as today.
  2. MEMBERSHIP — the granted set and its NAMES and COUNT, by R3 and R4.
  3. THE GATE and THE DEPTH GATE — walk the spine at `max(2, buf/2)` m to the first `holdClearM >= need0`, and to the first sample not blocked by a depth-kind feature, capped at `snapCapM(buf)` along-track.
  4. THE TRIPWIRE — every blocked spine sample from `berth.at` to the gate must be blocked by a GRANTED feature only, checked with `firstBlockAlong` (static/js/keepouts.js:850) against the ungranted-only model. ⚠ BY CONSTRUCTION THIS CANNOT FIRE: `gateLegClear` tolerates a block only where the endpoint ITSELF is blocked and the block is within 2·buf of it (static/js/routing.js:1087-1099, warrant at :1065-1082), and `routeAround` snaps a blocked start to the nearest free cell (:244-262). That is exactly why it is EVALUATED rather than believed. If it ever fires, the planner and the runtime guard have diverged about the same object, and that is the single most important sentence the console can say.
  5. FREEZE — `halfM`, `spineLen`, `gate`, `depthGate`, `need0`, `c0`, `until`, the granted names and count, and the `run_seq` it belongs to. ⚠ THE EXTENT IS NEVER RE-DERIVED IN FLIGHT. If it were recomputed from a set that builds, an intervention could enlarge the water its own grant covers.

WHAT TRAVELS WITH THE PLAN. To the SERVER: the grant object, on the state frame beside `run_seq` and in SALIENT. To the VESSEL: NOTHING NEW. `upload_plan`'s signature (asv_console.py:3167-3197) is untouched. SimVcu has no keep-out model of its own (asv_console.py:3436-3437) and can only obey `hold_clear_m`, `coast_from_m`, `approach_m`, a route and a speed key; a "berth" flag would be inert and an inflated `hold_clear_m` would be a lie the hull cannot check.

REFUSED AT PLAN TIME, by ONE function `departRefusal()` in `punchRefusal`'s form — read by the Upload button's disabled state, by its tooltip, by the amber row under it, and by `doUpload`, so the three cannot disagree. In every case `plan_uploaded` stays false and Start stays gated. There is no "upload anyway" fallback: a silent fallback here is the console granting itself the whole run.

  NO CERTIFIABLE WATER WITHIN THE CAP —
  "UPLOAD BLOCKED — no water this console can certify within 150 m of the boat along this plan: the whole way out stays inside the 5 m buffer of a dock / pier, and the most clear water anywhere on it is 3.1 m against the 6.0 m this set needs. The SURVEY is fine; the DEPARTURE is what would be uncommanded. To fix: move the first waypoint out into the channel, lower Buf m to 3 m (the gate is then 41 m out; the floor for this hull is 5.0 m, so this needs the vessel file changed), relaunch clear of the slip — or DEPART UNDER THE CLOCK, which grants the departure for 60 s and 41 m with no proof at the end of it."

  THE WAY OUT PASSES SOMETHING SHE WAS NOT LAUNCHED AGAINST (the tripwire) —
  "UPLOAD BLOCKED — the way out of this berth passes within 5 m of a bridge support 34 m along. That is not the dock / pier she is lying against, and the console will not grant a departure past a second feature. To fix: move the first waypoint so the way out leaves on the other side of it, widen Buf m so the router takes her round it — or I CAN SEE THAT, which names THAT ONE feature for THIS departure only."

  THE ONLY THING MAKING THE LAUNCH UNCERTIFIABLE IS UN-GRANTABLE —
  "UPLOAD BLOCKED — the console cannot certify this water because of a charted hazard 4 m off, and a charted hazard is not something the console will stand down against however the boat got here. Nothing was sent. Move her, or turn hazard enforcement off if that hazard is not real."

THE OPERATOR'S TWO ANSWERS, both shaped like `guardOverrideOk` (static/asv.html:1752-1781) — a record of ONE decision taken while looking at ONE situation, never a mode. Accepted only while `run !== "running"`, only at the PRESENT fix (never a clicked point), naming the SPECIFIC feature or the specific refusal, logged as a `/api/logevent`, and lapsing at the end of the run. Neither can ever cover an un-grantable kind. DEPART UNDER THE CLOCK removes only the PROOF end — the corridor, the clock, the stall and the recession test all still run, and the bar says "NO PROOF END — YOUR CLOCK" for the grant's whole life. THE REASON THEY EXIST: a refusal whose only lever is lowering a buffer will be answered by lowering the buffer, which costs protection for the whole run instead of forty metres of slip.

AND THE ONE THING THAT MUST NOT BE FORGOTTEN AT PLAN TIME. Any dialog that issues or explains a grant passes `{always: true}` to `guiConfirm` (static/asv.html:9262-9274): it auto-resolves YES in sim mode at :9266, which is the mode he runs every day, and the repo already uses that flag for the unrouted upload on exactly the applicable reasoning — the answer changes what the console CHECKS, not only what the boat does.

## The lifecycle

A RUN AT A BERTH, IN ORDER. Numbers are a DriX (vessels/drix08.json: loa 7.71 m, low 4.0 kn, high 14.0 kn, turn 20°/s, buffer floor 5.0 m) at New Castle in slack water, from logs/asv_20260918-100307.jsonl.

1. LINK UP, FIRST FIX. `run_seq === 0`, `nogo.ready` true, `holdClearM(boat) = 0.97 m < need0 = 6.0 m`. LATCH: `berth.at = 43.072110, -70.710912`. Spine = [berth.at] alone, so the grant region is an 8.25 m disc. Regime BERTHED. The server publishes `departure`. Bar: "BERTHED — 0.97 m off a dock / pier. The console cannot certify this water; you can. The HELM stands down against 2 named features inside 8.3 m of here. Everything else has the full guard. [DROP THE GRANT]".

2. ARM. Unchanged (static/asv.html:9275-9280). ⚠ From this instant, today, the console may command `/api/cmd/escape` on an idle boat — `Engine.escape` gates only on armed and not-estop (asv_console.py:4139-4140) and `act` carries no run state (static/asv.html:1820). Under the grant it cannot, because the launch pier is not in the model the ladder was handed.

3. UPLOAD. `routePlan` builds the 203-waypoint plan; the first emitted waypoint is 44 m out, in free water. Then, before `/api/cmd/upload` goes out: membership (2 granted features, both `a dock / pier`); the GATE by walking the spine at 2.5 m steps to the first `holdClearM >= 6.0 m` — found at 41 m, 18.2 m of clear water; the DEPTH GATE at 11 m; the TRIPWIRE (every blocked spine sample to the gate is blocked by a granted feature only) — passes; `halfM = 8.25 m`, `spineLen = 41 m`, `until = latch + 60 s` (3×41/2.058 = 60 s), `c0 = 0.97 m`. Frozen into the plan and POSTed with it. Intent card gains the DEPARTURE block. Plan uploaded and STAGED.

4. START. `/api/cmd/start`. `run` → running, `run_seq` 1. Regime → DEPARTING on the first frame `guardTrack()` returns non-null.

5. EVERY TELEMETRY FRAME, in the order the page already runs them (`clearanceGuard` first, static/asv.html:10089). `updateClearance()` on the TRUE model — the operator's metres and kind never move. `berthPhase()` computes the regime, membership (memoized), place, and the five ends. `clearanceGuard` picks `koG = grantFilter(nogo.ko, granted)` when a grant stands, and passes it to `guardAssess` and to both counterfactuals. `escapeCourse` and `holdClearAt` stay on `nogo.ko`.

6. THE FRAME THAT USED TO ESCAPE. 1.17 s after Start, `blocked(p, nogo.ko, 5)` is true — but the two `a dock / pier` entries are not in `koG`, so `timeToEntry` does not short-circuit, the drift march finds nothing within 45 s, and `assess` returns `clear`. No `/api/cmd/escape`. No `/api/cmd/speed high`: `speedRole()` is `depart` and the governor commands `low`. The bar reads "DEPARTING — 1.1 m off a dock / pier · 33 m to certified water · LOW · the guard would be IN EXTREMIS here" — the last clause printed only when a TRUE-model `assess` with `edge:false`, run once per 2000 ms, actually says so.

7. COMMANDS AVAILABLE THROUGHOUT: Stop, Pause, E-STOP, the RC transmitter, the speed selector, DROP THE GRANT. Nothing is added to the command set.

8. PROOF. At 41 m she reads `holdClearM = 18.4 m >= 6.0 m`; four seconds of dwell; grant SPENT. Speed role returns to `transit`; the governor commands the plan speed; `koG` becomes `nogo.ko`; the full five-rung ladder has her. Banner: "DEPARTURE PROVED — 18.4 m of clear water, more than the 6.0 m this set needs, 41 m from the launch. FULL CLEARANCE AUTHORITY RESTORED." Written permanently into `planIntent.why` (static/asv.html:1345) so the readout outlives its trigger.

9. WORKING. Regime OPEN for the rest of the run. Every rung, every threshold, every escape exactly as today. This is the state 199 of the 203 waypoints are flown in.

10. END OF PLAN. Unchanged. `completion` is the operator's standing setting; `CHAINABLE_BEHAVIORS` (static/asv.html:8281) is untouched, so `hold`, `escape`, `rth`, `reapproach` and the new `recover` can never be read as "the plan ended, go home".

11. COMING BACK. The RTH or the Go-To is planned to HOME, which is the first fix — the berth. `holdTarget` (static/js/passage.js:310-346) detects it and returns `heldOff`, exactly as today, and the console ends the return in clear water and says so — STILL THE DEFAULT. The held-off banner now carries one control: BRING HER ALONGSIDE.

12. PRESSED. Because the arrival point is within `halfM` of a berth latched THIS session, it is PRE-GRANTED — no press needed on the ordinary day, where he recovers her where he put her in. A recovery elsewhere needs the press. Regime RECOVERING: the spine is the inbound route's tail from the ENTRY GATE (the LAST point on it with `holdClearM >= need0`) to `berth.at`; the same `halfM`, the same membership, the same recession test, the same stand-down.

13. THE ARRIVAL IS COMMANDED BY `Engine.recover(route)` — a new path beside `escape` and `hold`, and the ONLY one that does not hard-code `completion="loiter"` (asv_console.py:4149, 4156). It uploads with `completion="complete"`, which SimVcu answers by clearing `_running` and targeting 0 kn (asv_console.py:3429-3430), and with `coast_from_m` from the existing `solveCoastFor` (static/asv.html:1301-1334) so she comes in with the way already off. `holdTarget` is told not to relocate for GRANTED features only; everything else it relocates exactly as today and tests/hold_point.js stays green.

14. ARRIVED. She stops. No hold, therefore no 0.97 m disc, therefore no `hold_wants_route`, therefore no 3-second re-approach loop alongside a pier. Regime falls to BERTHED. Bar: "ARRIVED AND STOPPED at the berth. The console is not holding her — she is yours." And every 8 s while the link lives, at the existing alarm cadence: "BERTHED — the guard is standing down against your berth. Nothing is holding her off it but you."

## Failure modes

**THE RECORDED CASE. DriX spawned 0.97 m off a pier at New Castle; Arm, Upload, Start; 1.17 s later the guard today commands /api/cmd/escape (logs/asv_20260918-100307.jsonl, 10:47:14 → 10:47:15), then /api/cmd/hold with hold_clear_m 0.9724 at 10:47:25.**

- console: Latched at the first fix; corridor certified at Upload (gate 41 m, 18.2 m clear); at Start the governor commands LOW, not HIGH; the two dock/pier entries are filtered out of the model handed to guardAssess, so the ladder reads clear and no escape and no hold are commanded. Proof at ~41 m releases everything.
- operator sees: "DEPARTING — 1.1 m off a dock / pier · 33 m to certified water · LOW · the guard would be IN EXTREMIS here. Everything else is watched." Then "DEPARTURE PROVED — 18.4 m of clear water, 41 m from the launch. FULL CLEARANCE AUTHORITY RESTORED."

**A SECOND STRUCTURE BETWEEN HER AND OPEN WATER — a bridge support 34 m along the lead-out that she was never lying against.**

- console: The tripwire fires at Upload. plan_uploaded stays false, Start stays gated, the feature is highlighted by setViolations the way an unroutable transit already is.
- operator sees: The named refusal with the feature and the distance, three remedies that work, and one bounded answer (I CAN SEE THAT) that names only that feature, only at the present fix, only for this run.

**A SECOND STRUCTURE SHE MEETS AFTER SHE HAS LEFT — she comes out of the slip and stands into the opposite bank, 25 m out, still inside the corridor.**

- console: That feature was never filtered, so it is in koG. The full ladder fires on it — slow, then (inside a grant) STOP, then helm with escapeCourse on the TRUE model. Because projectRoute no longer stops at the launch pier, the look-ahead reaches it EARLIER than today's does.
- operator sees: The ordinary guard bar and the ordinary alarm, naming the bank, with the departure line still beside it saying what is and is not stood down.

**SET BACK ONTO THE LAUNCH BERTH. A 1.9 kn stream along the pier face; she makes 0.4 m good and starts losing it. cMax has reached 3.0 m; berthClearM falls to 1.4 m.**

- console: give = max(0.5, min(5.0, 1.5)) = 1.5 m; 1.4 < 3.0 - 1.5, so the grant is SPENT by recession. The 20 s stand-down starts; the console commands STOP meanwhile. At the end of it the full ladder has her, with escapeCourse on the true chart — which beside a pier on three sides may correctly refuse and say BOXED IN.
- operator sees: "⚠ SET BACK ONTO THE BERTH — 1.4 m off a dock / pier, down from the 3.0 m you had made. THE GRANT HAS ENDED. In 20 s the console has the HELM and will steer her out at high speed. [TAKE THE HELM NOW] [HOLD THE GRANT] [DROP THE GRANT]" — and, if boxed in, today's BOXED IN wording instead of a steer.

**SHE NEVER MAKES WAY — a mooring line still on, a fouled prop, a speed command the hull will not take.**

- console: The stall test (cMax not improved by halfM in HOLD_S = 20 s) fires; /api/cmd/stop. NOT a hold (a 0.97 m disc starts the re-approach loop) and NOT an escape (it would steer her off the berth she was deliberately placed on). The head of the grant stands; the recession test keeps running.
- operator sees: "DEPARTURE STALLED — no ground made off a dock / pier in 20 s. STOPPED at the berth; she lies where you put her. Check the speed command, the prop and the mooring line. The guard is still standing down against your berth and watching everything else."

**THE FACT NEVER ARRIVES — she is out of the slip but nothing on the plan reaches certifiable water inside 60 s.**

- console: The time bound expires with no telemetry needed at all. /api/cmd/stop, and the head of the grant stands. If she is outside the corridor by then, the grant has already ended by distance instead, with the 20 s stand-down.
- operator sees: "DEPARTURE NOT PROVED — 60 s and 38 m run, still only 2.1 m of clear water. STOPPED. The guard has not been given the helm; it is still standing down against your berth and watching everything else. [DROP THE GRANT] hands it back now."

**SHE LEAVES THE CHECKED WAY OUT — more than halfM off the spine (a set across the corridor, an operator on RC).**

- console: The place test fails. The grant ends, but the helm is held for the 20 s stand-down so the first frame outside the corridor is an alarm and a slow-down, not a 14 kn escape from beside a wall.
- operator sees: "OFF THE CERTIFIED WAY OUT — 11 m wide of it. The guard has the boat again in 20 s. [HOLD THE GRANT] [TAKE THE HELM NOW]"

**THE TIDE MOVES 0.1 m MID-DEPARTURE. rebuildNogo replaces nogo.ko wholesale and may move nogo.frame.**

- console: Nothing is re-matched, because nothing was remembered: membership is re-derived from the new ko on the next frame, keyed on the latched lat/lon. The memo key is ko object identity, so a rebuild invalidates it by construction. If the rebuild leaves the launch water certifiable, the grant ends by PROOF, which is correct.
- operator sees: Nothing, unless the answer changed — in which case the proved or lapsed sentence, with its cause named. This is the one failure mode that produces no banner, deliberately: the grant did not go stale, so there is nothing to report.

**SUPERVISION HANDOVER OR A PAGE RELOAD MID-DEPARTURE.**

- console: The inheriting tab reads `departure` off the state frame and adopts it with its budget where it was — not restarted, because a handover must not buy fresh time. A view-only tab draws the same grant, the same corridor and the same countdown and commands nothing, exactly as `act` already gates.
- operator sees: The same bar in the new window, with the same numbers and the same count. Without the server field this is an unexplained 14 kn escape fifteen metres off the dock, which is the original bug at the worst possible moment.

**NO CHART MODEL — nogo.ready false at the launch.**

- console: No grant is latched (nothing can be certified) and nothing is enforced either: clearanceGuard already bails at static/asv.html:1786 and doUpload already asks the unrouted-upload question with {always:true}. Symmetric and honest.
- operator sees: The existing unrouted-upload confirmation and standing banner, with one added clause: "and the departure from this berth was not checked either."

**A NULL COURSE OVER GROUND — the boat is stopped, cog_deg is null (asv_console.py:3624).**

- console: groundVel returns null and clearanceGuard substitutes {level:"clear"} — the guard is BLIND, not safe. That is true today, everywhere, in every regime. The model changes nothing about it and makes it visible.
- operator sees: The bar reads BLIND rather than CLEAR: "NO COURSE OVER GROUND — the guard cannot project anything from here. The clearance number is live; the ladder is not."

**THE OPERATOR LAUNCHES HER, WALKS TO THE TRUCK, AND THE EBB SETS HER ONTO THE LAUNCH PIER.**

- console: The recession test fires as soon as she loses half the water she has made, the grant ends, the stand-down runs, and the console takes the helm — or reports BOXED IN, which beside a slip is likely. Before that point it alarms every 8 s, commands LOW, and will STOP but will not steer.
- operator sees: The 8-second alarm with the true metres and the true feature, then the SET BACK banner with its count. ⚠ THIS IS THE WORST OUTCOME THE MODEL PERMITS, and it rests entirely on the axiom being true at the moment it is relied on. supervising() proves a browser tab is open, not that anyone is looking at it.

## What is NOT weakened

- THE MEASUREMENT AND THE ALARM. `updateClearance()` (static/asv.html:1484-1508) is not touched and runs on the unfiltered model, so `clearance.m` and `clearance.kind` are always the true distance to the real pier and its real name. The 8-second re-say (:1884) is never suppressed. MECHANISM: the filtered model is passed to exactly three call sites, all of them inside `clearanceGuard`, and `updateClearance` is not one of them.
- THE GUARD'S ANSWER. `timeToEntry` still returns 0 rather than null from inside a buffer (static/js/guard.js:188-194) and `projectRoute` still short-circuits (:246). "We are in it" and "we will never be in it" do not become the same answer. MECHANISM: static/js/guard.js is not modified at all, and tests/in_extremis.js — whose TEETH list records "already-inside reports null instead of zero → 7" as a killed mutation — must stay green unmodified.
- THE AUTHORITY GATE. `const act = !!(S && S.armed && !S.estop) && supervising();` (static/asv.html:1820) is unchanged; no run-state, no speed and no time condition is added to it anywhere. MECHANISM: the regime key is `guardTrack() !== null`, which lives in a separate function, and tests/clearance_guard.js:427-431 greps clearanceGuard's raw source for `run === "running"` and `st.holding` — so a re-introduction reddens a pinned mutation guard. The Eastport case that widened the gate (a boat station-keeping while the stream sets her into a pier, :1519-1523) is untouched because it gets no grant: `run_seq > 0` and she is far from the latch.
- EVERY RUNG AGAINST EVERY FEATURE SHE WAS NOT LAUNCHED AGAINST. MECHANISM: those features are still in `koG` at the operator's full buffer, so `blocked`, `timeToEntry` and `projectRoute` still see them and every rung still fires — and because `projectRoute` no longer stops at the launch pier (it returns at the FIRST entry, :259), the look-ahead past the berth is strictly LONGER than today's, not shorter.
- THE ESCAPE'S CHART AND ITS REFUSAL. `escapeCourse` (static/js/guard.js:566-638) is called with `nogo.ko` at its one call site (static/asv.html:2086), never `koG`, so an escape driven by an ungranted feature can never steer toward a granted one; and its `null` (:636-637) remains a real answer, pinned by tests/in_extremis.js ("boxed-in returns the least-bad heading instead of refusing → 10"). MECHANISM: the call site is left as it is, deliberately, and the suite asserts it.
- THE NUMBER THE VESSEL OBEYS. `holdClearAt(ll)` (static/asv.html:1341-1344) is unchanged at all eight call sites and is NEVER inflated. MECHANISM: the mirror case is answered by `completion="complete"` — no disc, so nothing to be set out of — rather than by telling a hull with no keep-out model of its own (asv_console.py:3436-3437) that a seventeen-metre chord is clear by a construction (:3438-3441) that the inflation would make false.
- THE PLANNER'S OWN TIGHTENING. `gateLegClear`'s endpoint exemption (static/js/routing.js:1087-1099) is NOT widened. The runtime adopts the planner's judgement; the planner never adopts the runtime's radius. MECHANISM: nothing in routing.js changes, and tests/gate_endpoint.js and tests/buoy_lane.js:477-489 stay green — which matters because that gate was tightened for a measured incident (a route passing 0.47 m from a charted pier at a 3 m buffer, 1 of 475 Go-To routes).
- THE COMMAND-TIME HOLD-POINT AUTHORITY OUTSIDE A GRANT. `holdTarget` / `snapClearRadial` / `holdMarginM` still relocate any commanded endpoint that is blocked or tight, and still refuse when nothing inside `snapCapM(buf)` qualifies. MECHANISM: `opts.grant` is optional and defaults to absent; every existing caller passes nothing. tests/hold_point.js stays green.
- THE OPERATOR'S OVERRIDE SEMANTICS. PROCEED and CONTINUE AT LOW keep their meanings and their three-way lapse (`guardOverrideOk`, static/asv.html:1770-1781), and still void at `clear` and at `helm`. MECHANISM: untouched; the grant's two answers are separate records with their own, narrower scope.
- E-STOP, STOP, PAUSE AND THE RC TRANSMITTER. The RC transmitter remains master in every regime. MECHANISM: none of them is read by the grant, and none of them reads it.
- MOVING CONTACTS — unchanged, and unchanged means NOT GUARDED. `buildKeepouts` (static/js/keepouts.js:621) is built from ENC features only; AIS and ROC never enter `ko`. MECHANISM: `grantFilter` only ever filters `ko`, so the grant CANNOT quiet a contact alarm — and the honest half must be said too: there was no contact rung to weaken.
- THE END-OF-PLAN WHITELIST. `CHAINABLE_BEHAVIORS` (static/asv.html:8281) is not extended, so `hold`, `escape`, `rth`, `reapproach` and the new `recover` can never be read as "the plan ended, go home". MECHANISM: the new behavior is simply not added to a list whose entire value is being short.

## What would change, file by file

**static/js/guard.js**

- NO CHANGE AT ALL. That it is untouched is the falsification test for the claim that the OPEN regime is today's console: tests/in_extremis.js must stay green unmodified.
- risk: None. Stated here because every rejected alternative wanted to edit this file, and each edit would have made the guard's answer untrue rather than its authority narrower.

**static/js/keepouts.js**

- ONE new export, `featureClearanceM(p, feature)`: the distance from a point to ONE keep-out entry, built from `pinp`/`dSeg` for a poly, `dSeg` for a line, `max(0, hypot - (pt.r||0))` for a point — the same primitives as `clearanceM` (:767) in the same order, for the same stated reason. Pure, no state.
- risk: Low. Purely additive; every existing caller is untouched. The risk is drift from `clearanceM` if one is later edited and not the other — answered by writing it directly beneath it and pinning agreement in the suite.

**static/js/berth.js (NEW)**

- The whole model, pure and commanding nothing — the same split guard.js and hold.js already declare. `isBerthed(p, ko, buf, need)`; `grantedFeatures(ko, berthEN, buf, need0)` memoized on ko identity; `grantFilter(ko, granted)` returning the same {polys, lines, points, marks, sys, chans, passed} shape; `certifyDeparture(berthLL, route, frame, ko, buf, need0)` → {gate, depthGate, spine, spineLen, halfM, until, c0, granted[]} or a typed refusal {code, measured, feature}; `certifyArrival(...)` the same body with the ends swapped; `onCorridor(p, grant, frame)`; `regimeOf(state)` — the pure transition function, taking positions, distances and clocks only, never a course. Every threshold imported from hold.js, guard.js and turns.js; none redeclared.
- risk: Medium — it is the new surface. Bounded by being pure: no page state, no commands, fully testable without a boat. The specific risk is the memo key being 'tidied' into nogo.builtOffset or a boolean by a later edit, at which point a full model walk runs per frame beside a real harbour.

**static/asv.html — clearanceGuard (:1782)**

- ONE line at the head: `const koG = D ? D.ko : nogo.ko` where `D = departureMask()` is defined OUTSIDE the function; then `nogo.ko` becomes `koG` at the assess call (:1815) and at both counterfactuals (:1854, :2012, :2043). `updateClearance()`, `escapeCourse` (:2086) and `holdClearAt` (:2061, :2114) deliberately keep `nogo.ko`. The `act` gate (:1820) and the `!act` return (:1899) are untouched. The hold rung (:1969) and the helm rung (:2083) gain nothing — they are already unreachable against a filtered feature. The hold rung's command becomes `/api/cmd/stop` while a grant stands.
- risk: ⚠ HIGHEST-CARE ITEM, AND THE RISK IS NOT BEHAVIOURAL. tests/clearance_guard.js:110-116 `grab()`s this function's RAW SOURCE by brace-walking the file, and check 14 (:427-431) asserts `!/run === "running"/.test(G) && !/st\.holding/.test(G)` — comments included. A behaviourally perfect helper written INSIDE clearanceGuard reddens a pinned mutation guard for a reason unrelated to the code. `departureMask()` must live outside it and neither string may appear in it.

**static/asv.html — NEW berthPhase(), called first in the telemetry frame**

- Latches the berth at the three events of R1, computes the regime from `guardTrack() !== null`, runs proof / recession / stall / corridor / clock, commands the two things it is allowed to command — `/api/cmd/stop` and `/api/cmd/speed` — runs the stand-down countdown, and POSTs the grant to the server. The ONLY new commanding site in the design.
- risk: Medium. It adds state to a console whose history is mostly state going wrong. Structural defences: OPEN is the default at every ambiguity; the only thing remembered is a lat/lon and six frozen numbers; and every transition is a distance or a clock, never a course.

**static/asv.html — doUpload (:9296) and the Go-To / Transit commit sites**

- After routePlan and before the `/api/cmd/upload` POST: certify the departure, refuse with `departRefusal()` beside the existing `runUnsafe` refusal (:9331-9340) with the same consequence, otherwise write the DEPARTURE block onto the Intent card and POST the grant. Nothing new goes to the vessel.
- risk: Medium-high for the operator, not for the code: this is the refusal that can block a mission at a basin he launches from. Answered by DEPART UNDER THE CLOCK and I CAN SEE THAT, both bounded like guardOverrideOk. If those are omitted, the refusal will be answered by lowering the buffer for the whole run.

**static/asv.html — currentActivity (:3959), SPEED_ROLES (:1175)**

- One new branch above the survey branch returning `{activity:"departing"|"recovering", role:"depart", surveying:false, detail:…}` while a grant stands; `SPEED_ROLES` gains "depart". `roleSpeed("depart")` returns "low" as a CAP over the classifier's answer rather than a branch inside the classifier. `speedGovernor` (:2170) needs no edit.
- risk: Low. Honours the one-line-classifier rule at :1176-1181, so the recorder's activity and the boat's speed describe one moment. The cap must not be dialable from mission.speeds — it is the console suspending its own protection.

**static/asv.html — renderGuardBar (:1542) and the alarm (:1884)**

- A fourth bar state, up whenever a grant stands and not only while a rung is firing (the renderHeldBar precedent at :1553-1556 that an offer outlives its rung): the regime, the TRUE clearance, the granted count and names, the metres to the gate, the depth-grant remainder, the suppressed-rung sentence when a TRUE-model assess earns it, and DROP THE GRANT. Plus the stand-down box with its count and three buttons, and the BLIND state for a null cog.
- risk: Low, and the highest-value operator change in the set. The one failure to avoid is printing the suppressed-rung sentence unconditionally, which turns evidence into decoration.

**static/asv.html — hold interception and the mirror**

- `doHold()`, the guard's hold rung and the end-of-plan loiter all ask `regimeOf()` first and convert a hold inside a grant into `/api/cmd/stop` with the reason said — one predicate, three callers. The held-off banner gains BRING HER ALONGSIDE; `holdTarget` gains `opts.grant` so a target blocked ONLY by granted features is left where the operator put it (heldOff null, holdClear null). Every existing caller passes nothing and is unaffected.
- risk: Medium. A STOP inside a grant kills `guardHeldOffer` (it requires run "running" and behavior "hold"), so the RESUME SURVEY AT LOW offer is lost — acceptable during a departure, where nothing has been flown, and it must be stated rather than discovered.

**asv_console.py — Engine**

- NEW `self.departure` field, published in the state frame beside `run_seq` (:4741); NEW supervisor-gated `POST /api/cmd/berth` to set and clear it; cleared in `reset()`, on disconnect/disarm, and by `_run_route` for every behavior it serves so a new commanded motion inherits no grant; added to `SessionLogger.SALIENT` (:763). ⚠ The stale comment at :3774 (`# survey | goto | rth | hold`) omits transit, escape and reapproach and must be corrected in the same commit.
- risk: Low. The server gains no authority — it never runs the guard. It is the one part that cannot be omitted: without it a handover fires an unexplained escape from inside a slip.

**asv_console.py — NEW Engine.recover(route, hold_clear_m, coast_from_m)**

- Beside `escape` (:4199) and `hold` (:4229): the ONE path that does not hard-code `completion="loiter"` (`_run_route` at :4149 and :4156). It uploads with `completion="complete"`, which SimVcu answers by clearing `_running` and targeting 0 kn (:3429-3430), and sets `behavior = "recover"`. `_run_route` gains a `completion` argument defaulting to "loiter", so every existing caller is byte-identical. `CHAINABLE_BEHAVIORS` (static/asv.html:8281) is NOT extended, so a recovery can never be read as "the plan ended, go home".
- risk: Low-medium. `upload_plan`'s signature is untouched and SimVcu is untouched. The risk is the sim testing calmer than the water — see howToProve.

**tests/berth_grant.js (NEW), plus GUARDS, the hook's advice_for entry and a docs rebuild IN THE SAME COMMIT**

- Paired acceptance and refusal throughout, with a recorded TEETH list of RUN mutations. tests/in_extremis.js, tests/clearance_guard.js, tests/gate_endpoint.js, tests/buoy_lane.js and tests/hold_point.js stay green UNMODIFIED — that they are unmodified is the evidence that the OPEN regime is today's console.
- risk: The repo's standing rule: a new suite needs its GUARDS entry, its advice_for entry, its recorded TEETH list and a docs rebuild in the same commit. README.md's ladder enumeration at :1030-1036 is already one rung short of the code (it says four; RUNG has five) and now also needs the regimes.

## How to prove it

### ⚠⚠ DONE, 2026-09-19 — AND TWO OF THE CLAIMS BELOW ARE NOW KNOWN TO BE WRONG

The replay asked for below has been run from the real extracts, per upload window. The full
evidence, with every number, is in `ESCAPE_FINDINGS.md`'s "THE REPLAY, DONE" section. Read that
rather than re-deriving any of this. Three corrections to what follows:

1. **THE BUFFERS WERE 3 m, 20 m AND 3 m** (New Castle, Pago Pago, Erie), identified by searching
   for the model that reproduces each escape's own logged `hold_clear_m` — to 0.1 mm, 0.002 mm and
   5.2 mm. Every metre figure in the LIFECYCLE section above is a DriX at a 5 m buffer and is an
   ILLUSTRATION, not a record of these sessions. Do not quote it as one.
2. **ONLY PAGO PAGO REPRODUCES.** On their own identified models, New Castle reaches HOLD and
   Erie reaches SLOW — neither reaches the helm rung on any frame within ±30 s of the escape the
   console actually commanded. That is the same `chartInk` gap already recorded for Honolulu, and
   it makes item 5 a PREREQUISITE, not a tidy-up. At Pago Pago the grant disarms **6 of 6**
   in-extremis frames, all inside the corridor.
3. **ERIE IS NOT A LAUNCH-GRANT CASE AND SHOULD NOT BE LISTED AS ONE.** Its escape followed a
   `/api/cmd/goto` from 151.7 m away, with no upload after its spawn, so `certifyDeparture()`
   never runs and no grant is ever armed. The launch grant leaves that escape exactly as it is.

⚠ **AND NONE OF IT CAN SHIP AS A SUITE.** `charts/` and `logs/` are gitignored, so a check that
reads them fails for anyone who clones this repo and would fail in the hook. `tests/berth_grant.js`
holds the invariants on fixtures; ESCAPE_FINDINGS.md holds the measurement against the record.

The original plan follows, unchanged.


- REPLAY THE THREE RECORDED FRAMES. For each of New Castle (logs/asv_20260918-100307.jsonl, /api/cmd/start 10:47:14.215 → /api/cmd/escape 10:47:15.382, 1.17 s), Pago Pago (logs/asv_20260918-130610.jsonl, start 14:03:22.200 → escape 14:03:22.649, 0.449 s, second escape 14:03:28.659 at exactly GUARD_REASSESS_MS) and Erie (logs/asv_20260916-102925.jsonl, /api/cmd/goto 13:54:23.733 → escape 13:54:23.879, 0.146 s): assert `assess(p, vel, drift, koFull, buf)` is `helm` and `assess(p, vel, drift, koG, buf)` is NOT, at the recorded position, with the recorded set. ⚠⚠ **CORRECTED 2026-09-19: THE EXTRACTS *ARE* IN THE REPO AND THIS PLAN SHOULD USE THEM.** `charts/enc/features_v5_<bbox>.json` holds them, and a keep-out model rebuilt from them with the console's own `buildKeepouts` reproduced the console's own logged `hold_clear_m` at the Honolulu escape target to **4 mm** (48.961 m raw against a logged 43.965 m, which is the same number less the 5 m buffer). Andy's call when this was put to him: build the replay from the REAL extracts, **per upload window**. ⚠ And per WINDOW is not a detail - **sessions span several ports**: `asv_20260918-130610` uploads at both Pago Pago and New Castle, `asv_20260918-100307` at both Erie and New Castle, `asv_20260916-102925` at Pago Pago and Erie. One extract per SESSION mis-charts three of seven, and frames off the chart read `clear` for want of features rather than for want of hazard. (That is a mistake this session made and had to correct: an old-rung/new-rung occupancy replay was run one-chart-per-session, and while the like-for-like RATIO survives it, the absolute rung levels and the per-session attribution do not.) The reconstructed-geometry route below is kept only as an independent cross-check that does not depend on the extract mapping being right; as the PRIMARY evidence it would be weaker than what the repo already holds. The original wording follows: the keep-out geometry must be reproduced from the recording's own measured numbers — 0.9724 m of certified clear water at the boat at New Castle, 43.34 m at the escape target, 22.80 m at Pago Pago, 19.16 m at Erie. That pins the DECISION against geometry reconstructed from the recording; it is not a live replay of the chart, and calling it one would be a claim the evidence does not carry.
- MUTATE EVERY RULE AND WATCH IT REDDEN, against a sidecar copy, never the real source, with `git diff` after every run. Membership test removed → every nearby feature granted. Place test removed → a grant everywhere the operator has been. The un-grantable kind list emptied → a charted hazard granted at a berth. The latch fired on geometry rather than on the launch event → a boat set onto a pier mid-mission gets a grant. `need0` re-derived live instead of frozen → a building set enlarges the granted set. The recession give made flat 5 m → the New Castle case at 0.97 m becomes undetectable (this mutation must redden a check written specifically for it, or the repair is unproven). The proof test replaced by a timer. `edge:true` inside a grant → a dog-leg verified through the launch pier. `koG` passed to escapeCourse. `holdClearAt` inflated. The stand-down removed → an instant escape on expiry. `featureClearanceM` ignoring `pt.r`.
- PAIR EVERY REFUSAL WITH AN ACCEPTANCE, because a round-trip is not coverage. A berthed start that departs and proves, AND the same start with the gate past `snapCapM(buf)` (Upload refused, and the message names the cap and the measured best clearance). A pier 40 m from the launch that is NOT granted and still earns a helm on the same frame as a granted pier is standing down. A boat set onto a pier mid-mission that gets NO grant at all.
- PROVE THE STALENESS DISCIPLINE DIRECTLY. Build a keep-out model, latch a grant, rebuild the model with `rebuildNogo`-equivalent geometry (a fresh ko object, same rings, a new frame origin), and assert the membership answer is IDENTICAL and the memo was invalidated. Then rebuild with the launch pier REMOVED and assert the grant ends by proof, not by silently keeping a feature that no longer exists.
- PROVE THE OPEN REGIME IS TODAY'S CONSOLE, by omission: tests/in_extremis.js, tests/clearance_guard.js, tests/gate_endpoint.js, tests/buoy_lane.js and tests/hold_point.js must pass UNMODIFIED, and static/js/guard.js must show zero diff. That is a checkable property, not an assertion.
- READ WHAT THE CHECK PRINTS. Every check's detail line must carry the metres and the feature it decided on, so a check that passed for the wrong reason shows up. And verify the SUITE before trusting it: a mutation credited to a case that stayed green is a broken instrument, which is how the core's mutation runner once scored six.
- LIVE, ON A TEMP COPY ONLY (`--sim --browser none --port 8796 --no-log --state-dir <temp>`, never port 8791, never his session): spawn at each of the three recorded launch positions, Arm / Upload / Start through the page's own buttons, and observe via the injected-probe route that (a) no `/api/cmd/escape` is issued in the first 60 s, (b) the first speed command is `low` and not `high`, (c) the bar carries the DEPARTING line with a live true clearance, and (d) the grant survives a simulated supervision handover with its budget where it was.
- MEASURE THE COST. Time `grantedFeatures` on a New Castle-scale extract (34,579 ring vertices; `blocked` measures ~800 µs) and confirm it runs once per `rebuildNogo`, not per frame, by counting calls over a synthetic minute with a tide tick in it. Time the extra TRUE-model `assess` at 2 s cadence (~9 ms). Both must be bounded and both must be stated, because this page has already measured a 1,060 ms frozen tab.
- ⚠ THE ONE THING THE SIMULATOR CANNOT PROVE, and it must be carried in writing rather than discovered later. `env = ENV.field() if (self._running and not self._estop)` (asv_console.py:3501), so a boat that has STOPPED — which is what `completion="complete"` produces (:3429-3430), and what every failure end of this model commands — STOPS BEING ADVECTED IN THE SIM. In real water she does not. Every terminus and every STOP in this design will therefore test calmer in the simulator than the thing it models, and any check written against the sim's own physics there is checking the wrong boat. The recession test after a STOP must be driven by a synthetic drift in a headless check, not by the sim.

## OPEN DECISIONS — ⚠ ANSWERED 2026-09-19, ALL FIVE

Put to Andy with the measurements in front of him. **1** - ship as designed, the depth grant capped at the vessel's `low` key (recommendation (a)). **2 - DEPART UNDER THE CLOCK: YES**, bounded and logged, with the bar reading "NO PROOF END — YOUR CLOCK" for its whole life (a). **3** - the clock is 3 x corridor / low, floored at 60 s. **4** - a recovery somewhere new needs BRING HER ALONGSIDE; a recovery within `halfM` of a berth latched THIS session is pre-granted (a). **5 - AFTER A STOP AT THE BERTH, KEEP STANDING DOWN** (a): the only ends are proof, recession, a new command, loss of the model, or DROP THE GRANT. A boat stopped at her berth is never steered off it by the console, however bad the number gets — it alarms, it will stop her, and nothing else. That rests entirely on his axiom, which is why it was asked rather than assumed.

The reasoning for each is unchanged below.

## OPEN DECISIONS - Andy's, each with a recommended default

### 1. Should the DEPTH grant have a speed of its own — a fourth key, `dock`, in vessels/*.json below `low` — or is `low` good enough?

- options: (a) Ship as designed: the depth grant holds only at the vessel's `low` key. (b) Add `propulsion.speeds_kn.dock` (say 1.5 kn on the DriX) and condition the depth grant on that instead.
- **recommendation: (a) for now, and say it in the operator's own words on the Intent card rather than hiding it: "the depth grant is permission to run with the 2.3 m under-keel clearance unverified, at four knots."**
- why it matters: Your own sentence carries the speed clause — a hull sitting in 0.3 m over a ramp is fine, the same hull crossing it at 6 kn is not. DriX `low` is 4.0 kn. Four knots over a ramp is a grounding this model does not prevent; the small depth-gate distance bounds the exposure to a few seconds, it does not remove it. (b) is the honest fix and it is a vessel-file change, which is yours and not the console's.

### 2. Should DEPART UNDER THE CLOCK exist at all — the one-press answer to "no water I can certify within 150 m" in an enclosed basin?

- options: (a) Yes: a bounded, logged, one-run grant with the corridor, the clock, the stall and the recession test all still running, and no proof end. (b) No: the Upload is simply refused and the only remedies are moving the first waypoint or relaunching.
- **recommendation: (a), with the bar reading "NO PROOF END — YOUR CLOCK" for its whole life.**
- why it matters: Without it there are real basins this console will not start a mission from, and the lever you would actually reach for is lowering Buf m — which reduces protection for the WHOLE run rather than for forty metres of slip. With it, the console has granted itself a departure bounded only by a clock, which is the weakest bound in the design.

### 3. How long may she sit inside a grant before the console stops her and says so?

- options: 3 × (corridor length ÷ low speed), floored at 60 s — about 60-70 s on a DriX; or a flat number you pick; or no clock at all, leaving only proof, recession and the corridor.
- **recommendation: 3 × corridor ÷ low, floored at 60 s.**
- why it matters: It is the one bound that needs no telemetry at all, so it is what answers "the link died and she is still alongside". It is also the least principled number in the design — derived from how a departure OUGHT to go rather than from anything the hull or the chart knows. Too short and it stops you mid-departure at a busy ramp; too long and a boat nobody is watching sits under a grant for minutes.

### 4. On a recovery at a place you did NOT launch from today, should a HOME that is at a berth be pre-granted, or always need the press?

- options: (a) Always need BRING HER ALONGSIDE, on the held-off banner that already exists. (b) Pre-grant any HOME that is berth-like.
- **recommendation: (a) — with the one automatic exception already in the model: a recovery within halfM of a berth latched THIS session is pre-granted, which is your ordinary day and needs no press at either end.**
- why it matters: On departure the evidence is an act already performed — she is floating there and a person put her there. On arrival it is an act PROMISED, and the console cannot observe it. (b) would let a stale HOME certify water nobody has looked at today. The cost of (a) is one press on the days you recover somewhere new.

### 5. When a departure is STOPPED at the berth (stalled, or the clock ran out), should the console keep standing down against your berth indefinitely, or hand the helm back after some further dwell?

- options: (a) Keep standing down: the only ends are proof, recession, a new command, loss of the model, or DROP THE GRANT. (b) Add a second, longer clock after which the helm returns with the 20 s countdown.
- **recommendation: (a).**
- why it matters: This is the sharpest edge in the whole design and it is where the axiom is doing all the work. Under (a), a boat stopped at her berth with a grant standing will never be steered off it by the console, however bad the number gets — it alarms every 8 s, it will stop her, and nothing else. The recession test is the watchdog and it now arms even at 0.97 m, but it only fires when she is getting WORSE. Under (b) the console eventually commands a 14 kn escape out of a slip, which is frequently BOXED IN anyway, at a boat you deliberately put there.

## Staged delivery (subject to the re-ordering in ESCAPE_FINDINGS.md)

STAGE 0 — SHIP IMMEDIATELY, INDEPENDENT OF ALL OF THIS. The BLIND readout. A null `cog_deg` makes `groundVel` return null (static/js/guard.js:178-182) and `clearanceGuard` substitute `{level:"clear"}` (static/asv.html:1814-1815): the guard is blind, not safe, and it reads CLEAR to you today, in every regime, everywhere on the water. One bar state, no model, no berth, no grant. It costs nothing and it closes an existing hole that matters most exactly where a stopped boat produces it. Ship it with the stale `behavior` comment correction at asv_console.py:3774 and the README ladder enumeration at :1030-1036, which says four rungs where RUNG has five.

STAGE 1 — THE MODEL, AND IT MUST LAND WHOLE. The latch, membership, the corridor, the gate, `grantFilter`, the three-line change to `clearanceGuard`, `edge:false`, hold-becomes-STOP, the proof / recession / stall / corridor / clock ends, the 20 s stand-down with its count, the `depart` speed role, the guard bar, the Upload certification with its three refusals, DEPART UNDER THE CLOCK, the server field with `POST /api/cmd/berth` and the SALIENT entry, and tests/berth_grant.js with its GUARDS entry, its advice_for entry, its recorded TEETH list and the docs rebuild.

WHY THIS IS THE SMALLEST THING THAT IS NOT HALF-BUILT, item by item — each of these, omitted, produces a WORSE console than today's at the moment it matters:
  * The GATE-derived corridor, omitted. A fixed radius of 10 or 17 m spends while she is still between the piers, the full ladder comes back with her inside the buffer, `blocked(p)` short-circuits exactly as it does now, and the escape fires at the slip mouth instead of at the berth. You would read a good paragraph, watch a chip count to 10 of 10, and get escaped anyway. The problem would not go away — it would move sixteen metres.
  * The 20 s STAND-DOWN, omitted. Every end hands a 14 kn escape rung to a boat still inside a slip's buffer on the very next frame. That is the original defect with a delay on it.
  * hold-becomes-STOP, omitted. The guard's hold rung inside the corridor ships `hold_clear_m` measured at the boat — 0.9724 m, recorded — and starts the routed re-approach cycle every three seconds alongside the pier.
  * `edge:false`, omitted. `edgeAround` verifies candidates against the model it was handed (static/js/guard.js:425-426), so the console can command a deviation, through `/api/cmd/amend`, routed straight through your launch pier — a NEW hazard this design would have invented.
  * The SERVER field, omitted. A supervision handover or a page reload mid-departure fires an unexplained escape fifteen metres off the dock, and the surviving window has nothing in its UI that could explain it. That is the reconstruction failure happening live, in front of you.
  * The plan-time REFUSALS, omitted. A departure that cannot be certified is discovered at Start, as an escape, instead of at Upload, where you can still move the first waypoint.

STAGE 2 — THE MIRROR AND THE REMAINING LEVER, once Stage 1 has flown a few departures. `Engine.recover()` with `completion="complete"`, the `_run_route` completion argument, `coast_from_m` on the way in, `holdTarget`'s `opts.grant`, BRING HER ALONGSIDE on the held-off banner, the session-of pre-grant, I CAN SEE THAT for the tripwire refusal, and the exercised-suppression log.

WHY THE MIRROR CAN WAIT. Until it lands, a return to a berth-set HOME behaves exactly as it does today — `holdTarget` holds it off to clear water and the banner says so (documented at tools/build_ops_manual.js:244) — and you drive the last twenty metres by hand. That is inconvenient and it is not a defect. The departure is the thing that stops the boat leaving the dock, and it is the thing you have six recorded episodes of.

WHY I CAN SEE THAT CAN WAIT AND DEPART UNDER THE CLOCK CANNOT. The tripwire that I CAN SEE THAT answers should be unreachable by construction — `gateLegClear` and `routeAround` already guarantee the way out is clear of everything except the blocked endpoint's own neighbourhood — so it is an assertion, not an expected refusal. The no-gate refusal that DEPART UNDER THE CLOCK answers WILL fire in an enclosed basin, and a refusal with no lever is the one thing in this design that would teach you to lower the buffer by reflex.
