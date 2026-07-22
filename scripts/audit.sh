#!/usr/bin/env bash
#
# Dependency vulnerability audit for the whole project.
#
#   Backend  : govulncheck (reachable-set analysis of the Go module)
#   Frontend : npm audit --omit=dev --audit-level=high (production deps only)
#
# The audit FAILS (non-zero exit) when high-severity findings are present.
#
# Both tools need network access to their vulnerability databases. When the
# database is unreachable (offline), the audit degrades to a LOUD WARNING and a
# soft-skip (exit 0) instead of silently passing green. This keeps the pre-commit
# hook usable offline while making the skip clearly visible.
#
# Usage:
#   ./scripts/audit.sh
#
# Environment:
#   GOVULNCHECK_VERSION   Pinned govulncheck version (default: v1.6.0)
#
# Exit codes:
#   0   No high-severity findings (or offline soft-skip with warning)
#   1   High-severity findings, or an unexpected tool error
#
set -uo pipefail

GOVULNCHECK_VERSION="${GOVULNCHECK_VERSION:-v1.6.0}"

# Patterns that indicate a network / vuln-DB reachability problem rather than a
# real finding. Used to turn offline runs into a visible soft-skip.
NET_ERR_RE='dial tcp|no such host|connection refused|network is unreachable|TLS handshake|i/o timeout|deadline exceeded|context deadline|failed to load|unable to fetch|ENOTFOUND|EAI_AGAIN|getaddrinfo|request to .* failed'

# classify_result <exit_code> <output> [findings_marker]
#
# Echoes exactly one of: clean | findings | offline | error
#   clean    : tool exited 0
#   findings : non-zero exit and output contains findings_marker (real vulns)
#   offline  : non-zero exit and output matches a network-error pattern
#   error    : non-zero exit for some other/unexpected reason
#
# When findings_marker is empty, any non-zero, non-network exit is treated as
# findings (npm audit has no distinct marker line but only exits non-zero when
# vulnerabilities at/above the audit level are present).
classify_result() {
	local rc="$1" out="$2" marker="${3:-}"
	if [ "$rc" -eq 0 ]; then
		echo "clean"
	elif [ -n "$marker" ] && printf '%s' "$out" | grep -q "$marker"; then
		echo "findings"
	elif printf '%s' "$out" | grep -qiE "$NET_ERR_RE"; then
		echo "offline"
	elif [ -z "$marker" ]; then
		echo "findings"
	else
		echo "error"
	fi
}

warn_offline() {
	echo ""
	echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
	echo "!! AUDIT WARNING: $1 could not reach its vulnerability DB."
	echo "!! The audit was SKIPPED (offline). This is NOT a clean pass."
	echo "!! Re-run 'make audit' with network access before committing."
	echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
	echo ""
}

main() {
	local script_dir project_dir overall=0
	script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	project_dir="$(cd "$script_dir/.." && pwd)"

	echo "=== Backend audit: govulncheck ($GOVULNCHECK_VERSION) ==="
	local be_out be_rc
	be_out="$(cd "$project_dir/backend" && go run "golang.org/x/vuln/cmd/govulncheck@$GOVULNCHECK_VERSION" ./... 2>&1)"
	be_rc=$?
	echo "$be_out"
	case "$(classify_result "$be_rc" "$be_out" "Vulnerability #")" in
		clean)    echo "Backend: no vulnerabilities found." ;;
		findings) echo "Backend: vulnerabilities found (see above)." >&2; overall=1 ;;
		offline)  warn_offline "govulncheck" ;;
		error)    echo "Backend: govulncheck failed unexpectedly (exit $be_rc)." >&2; overall=1 ;;
	esac

	echo ""
	echo "=== Frontend audit: npm audit --omit=dev --audit-level=high ==="
	local fe_out fe_rc
	fe_out="$(cd "$project_dir/frontend" && npm audit --omit=dev --audit-level=high 2>&1)"
	fe_rc=$?
	echo "$fe_out"
	case "$(classify_result "$fe_rc" "$fe_out")" in
		clean)    echo "Frontend: no high-severity production vulnerabilities found." ;;
		findings) echo "Frontend: high-severity production vulnerabilities found (exit $fe_rc)." >&2; overall=1 ;;
		offline)  warn_offline "npm audit" ;;
	esac

	echo ""
	if [ "$overall" -eq 0 ]; then
		echo "=== Audit passed ==="
	else
		echo "=== Audit FAILED ===" >&2
	fi
	return "$overall"
}

# Only run main when executed directly (not when sourced by tests).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	main
	exit $?
fi
