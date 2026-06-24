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

database_file_count="$(
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
  \) -print | wc -l | tr -d ' '
)"

if [ "${database_file_count}" -eq 0 ]; then
  echo "No database files found."
  exit 0
fi

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
\) -print -delete

echo "Noema local database files cleared."
