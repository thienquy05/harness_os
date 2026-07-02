CREATE TABLE config_checksums (
    id SERIAL PRIMARY KEY,
    project_path TEXT NOT NULL,
    file_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_by TEXT NOT NULL,
    -- Present per §3.5a's schema sketch but intentionally never written to by
    -- app code in v1 (kept for manual forensic annotation only): populating
    -- it would require an UPDATE on the superseded row, which would break the
    -- append-only-by-role guarantee below. "Which row is current" is instead
    -- derived as the most recent (project_path, file_path) row by
    -- verified_at — see config-integrity.ts.
    superseded_by INTEGER REFERENCES config_checksums(id)
);

CREATE INDEX idx_config_checksums_project_file ON config_checksums(project_path, file_path, verified_at DESC);

-- Append-only, enforced at the role level, same rationale as `decisions`:
-- reconcile-config always INSERTs a new row; it never UPDATEs an old one.
GRANT SELECT, INSERT ON config_checksums TO harness_app;
