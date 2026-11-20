#!/usr/bin/env bash
# Runs supabase/schema.sql against a throwaway local Postgres and checks the
# security rules + validation. Needs Postgres 15+ binaries (initdb, pg_ctl, psql).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PATH="$PGBIN:$PATH"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"

cleanup() { pg_ctl -D "$TMP/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf -- "$TMP"; }
trap cleanup EXIT

# Postgres refuses to run as root; use the postgres user if we are root.
RUN=()
if [ "$(id -u)" = "0" ]; then chown -R postgres "$TMP"; RUN=(runuser -u postgres --); fi

"${RUN[@]}" initdb -D "$TMP/db" -U postgres --auth=trust >/dev/null
"${RUN[@]}" pg_ctl -D "$TMP/db" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

PSQL=("${RUN[@]}" psql -h "$TMP" -p "$PORT" -U postgres -d postgres -q -v ON_ERROR_STOP=1)
# Files go through stdin so the postgres user doesn't need read access to them.
"${PSQL[@]}" < "$HERE/stubs.sql"
"${PSQL[@]}" < "$HERE/../schema.sql"
"${PSQL[@]}" < "$HERE/../schema.sql" 2>/dev/null   # must be safe to re-run
"${PSQL[@]}" < "$HERE/tests.sql"
