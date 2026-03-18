#!/usr/bin/env bash
#
# Consolidated runtime error sweep for E2E shard logs.
# Scans backend and frontend logs for unexpected errors, filters allowed
# patterns (from QA_ALLOWED_ERRORS.md), deduplicates, and writes a
# machine-readable report.
#
# Usage:
#   ./scripts/e2e/e2e_sweep.sh [log-dir]
#   Default log-dir: .e2e/logs
#
# Output:
#   - <log-dir>/../sweep.txt  (machine-readable report)
#   - stdout summary line
#
set -euo pipefail

LOG_DIR="${1:-.e2e/logs}"

if [ ! -d "$LOG_DIR" ]; then
  echo "E2E SWEEP: No log directory found at $LOG_DIR — skipping"
  exit 0
fi

# Resolve output path: sibling of the log directory
PARENT_DIR="$(cd "$LOG_DIR/.." && pwd)"
OUTPUT_FILE="$PARENT_DIR/sweep.txt"

# Count shards by looking for shard-* directories
SHARD_DIRS=$(find "$LOG_DIR" -maxdepth 1 -type d -name 'shard-*' 2>/dev/null | sort)
SHARD_COUNT=$(echo "$SHARD_DIRS" | grep -c . 2>/dev/null || echo 0)

if [ "$SHARD_COUNT" -eq 0 ]; then
  echo "E2E SWEEP: No shard directories found in $LOG_DIR — skipping"
  cat > "$OUTPUT_FILE" <<EOF
sweep_result=SKIPPED
reason=no_shard_directories
EOF
  exit 0
fi

# --- Scan for errors ---
FINDINGS_FILE=$(mktemp)
trap "rm -f '$FINDINGS_FILE'" EXIT

# Helper: scan a log file for matching lines and append structured findings
scan_log() {
  local shard_name="$1" log_file="$2" log_type="$3" pattern="$4"
  if [ ! -f "$log_file" ]; then return 0; fi
  local matches
  matches=$(grep -iE "$pattern" "$log_file" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    while IFS= read -r line; do
      echo "source=$shard_name/$log_type"
      echo "line=$line"
      echo "---"
    done <<< "$matches" >> "$FINDINGS_FILE"
  fi
}

# Backend: scan for level=error or level=fatal lines
for shard_dir in $SHARD_DIRS; do
  shard_name=$(basename "$shard_dir")
  scan_log "$shard_name" "$shard_dir/backend.log" "backend.log" 'level=(error|fatal|panic)|FATAL|PANIC|panic:'
done

# Frontend: scan for error/EPIPE/ECONNREFUSED lines
for shard_dir in $SHARD_DIRS; do
  shard_name=$(basename "$shard_dir")
  scan_log "$shard_name" "$shard_dir/frontend.log" "frontend.log" 'error|EPIPE|ECONNREFUSED'
done

# --- Filter allowed patterns (from QA_ALLOWED_ERRORS.md) ---
FILTERED_FILE=$(mktemp)
trap "rm -f '$FINDINGS_FILE' '$FILTERED_FILE'" EXIT

ALLOWED_PATTERNS=4

# Process findings in blocks of 3 lines (source, line, ---)
# Filter out allowed patterns from the line= field
while IFS= read -r source_line; do
  IFS= read -r content_line || break
  IFS= read -r separator || break

  line_value="${content_line#line=}"

  # ComfyUI errors
  if echo "$line_value" | grep -qiE 'comfyui|ComfyUI'; then
    continue
  fi

  # DB reset race conditions
  if echo "$line_value" | grep -qiE 'no such table|no such column'; then
    continue
  fi

  # Safetensors metadata parse failures
  if echo "$line_value" | grep -qiE 'safetensors metadata|safetensors header|parsing safetensors'; then
    continue
  fi

  # Vite WebSocket proxy errors (EPIPE, ECONNREFUSED, ECONNRESET, ws proxy socket error)
  if echo "$line_value" | grep -qiE 'EPIPE|ECONNREFUSED|ECONNRESET|ws proxy socket error|WebSocket proxy'; then
    continue
  fi

  echo "$source_line" >> "$FILTERED_FILE"
  echo "$content_line" >> "$FILTERED_FILE"
  echo "$separator" >> "$FILTERED_FILE"
done < "$FINDINGS_FILE"

# --- Deduplicate findings (same error message = 1 finding) ---
DEDUPED_FILE=$(mktemp)
trap "rm -f '$FINDINGS_FILE' '$FILTERED_FILE' '$DEDUPED_FILE'" EXIT

declare -A SEEN_MESSAGES

while IFS= read -r source_line; do
  IFS= read -r content_line || break
  IFS= read -r separator || break

  line_value="${content_line#line=}"
  # Normalize: strip timestamps and shard-specific container prefixes for dedup
  normalized=$(echo "$line_value" | sed -E 's/time="[^"]*"//g; s/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.Z]+//g; s/checkpoint-sampler-e2e-[0-9]+-//g' | tr -s ' ')

  if [ -z "${SEEN_MESSAGES[$normalized]+_}" ]; then
    SEEN_MESSAGES[$normalized]=1
    echo "$source_line" >> "$DEDUPED_FILE"
    echo "$content_line" >> "$DEDUPED_FILE"
    echo "$separator" >> "$DEDUPED_FILE"
  fi
done < "$FILTERED_FILE"

# --- Generate output ---
FINDING_COUNT=0
if [ -s "$DEDUPED_FILE" ]; then
  # Count findings (each is 3 lines: source, line, ---)
  FINDING_COUNT=$(( $(wc -l < "$DEDUPED_FILE") / 3 ))
fi

if [ "$FINDING_COUNT" -eq 0 ]; then
  cat > "$OUTPUT_FILE" <<EOF
sweep_result=CLEAN
finding_count=0
shards_scanned=$SHARD_COUNT
allowed_patterns_filtered=$ALLOWED_PATTERNS
EOF
  echo "E2E SWEEP: CLEAN (scanned $SHARD_COUNT shards, filtered $ALLOWED_PATTERNS allowed patterns)"
else
  {
    echo "sweep_result=FINDINGS"
    echo "finding_count=$FINDING_COUNT"
    echo "shards_scanned=$SHARD_COUNT"
    echo "allowed_patterns_filtered=$ALLOWED_PATTERNS"
    cat "$DEDUPED_FILE"
  } > "$OUTPUT_FILE"

  echo "E2E SWEEP: $FINDING_COUNT finding(s) after filtering (scanned $SHARD_COUNT shards)"
  # Print each finding to stdout
  while IFS= read -r source_line; do
    IFS= read -r content_line || break
    IFS= read -r separator || break
    source_value="${source_line#source=}"
    line_value="${content_line#line=}"
    # Truncate long lines for stdout
    if [ ${#line_value} -gt 200 ]; then
      line_value="${line_value:0:200}..."
    fi
    echo "  [$source_value] $line_value"
  done < "$DEDUPED_FILE"
fi
