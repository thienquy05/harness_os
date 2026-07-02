CREATE TABLE risk_assessments (
    id SERIAL PRIMARY KEY,
    request_description TEXT NOT NULL,
    factors JSONB NOT NULL DEFAULT '{}'::jsonb,
    level TEXT NOT NULL CHECK (level IN ('critical', 'high', 'medium', 'low')),
    rationale TEXT NOT NULL,
    required_gates TEXT[] NOT NULL DEFAULT '{}',
    project_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_risk_assessments_project_path ON risk_assessments(project_path);

-- Escalation-only by convention (risk/rubric.md): app logic never lowers a
-- level once assigned, but that's enforced in packages/core/src/risk.ts, not
-- at the role level — unlike decisions/config_checksums, nothing here is
-- append-only-by-role since a mistaken assessment may legitimately need
-- correction by a human with direct DB access.
GRANT SELECT, INSERT ON risk_assessments TO harness_app;
