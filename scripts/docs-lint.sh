#!/usr/bin/env bash
# docs-lint.sh — validate the knowledge base structure and cross-links.
# Exit code 0 = all checks pass.  Non-zero = one or more failures.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=0

# ---------- helpers ----------

fail() {
  echo "FAIL: $1" >&2
  ERRORS=$((ERRORS + 1))
}

check_file_exists() {
  if [[ ! -f "$REPO_ROOT/$1" ]]; then
    fail "Required file missing: $1"
  fi
}

check_dir_exists() {
  if [[ ! -d "$REPO_ROOT/$1" ]]; then
    fail "Required directory missing: $1"
  fi
}

# ---------- 1. Required files ----------

echo "=== Checking required files ==="

REQUIRED_FILES=(
  AGENTS.md
  ARCHITECTURE.md
  docs/DESIGN.md
  docs/FRONTEND.md
  docs/PLANS.md
  docs/PRODUCT_SENSE.md
  docs/QUALITY_SCORE.md
  docs/RELIABILITY.md
  docs/SECURITY.md
  docs/design-docs/index.md
  docs/design-docs/core-beliefs.md
  docs/exec-plans/tech-debt-tracker.md
  docs/generated/db-schema.md
  docs/product-specs/index.md
  docs/product-specs/new-user-onboarding.md
)

for f in "${REQUIRED_FILES[@]}"; do
  check_file_exists "$f"
done

# ---------- 2. Required directories ----------

echo "=== Checking required directories ==="

REQUIRED_DIRS=(
  docs/design-docs
  docs/exec-plans/active
  docs/exec-plans/completed
  docs/generated
  docs/product-specs
  docs/references
)

for d in "${REQUIRED_DIRS[@]}"; do
  check_dir_exists "$d"
done

# ---------- 3. Cross-link validation ----------

echo "=== Checking cross-links in AGENTS.md ==="

# Extract markdown links from AGENTS.md and verify targets exist.
while IFS= read -r link; do
  # Strip trailing ) and any anchor
  target="${link%%#*}"
  target="${target%%)*}"
  if [[ -z "$target" || "$target" == http* ]]; then
    continue
  fi
  if [[ ! -e "$REPO_ROOT/$target" ]]; then
    fail "AGENTS.md links to non-existent target: $target"
  fi
done < <(grep -oP '\]\(\K[^)]+' "$REPO_ROOT/AGENTS.md" 2>/dev/null || true)

# ---------- 4. No empty docs ----------

echo "=== Checking for empty documentation files ==="

while IFS= read -r mdfile; do
  if [[ ! -s "$mdfile" ]]; then
    rel="${mdfile#"$REPO_ROOT"/}"
    fail "Empty documentation file: $rel"
  fi
done < <(find "$REPO_ROOT/docs" -name '*.md' -type f 2>/dev/null)

# ---------- 5. ARCHITECTURE.md mentions key crates ----------

echo "=== Checking ARCHITECTURE.md covers key crates ==="

KEY_CRATES=(tinyclaw-core tinyclaw-inference tinyclaw-cli tinyclaw-android tinyclaw-http)
for crate in "${KEY_CRATES[@]}"; do
  if ! grep -q "$crate" "$REPO_ROOT/ARCHITECTURE.md"; then
    fail "ARCHITECTURE.md does not mention crate: $crate"
  fi
done

# ---------- 6. Freshness check ----------

echo "=== Checking doc freshness (warn if >180 days old) ==="

NOW=$(date +%s)
STALE_DAYS=180

while IFS= read -r mdfile; do
  mod_time=$(stat -c %Y "$mdfile" 2>/dev/null || stat -f %m "$mdfile" 2>/dev/null || echo "$NOW")
  age_days=$(( (NOW - mod_time) / 86400 ))
  if [[ $age_days -gt $STALE_DAYS ]]; then
    rel="${mdfile#"$REPO_ROOT"/}"
    echo "WARN: $rel is $age_days days old (>${STALE_DAYS} days)" >&2
  fi
done < <(find "$REPO_ROOT/docs" "$REPO_ROOT/ARCHITECTURE.md" "$REPO_ROOT/AGENTS.md" -name '*.md' -type f 2>/dev/null)

# ---------- Summary ----------

echo ""
if [[ $ERRORS -gt 0 ]]; then
  echo "docs-lint: $ERRORS error(s) found." >&2
  exit 1
else
  echo "docs-lint: all checks passed."
  exit 0
fi
