#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  database_directory=$(dirname "${DATABASE_PATH:-/app/data/app.sqlite}")
  mkdir -p "$database_directory"
  chown node:node "$database_directory"
  exec gosu node "$@"
fi

exec "$@"
