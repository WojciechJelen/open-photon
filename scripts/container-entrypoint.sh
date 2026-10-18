#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  database_directory=$(dirname "${DATABASE_PATH:-/app/data/spike.sqlite}")
  media_directory=${MEDIA_DIRECTORY:-"$database_directory/media"}
  mkdir -p "$database_directory" "$media_directory"
  chown node:node "$database_directory" "$media_directory"
  exec gosu node "$@"
fi

exec "$@"
