#!/usr/bin/env bash
#
# Tests for check-e2e-select-helpers.sh
#
# Creates temporary spec files with safe and dangerous patterns and verifies
# the script's exit codes and violation detection.
#
# Usage:
#   ./scripts/test-check-e2e-select-helpers.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/check-e2e-select-helpers.sh"

PASS=0
FAIL=0

# ── helpers ───────────────────────────────────────────────────────────────────

ok() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $1" >&2
  FAIL=$((FAIL + 1))
}

assert_exit() {
  local description="$1"
  local expected="$2"
  shift 2
  local actual
  actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [ "$actual" -eq "$expected" ]; then
    ok "$description (exit $actual)"
  else
    fail "$description — expected exit $expected, got $actual"
  fi
}

# ── set up temp directory ─────────────────────────────────────────────────────

TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

# ── test 1: empty directory — exit 0 ─────────────────────────────────────────

CLEAN_DIR="$TMPDIR_BASE/clean"
mkdir -p "$CLEAN_DIR"

assert_exit "empty spec directory exits 0" 0 "$CHECK_SCRIPT" "$CLEAN_DIR"

# ── test 2: spec with safe helper call — exit 0 ───────────────────────────────

SAFE_DIR="$TMPDIR_BASE/safe"
mkdir -p "$SAFE_DIR"
cat > "$SAFE_DIR/safe.spec.ts" <<'EOF'
// Safe: uses the approved selectTrainingRun helper
await selectTrainingRun(page, 'my-model')
EOF

assert_exit "selectTrainingRun helper call exits 0" 0 "$CHECK_SCRIPT" "$SAFE_DIR"

# ── test 3: spec with selectNaiveOptionInContainer — exit 0 ───────────────────

SAFE2_DIR="$TMPDIR_BASE/safe2"
mkdir -p "$SAFE2_DIR"
cat > "$SAFE2_DIR/safe2.spec.ts" <<'EOF'
// Safe: uses the container-scoped helper
await selectNaiveOptionInContainer(page, dialog, 'training-run-select', 'my-model')
EOF

assert_exit "selectNaiveOptionInContainer helper call exits 0" 0 "$CHECK_SCRIPT" "$SAFE2_DIR"

# ── test 4: bare click on same line — exit 1 (AC: lint/check catches it) ──────

BARE_DIR="$TMPDIR_BASE/bare"
mkdir -p "$BARE_DIR"
cat > "$BARE_DIR/bare.spec.ts" <<'EOF'
// Dangerous: clicks training-run-select directly without a helper
await page.locator('[data-testid="training-run-select"]').click()
EOF

assert_exit "bare locator().click() on same line exits 1" 1 "$CHECK_SCRIPT" "$BARE_DIR"

# ── test 5: page.click() alternative syntax — exit 1 ─────────────────────────

ALT_DIR="$TMPDIR_BASE/alt"
mkdir -p "$ALT_DIR"
cat > "$ALT_DIR/alt.spec.ts" <<'EOF'
// Dangerous: alternative click syntax
await page.click('[data-testid="training-run-select"]')
EOF

# page.click() does not contain "training-run-select" AND ".click()" on the same
# line in the chained sense — the selector is inside quotes, .click() is called
# on page. This pattern IS caught because both substrings appear on the line.
assert_exit "page.click() with training-run-select in selector exits 1" 1 "$CHECK_SCRIPT" "$ALT_DIR"

# ── test 6: suppression annotation — exit 0 ───────────────────────────────────

SUPPRESSED_DIR="$TMPDIR_BASE/suppressed"
mkdir -p "$SUPPRESSED_DIR"
cat > "$SUPPRESSED_DIR/suppressed.spec.ts" <<'EOF'
// Suppressed legitimate dialog context
await page.locator('[data-testid="training-run-select"]').click() // bare-select-ok
EOF

assert_exit "line with bare-select-ok annotation exits 0" 0 "$CHECK_SCRIPT" "$SUPPRESSED_DIR"

# ── test 7: read-only locator (no click) — exit 0 ────────────────────────────

READONLY_DIR="$TMPDIR_BASE/readonly"
mkdir -p "$READONLY_DIR"
cat > "$READONLY_DIR/readonly.spec.ts" <<'EOF'
// Safe: assertion on the locator, no click
const select = page.locator('[data-testid="training-run-select"]')
await expect(select).toBeVisible()
await expect(select.locator('.n-base-selection--disabled')).toHaveCount(0)
EOF

assert_exit "read-only locator usage (no .click()) exits 0" 0 "$CHECK_SCRIPT" "$READONLY_DIR"

# ── test 8: helpers.ts is excluded from scanning — exit 0 ────────────────────

HELPERS_DIR="$TMPDIR_BASE/helpers"
mkdir -p "$HELPERS_DIR"
# helpers.ts contains the bare click as part of the safe implementation itself
cat > "$HELPERS_DIR/helpers.ts" <<'EOF'
// This is the helper implementation — must not be flagged
const selectTrigger = page.locator('[data-testid="training-run-select"]')
await selectTrigger.click()
EOF
# No spec files in this dir, but helpers.ts would be picked up by *.spec.ts glob
# anyway (it's not a .spec.ts file). Add an innocent spec to ensure helpers.ts
# is never scanned.
cat > "$HELPERS_DIR/innocent.spec.ts" <<'EOF'
// Clean spec with no training-run-select usage
await page.goto('/')
EOF

assert_exit "helpers.ts is not a .spec.ts and is excluded — exits 0" 0 "$CHECK_SCRIPT" "$HELPERS_DIR"

# ── test 9: missing directory — exit 1 ───────────────────────────────────────

assert_exit "non-existent directory exits 1" 1 "$CHECK_SCRIPT" "$TMPDIR_BASE/does-not-exist"

# ── test 10: multiple violations in one file — exit 1 ────────────────────────

MULTI_DIR="$TMPDIR_BASE/multi"
mkdir -p "$MULTI_DIR"
cat > "$MULTI_DIR/multi.spec.ts" <<'EOF'
await page.locator('[data-testid="training-run-select"]').click()
// some other code
await page.click('[data-testid="training-run-select"]')
EOF

assert_exit "multiple bare clicks in one file exits 1" 1 "$CHECK_SCRIPT" "$MULTI_DIR"

# ── summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
