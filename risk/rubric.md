# Risk Rubric

`assess_risk` (and `gate-check`'s use of it) is rule-based and deterministic
— no LLM call, same inputs always produce the same level. Inputs are a free-text
`request_description`, an optional list of `touched_paths`, and an optional
`project_path` (used to load any project-specific keyword overrides later; v1
ships with the global rubric only).

## Levels

| Level | Meaning | Required gates |
|---|---|---|
| `critical` | Irreversible, high-blast-radius, or financial impact | spec, tests (RED→GREEN observed), review:security, human-ack |
| `high` | Security- or auth-relevant, or touches shared infrastructure | spec, tests (RED→GREEN observed), review:security |
| `medium` | Ordinary feature work touching gated paths | spec, tests (RED→GREEN observed), review:code |
| `low` | Docs, config, non-gated paths | none beyond the constitution's `review`-tagged rules |

## Classification rule (evaluated in this order, first match wins)

1. **Auto-critical keywords** (case-insensitive match against
   `request_description` or any `touched_paths` segment): `trading`,
   `trade`, `order`, `payment`, `financial`, `wallet`, `ledger`, `funds`,
   `withdraw`, `deposit`. Matches CONST-ARCH-001. → `critical`.
2. **Auto-high keywords**: `auth`, `authentication`, `authorization`,
   `password`, `token`, `session`, `credential`, `crypto`, `secret`,
   `pii`, `personal data`. → `high`.
3. **Path matches a project's `gatedGlobs`** (from `harness.config.json`)
   and neither of the above matched. → `medium`.
4. **Everything else** (matches only `exemptGlobs`, or no gated path
   touched). → `low`.

`factors` (JSONB) records which rule matched and the exact keywords/paths
that triggered it, so `rationale` is reconstructable from stored data alone,
not just the level.

## Escalation, never de-escalation

A human or a reviewer directive may raise a stored assessment's level (a new
`risk_assessments` row, since the table is append-only-by-convention like the
decision log) but nothing in the system automatically lowers a level once
assigned in the same request.
