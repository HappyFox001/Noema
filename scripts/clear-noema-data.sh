#!/usr/bin/env bash

set -euo pipefail

APP_SUPPORT_DIR="${HOME}/Library/Application Support"
DEFAULT_DATA_DIR="${APP_SUPPORT_DIR}/@noema/desktop/noema-data"
DATA_DIR="${1:-${NOEMA_DATA_DIR:-${DEFAULT_DATA_DIR}}}"

echo "Clearing Noema local database files..."
echo "Data directory: ${DATA_DIR}"

if [ ! -d "${DATA_DIR}" ]; then
  echo "No data directory found."
  exit 0
fi

mapfile -d '' database_files < <(
  find "${DATA_DIR}" -maxdepth 2 -type f \( \
    -name '*.sqlite3' -o \
    -name '*.sqlite3-wal' -o \
    -name '*.sqlite3-shm' -o \
    -name '*.sqlite3-journal' -o \
    -name '*.sqlite' -o \
    -name '*.sqlite-wal' -o \
    -name '*.sqlite-shm' -o \
    -name '*.sqlite-journal' -o \
    -name '*.db' -o \
    -name '*.db-wal' -o \
    -name '*.db-shm' -o \
    -name '*.db-journal' \
  \) -print0
)

if [ "${#database_files[@]}" -eq 0 ]; then
  echo "No database files found."
  exit 0
fi

for file in "${database_files[@]}"; do
  echo "Removing: ${file}"
  rm -f "${file}"
done

echo "Noema local database files cleared."
