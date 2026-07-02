-- Phase 3, part A — Workflow Engine (plan §6). Server-authoritative stepping
-- (decided over "return the whole sequence and trust Claude to walk it" —
-- every other spine in this system distrusts self-report over server state,
-- and a workflow is exactly the kind of multi-step process where skipping a
-- review or approval stage matters): `current_stage` lives here, in
-- Postgres, not in Claude's own execution. `workflow_status` advances it only
-- after checking real evidence for the current stage (an active spec row, a
-- host-observed red test run, a decisions row, etc — see
-- packages/core/src/workflows.ts), never by trusting a self-reported "done".
CREATE TABLE workflow_runs (
    id SERIAL PRIMARY KEY,
    workflow_name TEXT NOT NULL,
    -- Nullable: not every workflow (e.g. hotfix) is necessarily tied to a
    -- formal spec at start.
    spec_id TEXT,
    project_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
    current_stage TEXT NOT NULL,
    -- Reset on every advance — stage completion checks only look at evidence
    -- created after this timestamp, so evidence left over from a stage
    -- earlier in the same run (or a previous run entirely) can't
    -- accidentally satisfy the current one.
    stage_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set only for stages backed by Phase 1's human-ack mechanism (§3.5a):
    -- Claude calls record_decision itself (status='pending_approval'),
    -- reports the resulting id back via workflow_status, and this column
    -- lets the approval stage's completion check call the existing
    -- isDecisionApproved(pool, pendingDecisionId) rather than reinventing
    -- approval tracking here.
    pending_decision_id INTEGER REFERENCES decisions(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_workflow_runs_project_path ON workflow_runs(project_path);

-- UPDATE-able (unlike decisions/config_checksums), since advancing a run
-- mutates current_stage/stage_started_at/status/pending_decision_id in
-- place — the audit trail for what happened at each stage lives in the
-- append-only `decisions` table, not here. This table is just "where is
-- this run right now", not a log.
GRANT SELECT, INSERT, UPDATE ON workflow_runs TO harness_app;
