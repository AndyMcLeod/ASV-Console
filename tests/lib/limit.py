"""Run one suite under a time limit, and stop it - and everything it spawned - when the limit passes.

    python tests/lib/limit.py SECONDS node tests/foo.js
    python tests/lib/limit.py SECONDS python tests/bar.py

Exit code: the suite's own, or 124 when the limit passed (GNU timeout's code, which the hook reads
as TIMED OUT).

WHY THIS AND NOT `timeout` (2026-09-26). The hook ran every suite under GNU timeout from Git's MSYS
tools, and on this machine that stopped being prompt: `timeout 3 python -c "sleep(20)"` killed the
python at 3 s and then RETURNED AT 47 s - measured, with the process gone from the task list at
7 s and timeout still waiting - and the same for node. A hook whose time limit lands 45 s late is
a commit gate that holds the commit for 45 s per hung suite, and tests/precommit_hook.py 4 rightly
refused it. Python's own subprocess wait is a plain WaitForSingleObject on the child, which returns
the moment the child is gone; and on Windows a hung suite that spawned a console (many do) is
stopped with its whole tree, not just the interpreter.

Output is NOT captured: the suite inherits the hook's stdout and stderr, so it prints live, as it
always did.
"""
import os
import subprocess
import sys


def main(argv):
    if len(argv) < 3:
        print("usage: limit.py SECONDS COMMAND [ARGS...]", file=sys.stderr)
        return 2
    try:
        secs = float(argv[1])
    except ValueError:
        print("limit.py: SECONDS must be a number, got %r" % argv[1], file=sys.stderr)
        return 2
    cmd = argv[2:]
    try:
        proc = subprocess.Popen(cmd)
    except OSError as e:
        print("limit.py: could not start %s: %s" % (cmd[0], e), file=sys.stderr)
        return 127
    try:
        return proc.wait(timeout=secs)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            # the whole tree: a suite that started a console must not leave it running
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            proc.kill()
        except OSError:
            pass
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        return 124


if __name__ == "__main__":
    sys.exit(main(sys.argv))
