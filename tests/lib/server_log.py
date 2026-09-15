"""tests/lib/server_log.py - what in a console's output is an exception it hit while serving (review #17).

Eleven suites end by reading the console's output and failing if it "logged an exception". They each matched
any line containing "Error" - and the console names exception types in its own deliberate notes. On
2026-09-14 a DNS failure made one print "[ports] geocoder unreachable: URLError: <urlopen error ...>" and
data_routes failed a commit that had nothing wrong with it. What counts now, and only this:

  * a Python traceback - reported by the exception line that ends it, which names the error;
  * socketserver's "Exception occurred during processing of request" - a GET handler that raised;
  * the console's own "[http] <path> raised: <Type>: <message>" - a POST route that raised, which the
    catch-all answers with a 500 and records without a traceback (review #10).

Not a note that reports a failure it handled: a service it could not reach, a monitor pass that failed and
carried on, a cycle it could not read.

Not a suite itself: it lives one level down, so the hook's tests/*.py glob does not run it.
"""

import re

_HTTP_RAISED = re.compile(r"^\[http\] \S+ raised: ")


def exception_lines(text):
    """One line per exception the console hit while serving, in the order they appear: for a traceback, the
    line that names the error (or the header, if the output ends inside it)."""
    lines = (text or "").splitlines()
    found = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if "Traceback (most recent call last)" in ln:
            j = i + 1
            # a traceback's body is indented; the first line after it that is not names the exception
            while j < len(lines) and (lines[j].startswith((" ", "\t")) or not lines[j].strip()):
                j += 1
            found.append((lines[j] if j < len(lines) else ln).strip())
            i = j + 1
            continue
        if "Exception occurred during processing of request" in ln or _HTTP_RAISED.match(ln.strip()):
            found.append(ln.strip())
        i += 1
    return found
