# Workflow: security-change

Run via `run_workflow({ workflow_name: "security-change", project_path, spec_id? })`.
For changes to auth, credentials, or other security-sensitive surfaces —
where `assess_risk` is expected to land High or Critical.

## Stages, in order

| Stage | Directive action | Advances once... |
|---|---|---|
| `security_review` | `invoke_agent` (`security-reviewer`) | a `decisions` row with `action = "workflow:security-change:security_review"` is recorded — self-report, logged before any code exists to review formally, matching the plan's "security review directive first" |
| `risk` | `assess_risk` | a `risk_assessments` row for this project exists after the stage started **and its `level` is `high` or `critical`** |
| `approval` | `record_pending_approval` → `require_human_approval` | reuses Phase 1's human-ack mechanism directly, not a new one: Claude calls `record_decision(status: "pending_approval")`, reports the id back via `workflow_status({ run_id, decision_id })`, and this stage completes once `isDecisionApproved` is true for that id (i.e. a human ran `harness approve <id>`) |
| `implement` | `invoke_skill` (`orch-change-feature`) | a `decisions` row with `action = "workflow:security-change:implement"` — self-report |
| `finalize` | `record_decision_checkpoint` | a `decisions` row with `action = "workflow:security-change:finalize"` — self-report, closes the run |

## The "risk forced ≥High" floor

This is a **floor Claude must actually hit via a real `assess_risk` call**,
not an override the workflow silently applies. If a genuine assessment comes
back Medium or Low, the stage simply never advances — the directive says to
escalate to a human rather than force the level, since silently overriding a
computed risk level would defeat the point of having a deterministic rubric
at all (`risk/rubric.md`).

## Open question, not yet resolved

The plan's sketch says "orch-change-feature/orch-fix-defect" for the
implement stage without picking one — this workflow definition hard-codes
`orch-change-feature`. If a security fix is better modeled as a defect fix,
route through the `hotfix` workflow instead, which uses `orch-fix-defect`.
