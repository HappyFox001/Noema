#!/usr/bin/env bash

set -euo pipefail

APP_SUPPORT_DIR="${HOME}/Library/Application Support"
TARGET_SUFFIX="her-text-data"

declare -a CANDIDATES=(
  "${APP_SUPPORT_DIR}/@her-text/desktop/${TARGET_SUFFIX}"
  "${APP_SUPPORT_DIR}/Her-Text/${TARGET_SUFFIX}"
  "${APP_SUPPORT_DIR}/Electron/${TARGET_SUFFIX}"
)

echo "Clearing Her-Text stored history..."

found_any=0

for target in "${CANDIDATES[@]}"; do
  if [ -d "${target}" ]; then
    found_any=1
    echo "Removing: ${target}"
    rm -rf "${target}"
  else
    echo "Skipping missing path: ${target}"
  fi
done

if [ "${found_any}" -eq 0 ]; then
  echo "No local history storage directories were found."
else
  echo "History storage cleared."
fi
