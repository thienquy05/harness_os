# Risk Rubric

`assess_risk` (and `gate-check`'s use of it) is rule-based and deterministic
— no LLM call, same inputs always produce the same level. Inputs are a free-text
`request_description`, an optional list of `touched_paths`, and an optional
`project_path`, used to load the project's keyword overrides (below).

## Levels

| Level | Meaning | Required gates |
|---|---|---|
| `critical` | Irreversible, high-blast-radius, or financial impact | spec, tests (RED→GREEN observed), review:security, human-ack |
| `high` | Security- or auth-relevant, or touches shared infrastructure | spec, tests (RED→GREEN observed), review:security |
| `medium` | Ordinary feature work touching gated paths | spec, tests (RED→GREEN observed), review:code |
| `low` | Docs, config, non-gated paths | none beyond the constitution's `review`-tagged rules |

## Classification rule (evaluated in this order, first match wins)

1. **Auto-critical keywords** (case-insensitive, **whole words**, against
   `request_description` and `touched_paths`; camelCase and snake_case are
   split into words and a plural `s`/`es` is allowed, so `authService.ts`
   and `payments` match while `border` and `author` do not): `trading`,
   `trade`, `order`, `payment`, `financial`, `wallet`, `ledger`, `funds`,
   `withdraw`, `deposit`. Matches CONST-ARCH-001. → `critical`.
2. **Auto-high keywords**: `auth`, `oauth`, `authentication`, `authorization`,
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

## Project overrides

A project can tune the keyword lists in its `.claude/harness.config.json`
(which is checksummed, so a change needs `harness reconcile-config`):

```json
"risk": {
  "ignoreKeywords": ["financial"],
  "extraCritical": ["migration"],
  "extraHigh": ["nfc"]
}
```

`ignoreKeywords` removes words that are harmless in this project (for example
"financial" in an app that only shows cost estimates); `extraCritical` and
`extraHigh` add the project's own sensitive words. Applied overrides are stored
in `factors.overrides`. Where the project config cannot be read (not
initialized, or the MCP container does not mount the projects root; see
RUNBOOK.md), the global lists apply.
