"""tests/docs_valid.py - the generated documents are valid, and still contain their content.

WHY THIS EXISTS, and it is the uncomfortable one. Andy tried to open the Word documents and
none of the four would open. They had NEVER opened. Every commit from 2a28a59 (2026-08-01),
the day the first generated document was built, through 30e31f0 (2026-08-04) shipped a
word/document.xml that is not well-formed XML - eighteen commits, four documents, and nobody
opened one until an operator did.

THE FAULT. CODE() returns an ARRAY of paragraphs, one per line, while every other helper in
docx_kit returns a single object. The builders all wrote `c.push(CODE([...]))`, pushing the
array itself as ONE child. The docx serializer emitted it as the literal element `<0/>` - an
element name cannot begin with a digit - and Word refused the file outright. The array's
CONTENTS were also dropped, so every code block was missing: the Quick Start, a document
whose entire job is telling you the commands to run, did not contain `python asv_console.py
--sim`. Fixed by flattening in write(), which repairs all six call sites at once and makes
the next list-returning helper safe by construction.

WHY IT SURVIVED SO LONG, which is the part worth carrying:

    The maintainer notes claimed the tech manual's word/document.xml was "byte-identical"
    across a refactor and called that evidence the refactor was safe. It WAS byte-identical.
    It was also identically broken. A hash proves stability, never correctness - and the
    build printed "written: <name> N bytes" for a file no reader could open, which reads
    exactly like success.

    So this suite does not ask whether the documents CHANGED. It asks whether they WORK.

    python tests/docs_valid.py      # exit 0 = pass, 1 = fail   (stdlib only)

The checks are the OOXML package rules a reader actually enforces - every part well-formed,
every part declared in [Content_Types].xml, every relationship target present, every r:id
resolvable - plus a CONTENT check, because validity alone is not enough here. Filtering the
arrays away instead of flattening them would produce four perfectly valid documents with
every code block still missing, and only the content check can tell those apart.

The expected code lines are PARSED OUT OF THE BUILDERS rather than listed here, so a new
code block is covered the day it is written.

VERIFIED AGAINST REAL WORD, which is the only authority that matters: before the fix, Word
refused both sampled documents with "Word experienced an error trying to open the file";
after it, all four open - operations manual 15 pages / 6368 words, technical manual 14 /
6025, development guide 8 / 3604, quick start 3 / 965. This suite is the cheap stand-in for
that, since Word is not available on every machine and cannot run in a hook.

TEETH (verified by mutation, with the checks each one produces):
    remove the flatten in write(), restoring the original fault   -> 2, 5
    flatten but drop the arrays (valid XML, no code blocks)       -> 5
    corrupt one part's XML                                        -> 2
    remove a part that [Content_Types].xml declares               -> 3
    point a relationship at a target that does not exist          -> 4
"""

import glob
import os
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

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


APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DOCS = os.path.join(APP, "docs")
TOOLS = os.path.join(APP, "tools")

CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
RS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
W_T = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)   # w:t only - w:top and w:tbl are not text

fails = 0
ran = 0


def check(name, cond, detail=""):
    """A thunk is allowed, and a THROW is a failed check rather than a dead run: these read
    zip files that may be malformed, which is the fault under test."""
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


def parts_of(z):
    """Real parts only. A zip may carry directory entries ('word/'), which are not parts and
    have no content type - reporting those was a bug in the first version of this check."""
    return {n for n in z.namelist() if not n.endswith("/")}


def package_problems(path):
    """Every rule a reader enforces before it will open the file. Returns a list."""
    out = []
    z = zipfile.ZipFile(path)
    names = parts_of(z)

    for n in sorted(names):                                  # 1. every XML part parses
        if n.lower().endswith((".xml", ".rels")):
            try:
                ET.fromstring(z.read(n))
            except Exception as e:
                out.append("%s is not well-formed (%s)" % (n, str(e)[:70]))

    try:                                                     # 2. every part has a content type
        ct = ET.fromstring(z.read("[Content_Types].xml"))
    except Exception as e:
        return out + ["[Content_Types].xml unreadable (%s)" % e]
    defaults = {d.get("Extension", "").lower() for d in ct.findall(CT + "Default")}
    overrides = {o.get("PartName") for o in ct.findall(CT + "Override")}
    for n in sorted(names):
        if n == "[Content_Types].xml":
            continue
        if "/" + n in overrides or n.rsplit(".", 1)[-1].lower() in defaults:
            continue
        out.append("no content type declared for %s" % n)

    for rels in sorted(n for n in names if n.endswith(".rels")):   # 3. targets exist
        base = posixpath.dirname(posixpath.dirname(rels))
        try:
            root = ET.fromstring(z.read(rels))
        except Exception:
            continue                                          # already reported above
        for rel in root.findall(RS + "Relationship"):
            if rel.get("TargetMode") == "External":
                continue
            tgt = posixpath.normpath(posixpath.join(base, rel.get("Target") or ""))
            if tgt not in names:
                out.append("%s points at missing %s" % (rels, tgt))

    try:                                                      # 4. every r:id resolves
        doc = z.read("word/document.xml").decode("utf-8", "replace")
        declared = {r.get("Id") for r in
                    ET.fromstring(z.read("word/_rels/document.xml.rels")).findall(RS + "Relationship")}
        for used in sorted(set(re.findall(r'r:(?:id|embed)="([^"]+)"', doc)) - declared):
            out.append("document.xml references undeclared relationship %s" % used)
    except Exception as e:
        out.append("document.xml / its rels unreadable (%s)" % e)
    return out


def doc_text(path):
    """The document's visible text, UN-ESCAPED. The writer escapes &, <, >, ' and " on the
    way in, so a probe like `cd tools && npm install` will never be found in the raw XML -
    the first version of this check reported exactly that as missing content, which was the
    test being wrong rather than the document."""
    d = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8", "replace")
    body = "\n".join(W_T.findall(d))
    for esc, ch in (("&lt;", "<"), ("&gt;", ">"), ("&apos;", "'"),
                    ("&quot;", '"'), ("&amp;", "&")):          # &amp; last, or it double-decodes
        body = body.replace(esc, ch)
    return body


def expected_code_lines():
    """{docx basename: [code lines the builder asks for]}, PARSED OUT OF THE BUILDERS so a
    new code block is covered the day it is written rather than the day this file is."""
    want = {}
    for src in sorted(glob.glob(os.path.join(TOOLS, "build_*.js"))):
        text = open(src, encoding="utf-8").read()
        m = re.search(r'write\(\s*"([^"]+\.docx)"', text)
        if not m:
            continue                                          # build_docs.js is the runner
        lines = []
        for block in re.findall(r"CODE\(\[(.*?)\]\)", text, re.S):
            for lit in re.findall(r'"((?:[^"\\]|\\.)*)"', block):
                lit = lit.replace('\\"', '"').strip()
                if len(lit) > 12 and not lit.startswith("#"):
                    lines.append(lit)
        if lines:
            want[m.group(1)] = lines
    return want


print("Generated documents — valid packages that a reader will open, with their content intact:")

docs = sorted(glob.glob(os.path.join(DOCS, "*.docx")))
check("1. the generated set is present", len(docs) == 4,
      ", ".join(os.path.basename(d) for d in docs) or "none found")

zip_bad = []
for d in docs:
    try:
        z = zipfile.ZipFile(d)
        if z.testzip() is not None:
            zip_bad.append(os.path.basename(d))
    except Exception as e:
        zip_bad.append("%s (%s)" % (os.path.basename(d), e))
check("2b. each file is a readable ZIP container", not zip_bad,
      "; ".join(zip_bad) or "%d files" % len(docs))

# THE REPORTED FAULT. `<0/>` is what an un-spread CODE() array serialises to, and it is why
# Word refused every one of these files for three days.
problems = {os.path.basename(d): package_problems(d) for d in docs}
broken = {k: v for k, v in problems.items() if v}
check("2. THE REPORTED FAULT: every part of every document is well-formed XML",
      not any("not well-formed" in p for v in problems.values() for p in v),
      lambda: "; ".join("%s: %s" % (k, v[0]) for k, v in broken.items())[:150]
      if broken else "no `<0/>` and nothing else malformed")

check("3. every part is declared in [Content_Types].xml",
      not any("no content type" in p for v in problems.values() for p in v),
      "a reader rejects a part it has no type for")

check("4. every relationship target exists, and every r:id resolves",
      not any(("points at missing" in p or "undeclared relationship" in p)
              for v in problems.values() for p in v),
      "a dangling relationship is a refusal, not a warning")

# THE ACCEPTANCE CASE, and the reason validity alone is not enough. Filtering the arrays out
# instead of flattening them yields four VALID documents with every code block still gone -
# which is the same silent content loss, wearing a clean bill of health.
want = expected_code_lines()
missing = []
for name, lines in sorted(want.items()):
    path = os.path.join(DOCS, name)
    if not os.path.exists(path):
        missing.append("%s absent" % name)
        continue
    body = doc_text(path)
    for line in lines:
        probe = line.split("#")[0].strip()[:40]
        if probe and probe not in body:
            missing.append("%s is missing %r" % (name, probe[:38]))
check("5. the CODE blocks actually reached the documents",
      not missing,
      lambda: "; ".join(missing[:3]) if missing
      else "%d code lines checked across %d documents"
           % (sum(len(v) for v in want.values()), len(want)))

# A document that lost its body would still pass everything above.
thin = [os.path.basename(d) for d in docs if len(doc_text(d)) < 2000]
check("6. no document came out suspiciously empty",
      not thin, "; ".join(thin) or "all four carry a full body of text")

# A DOCUMENT MUST NOT SHIP A MESSAGE ADDRESSED TO ITS OWN MAINTAINER.
#
# WHY THIS CHECK EXISTS, and it is the same shape as the fault this suite was born for.
# The technical manual's test-harness table is DERIVED from tests/ - deliberately, so a new
# suite appears in the manual the day it is written rather than when someone remembers. Its
# per-suite descriptions come from a hand-kept GUARDS lookup, and a suite with no entry
# renders a literal "(undocumented - add an entry to GUARDS in tools/build_tech_manual.js)"
# in the row. That is a good design: it self-reports. But NOTHING READ THE REPORT. Fifteen
# of thirty-seven suites had no entry, so fifteen rows of build instructions addressed to a
# developer sat in a document written for a reader.
#
# The derived half is exactly why this needs a test rather than diligence: the placeholder
# comes BACK, silently, the next time a suite is added without an entry. So the graceful
# degradation gets an alarm on it. Kept generic rather than matching that one string - any
# builder's TODO or FIXME leaking into a shipped document is the same defect.
leaked = []
for d in docs:
    body = doc_text(d)
    for marker in ("(undocumented", "TODO", "FIXME", "XXX:"):
        if marker in body:
            leaked.append("%s contains %r x%d"
                          % (os.path.basename(d), marker, body.count(marker)))
check("7. no document ships a note addressed to its own maintainer",
      not leaked,
      lambda: "; ".join(leaked[:3]) if leaked
      else "no placeholder, TODO or FIXME reached a reader")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
