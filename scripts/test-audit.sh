#!/usr/bin/env bash
#
# Tests for audit.sh's result-classification logic.
#
# Sources audit.sh (which does not run main when sourced) and exercises
# classify_result against representative tool outputs.
#
# Usage:
#   ./scripts/test-audit.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./audit.sh
source "$SCRIPT_DIR/audit.sh"

PASS=0
FAIL=0

assert_eq() {
	local description="$1" expected="$2" actual="$3"
	if [ "$actual" = "$expected" ]; then
		echo "PASS: $description"
		PASS=$((PASS + 1))
	else
		echo "FAIL: $description — expected '$expected', got '$actual'" >&2
		FAIL=$((FAIL + 1))
	fi
}

# ── govulncheck-style outputs (marker: "Vulnerability #") ──────────────────────

assert_eq "govulncheck clean (rc 0)" "clean" \
	"$(classify_result 0 "No vulnerabilities found." "Vulnerability #")"

assert_eq "govulncheck real findings" "findings" \
	"$(classify_result 3 "Vulnerability #1: GO-2026-4918 ..." "Vulnerability #")"

assert_eq "govulncheck offline (dial tcp)" "offline" \
	"$(classify_result 1 "govulncheck: loading: dial tcp: lookup vuln.go.dev: no such host" "Vulnerability #")"

assert_eq "govulncheck unexpected error" "error" \
	"$(classify_result 1 "some unrelated build failure" "Vulnerability #")"

# ── npm audit-style outputs (no marker) ────────────────────────────────────────

assert_eq "npm audit clean (rc 0)" "clean" \
	"$(classify_result 0 "found 0 vulnerabilities" "")"

assert_eq "npm audit high findings (rc 1)" "findings" \
	"$(classify_result 1 "2 high severity vulnerabilities" "")"

assert_eq "npm audit offline (ENOTFOUND)" "offline" \
	"$(classify_result 1 "npm error code ENOTFOUND request to registry failed" "")"

# ── summary ────────────────────────────────────────────────────────────────────

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
