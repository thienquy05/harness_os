# Workflow: new-feature

Run via `run_workflow({ workflow_name: "new-feature", project_path, spec_id })`.
`spec_id` is required — the first stage needs it. Server-authoritative (plan
§6): each stage advances only once `workflow_status` observes real evidence,
never a self-report. See `packages/core/src/workflow-definitions.ts` for the
exact `isComplete` checks below — this file documents intent; the code is the
source of truth for behavior.

## Stages, in order

| Stage | Directive action | Advances once... |
|---|---|---|
| `spec` | `create_spec` | `spec_id` resolves to an **active** spec row (`getActiveSpec`) |
| `risk` | `assess_risk` | any `risk_assessments` row for this project exists after the stage started — no floor |
| `tests` | `establish_red_phase` | the project's most recently **host-observed** test run (`test_runs`, recorded by `enforce-gate.sh`, not self-reported — plan §12.3) is `red` |
| `implement` | `invoke_skill` (`orch-add-feature`) | a `decisions` row with `action = "workflow:new-feature:implement"` is recorded — **self-report**, no natural backing table for "implementation happened" (same accepted-risk class as `validate_coverage`, plan §12.4 Open Item #15) |
| `review` | `call_request_review` | a `decisions` row with `action = "request_review"` exists (the `request_review` tool records this itself) |
| `finalize` | `record_decision_checkpoint` | a `decisions` row with `action = "workflow:new-feature:finalize"` is recorded — self-report, closing the run |
| `trace` | `trace_artifact` | a `traceability_edges` row for this project exists after the stage started |

Once `trace` completes, the run's `status` becomes `completed` and
`workflow_status` stops returning a directive.

## Why this order

Spec-first and risk-second mean nothing gets implemented against an
unregistered or unassessed change. `tests` before `implement` is the TDD
red-phase gate (plan §5.2) applied at the workflow level, not just the
file-write level — though note `gates.ts`'s own red-phase gate is
project-wide, not scoped to this specific run (Open Item #14), so a red test
elsewhere in the project technically satisfies this stage too. `review`
before `finalize` means a change can't be marked done without a review
directive having been issued. `trace` last links the finished work back to
its spec and tests for future impact analysis.
