-- Least-privilege runtime role. The role Postgres is bootstrapped with
-- (POSTGRES_USER, used only by docker-entrypoint-initdb.d scripts and by a
-- human running migrations) is a superuser and would bypass any table-level
-- REVOKE. The server and gate-daemon connect as `harness_app` instead, so
-- the "append-only" guarantee on decisions/config_checksums (CONST-CORE-004)
-- is enforced by Postgres, not by application discipline that could be
-- bypassed by whatever is running inside the container.
DO
$$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harness_app') THEN
    CREATE ROLE harness_app LOGIN PASSWORD 'harness_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE harness_os TO harness_app;
GRANT USAGE ON SCHEMA public TO harness_app;

-- Any table created after this point in later init scripts should also grant
-- USAGE on its serial sequence explicitly (done per-file), since default
-- privileges don't retroactively apply to already-created objects.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO harness_app;
