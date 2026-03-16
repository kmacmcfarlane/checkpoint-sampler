#!/usr/bin/env bash
#
# Run Playwright E2E tests in parallel across N isolated docker-compose stacks.
# Each shard gets its own fully isolated compose stack (backend, frontend,
# comfyui-mock, SQLite DB). Parallelism is at the stack level; each shard
# still runs with workers:1.
#
# The backend binary is pre-built in the Docker image (Dockerfile.dev bakes
# codegen + compilation). Shards start in batches (BATCH_SIZE=4) to avoid
# Docker DNS resolver races when many stacks start simultaneously (B-108).
#
# Usage:
#   ./scripts/e2e/e2e_parallel.sh [SHARDS] [-- playwright args...]
#
#   SHARDS: number of parallel stacks (default: 4)
#   Everything after -- is forwarded to playwright test
#
# Exit codes:
#   0   All shards passed, no panics detected
#   1   One or more shards failed or panics detected
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

COMPOSE_FILE="docker-compose.test.yml"
E2E_DIR=".e2e"

# --- Parse arguments ---
SHARDS="${1:-12}"
shift || true

PW_ARGS=""
if [ "${1:-}" = "--" ]; then
  shift
  PW_ARGS="$*"
fi

# Validate shard count
if ! [[ "$SHARDS" =~ ^[0-9]+$ ]] || [ "$SHARDS" -lt 1 ]; then
  echo "Error: SHARDS must be a positive integer (got: $SHARDS)" >&2
  exit 1
fi

START_TIME=$SECONDS

echo "=== E2E parallel: $SHARDS shard(s) ==="

# --- Cleanup trap ---
# Separate EXIT from INT/TERM so that Ctrl+C tears down and exits immediately
# rather than continuing into phases 4/5 against already-destroyed stacks.
INTERRUPTED=0

cleanup() {
  echo ""
  echo "=== Tearing down all shard stacks ==="
  for i in $(seq 1 "$SHARDS"); do
    docker compose -p "checkpoint-sampler-e2e-${i}" -f "$COMPOSE_FILE" down -v 2>/dev/null &
  done
  wait
  # Also remove the build project if it exists
  docker compose -p "checkpoint-sampler-e2e-build" -f "$COMPOSE_FILE" down -v 2>/dev/null || true
  echo "=== Teardown complete ==="
}

on_interrupt() {
  INTERRUPTED=1
  echo ""
  echo "=== Interrupted ==="
  exit 130
}

trap cleanup EXIT
trap on_interrupt INT TERM

# --- Clean previous artifacts ---
if [ -d "$E2E_DIR" ]; then
  rm -rf "$E2E_DIR"
fi
mkdir -p "$E2E_DIR/logs" "$E2E_DIR/blobs" "$E2E_DIR/report"

# --- Phase 1: Build images once ---
echo ""
echo "=== Phase 1: Building images ==="
docker compose -p "checkpoint-sampler-e2e-build" -f "$COMPOSE_FILE" build
echo "=== Build complete ==="

# --- Phase 2: Start all stacks in parallel ---
echo ""
echo "=== Phase 2: Starting $SHARDS shard stack(s) ==="

start_shard() {
  local i=$1
  local project="checkpoint-sampler-e2e-${i}"
  echo "  [shard $i] Starting stack ($project)..."
  docker compose -p "$project" -f "$COMPOSE_FILE" up -d --build --wait --remove-orphans backend frontend 2>&1 | \
    sed "s/^/  [shard $i] /"
  echo "  [shard $i] Stack healthy"
}

# Stagger shard startup in batches to reduce pressure on Docker's embedded
# DNS resolver. When all shards start simultaneously, DNS hostname registration
# can race with container readiness checks, causing ENOTFOUND errors (B-108).
BATCH_SIZE=4
for i in $(seq 1 "$SHARDS"); do
  start_shard "$i" &
  # After each batch, wait briefly before starting the next batch
  if [ $(( i % BATCH_SIZE )) -eq 0 ] && [ "$i" -lt "$SHARDS" ]; then
    sleep 2
  fi
done
wait
echo "=== All stacks healthy ==="

# --- Phase 3: Run tests in parallel ---
echo ""
echo "=== Phase 3: Running tests across $SHARDS shard(s) ==="

declare -A PIDS

run_shard() {
  local i=$1
  local project="checkpoint-sampler-e2e-${i}"
  local blob_dir
  blob_dir="$(pwd)/$E2E_DIR/blobs/shard-${i}"
  local shard_log="$(pwd)/$E2E_DIR/logs/shard-${i}-playwright.log"
  mkdir -p "$blob_dir" "$(pwd)/$E2E_DIR/logs"

  echo "  [shard $i] Running playwright test --shard=${i}/${SHARDS}..."
  docker compose -p "$project" -f "$COMPOSE_FILE" run --rm --remove-orphans \
    -v "$blob_dir:/app/blob-report" \
    playwright sh -c "npx playwright test --shard=${i}/${SHARDS} --reporter=blob $PW_ARGS" 2>&1 | \
    tee "$shard_log" | sed "s/^/  [shard $i] /"
  return ${PIPESTATUS[0]}
}

for i in $(seq 1 "$SHARDS"); do
  run_shard "$i" &
  PIDS[$i]=$!
done

# Collect exit codes (suppress "not a child" errors from interrupted runs)
FAIL=0
for i in $(seq 1 "$SHARDS"); do
  if ! wait "${PIDS[$i]}" 2>/dev/null; then
    echo "  [shard $i] FAILED"
    FAIL=1
  else
    echo "  [shard $i] PASSED"
  fi
done

# If interrupted, the EXIT trap handles cleanup — skip remaining phases
if [ "$INTERRUPTED" -eq 1 ]; then
  exit 130
fi

# --- Phase 4: Log capture + panic detection ---
echo ""
echo "=== Phase 4: Capturing logs ==="

for i in $(seq 1 "$SHARDS"); do
  local_log_dir="$E2E_DIR/logs/shard-${i}"
  mkdir -p "$local_log_dir"
  project="checkpoint-sampler-e2e-${i}"

  docker compose -p "$project" -f "$COMPOSE_FILE" logs --no-color backend > "$local_log_dir/backend.log" 2>&1
  docker compose -p "$project" -f "$COMPOSE_FILE" logs --no-color frontend > "$local_log_dir/frontend.log" 2>&1

  echo "  [shard $i] Logs saved to $local_log_dir/"

  # Check for panics
  if ! ./scripts/check-e2e-panics.sh "$local_log_dir"; then
    FAIL=1
  fi
done

# --- Phase 5: Report merge ---
echo ""
echo "=== Phase 5: Merging reports ==="

# Check if any blob reports were produced
BLOB_COUNT=$(find "$E2E_DIR/blobs" -name "*.zip" -o -name "*.jsonl" 2>/dev/null | head -1 | wc -l)
if [ "$BLOB_COUNT" -gt 0 ] || [ -n "$(ls -A "$E2E_DIR/blobs/shard-1/" 2>/dev/null)" ]; then
  # Use one of the shard's playwright containers to merge reports
  # Copy all shard blobs into a single merge directory
  merge_dir="$(pwd)/$E2E_DIR/merge-input"
  mkdir -p "$merge_dir"
  for i in $(seq 1 "$SHARDS"); do
    cp -r "$E2E_DIR/blobs/shard-${i}/." "$merge_dir/" 2>/dev/null || true
  done

  report_dir="$(pwd)/$E2E_DIR/report"
  docker compose -p "checkpoint-sampler-e2e-1" -f "$COMPOSE_FILE" run --rm --remove-orphans \
    -v "$merge_dir:/app/blob-report" \
    -v "$report_dir:/app/merged-report" \
    playwright sh -c "npx playwright merge-reports --reporter=html ./blob-report && cp -r playwright-report/. /app/merged-report/" 2>&1 | \
    sed "s/^/  [merge] /" || echo "  [merge] Report merge failed (non-fatal)"

  rm -rf "$merge_dir"
  echo "  Merged HTML report: $E2E_DIR/report/"
else
  echo "  No blob reports found — skipping merge"
fi

# --- Summary ---
ELAPSED=$(( SECONDS - START_TIME ))
MINS=$(( ELAPSED / 60 ))
SECS=$(( ELAPSED % 60 ))

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "=== ALL $SHARDS SHARDS PASSED in ${MINS}m${SECS}s ==="
else
  echo "=== SOME SHARDS FAILED (${MINS}m${SECS}s) ==="
  echo ""
  echo "--- Failure details ---"
  for i in $(seq 1 "$SHARDS"); do
    shard_log="$E2E_DIR/logs/shard-${i}-playwright.log"
    if [ -f "$shard_log" ]; then
      # Extract Playwright failure summary block: lines from "N) [chromium]" errors
      # through "N failed" count. Also grabs assertion error lines.
      failures=$(sed -n '/^[[:space:]]*[0-9]\+) \[chromium\]/,/^[[:space:]]*[0-9]\+ failed/p' "$shard_log" 2>/dev/null | head -30)
      if [ -n "$failures" ]; then
        echo "  [shard $i]:"
        echo "$failures" | sed 's/^/    /'
        echo ""
      fi
    fi
  done
fi

exit $FAIL
