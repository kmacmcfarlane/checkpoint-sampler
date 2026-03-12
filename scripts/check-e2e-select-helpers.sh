#!/usr/bin/env bash
#
# Audit E2E spec files for bare NSelect click patterns on training-run-select.
#
# Flags lines that click [data-testid="training-run-select"] directly without
# going through the selectTrainingRun or selectNaiveOptionInContainer helpers.
# Bare clicks are susceptible to NSelect race conditions (see B-053, B-054):
# the dropdown may be clicked before loading state clears or before the NDrawer
# animation completes, causing flaky tests.
#
# Usage:
#   ./scripts/check-e2e-select-helpers.sh [e2e-dir]
#
# Arguments:
#   e2e-dir   Directory containing *.spec.ts files (default: frontend/e2e)
#
# Suppression:
#   Add "// bare-select-ok" to a flagged line to suppress the warning for
#   legitimate cases (e.g. a dialog-scoped select that does not share the
#   sidebar race condition).
#
# Exit codes:
#   0   No violations found
#   1   One or more bare click violations found
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEFAULT_E2E_DIR="$PROJECT_DIR/frontend/e2e"
E2E_DIR="${1:-$DEFAULT_E2E_DIR}"

if [ ! -d "$E2E_DIR" ]; then
  echo "check-e2e-select-helpers: directory not found: $E2E_DIR" >&2
  exit 1
fi

VIOLATIONS=0
VIOLATION_LINES=""

# Scan all *.spec.ts files (skip helpers.ts — that is the safe implementation).
while IFS= read -r -d '' specfile; do
  filename="$(basename "$specfile")"

  # Skip helpers.ts — the locator usage there is the safe helper itself.
  if [ "$filename" = "helpers.ts" ]; then
    continue
  fi

  lineno=0
  while IFS= read -r line; do
    lineno=$((lineno + 1))

    # Must reference training-run-select on this line.
    if ! echo "$line" | grep -qF 'training-run-select'; then
      continue
    fi

    # Must have .click( on the same line (chained usage is the dangerous pattern).
    # Matches both locator().click() and page.click('selector') forms.
    if ! echo "$line" | grep -qF '.click('; then
      continue
    fi

    # Safe: line uses the selectTrainingRun helper.
    if echo "$line" | grep -qF 'selectTrainingRun'; then
      continue
    fi

    # Safe: line uses the selectNaiveOptionInContainer helper.
    if echo "$line" | grep -qF 'selectNaiveOptionInContainer'; then
      continue
    fi

    # Safe: suppressed by inline annotation.
    if echo "$line" | grep -qF '// bare-select-ok'; then
      continue
    fi

    # Violation found.
    VIOLATIONS=$((VIOLATIONS + 1))
    VIOLATION_LINES="$VIOLATION_LINES\n  $specfile:$lineno: $line"
  done < "$specfile"
done < <(find "$E2E_DIR" -maxdepth 1 -name "*.spec.ts" -print0 | sort -z)

if [ "$VIOLATIONS" -gt 0 ]; then
  echo "check-e2e-select-helpers: $VIOLATIONS bare training-run-select click(s) found." >&2
  echo "  Use selectTrainingRun(page, name) instead of clicking the locator directly." >&2
  echo "  To suppress a legitimate case, add '// bare-select-ok' to the line." >&2
  echo "" >&2
  printf "%b\n" "$VIOLATION_LINES" >&2
  exit 1
fi

echo "check-e2e-select-helpers: no bare training-run-select clicks found"
exit 0
