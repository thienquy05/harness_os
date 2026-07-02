-- Seed data mirroring constitution/*.md as of VERSION 1.0.0.
-- Source of truth for rule *text* is the markdown in constitution/ (read by
-- humans and by Claude directly); this file is what get_constitution actually
-- queries. Kept in sync by hand in v1 — see docs/ for the known follow-up of
-- generating this file from the markdown instead of duplicating content.
BEGIN;

INSERT INTO constitution_versions (version, description)
VALUES ('1.0.0', 'Initial constitution: core, security, architecture, coding-standards, ai-agent-boundaries, ai-output-standard.');

WITH v AS (SELECT id FROM constitution_versions WHERE version = '1.0.0')
INSERT INTO constitution_rules (rule_id, version_id, domain, text, severity, enforcement)
SELECT rule_id, v.id, domain, text, severity, enforcement
FROM v, (VALUES
    ('CONST-CORE-001', 'core', 'No implementation code may be written to a path matching a project''s gatedGlobs without a validated spec covering it. Enforced by enforce-gate.sh + gate-check at write time, not by review after the fact.', 'critical', 'gate'),
    ('CONST-CORE-002', 'core', 'No implementation file may be written until its corresponding test has been independently observed RED (non-zero exit, executed by gate-check --mode verify-red, not self-reported) - and the change is not considered complete until GREEN is subsequently observed the same way.', 'critical', 'gate'),
    ('CONST-CORE-003', 'core', 'When a spec is superseded, dependent code must be regenerated and re-verified against the new version, not patched around a stale assumption. Traceability edges referencing a superseded spec version are marked stale until re-verified.', 'high', 'review'),
    ('CONST-CORE-004', 'core', 'harness.config.json, enforce-gate.sh, and settings.json are checksummed at harness init. Any drift between the on-disk files and the last-verified hash fails every gated write closed, regardless of spec/test state, until a human runs harness reconcile-config.', 'critical', 'gate'),
    ('CONST-SEC-001', 'security', 'No API keys, passwords, tokens, or other secrets in source code. Use environment variables or a secret manager, validated present at startup.', 'critical', 'review'),
    ('CONST-SEC-002', 'security', 'Browser/client-side code must never call an LLM or other third-party API directly with a credential. Proxy such calls through a server-side endpoint that holds the credential.', 'critical', 'review'),
    ('CONST-SEC-003', 'security', 'Full application state, credentials, or session tokens must never be attached to window.* or any other client-global object reachable by third-party scripts or a compromised dependency.', 'critical', 'review'),
    ('CONST-SEC-004', 'security', 'Authentication must not rely solely on client-side storage (e.g. localStorage tokens checked only in the browser). Use httpOnly cookies or an equivalent flow where the server verifies the session on every request.', 'critical', 'review'),
    ('CONST-SEC-005', 'security', 'All user input is validated at the system boundary. Database queries are parameterized; never string-concatenated.', 'high', 'review'),
    ('CONST-ARCH-001', 'architecture', 'Financial, trading, or payment-moving logic is automatically classified Critical risk by assess_risk and requires human-ack (harness approve) before it can be considered gated-complete, regardless of how it was otherwise scoped.', 'high', 'review'),
    ('CONST-ARCH-002', 'architecture', 'Prefer composition and existing, battle-tested libraries or patterns (repository pattern, standard API response envelopes) over new bespoke infrastructure.', 'medium', 'review'),
    ('CONST-ARCH-003', 'architecture', 'Target 200-400 lines per file, 800 hard cap. Extract modules rather than growing a file indefinitely.', 'medium', 'review'),
    ('CONST-CODE-001', 'coding-standards', 'Never mutate objects or arrays in place; return new copies with the change applied.', 'medium', 'review'),
    ('CONST-CODE-002', 'coding-standards', 'No more than 4 levels of nesting; prefer early returns over stacked conditionals.', 'medium', 'review'),
    ('CONST-CODE-003', 'coding-standards', 'Named constants for meaningful thresholds, delays, and limits - not inline literals.', 'low', 'review'),
    ('CONST-AI-001', 'ai-output-standard', 'In Plan Mode, every step must enumerate the exact file(s) or directory path(s) to be created or edited. Vague steps ("update the config", "add validation") are non-compliant. Applies globally, in every project the harness touches, not per-session.', 'high', 'review'),
    ('CONST-AI-002', 'ai-agent-boundaries', 'A containerized Harness OS tool cannot spawn Claude Code''s Task/Agent tool. Every tool that would otherwise invoke an ECC agent or skill instead validates state and returns a structured directive; Claude Code is solely responsible for reading it and invoking the agent, with the outcome recorded via record_decision.', 'critical', 'gate'),
    ('CONST-AI-003', 'ai-agent-boundaries', 'Claude must not treat its own narrative claim of "tests are RED" or "tests are GREEN" as fact, and must not write a decisions row asserting either directly. Only gate-check''s own observed process exit code is authoritative.', 'high', 'review')
) AS rules(rule_id, domain, text, severity, enforcement);

COMMIT;
