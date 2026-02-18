#!/usr/bin/env bash
set -euo pipefail

# Patch qmd vsearch to support embedding-only mode via:
#   QMD_VSEARCH_DISABLE_EXPANSION=1
#
# Usage:
#   scripts/patch-qmd-no-expansion.sh
#   scripts/patch-qmd-no-expansion.sh /custom/path/to/store.ts

TARGET_DEFAULT="$HOME/.bun/install/global/node_modules/qmd/src/store.ts"
TARGET_PATH="${1:-$TARGET_DEFAULT}"

if [[ ! -f "$TARGET_PATH" ]]; then
  echo "Target file not found: $TARGET_PATH" >&2
  exit 1
fi

if grep -q "QMD_VSEARCH_DISABLE_EXPANSION" "$TARGET_PATH"; then
  echo "Already patched: $TARGET_PATH"
  exit 0
fi

node - "$TARGET_PATH" <<'NODE'
const fs = require('fs');
const target = process.argv[2];
const src = fs.readFileSync(target, 'utf8');

const marker = 'QMD_VSEARCH_DISABLE_EXPANSION';
if (src.includes(marker)) {
  console.log(`Already patched: ${target}`);
  process.exit(0);
}

const pattern = /  \/\/ Expand query — filter to vec\/hyde only \(lex queries target FTS, not vector\)\n  const allExpanded = await store\.expandQuery\(query\);\n  const vecExpanded = allExpanded\.filter\(q => q\.type !== 'lex'\);\n  options\?\.hooks\?\.onExpand\?\.\(query, vecExpanded\);/;

const replacement = [
  "  // Optional: disable query expansion to run embedding-only vector search.",
  "  const disableExpansion = process.env.QMD_VSEARCH_DISABLE_EXPANSION === '1';",
  "  const vecExpanded = disableExpansion",
  "    ? []",
  "    : (await store.expandQuery(query)).filter(q => q.type !== 'lex');",
  "  options?.hooks?.onExpand?.(query, vecExpanded);",
].join('\n');

if (!pattern.test(src)) {
  console.error('Patch anchor not found. qmd source layout may have changed.');
  process.exit(2);
}

const out = src.replace(pattern, replacement);
fs.writeFileSync(target, out);
console.log(`Patched: ${target}`);
NODE
