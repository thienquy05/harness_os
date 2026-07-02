# Constitution — AI Output Standard

> Extends `core.md`. See `core.md` for the rule format and the full index.

## CONST-AI-001 — Plan Mode steps must be concrete
- severity: high
- enforcement: review
- domain: ai-output-standard

In Plan Mode, every step must enumerate the exact file(s) or directory
path(s) to be created or edited. Vague steps ("update the config", "add
validation") are non-compliant. Applies globally, in every project the
harness touches, not per-session.
