# Constitution — Architecture

> Extends `core.md`. See `core.md` for the rule format and the full index.

## CONST-ARCH-001 — Financial/trading logic is auto-Critical
- severity: high
- enforcement: review
- domain: architecture

Financial, trading, or payment-moving logic is automatically classified
Critical risk by `assess_risk` and requires human-ack (`harness approve`)
before it can be considered gated-complete, regardless of how it was
otherwise scoped.

## CONST-ARCH-002 — Reuse before building
- severity: medium
- enforcement: review
- domain: architecture

Prefer composition and existing, battle-tested libraries or patterns
(repository pattern, standard API response envelopes) over new bespoke
infrastructure.

## CONST-ARCH-003 — Files stay cohesive
- severity: medium
- enforcement: review
- domain: architecture

Target 200-400 lines per file, 800 hard cap. Extract modules rather than
growing a file indefinitely.
