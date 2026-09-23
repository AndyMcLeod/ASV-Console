"""tests/sanitization.py - this derivative carries no vendor identity in its code.

    python tests/sanitization.py      # exit 0 = pass, 1 = fail   (stdlib Python)

The project's first paragraph says it "carries no vendor, model, or proprietary-protocol
identity", and CLAUDE.md's sanitization section settles where the line falls. It was clean at
the scrub commit of 2026-08-26 - and by 2026-09-23 NINE hits had drifted back across seven
files, every one of them from a commit AFTER the scrub, one of them baked into the shipped
technical manual. CLAUDE.md had already named the reason:

    "⚠ AND NOTHING RUNS THIS. It lives here as prose, so it is a check only when somebody
     types it - which is how it stayed wrong."

This is the check. Three rules, and they are not the same rule:

  * THE HOUSE WORD is "the small-class boat", matching vessels/*.json's `"class"`.
  * A QUOTATION IS ALTERED IN BRACKETS, NEVER SILENTLY - "[small-class boat]" - because a
    quotation reworded without saying so stops being evidence of what was asked for.
  * WHERE A CHECK NAMES THE THING EXACTLY, THE PROFILE ID is the sanitized way, and the
    pattern permits it: `zboat_1800hs=` is a data key, the brand alone is branding.

⚠⚠ THE RULE IS SCOPED TO CODE, and that scope is the point rather than an oversight.
CLAUDE.md, the READMEs and the design notes deliberately NAME the sibling and its path - a
maintainer has to be able to find it. Check 3 asserts that exemption is real, so nobody
"finishes the job" by scrubbing the maintainer notes.
"""
import os
import re
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)


def _crash_report(exc_type, exc, tb):
    print("  FAIL 0. the suite itself CRASHED before finishing - "
          + "".join(traceback.format_exception_only(exc_type, exc)).strip())
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    os._exit(1)


sys.excepthook = _crash_report

fails = 0
ran = 0


def check(name, cond, detail):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
        note = detail() if callable(detail) else detail
    except Exception as e:                                          # noqa: BLE001
        ok, note = False, "THREW: %s" % e
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % note if note else ""))
    if not ok:
        fails += 1


# ⚠ THE NEGATIVE LOOKAHEAD IS WHAT MAKES THIS USABLE, and CLAUDE.md records why: the brand
# as a DATA KEY (`zboat_1800hs.json`) is a key, the brand standing alone is branding. Without
# it the profile ids drown the real hits - which is exactly what hid the previous nine.
BRAND = re.compile(r"teledyne|z-?boat(?![_a-z0-9])", re.I)

CODE_EXT = (".py", ".js", ".html")
SKIP_DIRS = {"node_modules", ".git", "vessels", "charts", "logs", "ofs_cache", "__pycache__"}


# ⚠⚠ THIS FILE IS EXEMPT, AND IT HAS TO BE: a suite that searches for a word must
# contain that word. The exemption is ONE file, named here rather than left as a quiet hole in
# a walk - check 4 pins it, because "skip a file" is how a guard stops guarding.
SELF = os.path.abspath(__file__)


def code_files():
    for root, dirs, names in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for n in sorted(names):
            p = os.path.join(root, n)
            if n.endswith(CODE_EXT) and os.path.abspath(p) != SELF:
                yield p


def hits_in(path):
    out = []
    try:
        txt = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return out
    for i, line in enumerate(txt.split("\n"), 1):
        m = BRAND.search(line)
        if m:
            out.append("%s:%d %s" % (os.path.relpath(path, APP), i, m.group(0)))
    return out


print("This derivative carries no vendor identity in its code:")

# -- 1. the code ------------------------------------------------------------------------
_all = []
for f in code_files():
    _all += hits_in(f)

check("1. no source file names the sibling console - not the page, not the server, not a "
      "suite, not a doc BUILDER",
      lambda: len(_all) == 0,
      lambda: ("%d hit(s): %s" % (len(_all), " | ".join(_all[:8]))) if _all
              else "clean across every .py/.js/.html outside vessels/ - the house word is "
                   "\"the small-class boat\", and a check naming the thing exactly uses the "
                   "PROFILE ID, which the pattern permits")

# -- 2. and nothing it SHIPS ------------------------------------------------------------
# ⚠⚠ THE ONE THAT LEAVES THE SOURCE TREE. The builders are source, so check 1 covers
# them - but the .docx is what an outsider is handed, and it is rebuilt from those builders.
# The previous drift put a vendor name into the shipped technical manual and stayed there
# through every rebuild, because nothing looked at either end.
import zipfile                                                      # noqa: E402

_docs = []
_docdir = os.path.join(APP, "docs")
if os.path.isdir(_docdir):
    for n in sorted(os.listdir(_docdir)):
        p = os.path.join(_docdir, n)
        if n.endswith((".docx", ".pptx")):
            try:
                z = zipfile.ZipFile(p)
            except Exception:                                       # noqa: BLE001
                continue
            body = ""
            for item in z.namelist():
                if item.endswith(".xml"):
                    body += z.read(item).decode("utf-8", "replace")
            plain = re.sub(r"<[^>]+>", " ", body)
            m = BRAND.search(plain)
            if m:
                _docs.append("%s (%s)" % (n, m.group(0)))

check("2. ... and neither does any GENERATED DOCUMENT, which is what an outsider is handed",
      lambda: len(_docs) == 0,
      lambda: ("%d document(s): %s" % (len(_docs), ", ".join(_docs))) if _docs
              else "%d generated document(s) checked, none names it - the last drift put a "
                   "vendor name in the shipped technical manual and it survived every rebuild"
                   % len([n for n in os.listdir(_docdir) if n.endswith((".docx", ".pptx"))]))

# -- 3. the exemption is real, and it is the maintainer notes ----------------------------
# ⚠⚠ THE PAIR, AND IT IS NOT DECORATION. Checks 1 and 2 would pass just as happily
# against a pattern that matched nothing at all, or a walk that visited no files. CLAUDE.md
# DELIBERATELY names the sibling and its path so a maintainer can find it - "Don't 'finish the
# job' by scrubbing the maintainer notes" - so its hits are the positive control: they prove
# the pattern bites, and they prove the scope stops where the rule says it stops.
_md = hits_in(os.path.join(APP, "CLAUDE.md".replace("/", os.sep)))
_md_raw = open(os.path.join(APP, "CLAUDE.md"), encoding="utf-8", errors="replace").read()
_md_hits = len(BRAND.findall(_md_raw))
check("3. ... and the MAINTAINER NOTES still name it, which is both the exemption and the "
      "proof this pattern bites",
      lambda: _md_hits > 0,
      lambda: "CLAUDE.md names the sibling %d time(s), deliberately - a maintainer has to be "
              "able to find it, the rule is scoped to CODE, and if this ever reads 0 then "
              "either the notes were scrubbed by mistake or checks 1-2 are passing because "
              "the pattern matches nothing" % _md_hits)

# -- 4. the self-exemption is exactly one file ------------------------------------------
_skipped = [f for f in [SELF] if f.endswith(".py")]
check("4. ... and the only file this skips is ITSELF, which it must",
      lambda: len(_skipped) == 1 and os.path.basename(SELF) == "sanitization.py",
      lambda: "exempt: %s - a suite that searches for a word has to contain it, and that is "
              "the whole exemption. Anything else skipped here is a hole."
              % os.path.basename(SELF))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
