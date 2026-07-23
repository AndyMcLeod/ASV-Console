# ASV Generalized Behaviors — design/plan

> **FIRST SLICE DONE (2026-07-20):** Go-To, real Return-to-Home, Hold/station-keep,
> and Set-Home — server + GUI, verified in sim. `SimVcu` station-keeps at the last
> waypoint when `hold`; Engine `_run_route`/`go_to`/`hold`/`set_home`/`return_home`
> (arm-gated); `home` auto-set on first fix; endpoints `/api/cmd/{goto,hold,sethome}`;
> command-bar buttons Go-To (click a point) / Hold / RTH / Set Home; green "H" home
> marker; `behavior` + `home` in SSE state; autonomy shows `hold`.
>
> **SEARCH PATTERNS DONE (2026-07-20):** Expanding box / Sector / Parallel — the three
> canned generators (à la Project-11 `track_patterns.py`), **client-side only** (no
> server change: they produce an ordered waypoint route that feeds `mission.waypoints`
> and runs through the existing Arm → Upload → Start flow, completing like a survey).
> New `SRCH` toolbar mode + `#searchPanel` (pattern picker, per-type params, live
> preview, draggable **D** datum, Add to plan / Reset). Generators
> `expandingBox`/`sectorSearch`/`parallelTrack` + `searchRoute()`/`drawSearch()` in
> `asv.html`. Sim-verified end-to-end: sector pattern (10 wpts) armed/uploaded/started,
> boat line-follows the first leg at 3 kn, no console errors.
>
> **ENC NOGO — ALL BEHAVIORS ENC-AWARE DONE (2026-07-20):** on the first GPS fix the
> console auto-extracts ENC for the operating area (10 km box, ±5 km) and builds a persistent
> **nogo model** = shoreline + manmade + water <1 m CORRECTED (charted + live water level).
> `nogo` global + `refreshNogo`/`rebuildNogo`/`drawNogo`, `NOGO` toggle, `v_nogo` readout,
> re-extract on transit. Every behavior routes clear via `planNogoRoute` (reuses
> `blocked`/`legClear`/`routeAround`): **Go-To** (`doGoTo`) + **RTH** (`doRTH`) compute the
> detour client-side and POST a full route (server `go_to`/`return_home` take an optional
> `route`, validated by `_sanitize_route`); **search patterns** clip legs + route transits +
> flag unroutable red (`computeSearchNogo`). **Refuse+warn** on unreachable targets; honest
> **direct** degrade when no ENC coverage. Sim-verified live (Presque Isle Bay).
>
> **PUNCH OUT UNIFIED WITH THE GLOBAL NOGO DONE (2026-07-20):** survey Punch Out clips
> against the SAME `nogo` model as the behaviors (shared features/ref/enforce/buffer;
> `buildKeepouts` gained an optional features arg). **Layered depth:** fixed 1 m navigability
> floor = single safety source of truth; the survey Min/Max depth is a survey-only coverage
> window layered on the floor in `punchOut` (`dr.min=max(1,panelMin)`). Buffer + enforce
> toggles are now the SHARED nogo controls (`applyNogoControls` → live `rebuildNogo`; re-routes
> every behavior); `enf_area` defaults OFF. `ensureNogoArea` extends the fetch (bbox union)
> when a survey is drawn outside the operating area, transit center pinned to the vessel.
> Sim-verified: survey clips cross the behavior floor-nogo 0×; toggles rebuild live; far-survey
> re-fetch works.
>
> **SINGLE DEPTH-SHADING LAYER DONE (2026-07-20):** `drawNogo` is now the only layer that
> shades water depth — RED = hard nogo (land/manmade/water below the 1 m floor), AMBER =
> water outside the survey COVERAGE window (navigable, just not surveyed), shown only while a
> survey pattern exists. `drawENC` no longer fills depth areas (removed its `depthExcluded`
> fill + unused `dr`), so nothing is double-shaded. Sim-verified: 6 depth areas red at the
> floor, +17 disjoint amber with a pattern + 4 m min; toggles/render throw nothing.
>
> **SURVEY AS A TYPED BEHAVIOR + COMPLETION SEMANTICS DONE (2026-07-20):** the plan run
> (Survey / committed search patterns) now carries a **completion mode** — `SimVcu._completion`
> ∈ **complete** (stop) | **loiter** (station-keep at the last wp) | **repeat** (loop:
> `_wp_index=0`, `_seg_start`=present, `_laps++`, until Stop) — replacing the old `_hold` bool.
> Persisted as `mission.completion`; `Engine.upload` passes `completion=` to `upload_plan`;
> behaviors' `_run_route` always uses `loiter`. Autonomy shows `hold` whenever station-keeping
> (a loitering Survey included). GUI: `#c_completion` command-bar selector + vessel-card **Run
> mode** row (`behavior · completion · lap N`). Sim-verified all three modes. **This completes
> the ASV behavior set** (Go-To, RTH, Hold, search patterns, Survey — all typed, ENC-aware,
> with completion semantics). **Next candidate:** a per-behavior loiter/station-keep radius, or
> `route-plan` protocol capture (the real-hardware blocker) once vendor traffic is available.

Goal: broaden the console from a single **survey-line mission** to a library of
composable **autonomous behaviors** the ASV can execute — matching how CCOM's
Project 11 works (`unh_marine_autonomy/.../track_patterns.py` = canned
`ExpandingBoxSearch`/`RaceTrackPattern`; behavior-tree "survey this area" →
tracklines). All behaviors run through the existing run-control + line-following
guidance and the same safety model. **Proposal — confirm / re-prioritize before
building.**

## Principle
A "behavior" is a **route/param generator + a mode tag + completion semantics**.
The Engine + `SimVcu` already follow an ordered waypoint route with line-following
(`_seg_start`→wp, LOS, approach radius) and own arming/run state. So most of a
behavior = *produce the waypoint route* (and how it ends: complete once vs repeat
vs hold). Minimal new engine surface.

## Behavior set (proposed, priority order)
1. **Go-To point** — click a point; drive to it (obstacle-aware transit via the
   existing `routeAround`), then Hold. The simplest generalized behavior.
2. **Return-to-Home (RTH)** — real version of today's Phase-0 stub: store a *home*
   (launch fix or a set point), route to it clear of keep-outs, then Hold.
3. **Hold / Station-keep** — maintain a position: Hold (stop) or Station-keep
   (small circle / re-approach when drift > radius). Loiter radius param.
4. **Search patterns** (canned generators, à la track_patterns.py):
   - **Expanding box** (growing square spiral from a datum),
   - **Sector search** (pie wedges from a datum),
   - **Parallel / creeping-line** (offset lanes over a strip).
   Params: datum, spacing/leg, orientation, radius/laps, speed.
5. **Survey** (existing) — the CAMP 3-click + Punch Out + boundary + BCD ordering
   plan, folded in as one behavior type.

## Architecture
- **Behavior model:** `{type, params, route:[{lat,lon}], mode: complete|repeat|hold}`.
  Reuse `mission` as "the active behavior's route + params"; add `type`.
- **Generators (client JS):** one per behavior producing the waypoint route from a
  few clicks + params (port the geometry from Project 11 `track_patterns.py` —
  `poseFromDistanceAndHeading` etc.). Keep-out-aware where sensible (reuse
  `regionOrder`/`routeAround`).
- **Engine/SimVcu:** add route **completion semantics** — `hold` (loiter at last
  wp / station-keep), `repeat` (loop the route). Today it just completes. Add
  `set_home`, and make `return_home` real (route to home, then hold). Behaviors
  are still **arm-gated, estop/link-loss safe, RC-master** — unchanged safety.
- **GUI:** a behavior/mode picker (a row of buttons like the survey tools) + a
  per-behavior param panel; the command bar (Arm/Upload/Start/Pause/Stop/RTH/
  E-STOP) drives every behavior uniformly.

## Scope / constraints
- **Sim-first**, like everything else — real execution still gated on the VCU
  serial control link protocol capture (unchanged blocker; behaviors just generate routes the
  real VCU would follow once the codec exists).
- Keep it composable: a behavior is just a route + mode, so nothing about the
  command flow, safety, water-level/depth, or obstacle handling changes.

## Suggested first slice (one fresh session)
Go-To + real RTH + Hold + the behavior-mode picker and `hold`/`set_home` engine
support — small, end-to-end, immediately useful — then add the search patterns.
