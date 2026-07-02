# Workflow: hotfix

Run via `run_workflow({ workflow_name: "hotfix", project_path })`. The
fast-path for urgent fixes — no spec stage, no minimum risk level, but still
requires human approval before implementation.

## Stages, in order

| Stage | Directive action | Advances once... |
|---|---|---|
| `risk` | `assess_risk` | any `risk_assessments` row for this project exists after the stage started — no floor ("fast-path (bounded)" per plan §6: bounded by human approval next, not by a risk-level requirement) |
| `approval` | `record_pending_approval` → `require_human_approval` | same Phase 1 human-ack reuse as `security-change`: Claude records `pending_approval`, reports the id, stage completes once a human runs `harness approve` |
| `implement` | `invoke_skill` (`orch-fix-defect`) | a `decisions` row with `action = "workflow:hotfix:implement"` — self-report |
| `finalize` | `record_decision_checkpoint` | a `decisions` row with `action = "workflow:hotfix:finalize"` — self-report; the directive text notes this is a **retroactive audit note** for a fast-path fix (plan §6), not a pre-fix review |

## What "limited approval" means here, honestly

The plan's sketch calls this a "limited approval" — in this implementation
it reuses the exact same `isDecisionApproved` mechanism as `security-change`'s
full approval checkpoint. Nothing in code currently narrows *what* a human is
approving or bounds the scope of a hotfix differently from a security-change
approval. If "limited" is meant to imply a lighter-weight or differently
scoped approval (e.g. a shorter TTY prompt, or approval from a specific
role), that's not built — named here as an open gap rather than silently
assumed equivalent.
