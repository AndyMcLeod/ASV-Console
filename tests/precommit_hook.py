"""tests/precommit_hook.py - the commit gate has no gaps (review #17, 2026-09-15).

WHAT WAS WRONG WITH IT:
  * its list of paths that count had drifted: a commit touching only currents.py, a vessels/*.json file or
    ports.default.json ran NO suites;
  * two failure-advice entries were written twice, so the second copy of each could never be shown - and ten
    suites had none at all;
  * a suite that hung held the commit for ever;
  * and eleven suites failed a commit whenever the console's output merely CONTAINED "Error": a DNS hiccup
    made it print "[ports] geocoder unreachable: URLError: ..." and a commit with nothing wrong was blocked.

HOW THIS IS PROVED: a copy of the real hook is run in a temp folder holding a probe suite, with a stand-in `git`
on PATH that answers `git diff --cached --name-only` with the staged names under test - so the hook's own sh
decides, and nothing is committed anywhere.

    python tests/precommit_hook.py     # exit 0 = pass, 1 = fail   (stdlib only; needs the sh Git ships)

TEETH - 11 mutations RUN in a scratch clone, 11/11 caught (recorded results):
  * the old list of paths that count restored             -> caught by 1, 2
  * nothing staged skips the suites                       -> caught by 1
  * Markdown alone runs the suites                        -> caught by 2
  * no time limit                                         -> caught by 4
  * a timeout reported as a plain failure                 -> caught by 4
  * an advice entry written twice again                   -> caught by 5
  * a suite left without advice                           -> caught by 5
  * a POST route that raised not counted                  -> caught by 6
  * any line naming an Error counted again                -> caught by 6
  * a suite back on the broad match                       -> caught by 7
  * END TO END: the water-level cast unguarded in the console -> env_water.py 7 and 9, and 9 names the line
    "[http] /api/waterlevel raised: ValueError: ..." - the finder still sees a route that raises
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
HOOK = os.path.join(APP, ".githooks", "pre-commit")
sys.path.insert(0, os.path.join(HERE, "lib"))
from server_log import exception_lines  # noqa: E402

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


def find_sh():
    for cand in (shutil.which("sh"), r"C:\Program Files\Git\bin\sh.exe", r"C:\Program Files\Git\usr\bin\sh.exe"):
        if cand and os.path.exists(cand):
            return cand
    return None


print("The commit gate has no gaps:")

SH = find_sh()
WORK = tempfile.mkdtemp(prefix="asv_hook_")
BIN = os.path.join(WORK, "bin")
REPO = os.path.join(WORK, "repo")
os.makedirs(BIN)
os.makedirs(os.path.join(REPO, "tests"))
with open(os.path.join(BIN, "git"), "w", newline="\n") as f:
    f.write('#!/bin/sh\nprintf "%s" "$FAKE_STAGED"\n')
os.chmod(os.path.join(BIN, "git"), 0o755)
PROBE = os.path.join(REPO, "tests", "probe.py")


def probe(body):
    with open(PROBE, "w", newline="\n") as f:
        f.write(body)


def hook(staged, limit=None, timeout=120):
    """Run the real hook in the temp repo with `staged` as the staged paths: (exit code, output, seconds)."""
    env = dict(os.environ)
    env["PATH"] = BIN + os.pathsep + env.get("PATH", "")
    env["FAKE_STAGED"] = "\n".join(staged)
    if limit is not None:
        env["ASV_SUITE_LIMIT_S"] = str(limit)
    t0 = time.time()
    r = subprocess.run([SH, HOOK], cwd=REPO, env=env, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout)
    return r.returncode, r.stdout + r.stderr, time.time() - t0


try:
    # ── 1-2. what makes the suites run ─────────────────────────────────────────────────────
    probe('print("probe ran")\n')
    RUNS = [["currents.py"], ["vessels/drix08.json"], ["ports.default.json"], ["static/js/units.js"],
            ["tools/build_docs.js"], ["README.md", "asv_console.py"], []]
    SKIPS = [["README.md"], ["CLAUDE.md", "docs/README_PLAYBACK.md"], [".gitignore"]]
    ran_for = {}
    for staged in RUNS + SKIPS:
        code, out, _ = hook(staged) if SH else (None, "", 0)
        ran_for[", ".join(staged) or "(nothing staged)"] = (code, "pre-commit: probe.py ..." in out)
    check("1. the suites run for a commit touching only the current model, a vessel file, the default ports, a module "
          "or a tool - the paths the old list never named - and for a commit that stages nothing",
          lambda: SH and all(ran_for[", ".join(s) or "(nothing staged)"] == (0, True) for s in RUNS),
          lambda: "sh: %s; %s" % (SH, {k: v for k, v in ran_for.items() if k in [", ".join(s) or "(nothing staged)" for s in RUNS]}))
    check("2. ... and are skipped only when every staged path is one no suite reads - Markdown or git's own metadata",
          lambda: SH and all(ran_for[", ".join(s)] == (0, False) for s in SKIPS),
          lambda: {k: v for k, v in ran_for.items() if k in [", ".join(s) for s in SKIPS]})

    # ── 3-4. what blocks a commit ───────────────────────────────────────────────────────────
    probe('import sys\nprint("  FAIL 1. a probe that fails")\nsys.exit(1)\n')
    code_f, out_f, _ = hook(["asv_console.py"])
    probe('print("probe ran")\n')
    code_p, out_p, _ = hook(["asv_console.py"])
    check("3. a suite that fails blocks the commit, with its advice; one that passes lets it through",
          lambda: code_f == 1 and "pre-commit: probe.py FAILED." in out_f and "commit blocked" in out_f
          and "See the suite's own docstring" in out_f and code_p == 0,
          lambda: "failing: exit %s; passing: exit %s" % (code_f, code_p))
    probe('import time\nprint("probe hangs", flush=True)\ntime.sleep(60)\n')
    try:
        code_h, out_h, secs = hook(["asv_console.py"], limit=3, timeout=90)
    except subprocess.TimeoutExpired:           # the hook itself held on: that IS the defect, reported as a check
        code_h, out_h, secs = None, "the hook was still running after 90 s", 90.0
    check("4. a suite that HANGS is stopped after the time limit and blocks the commit as TIMED OUT - not held for ever",
          lambda: code_h == 1 and "pre-commit: probe.py TIMED OUT after 3 s" in out_h and secs < 30,
          lambda: "exit %s after %.1f s; %s" % (code_h, secs, (re.findall(r"pre-commit: probe\.py [A-Z ]+[^\n]*", out_h) or ["no verdict"])[0]))

    # ── 5. the advice ──────────────────────────────────────────────────────────────────────
    text = open(HOOK, encoding="utf-8").read()
    labels = re.findall(r"^    ([a-z_0-9]+\.(?:js|py))\)", text, re.M)
    dupes = sorted({x for x in labels if labels.count(x) > 1})
    suites = sorted(n for n in os.listdir(HERE) if n.endswith((".js", ".py")))
    missing = [n for n in suites if n not in labels]
    check("5. every suite has ONE advice entry - none written twice, where the second copy can never be shown, and "
          "none left to the generic line",
          lambda: not dupes and not missing and len(suites) >= 70,
          lambda: "%d suites, %d entries; twice: %s; missing: %s" % (len(suites), len(labels), dupes or "none", missing or "none"))

    # ── 6-7. what counts as an exception in a console's output ──────────────────────────────
    SAMPLE = "\n".join([
        "[ports] geocoder unreachable: URLError: <urlopen error [Errno 11001] getaddrinfo failed>",
        "[water] an update failed, and the monitor carries on: KeyError: 'lng'",
        "[currents] cycle gomofs_x unreadable: OSError: [Errno 2] No such file",
        "----------------------------------------",
        "Exception occurred during processing of request from ('127.0.0.1', 51000)",
        "Traceback (most recent call last):",
        '  File "asv_console.py", line 10, in do_GET',
        "    raise TypeError('boom')",
        "TypeError: boom",
        "[http] /api/waterlevel raised: ValueError: could not convert string to float: 'abc'",
    ])
    got = exception_lines(SAMPLE)
    check("6. an exception while serving is found - a traceback (named by its error line), socketserver's report, and "
          "a POST route that raised - and a deliberate note that merely names an error is not",
          lambda: got == ["Exception occurred during processing of request from ('127.0.0.1', 51000)", "TypeError: boom",
                          "[http] /api/waterlevel raised: ValueError: could not convert string to float: 'abc'"],
          lambda: got)
    broad, using = [], []
    for n in suites:
        if not n.endswith(".py") or n == "precommit_hook.py":       # this file names the pattern it looks for
            continue
        src = open(os.path.join(HERE, n), encoding="utf-8").read()
        if re.search(r'"Error" in ln', src):
            broad.append(n)
        if "exception_lines(" in src:
            using.append(n)
    check("7. no suite still fails on any line containing \"Error\"; the console-output checks use the shared finder",
          lambda: not broad and len(using) >= 11, lambda: "broad match left in: %s; using the finder: %d" % (broad or "none", len(using)))
finally:
    shutil.rmtree(WORK, ignore_errors=True)

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
