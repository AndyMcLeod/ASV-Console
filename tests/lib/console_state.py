"""tests/lib/console_state.py - where a console started by a test keeps its state: never the app folder.

Review #16, 2026-09-14. Eighteen suites started a console in the app directory, and the console
kept its plan, comms settings, port registry, ROC registry and session logs beside the program - so
every run of the pre-commit hook wrote the operator's own files. Most suites "protected" the plan by
reading mission.json when they began and writing it back when they ended, which is a write of its
own: an edit the operator made in their own console while the hook ran was lost at the write-back,
and with plan revisions (review #10) the write-back also rolled the revision back, so the operator's
page then refused to save.

The console now takes --state-dir DIR (asv_console.use_state_dir). Every harness that starts one
passes a fresh temp folder through this helper, and tests/state_dir.py fails the day a suite starts a
console without it.

    from console_state import ConsoleState
    STATE = ConsoleState()
    proc = subprocess.Popen([sys.executable, "asv_console.py", ..., *STATE.args()], cwd=APP, ...)
    STATE.path("logs")            # where that console's session logs go

This folder is NOT a suite: the hook runs tests/*.py, and this file lives one level down.
"""
import atexit
import os
import shutil
import tempfile


class ConsoleState:
    """A fresh, empty temp folder for one console's own state, removed when the suite exits. Empty on
    purpose: a suite that needs a plan, a port or a ROC makes it, and never inherits the operator's."""

    def __init__(self, prefix="asv_test_state_"):
        self.dir = tempfile.mkdtemp(prefix=prefix)
        atexit.register(shutil.rmtree, self.dir, True)

    def args(self):
        """The command-line arguments that keep a console's state in this folder - and its surface current to the OFS
        alone (2026-10-07). With the NOAA station predictions the stream at New Castle, the default port, is the
        river's own, up to ~4 kn: a suite driving the boat there would pass at slack water and fail at full ebb. A
        suite that wants the fused stream drives stream_fusion.py in-process (tests/stream_fusion.py)."""
        return ["--state-dir", self.dir, "--no-stream-predictions"]

    def path(self, *parts):
        return os.path.join(self.dir, *parts)
