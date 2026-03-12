#!/usr/bin/env bash
#
# Regression guard: scan string literals for characters in the disallowed study-name set.
#
# Reads the disallowedNameChars constant from backend/internal/service/study.go and
# then scans .go, .ts, and .vue source files for string literals that look like
# plausible study name values and contain any of those disallowed characters.
#
# This is designed to catch regressions introduced when a new character is added to
# disallowedNameChars.  For example, if "(" is added to the disallowed set, an
# existing Example("My Study (copy)") in a Goa design file would be flagged.
#
# The check scans for name-providing contexts:
#   - Goa design Example("...") values
#   - Variable/field assignments where the LHS contains "name" or "Name"
#   - String constants that look like user-visible labels
#
# It intentionally skips:
#   - Import paths, SQL, YAML, format strings
#   - Ginkgo test descriptions (It/Describe/Context/Entry/BeforeEach)
#   - Goa design Attribute()/Error() descriptions (3rd arg is documentation)
#   - Pure comment lines
#
# Run this after changing disallowedNameChars to find code that needs updating
# before the change reaches review.
#
# Usage:
#   ./scripts/check-disallowed-chars.sh [project-dir]
#
# Arguments:
#   project-dir   Root of the repository (default: parent directory of scripts/)
#
# Suppression:
#   Add "# disallowed-chars-ok" (shell) or "// disallowed-chars-ok" (Go/TS/Vue)
#   to a flagged line to suppress the warning for legitimate cases.
#
# Exit codes:
#   0   No violations found
#   1   One or more violations found
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="${1:-$DEFAULT_PROJECT_DIR}"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "check-disallowed-chars: directory not found: $PROJECT_DIR" >&2
  exit 1
fi

STUDY_GO="$PROJECT_DIR/backend/internal/service/study.go"

if [ ! -f "$STUDY_GO" ]; then
  echo "check-disallowed-chars: definition file not found: $STUDY_GO" >&2
  exit 1
fi

# ── Extract disallowedNameChars from study.go ─────────────────────────────────
#
# The constant is declared as a raw backtick string on a single line:
#   const disallowedNameChars = `()/\:*?<>|"`
#
DISALLOWED_CHARS=$(grep -oP 'disallowedNameChars\s*=\s*`\K[^`]+' "$STUDY_GO" || true)

if [ -z "$DISALLOWED_CHARS" ]; then
  echo "check-disallowed-chars: could not extract disallowedNameChars from $STUDY_GO" >&2
  exit 1
fi

echo "check-disallowed-chars: disallowed chars from study.go: $DISALLOWED_CHARS"

# ── Run Python scanner ────────────────────────────────────────────────────────

python3 - "$PROJECT_DIR" "$DISALLOWED_CHARS" <<'PYEOF'
import sys
import os
import re

project_dir = sys.argv[1]
disallowed_chars = sys.argv[2]

# Files to skip: definition sites and their test files that intentionally
# contain the full disallowed character set.
skip_files = {
    os.path.normpath(os.path.join(project_dir, "backend/internal/service/study.go")),
    os.path.normpath(os.path.join(project_dir, "backend/internal/service/study_test.go")),
    os.path.normpath(os.path.join(project_dir, "frontend/src/components/StudyEditor.vue")),
}

# Directories to skip entirely.
skip_dirs = {
    os.path.normpath(os.path.join(project_dir, "backend/internal/api/gen")),
    os.path.normpath(os.path.join(project_dir, "frontend/node_modules")),
    os.path.normpath(os.path.join(project_dir, "node_modules")),
    os.path.normpath(os.path.join(project_dir, ".git")),
}

# ── Line-level exclusion patterns ─────────────────────────────────────────────
#
# Lines matching these patterns are skipped even if they contain a disallowed char.

# 1. Lines containing these substrings are always safe (definition sites, error
#    message templates that describe the disallowed set, suppression markers).
SAFE_SUBSTRINGS = [
    'disallowedNameChars',
    'disallowedChars',
    'characters are not allowed',
    'disallowed-chars-ok',
]

# 2. Patterns matching line prefixes/contexts that are NOT name-providing.
#    These regex patterns match the whole line (after stripping leading whitespace).
#
#    a) Ginkgo test framework callsites: the string argument is a test description,
#       not a user-visible name.
GINKGO_CALLS_RE = re.compile(
    r'''^\s*(?:It|Describe|Context|When|Entry|BeforeEach|AfterEach|
               JustBeforeEach|JustAfterEach|BeforeSuite|AfterSuite|
               BeforeAll|AfterAll|DescribeTable|By)\s*\(''',
    re.VERBOSE
)

#    b) Goa DSL description strings: the 3rd argument of Attribute() and Error()
#       calls is documentation, not a name value. We detect this by looking for
#       the pattern Attribute("ident", Type, "...") on the same line.
GOA_DESCRIPTION_RE = re.compile(
    r'''(?:Attribute|Error)\s*\(\s*"[^"]*"\s*,\s*\S+.*,\s*"'''
)

#    c) Pure comment lines.
COMMENT_RE = re.compile(r'^\s*(?://|#)')

#    d) Go import path lines: a line that is only an import path string.
#       e.g.:  "net/http"  or  genpresets "github.com/..."
IMPORT_LINE_RE = re.compile(
    r'''^\s*(?:\w+\s+)?"[a-z][a-zA-Z0-9._/-]+"[\s,)]*$'''
)

#    e) Vue template lines: lines that start with an HTML attribute or a Vue
#       directive (v-if, v-for, @click, :disabled, etc.), which are HTML/template
#       context rather than runtime string values.
VUE_TEMPLATE_RE = re.compile(
    r'''^\s*(?:v-|@|:|<[a-zA-Z])'''
)

#    f) Logger call lines: the string argument is a log message, not a study name.
#       e.g.:  logger.Warn("some message (detail)")
LOGGER_CALL_RE = re.compile(
    r'''\.\s*(?:Warn|Error|Info|Debug|Trace|Fatal|Panic|Log)\s*\('''
)

#    g) Go backtick-concatenated string lines: lines containing `"` or "` indicate
#       a raw string literal boundary mixed with double-quoted strings, making
#       literal extraction unreliable.  Skip such lines.
BACKTICK_CONCAT_RE = re.compile(r'[`"].*["`]')
BACKTICK_BOUNDARY_RE = re.compile(r'''["`]\s*\+|["]\s*`''')

#    h) CSS/HTML style attribute strings: lines where the string contains CSS
#       properties like "max-width: 640px;" are Vue template style attributes.
CSS_STYLE_RE = re.compile(r'style\s*=')

#    i) SQL-containing strings: SQL keyword sequences indicate a query string.
SQL_LINE_RE = re.compile(
    r'''(?:INSERT\s+INTO|SELECT\s+\w|UPDATE\s+\w|CREATE\s+TABLE|DELETE\s+FROM|
           VALUES\s*\(|FROM\s+\w|WHERE\s+\w|ALTER\s+TABLE|DROP\s+TABLE)''',
    re.VERBOSE | re.IGNORECASE
)

#    j) os.MkdirTemp calls: the second argument is a temp dir prefix, not a name.
MKDIRTEMP_RE = re.compile(r'os\.MkdirTemp\s*\(')

#    k) Goa Description() calls at the service/method level: these are API
#       documentation strings, not example name values.
#       (The 3rd arg of Attribute() is already handled by GOA_DESCRIPTION_RE.)
GOA_STANDALONE_DESC_RE = re.compile(r'^\s*Description\s*\(')

#    l) Gomega assertion wrappers: Expect(...).To(ContainSubstring("...")) etc.
#       The string being tested is an expected value from the system, not a name.
GOMEGA_ASSERT_RE = re.compile(
    r'''\.To\s*\((?:ContainSubstring|Equal|HaveKeyWithValue|ContainElement)'''
)

#    m) JSDoc / multiline comment lines: /** ... */ and * ... lines.
JSDOC_RE = re.compile(r'^\s*(?:/\*\*|\*)')

#    n) Vue/HTML attribute assignments (name="value" on template lines).
HTML_ATTR_RE = re.compile(r'''^\s*(?:title|description|placeholder|label)="''')

# ── String-level filters ───────────────────────────────────────────────────────
#
# For a string literal to be flagged, it must look like a plausible study name:
# a human-readable label rather than a technical string.

# Characters whose presence in a string strongly suggests it is technical, not a name.
# (These are separate from disallowed chars — they indicate the string serves a
# different purpose: paths, format strings, SQL, etc.)
TECHNICAL_IN_STRING = set('/\\%:')

def is_name_like(s):
    """Return True if the string could plausibly be a study name value."""
    # Must contain at least one letter.
    if not any(c.isalpha() for c in s):
        return False
    # Technical path/format chars rule out name context.
    for ch in TECHNICAL_IN_STRING:
        if ch in s:
            return False
    # Escaped sequences indicate YAML, multiline Go strings, etc.
    if '\\n' in s or '\\t' in s:
        return False
    # Long strings are likely error messages, SQL, or descriptions.
    if len(s) > 80:
        return False
    return True

def contains_disallowed(s, chars):
    """Return the first disallowed char found in s, or empty string."""
    for ch in chars:
        if ch in s:
            return ch
    return ''

# Regex to extract double-quoted string literal content.
DQUOTE_RE = re.compile(r'"([^"\n\\]*(?:\\.[^"\n\\]*)*)"')

def is_line_excluded(line):
    """Return True if the line matches a known-safe context."""
    for sub in SAFE_SUBSTRINGS:
        if sub in line:
            return True
    if COMMENT_RE.match(line):
        return True
    if IMPORT_LINE_RE.match(line):
        return True
    if GINKGO_CALLS_RE.match(line):
        return True
    if GOA_DESCRIPTION_RE.search(line):
        return True
    if VUE_TEMPLATE_RE.match(line):
        return True
    if LOGGER_CALL_RE.search(line):
        return True
    if CSS_STYLE_RE.search(line):
        return True
    if SQL_LINE_RE.search(line):
        return True
    # Lines with backtick-string boundaries make double-quote extraction unreliable.
    if BACKTICK_BOUNDARY_RE.search(line):
        return True
    if MKDIRTEMP_RE.search(line):
        return True
    if GOA_STANDALONE_DESC_RE.match(line):
        return True
    if GOMEGA_ASSERT_RE.search(line):
        return True
    if JSDOC_RE.match(line):
        return True
    if HTML_ATTR_RE.match(line):
        return True
    return False

def scan_file(path, disallowed):
    """Yield (lineno, line, char) for each violation."""
    try:
        with open(path, encoding='utf-8', errors='replace') as fh:
            lines = fh.readlines()
    except OSError:
        return

    for lineno, raw_line in enumerate(lines, start=1):
        line = raw_line.rstrip('\n')

        # Fast pre-check: any disallowed char on this line at all?
        if not any(ch in line for ch in disallowed):
            continue

        if is_line_excluded(line):
            continue

        # Extract double-quoted string literals and test them.
        for m in DQUOTE_RE.finditer(line):
            s = m.group(1)
            if not is_name_like(s):
                continue
            ch = contains_disallowed(s, disallowed)
            if ch:
                yield (lineno, line, ch)
                break  # one report per source line

violations = []

for root, dirs, files in os.walk(project_dir):
    abs_root = os.path.normpath(os.path.abspath(root))
    dirs[:] = [
        d for d in sorted(dirs)
        if os.path.normpath(os.path.join(abs_root, d)) not in skip_dirs
        and not d.startswith('.')
    ]

    for fname in sorted(files):
        if not (fname.endswith('.go') or fname.endswith('.ts') or fname.endswith('.vue')):
            continue
        abs_path = os.path.normpath(os.path.join(abs_root, fname))
        if abs_path in skip_files:
            continue

        for lineno, line, ch in scan_file(abs_path, disallowed_chars):
            rel = os.path.relpath(abs_path, project_dir)
            violations.append((rel, lineno, line, ch))

if violations:
    print(
        f"\ncheck-disallowed-chars: {len(violations)} line(s) contain "
        f"disallowed study-name characters.",
        file=sys.stderr
    )
    print(
        "  These may be regressions introduced alongside a change to disallowedNameChars.",
        file=sys.stderr
    )
    print(
        "  Review each line and either update the string or add '// disallowed-chars-ok'",
        file=sys.stderr
    )
    print(
        "  if the usage is intentional and unrelated to study names.",
        file=sys.stderr
    )
    print("", file=sys.stderr)
    for rel, lineno, line, ch in violations:
        print(f"  {rel}:{lineno}: {line}", file=sys.stderr)
    sys.exit(1)
else:
    print("check-disallowed-chars: no violations found")
    sys.exit(0)
PYEOF
