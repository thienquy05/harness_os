#!/bin/bash
# docker-entrypoint-initdb.d only scans its own top-level directory, so
# db/seed/ (mounted separately at /gov-seed, kept apart from db/init/ so
# future seed versions can be added without touching schema files) has to be
# invoked explicitly. Runs once, same as everything else here, only when the
# data directory is empty on first container start.
set -euo pipefail

for seed_file in /gov-seed/*.sql; do
  echo "Applying seed: $seed_file"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$seed_file"
done
