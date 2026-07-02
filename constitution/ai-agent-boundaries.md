# Constitution — AI Agent Boundaries

> Extends `core.md`. See `core.md` for the rule format and the full index.

## CONST-AI-002 — Tools validate and direct, they never invoke
- severity: critical
- enforcement: gate
- domain: ai-agent-boundaries

A containerized Harness OS tool cannot spawn Claude Code's Task/Agent tool —
agent invocation only happens in the client. Every Harness OS tool that would
otherwise "invoke" an ECC agent or skill instead validates state and returns
a structured directive (`directives.ts`). Claude Code is solely responsible
for reading the directive and invoking the agent/skill; the outcome is
recorded via `record_decision` once Claude Code reports back. A tool
implementation that calls out to an agent directly is a constitution
violation, not just a bug.

## CONST-AI-003 — Self-reported test results are not evidence
- severity: high
- enforcement: review
- domain: ai-agent-boundaries

Claude must not treat its own narrative claim of "tests are RED" or "tests
are GREEN" as fact, and must not write a `decisions` row asserting either
directly. Only `gate-check --mode verify-red/verify-green`'s own observed
process exit code is authoritative (see CONST-CORE-002).
