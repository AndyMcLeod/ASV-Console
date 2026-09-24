"""tests/roc_persist.py - the ROC registry keeps only the most recent few across a
restart, and one malformed record cannot take the card down.

WHY THIS EXISTS. Andy: "The ROC card opens with old data. The remove button on each
entry fails to remove the entry. Delete the data and allow only the most recent 3
entries to preserve through restarts."

THE REMOVE BUTTON WAS NEVER BROKEN, and that is the finding. roc_config.json had grown
to 198 identical staged ROCs, and every ROC edit ships the WHOLE registry back and
re-renders the WHOLE list: measured in a real browser, one Remove took ~1200 ms to show
at 198 entries against 28 ms at 4, and it took away 1 row out of 198 - so the operator
clicked, nothing appeared to happen, and the list looked exactly as before. A control
that is correct but smothered by data reads as a broken control.

WHERE THE 198 CAME FROM, and it is ours: tests/http_contract.py POSTs every ROC op -
including `add` - against a live console started with cwd=APP, so each run wrote one
more staged ROC into the OPERATOR'S OWN roc_config.json and nothing ever removed it.
That is the same class as the mission.json scare: a harness driving a real console in
the app directory writes the app's real files. The console now takes --roc-config and
both ROC-touching suites point it at a temp file (checks 9-10).

THE RULE: ROC_PERSIST_MAX (3) applies to what SURVIVES, not to the live registry - a
session may place as many ROCs as the work needs. Enforced on save AND on load, so a
huge file written by an older build heals itself on the next start instead of having to
be deleted by hand. HOME is the one exception to "most recent": dropping it would
quietly move where Return-to-Home goes, so it displaces the oldest kept entry instead.

    python tests/roc_persist.py     # exit 0 = pass, 1 = fail   (stdlib only)

LIVE-VERIFIED in a real browser at the Lewes base, which these checks cannot see: with
the file deleted the card opens on "No ROC yet"; five placed all stay live; Remove takes
31 ms and the row leaves the DOM; and after a real console restart exactly the three
most recent come back.

TEETH (verified by mutation, with the checks each one produces):
    the save-side cap is dropped                              -> 1, 2
    the load-side cap is dropped (no self-heal)               -> 5
    the cap keeps the OLDEST instead of the newest            -> 2, 6
    HOME is allowed to fall off the cap                       -> 3, 4
    the cap is applied to the LIVE registry too               -> 7
    the offset default is overwritten by an absent field      -> 8
    a harness stops passing --roc-config                      -> 9, 10
"""

import ast
import json
import os
import sys
import tempfile

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

import roc_tracks as R                                  # noqa: E402

# --- crash guard: a throw outside a check() must still REPORT ---------------------------
# check() turns an exception inside its own thunk into a failed check. Scenario SETUP is
# not inside one - booting a console, driving an endpoint, waiting on a fix - and an
# exception there would end the process before a single FAIL line printed. "No FAIL lines"
# and "the process died" are indistinguishable to anything reading stdout, so a mutation
# that crashes this suite would score as SURVIVED rather than caught. Report it instead, in
# this suite's normal format; Python still exits non-zero on its own.
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report


fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond()) if callable(cond) else bool(cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        ok = False
        detail = "threw %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + str(detail) + "]" if detail else ""))
    if not ok:
        fails += 1


def names(path):
    with open(path, "r", encoding="utf-8") as f:
        return [r.get("name") for r in json.load(f).get("rocs", [])]


import atexit  # noqa: E402
import shutil  # noqa: E402
TMP = tempfile.mkdtemp(prefix="asv_roc_persist_")
atexit.register(shutil.rmtree, TMP, True)  # a suite leaves no temp folder behind (review #27; tests/state_dir.py 1b)


def fresh(fname):
    return os.path.join(TMP, fname)


print("ROC persistence — only the most recent %d survive a restart:" % R.ROC_PERSIST_MAX)

# ---- the cap, on the way out --------------------------------------------- #
p1 = fresh("cap.json")
t1 = R.RocTracker(config_path=p1)
for i in range(6):
    t1.add("shore", name="R%d" % i, lat=38.79, lon=-75.161)
check("1. placing six writes only %d to the file" % R.ROC_PERSIST_MAX,
      lambda: len(names(p1)) == R.ROC_PERSIST_MAX, lambda: str(names(p1)))
check("2. and they are the MOST RECENT, in order",
      lambda: names(p1) == ["R3", "R4", "R5"], lambda: str(names(p1)))

# ---- HOME is never dropped by the cap ------------------------------------ #
p2 = fresh("home.json")
t2 = R.RocTracker(config_path=p2)
hid = t2.add("shore", name="HOME_ONE", lat=38.79, lon=-75.161)
t2.confirm(hid)
t2.select_home(hid)
for i in range(5):
    t2.add("shore", name="later%d" % i, lat=38.79, lon=-75.161)
with open(p2, "r", encoding="utf-8") as f:
    saved2 = json.load(f)
check("3. HOME survives the cap even when it is the oldest ROC of all",
      lambda: "HOME_ONE" in names(p2) and len(names(p2)) == R.ROC_PERSIST_MAX,
      lambda: str(names(p2)))
check("3b. ... by displacing the OLDEST kept entry, not the newest "
      "(the newest is what the operator just placed)",
      lambda: names(p2) == ["HOME_ONE", "later3", "later4"], lambda: str(names(p2)))
# ⚠⚠ 4 USED TO ASSERT THE OPPOSITE - "home_id is still pointed at it after a restart, so
# Return-to-Home goes where it went before" - and that promise is what put home 500 km from the
# boat at Erie on 2026-09-23: an Aug demo's Mothership, restored as HOME at every boot, planted
# over the first fix, and no spawn could shift it. The ROC survives (3, 3b); the SELECTION is
# the operator's to make again in this session, from where the boat actually is.
check("4. ... but the SELECTION does not: the file names no home and a fresh tracker "
      "selects none - a restart re-arms home at the first fix, not at last week's ship",
      lambda: "home_id" not in saved2
      and R.RocTracker(config_path=p2).snapshot().get("home_id") is None,
      lambda: "saved home_id=%s reloaded=%s" % (saved2.get("home_id", "<absent>"),
                                                R.RocTracker(config_path=p2).snapshot().get("home_id")))
# 4b. THE FILE HIS CONSOLE HAD: an older build's file that still carries "home_id". It loads the
# ROC and ignores the selection - the operator does not have to edit it to boot with a true home.
p2b = fresh("legacy_home.json")
with open(p2b, "w", encoding="utf-8") as f:
    json.dump({"rocs": [{"id": "ship-1", "name": "Mothership", "kind": "ship", "status": "active",
                         "lat": 38.8, "lon": -75.1}], "home_id": "ship-1"}, f)
snap2b = R.RocTracker(config_path=p2b).snapshot()
check("4b. an old file that still names a home_id loads the ROC and selects NOTHING",
      lambda: [r["id"] for r in snap2b["rocs"]] == ["ship-1"] and snap2b.get("home_id") is None,
      lambda: "rocs=%s home_id=%s" % ([r["id"] for r in snap2b["rocs"]], snap2b.get("home_id")))

# ---- the cap, on the way IN (self-heal) ---------------------------------- #
# THE CASE THAT WAS ACTUALLY REPORTED: a file already holding 198 entries, written by a
# build with no cap. Loading must not need the operator to delete anything. These
# records also carry NO offset fields, which is the malformed shape check 8 covers.
p3 = fresh("legacy.json")
with open(p3, "w", encoding="utf-8") as f:
    json.dump({"rocs": [{"id": "shore-%d" % i, "name": "old%d" % i, "kind": "shore",
                         "lat": 38.79, "lon": -75.161} for i in range(198)],
               "home_id": None}, f)
t3 = R.RocTracker(config_path=p3)
# snapshot() LAZILY, inside the thunks. Called eagerly here it killed the whole suite
# under the very mutation check 8 exists for (a record with no offset fields raises
# inside snapshot), so the process died at check 5 and printed no FAIL line at all -
# scored as a surviving mutant. A harness that cannot survive the fault it tests for
# cannot report it; this file's own rule, relearnt.
check("5. THE REPORTED CASE: a 198-entry file left by an older build loads as %d, "
      "so the card cannot open on a wall of stale rows" % R.ROC_PERSIST_MAX,
      lambda: len(t3.snapshot()["rocs"]) == R.ROC_PERSIST_MAX,
      lambda: "%d loaded" % len(t3.snapshot()["rocs"]))
check("6. ... and it kept the NEWEST of them",
      lambda: [r["name"] for r in t3.snapshot()["rocs"]] == ["old195", "old196", "old197"],
      lambda: str([r["name"] for r in t3.snapshot()["rocs"]]))
def heal_p3():
    t3.add("shore", name="new", lat=38.79, lon=-75.161)   # the save is what rewrites it
    return names(p3) == ["old196", "old197", "new"]


# The add() is INSIDE the thunk for the same reason the snapshots above are: saving walks
# every kept ROC, so under the malformed-record fault it throws, and at module level that
# killed the process before checks 8+ ever ran.
check("6b. ... and the oversized file is rewritten at the next save (it heals, it does "
      "not just read short)", heal_p3, lambda: str(names(p3)))

# ---- the LIVE registry is not capped ------------------------------------- #
# The cap is a property of what survives. Removing a ROC the operator is still using
# because they placed a fourth would be a surprise mid-session.
p4 = fresh("live.json")
t4 = R.RocTracker(config_path=p4)
for i in range(6):
    t4.add("shore", name="L%d" % i, lat=38.79, lon=-75.161)
check("7. the LIVE registry is unbounded — six placed, six usable this session",
      lambda: len(t4.snapshot()["rocs"]) == 6,
      lambda: "%d live vs %d persisted" % (len(t4.snapshot()["rocs"]), len(names(p4))))

# ---- one malformed record must not take the card down -------------------- #
# A record written before the offset fields existed arrives as {"range_m": None, ...};
# `in`-based merging overwrote the default with None, set_offset() skips None, and the
# attribute was then never assigned - so the first read of the arrival point raised
# INSIDE snapshot(), taking out the ROC card and every /api/state frame with it.
p5 = fresh("partial.json")
with open(p5, "w", encoding="utf-8") as f:
    json.dump({"rocs": [{"id": "shore-1", "name": "no-offset-fields", "kind": "shore",
                         "lat": 38.79, "lon": -75.161}], "home_id": None}, f)
t5 = R.RocTracker(config_path=p5)
check("8. a record with NO offset fields keeps the defaults and still snapshots "
      "(one malformed ROC used to take out the whole card)",
      lambda: t5.snapshot()["rocs"][0]["offset"]["range_m"] == 0.0
      and t5.snapshot()["rocs"][0]["arrival"] is not None,
      lambda: json.dumps(t5.snapshot()["rocs"][0]["offset"]))

# ---- no harness may write to the operator's registry --------------------- #
# Parsed out of the source, so a suite that later grows a ROC call is covered the day it
# is added rather than the day someone remembers this rule.
def launches_console(src):
    """True when the source actually CALLS subprocess.Popen on the console.

    By AST, not by substring, and the reason is this file: it names asv_console.py
    (check 10 reads it) and it names the launch call (in this very predicate), so a
    substring test put roc_persist.py into its own audit set - where it passed only
    because the literal "--roc-config" appears in check 10. A source-shape check whose
    pattern occurs in its own source cannot tell the two apart. The AST sees a CALL;
    a string in a function body is not one.
    """
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return False
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if isinstance(f, ast.Attribute) and f.attr == "Popen" and "asv_console.py" in src:
            return True
    return False


def passes_roc_config(src):
    # A console given a state folder of its own (--state-dir, tests/lib/console_state.py) keeps its ROC
    # registry there too - review #16, proved by tests/state_dir.py 2b.
    return '"--roc-config"' in src or "ConsoleState(" in src


roc_suites, unisolated = [], []
for fn in sorted(os.listdir(os.path.join(APP, "tests"))):
    if not fn.endswith(".py"):
        continue
    with open(os.path.join(APP, "tests", fn), "r", encoding="utf-8") as f:
        src = f.read()
    if launches_console(src) and "/api/roc" in src:
        roc_suites.append(fn)
        if not passes_roc_config(src):
            unisolated.append(fn)
check("9. every suite that drives a real console AND touches /api/roc passes "
      "--roc-config, so none of them can write to the operator's ROCs",
      lambda: roc_suites and not unisolated,
      lambda: "checked %s%s" % (", ".join(roc_suites),
                                ("; NOT isolated: " + ", ".join(unisolated)) if unisolated else ""))

# 10. the flag has to actually reach the registry, not just be accepted.
with open(os.path.join(APP, "asv_console.py"), "r", encoding="utf-8") as f:
    console_src = f.read()
check("10. the console wires --roc-config through to the registry",
      lambda: "--roc-config" in console_src and "ROC.use_config(args.roc_config)" in console_src)

# 11. use_config really isolates: the previous file is left exactly as it was.
pa, pb = fresh("a.json"), fresh("b.json")
t6 = R.RocTracker(config_path=pa)
t6.add("shore", name="inA", lat=38.79, lon=-75.161)
t6.use_config(pb)
t6.add("shore", name="inB", lat=38.79, lon=-75.161)
check("11. use_config() re-points the registry and leaves the old file untouched",
      lambda: names(pa) == ["inA"] and names(pb) == ["inB"]
      and [r["name"] for r in t6.snapshot()["rocs"]] == ["inB"],
      lambda: "A=%s B=%s live=%s" % (names(pa), names(pb),
                                     [r["name"] for r in t6.snapshot()["rocs"]]))

# 12. remove() still does what the card asks of it - the button was never the bug, and a
# regression here would be blamed on the UI again.
p7 = fresh("rm.json")
t7 = R.RocTracker(config_path=p7)
a = t7.add("shore", name="keep", lat=38.79, lon=-75.161)
b = t7.add("shore", name="drop", lat=38.79, lon=-75.161)
gone = t7.remove(b)
check("12. remove() removes the entry, reports True, and persists the removal",
      lambda: gone is True and [r["id"] for r in t7.snapshot()["rocs"]] == [a]
      and names(p7) == ["keep"],
      lambda: "returned %s, live=%s, file=%s" % (gone, [r["name"] for r in t7.snapshot()["rocs"]],
                                                 names(p7)))
check("12b. ... and removing an unknown id is False, not a crash",
      lambda: t7.remove("no-such-roc") is False)

# 13. ROC_PERSIST_MAX is the operator's number, read from the source rather than assumed.
check("13. the cap is %d, as asked" % 3, lambda: R.ROC_PERSIST_MAX == 3,
      lambda: "ROC_PERSIST_MAX=%s" % R.ROC_PERSIST_MAX)

print("%d checks, %d failed" % (ran, fails))
sys.exit(1 if fails else 0)
