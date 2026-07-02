CREATE TABLE specs (
    id SERIAL PRIMARY KEY,
    -- Stable business identifier (e.g. "APX-API-001"), NOT unique alone: a
    -- spec has one row per version (see version below), mirroring how
    -- constitution_rules/constitution_versions already separate "this rule"
    -- from "this rule's current text". UNIQUE(spec_id, version) is the real
    -- key; the partial unique index below enforces "at most one active
    -- version per spec_id" at the database level, not just in application code.
    spec_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('product', 'domain', 'api', 'data', 'infra')),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'superseded', 'deprecated')),
    content JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    project_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (spec_id, version)
);

CREATE INDEX idx_specs_spec_id ON specs(spec_id);
CREATE INDEX idx_specs_project_path ON specs(project_path);
-- Enforces "at most one active version per spec_id" — a spec-version bump
-- that forgets to supersede the prior row fails at INSERT time, not silently.
CREATE UNIQUE INDEX idx_specs_one_active_per_spec_id ON specs(spec_id) WHERE status = 'active';

-- Dependency edges reference specific spec VERSIONS (specs.id, the row PK),
-- not the business spec_id string — deliberately distinct column names from
-- specs.spec_id to avoid the obvious naming collision ("spec_id" already
-- means "the business identifier" on the specs table itself). This lets
-- impact-analysis answer "what depended on THIS version" precisely, and
-- mirrors traceability_edges' from_id/to_id design (§5.2, Phase 2 part B).
CREATE TABLE spec_dependencies (
    dependent_id INTEGER NOT NULL REFERENCES specs(id),
    dependency_id INTEGER NOT NULL REFERENCES specs(id),
    PRIMARY KEY (dependent_id, dependency_id)
);

GRANT SELECT, INSERT, UPDATE ON specs TO harness_app;
GRANT SELECT, INSERT ON spec_dependencies TO harness_app;
