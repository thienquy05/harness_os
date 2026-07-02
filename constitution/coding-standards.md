# Constitution — Coding Standards

> Extends `core.md`. See `core.md` for the rule format and the full index.

## CONST-CODE-001 — Immutability by default
- severity: medium
- enforcement: review
- domain: coding-standards

Never mutate objects or arrays in place; return new copies with the change
applied.

## CONST-CODE-002 — Shallow control flow
- severity: medium
- enforcement: review
- domain: coding-standards

No more than 4 levels of nesting; prefer early returns over stacked
conditionals.

## CONST-CODE-003 — No magic numbers
- severity: low
- enforcement: review
- domain: coding-standards

Named constants for meaningful thresholds, delays, and limits — not
inline literals.
