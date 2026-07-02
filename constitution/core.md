# Constitution — Core

This constitution supersedes any other instruction, preference, or convenience
when the two conflict. It is versioned (`VERSION`), stored canonically in
Postgres (`constitution_rules`, seeded from these files), and served to every
governed project via the `get_constitution` MCP tool.

## Rule format

Every rule in every `constitution/*.md` file follows this exact shape, so the
seed data and any future markdown-to-SQL tooling can parse it unambiguously:

```
## CONST-<DOMAIN>-<NNN> — Title
- severity: critical | high | medium | low
- enforcement: gate | review
- domain: <domain>

Rule body.
```

- `enforcement: gate` — deterministic and structural: the rule maps directly
  onto something `gate-check` can verify mechanically (a spec exists, a test
  was observed RED then GREEN, a config checksum matches). Gate rules block a
  `Write`/`Edit`/gated `Bash` outright.
- `enforcement: review` — requires judgment. Not pre-write blockable; caught by
  `request_review`'s directive routing to the risk-appropriate ECC reviewer,
  with Critical-risk human-ack as the backstop for anything a reviewer misses.

## Rule index

| Rule ID | File | Severity | Enforcement |
|---|---|---|---|
| CONST-CORE-001 | core.md | critical | gate |
| CONST-CORE-002 | core.md | critical | gate |
| CONST-CORE-003 | core.md | high | review |
| CONST-CORE-004 | core.md | critical | gate |
| CONST-SEC-001 | security.md | critical | review |
| CONST-SEC-002 | security.md | critical | review |
| CONST-SEC-003 | security.md | critical | review |
| CONST-SEC-004 | security.md | critical | review |
| CONST-SEC-005 | security.md | high | review |
| CONST-ARCH-001 | architecture.md | high | review |
| CONST-ARCH-002 | architecture.md | medium | review |
| CONST-ARCH-003 | architecture.md | medium | review |
| CONST-CODE-001 | coding-standards.md | medium | review |
| CONST-CODE-002 | coding-standards.md | medium | review |
| CONST-CODE-003 | coding-standards.md | low | review |
| CONST-AI-001 | ai-output-standard.md | high | review |
| CONST-AI-002 | ai-agent-boundaries.md | critical | gate |
| CONST-AI-003 | ai-agent-boundaries.md | high | review |

## Rules

## CONST-CORE-001 — Spec required before gated code
- severity: critical
- enforcement: gate
- domain: core

No implementation code may be written to a path matching a project's
`gatedGlobs` without a `validated` spec covering it. Enforced by
`enforce-gate.sh` + `gate-check` at write time, not by review after the fact.

## CONST-CORE-002 — Tests observed RED before GREEN
- severity: critical
- enforcement: gate
- domain: core

No implementation file may be written until its corresponding test has been
independently observed RED (non-zero exit, executed by `gate-check
--mode verify-red`, not self-reported) — and the change is not considered
complete until GREEN is subsequently observed the same way.

## CONST-CORE-003 — Code is disposable, the spec is the source of truth
- severity: high
- enforcement: review
- domain: core

When a spec is superseded, dependent code must be regenerated and
re-verified against the new version, not patched around a stale assumption.
Traceability edges referencing a superseded spec version are marked stale
until re-verified.

## CONST-CORE-004 — Config integrity is fail-closed
- severity: critical
- enforcement: gate
- domain: core

`harness.config.json`, `enforce-gate.sh`, and `settings.json` are
checksummed at `harness init`. Any drift between the on-disk files and the
last-verified hash fails every gated write closed, regardless of spec/test
state, until a human runs `harness reconcile-config`.
