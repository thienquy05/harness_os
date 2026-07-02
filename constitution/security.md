# Constitution — Security

> Extends `core.md`. See `core.md` for the rule format and the full index.

## CONST-SEC-001 — No hardcoded secrets
- severity: critical
- enforcement: review
- domain: security

No API keys, passwords, tokens, or other secrets in source code. Use
environment variables or a secret manager, validated present at startup.

## CONST-SEC-002 — No third-party/LLM API calls from client code
- severity: critical
- enforcement: review
- domain: security

Browser/client-side code must never call an LLM or other third-party API
directly with a credential. Proxy such calls through a server-side endpoint
that holds the credential.

## CONST-SEC-003 — No application state on client globals
- severity: critical
- enforcement: review
- domain: security

Full application state, credentials, or session tokens must never be
attached to `window.*` or any other client-global object reachable by
third-party scripts or a compromised dependency.

## CONST-SEC-004 — Auth must be server-verified
- severity: critical
- enforcement: review
- domain: security

Authentication must not rely solely on client-side storage (e.g.
`localStorage` tokens checked only in the browser). Use httpOnly cookies or
an equivalent flow where the server verifies the session on every request.

## CONST-SEC-005 — Validate at the boundary
- severity: high
- enforcement: review
- domain: security

All user input is validated at the system boundary. Database queries are
parameterized; never string-concatenated.
