"""tests/tide_note.py - the tide card's failure note says ONE CAUSE ONCE.

WHY THIS EXISTS. Andy reported the ENV card reading, in a single line:

    no observed data (fetch failed: HTTP Error 502: Bad Gateway) · fetch failed: HTTP Error
    502: Bad Gateway

The observed and predicted series are two independent calls to the SAME upstream (NOAA
CO-OPS), so one outage fails both with an identical message, and the note joined them
verbatim. The repetition tells the operator nothing extra - and it HIDES the part that
matters, which is that BOTH series are gone rather than just the observed one.

The 502 itself was NOT a bug here. Every request shape the console sends was replayed
against CO-OPS by hand and all four answered 200, including the exact Lewes calls; the
outage was transient at their end. The console already degrades correctly (it never raises,
it shows a note, and the card clears the note on the next good fetch). What was wrong was
only what the operator was asked to read.

    python tests/tide_note.py      # exit 0 = pass, 1 = fail   (stdlib only)

tide_note() was split out of fetch_tide precisely so this can run with no network: the
function that surrounds it does live HTTP, and a test that needs a working NOAA to tell you
whether a STRING is well formed is a test that fails for the wrong reason.

TEETH (verified by mutation, with the checks each one actually produced):
    the de-duplication removed, so one cause prints twice     -> 1, 1b
    de-duplicating on the FIRST note only, ignoring equality  -> 2
    the combined message drops "and no predictions"           -> 1
    a single failure stops naming its reason                  -> 2, 3
    a healthy pair starts emitting a note                     -> 5

MUTATION-TESTING A PYTHON MODULE NEEDS PYTHONDONTWRITEBYTECODE=1, and this file is where
that was learnt. Rewriting asv_console.py repeatedly in a loop puts several versions inside
the mtime granularity Python uses to decide whether a cached .pyc is still valid, so a run
can import the PREVIOUS mutation's bytecode. It is not a crash and nothing looks wrong: one
mutation above was graded against the wrong code and reported check 2 instead of check 1,
and the same mechanism could just as easily report a live mutation as CAUGHT when the test
never ran against it. Disable the cache, or delete __pycache__ between runs. The JS suites
are immune - Node has no equivalent on-disk cache here.
"""

import os
import sys

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

from asv_console import tide_note                                   # noqa: E402

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
    """A thunk is allowed, and a THROW is reported as a failed check rather than killing the
    run - see tests/stored_settings.js."""
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
        note = detail() if callable(detail) else detail
    except Exception as e:
        ok, note = False, "THREW: %s" % e
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + note + "]" if note else ""))
    if not ok:
        fails += 1


OUTAGE = "fetch failed: HTTP Error 502: Bad Gateway"

print("Tide note — one cause, said once, and it names everything that was lost:")

# 1. THE REPORTED CASE. One upstream failure, both series gone.
both = tide_note({"ok": False, "note": OUTAGE}, {"ok": False, "note": OUTAGE})
check("1. THE REPORTED CASE: one outage does not print its message twice",
      lambda: both.count(OUTAGE) == 1 and "no observed data and no predictions" in both,
      lambda: both)

# The old output is the specific thing that must never come back.
check("1b. ... and the exact string Andy saw is not producible any more",
      lambda: both != "no observed data (%s) · %s" % (OUTAGE, OUTAGE),
      "the joined-verbatim form")

# 2. TWO DIFFERENT causes are two different facts - collapsing them would lose one. This is
# the acceptance case that stops check 1 being satisfied by "always print one note".
GL = "no tide forecast at Great Lakes stations (levels are weather-driven)"
diff = tide_note({"ok": False, "note": OUTAGE}, {"ok": False, "note": GL})
check("2. two DIFFERENT failures are both reported, not collapsed into one",
      lambda: OUTAGE in diff and GL in diff and " · " in diff,
      lambda: diff)

# 3-4. A single failure is unchanged, and still names its reason - the de-duplication must
# not have quietly swallowed the ordinary cases.
obs_only = tide_note({"ok": False, "note": "no water_level data"}, {"ok": True})
check("3. only the observed series failed — reported, with its reason",
      lambda: obs_only == "no observed data (no water_level data)",
      lambda: repr(obs_only))

pred_only = tide_note({"ok": True}, {"ok": False, "note": "no predictions"})
check("4. only the predictions failed — reported on its own",
      lambda: pred_only == "no predictions",
      lambda: repr(pred_only))

# 5. THE SILENCE CASE. A working pair must produce NO note at all: a card that always has
# something to say about failure trains the operator to ignore the line.
check("5. two healthy series produce no note whatsoever",
      lambda: tide_note({"ok": True}, {"ok": True}) is None,
      "nothing to report is reported as nothing")

# 6. Degrades rather than throwing when the upstream gave no reason at all - the note is
# assembled from whatever came back, and "?" is honest about not knowing.
bare = tide_note({"ok": False}, {"ok": False})
check("6. a failure that carried no reason still produces a usable note",
      lambda: bare is not None and "no observed data" in bare and "no predictions" in bare,
      lambda: repr(bare))

# 7. The de-duplication keys on the MESSAGE, not on both merely being unhealthy: two empty
# notes are not evidence of a common cause.
check("7. the de-duplication needs a real, matching reason — not two blanks",
      lambda: " · " in bare,
      "no shared message means no claim of a shared cause")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
