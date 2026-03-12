#!/usr/bin/env bash
#
# Tests for check-disallowed-chars.sh
#
# Simulates adding a new disallowed character to disallowedNameChars and verifies
# that the guard script catches string literals containing that character in
# name-providing contexts, while ignoring technical/non-name strings.
#
# Usage:
#   ./scripts/test-check-disallowed-chars.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/check-disallowed-chars.sh"

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

TMPBASE=$(mktemp -d)
trap 'rm -rf "$TMPBASE"' EXIT

# Helper: create a minimal fake project directory structure with a study.go
# that includes the given disallowed chars constant, plus a source file to scan.
#
# Usage: make_project <dir> <disallowed_chars>
make_project() {
  local dir="$1"
  local chars="$2"

  # Minimal backend service directory with a study.go definition file.
  mkdir -p "$dir/backend/internal/service"
  cat > "$dir/backend/internal/service/study.go" <<GOEOF
package service

const disallowedNameChars = \`${chars}\`
GOEOF
}

# ── test 1: missing project directory exits 1 ────────────────────────────────

assert_exit "non-existent project directory exits 1" 1 \
  "$CHECK_SCRIPT" "$TMPBASE/does-not-exist"

# ── test 2: missing study.go exits 1 ─────────────────────────────────────────

NODEF_DIR="$TMPBASE/nodef"
mkdir -p "$NODEF_DIR/backend/internal/service"
# No study.go — should fail with definition-not-found error.
assert_exit "missing study.go exits 1" 1 "$CHECK_SCRIPT" "$NODEF_DIR"

# ── test 3: clean project (no source files) exits 0 ──────────────────────────
# AC: guard exits 0 when no violations are present.

CLEAN_DIR="$TMPBASE/clean"
make_project "$CLEAN_DIR" '@'
# study.go itself is the only file and is in the skip list — no scan targets.
assert_exit "project with no other source files exits 0" 0 "$CHECK_SCRIPT" "$CLEAN_DIR"

# ── test 4: source file with NO disallowed chars exits 0 ─────────────────────

SAFE_DIR="$TMPBASE/safe"
make_project "$SAFE_DIR" '@'
cat > "$SAFE_DIR/backend/internal/service/example.go" <<'GOEOF'
package service

// safeFunc demonstrates a safe study name with no disallowed characters.
func safeFunc() string {
	return "My Clean Study"
}
GOEOF
assert_exit "source file with no disallowed chars exits 0" 0 "$CHECK_SCRIPT" "$SAFE_DIR"

# ── test 5: Example() with newly disallowed char exits 1 ─────────────────────
# AC: guard flags Example("My Study @2024") when '@' is newly disallowed.
# This is the primary regression scenario the guard was built to catch.

EXAMPLE_DIR="$TMPBASE/example_violation"
make_project "$EXAMPLE_DIR" '@'
mkdir -p "$EXAMPLE_DIR/backend/internal/api/design"
cat > "$EXAMPLE_DIR/backend/internal/api/design/studies.go" <<'GOEOF'
package design

import . "goa.design/goa/v3/dsl"

var ForkStudyPayload = Type("ForkStudyPayload", func() {
	Attribute("name", String, "New study display name", func() {
		Example("My Study @2024")
		MinLength(1)
	})
})
GOEOF
assert_exit "Example() with newly disallowed char exits 1" 1 "$CHECK_SCRIPT" "$EXAMPLE_DIR"

# ── test 6: string constant with newly disallowed char exits 1 ───────────────
# AC: guard flags a name suffix constant like const copySuffix = " @copy".

CONST_DIR="$TMPBASE/const_violation"
make_project "$CONST_DIR" '@'
cat > "$CONST_DIR/backend/internal/service/fork.go" <<'GOEOF'
package service

// copySuffix is appended to the study name when forking.
const copySuffix = " @copy"
GOEOF
assert_exit "string constant with newly disallowed char exits 1" 1 "$CHECK_SCRIPT" "$CONST_DIR"

# ── test 7: Ginkgo It() description with disallowed char is NOT flagged ───────
# The string argument to It() is a test description, not a study name.

GINKGO_DIR="$TMPBASE/ginkgo_safe"
make_project "$GINKGO_DIR" '@'
cat > "$GINKGO_DIR/backend/internal/service/study_test.go" <<'GOEOF'
package service_test

import . "github.com/onsi/ginkgo/v2"

var _ = Describe("study", func() {
	It("rejects names with @ symbols (disallowed)", func() {
		// Test body
	})
})
GOEOF
assert_exit "Ginkgo It() description is not flagged" 0 "$CHECK_SCRIPT" "$GINKGO_DIR"

# ── test 8: Goa Attribute() description with disallowed char is NOT flagged ───
# The 3rd argument to Attribute() is API documentation, not a name value.

ATTR_DIR="$TMPBASE/attr_desc_safe"
make_project "$ATTR_DIR" '@'
mkdir -p "$ATTR_DIR/backend/internal/api/design"
cat > "$ATTR_DIR/backend/internal/api/design/studies.go" <<'GOEOF'
package design

import . "goa.design/goa/v3/dsl"

var StudyResponse = Type("StudyResponse", func() {
	Attribute("name", String, "Study name (e.g. My Study @2024)", func() {
		Example("My Clean Study")
		MinLength(1)
	})
})
GOEOF
assert_exit "Goa Attribute() description is not flagged" 0 "$CHECK_SCRIPT" "$ATTR_DIR"

# ── test 9: suppression annotation prevents false-positive flag ───────────────
# A line with '// disallowed-chars-ok' should not be flagged.

SUPP_DIR="$TMPBASE/suppressed"
make_project "$SUPP_DIR" '@'
cat > "$SUPP_DIR/backend/internal/service/fork.go" <<'GOEOF'
package service

// This is a display-only label, not used as a study name.
const displayLabel = "My Study @2024" // disallowed-chars-ok
GOEOF
assert_exit "line with disallowed-chars-ok annotation is not flagged" 0 "$CHECK_SCRIPT" "$SUPP_DIR"

# ── test 10: definition files themselves are not flagged ──────────────────────
# study.go and StudyEditor.vue are in the skip list and must not cause a violation
# even though they define the disallowed char set.

DEFONLY_DIR="$TMPBASE/def_only"
make_project "$DEFONLY_DIR" '@()'
# Add a StudyEditor.vue that contains the disallowed chars in its definition.
mkdir -p "$DEFONLY_DIR/frontend/src/components"
cat > "$DEFONLY_DIR/frontend/src/components/StudyEditor.vue" <<'VUEOF'
<script setup lang="ts">
const disallowedChars = `@()/\\:*?<>|"`
</script>
VUEOF
assert_exit "definition files (study.go, StudyEditor.vue) are not flagged" 0 \
  "$CHECK_SCRIPT" "$DEFONLY_DIR"

# ── test 11: full codebase scan exits 0 on actual project ────────────────────
# AC: the current codebase is clean (no violations with current disallowed set).

REAL_PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
assert_exit "full codebase scan exits 0 (current codebase is clean)" 0 \
  "$CHECK_SCRIPT" "$REAL_PROJECT_DIR"

# ── summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
