-- Not in the plan's original §5 sketch — added during Phase 2 Part B
-- implementation to back the TDD RED-phase gate (see plan §12.3 for the
-- Option 1 vs Option 2 decision this supports). Records every test command
-- run that enforce-gate.sh itself executed and observed the exit code for
-- (never a Claude-reported number, see gates.ts/test-runs.ts).
CREATE TABLE test_runs (
    id SERIAL PRIMARY KEY,
    project_path TEXT NOT NULL,
    command TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('red', 'green')),
    exit_code INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_test_runs_project_path_created_at ON test_runs(project_path, created_at DESC);

-- Append-only, same posture as decisions (§3.5): a test run is a historical
-- observation, never edited after the fact.
GRANT SELECT, INSERT ON test_runs TO harness_app;
