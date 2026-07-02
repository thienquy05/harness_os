CREATE TABLE decisions (
    id SERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    rationale TEXT NOT NULL,
    constitution_rules_applied TEXT[] NOT NULL DEFAULT '{}',
    risk_level TEXT NOT NULL CHECK (risk_level IN ('critical', 'high', 'medium', 'low')),
    status TEXT NOT NULL DEFAULT 'approved'
        CHECK (status IN ('approved', 'pending_approval', 'rejected')),
    approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Not in the plan's original §3.5 sketch. Required to implement "approve
    -- is a new row referencing the original, not an UPDATE" (§3.5): when
    -- `harness approve <id>` runs, it INSERTs a new row with
    -- action='approve_decision', status='approved', and this column set to
    -- the original pending row's id. gate-check treats a decision as approved
    -- if its own status is 'approved', OR if any row exists with
    -- related_decision_id = its id AND status = 'approved'.
    related_decision_id INTEGER REFERENCES decisions(id),
    project_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_decisions_project_path ON decisions(project_path);
CREATE INDEX idx_decisions_status ON decisions(status);
CREATE INDEX idx_decisions_related ON decisions(related_decision_id);

-- Append-only, enforced at the role level: harness_app gets SELECT + INSERT
-- only. No UPDATE/DELETE grant exists for this role on this table at all —
-- "approving" is a new row (see related_decision_id above), never a mutation
-- of the original.
GRANT SELECT, INSERT ON decisions TO harness_app;
