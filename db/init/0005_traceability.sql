-- traceability_edges: constitution_rule -> spec, spec -> test, test -> commit_sha,
-- review -> decision_id, etc. from_id/to_id are TEXT, not FKs, because the
-- entities on either end are heterogeneous: some are DB rows with an integer
-- PK (specs.id), others are external identifiers with no row of their own
-- (a commit SHA, a test file path). A single edges table spanning both only
-- works if the id column can hold either, so it's stored as the string form
-- of whichever id the entity actually has (see specs.ts's use of
-- String(spec.id) when recording spec-originating edges).
CREATE TABLE traceability_edges (
    id SERIAL PRIMARY KEY,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    stale BOOLEAN NOT NULL DEFAULT false,
    project_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_traceability_from ON traceability_edges(from_type, from_id);
CREATE INDEX idx_traceability_to ON traceability_edges(to_type, to_id);
CREATE INDEX idx_traceability_project_path ON traceability_edges(project_path);

-- UPDATE (not append-only) is required here, unlike decisions/config_checksums:
-- spec-version propagation (specs.ts's createSpec) must flip `stale` to true
-- on existing rows when a spec is superseded, in the same transaction as the
-- version bump (plan §5.2).
GRANT SELECT, INSERT, UPDATE ON traceability_edges TO harness_app;
