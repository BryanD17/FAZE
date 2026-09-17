#!/usr/bin/env bash
#
# ETL stage 00 — acquire the raw game catalog into db/data/raw/.
#
# FAZE uses a bulk source for the catalog and a live API for enrichment (§1.7).
# This script tries the bulk sources in order of preference and stops at the
# first one that works, so a missing Kaggle token does not stall the build.
#
# Nothing here is committed to git: db/data/raw/ is gitignored because the raw
# dumps are reproducible by re-running this script.
#
set -euo pipefail

RAW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../data/raw" && pwd)"
cd "$RAW_DIR"

echo "  Raw data directory: $RAW_DIR"

# -----------------------------------------------------------------------------
# Source A (preferred) — Kaggle Steam datasets.
#
# Requires a Kaggle API token. Create one at kaggle.com/settings -> API ->
# "Create New Token", save the downloaded kaggle.json to ~/.kaggle/kaggle.json
# and `chmod 600` it.
# -----------------------------------------------------------------------------
download_kaggle() {
  if ! command -v kaggle >/dev/null 2>&1; then
    echo "  [kaggle] CLI not installed (pip install kaggle) — skipping."
    return 1
  fi
  if [ ! -f "$HOME/.kaggle/kaggle.json" ]; then
    echo "  [kaggle] No ~/.kaggle/kaggle.json — skipping."
    echo "           To enable: kaggle.com/settings -> API -> Create New Token,"
    echo "           save to ~/.kaggle/kaggle.json && chmod 600 ~/.kaggle/kaggle.json"
    return 1
  fi

  echo "  [kaggle] Downloading Steam datasets..."
  # Dataset slugs rot. If one 404s, search rather than guessing a replacement:
  #   kaggle datasets list -s "steam games"
  #   kaggle datasets list -s "video game ratings"
  kaggle datasets download -d fronkongames/steam-games-dataset -p . --unzip \
    || { echo "  [kaggle] slug 404'd — run: kaggle datasets list -s \"steam games\""; return 1; }
  kaggle datasets download -d antonkozyriev/game-recommendations-on-steam -p . --unzip \
    || echo "  [kaggle] recommendations dataset unavailable; continuing without it."
  return 0
}

# -----------------------------------------------------------------------------
# Source B (fallback, no credentials) — the Steam Catalog Insights export.
#
# A public CSV export of the Steam catalog as of October 2024, mirrored on
# GitHub. Same shape as the Kaggle dumps (one app table plus long-format genre
# and category tables) and it needs no account, so the pipeline is reproducible
# by any teammate on a fresh clone.
#
# Provenance and licensing are recorded in docs/data.md. Read that before using
# this data anywhere beyond coursework.
# -----------------------------------------------------------------------------
download_steam_insights() {
  local base="https://raw.githubusercontent.com/NewbieIndieGameDev/steam-insights/main"
  echo "  [steam-insights] Downloading catalog export..."
  for f in games.zip genres.zip categories.zip steamspy_insights.zip; do
    if [ -f "${f%.zip}.csv" ]; then
      echo "    ${f%.zip}.csv already present — skipping download."
      continue
    fi
    echo "    fetching $f"
    curl -fsSL --retry 3 --retry-delay 2 --max-time 300 -o "$f" "$base/$f"
    unzip -o -q "$f"
    rm -f "$f"
  done
  return 0
}

if download_kaggle; then
  echo "  Source: Kaggle."
elif download_steam_insights; then
  echo "  Source: Steam Catalog Insights (no credentials required)."
else
  echo "  ERROR: no bulk source could be downloaded." >&2
  exit 1
fi

echo
echo "  Files in $RAW_DIR:"
ls -lh "$RAW_DIR"/*.csv 2>/dev/null || echo "    (none)"
echo
echo "  Next: npm run etl:load"
