# Harness OS

A **governance layer for Claude Code**. It sits between Claude Code and the projects it works on, and makes the AI follow a process: **spec first → risk assessed → test fails (RED) → code written → test passes (GREEN) → reviewed → logged**. It does this with real blocking, not just reminders.

> Status: Phases 1–3 are built and tested. Phase 4 (retrofitting the first real project, "ApexTrade") has not started. This is a solo-developer, Docker-based tool; it is not a hosted service.

---

## 1. The idea in 60 seconds

An MCP server is passive: Claude only uses it if Claude decides to call it. A rule like "write tests first" in a prompt can be ignored. Harness OS adds four things so the rules actually stick:

| Piece | What it does |
|---|---|
| **MCP server** (`server/`) | Gives Claude 14 governance tools: look up rules, register specs, assess risk, log decisions, run workflows. Every tool *tells* Claude what to do next (a "directive"). It never runs agents itself. |
| **Hooks in each governed project** (`scaffold/.claude/hooks/`) | Run before every `Edit`, `Write` and `Bash` call. If the gate isn't satisfied, the hook exits with code 2 and Claude Code **blocks the action**. The block message is JSON telling Claude how to fix it. |
| **Postgres database** (`db/`) | The single source of truth: constitution, specs, risk assessments, an append-only decision log, test runs, traceability links, workflow state, config checksums. |
| **Human-only CLI** (`bin/harness`) | `init`, `approve`, `reconcile-config`. They require a real terminal (TTY), so Claude's `Bash` tool cannot run them on its own behalf. |

**Core principle:** evidence is *observed*, never self-reported. When Claude says "the test is red", nobody believes it. The hook runs the test command itself on the host and records the real exit code (CONST-AI-003).

---

## 2. How a governed write works

```
Claude tries to Write src/orders.ts
        │
        ▼
PreToolUse hook  (.claude/hooks/enforce-gate.sh)
        │  docker exec harness_gate_daemon gate-check ...
        ▼
gate-check, in order:
  1. Is the project initialized (`harness init` ran)?      no → block: run_harness_init
  2. Do config checksums still match?                       no → block: reconcile_config   (CONST-CORE-004)
  3. Is the file in `gatedGlobs`?                           no → allow
  4. Is the latest recorded test run RED?                   no → block: establish_red_phase
        │
        ▼
allow  →  write happens
        │
        ▼
PostToolUse hook on Bash (post-bash-revert.sh)
   backstop: if a Bash command changed a tracked config file behind the gate's back,
   `git checkout` reverts it and a CRITICAL decision is logged.
```

Notes:
- When Claude runs a command matching your `testCommands`, `enforce-gate.sh` **runs it first itself** (120 s timeout) and records red/green in `test_runs`. Claude's own run then proceeds normally.
- Every hook failure is **fail-closed**: a crash in the hook blocks the write rather than allowing it.
- Config tampering is detected, not prevented: `harness.config.json`, `enforce-gate.sh` and `settings.json` are SHA-256 checksummed at init. If they drift, *all* gated writes are blocked until a human runs `harness reconcile-config`.

---

## 3. What's in the box

### Repo layout

```
harness_os/
├── packages/core/    Shared logic (TypeScript). Gates, risk, specs, audit log, workflows,
│                     config integrity, stack detection. MCP tools and CLI both call this,
│                     so rules are defined once.
├── server/           MCP server (stdio). One file per tool in server/src/tools/.
│                     Also the Dockerfile and entrypoint that dispatch all modes.
├── cli/              Node CLIs: gate-check, gate-daemon, harness-init, approve,
│                     reconcile-config, log-revert.
├── bin/harness       Bash wrapper for the human-facing commands (init / approve / reconcile-config).
├── scaffold/.claude/ Template stamped into every governed project (hooks, settings, config).
├── constitution/     The rules, as markdown (core, security, architecture, coding-standards, AI).
├── risk/rubric.md    The deterministic risk classifier, documented.
├── workflows/        Documentation of the 3 workflows (new-feature, security-change, hotfix).
├── specs/schema/     JSON Schemas for the 5 spec types.
├── templates/        Example spec for each type.
├── db/               docker-compose.yml, SQL migrations (init/), constitution seed (seed/).
├── plan/             IMPLEMENTATION_PLAN.md (full design + decision log), PRD template, diagrams.
└── RUNBOOK.md        "What do I actually type" cheat sheet.
```

### Stack
TypeScript (ESM, Node 22) · npm workspaces · `@modelcontextprotocol/sdk` · Postgres 16 · Docker / docker-compose · Vitest (+ testcontainers for real-Postgres tests) · AJV (spec validation) · minimatch (glob matching) · zod (tool input).

### Docker containers

| Container | Lifetime | Role |
|---|---|---|
| `harness_postgres` | persistent | The database. No host port exposed; only reachable on the `harness_os_default` network. |
| `harness_gate_daemon` | persistent | Answers hook `gate-check` calls via `docker exec`. Mounts `$HARNESS_PROJECTS_ROOT` **read-only** at `/workspaces`. |
| `harness-os:latest` (`mcp-serve`) | one per Claude Code session | The MCP server over stdio (`docker run --rm -i`). |

All three use the same image; the first argument picks the mode: `mcp-serve | gate-daemon | gate-check | approve | reconcile-config | log-revert | harness-init`.

### MCP tools (what Claude can call)

| Group | Tool | Purpose |
|---|---|---|
| Constitution | `get_constitution` | Versioned rules (severity + `gate`/`review` tag), merged with project overrides in `<project>/.claude/constitution/*.md`. |
| | `evaluate_governance` | Before starting: applicable rules + risk assessment. Informational. |
| Risk | `assess_risk` | Classifies `critical/high/medium/low` and returns required gates. |
| Audit | `record_decision` | Append-only log entry. Cannot be used to claim RED/GREEN. |
| | `audit_report` | Full decision history for a project. |
| Specs | `create_spec` | Register a spec; rejects schema-invalid content; supersedes the prior version atomically. |
| | `validate_spec` | Validate without writing. |
| | `impact_analysis` | What other specs depend on this one (transitively). |
| Tests/QA | `generate_tests` | Directive to write tests for a spec, including enumerated state-machine transitions. |
| | `validate_coverage` | Checks reported coverage against 80% (or an override). **Trusts the reported number.** |
| | `request_review` | Maps risk level → which reviewer agent must run. |
| Traceability | `trace_artifact` | Records edges (rule→spec→test→commit→review…). Edges go stale when a spec is superseded. |
| Workflows | `run_workflow` | Start `new-feature`, `security-change` or `hotfix`; returns only the first stage. |
| | `workflow_status` | Re-checks real evidence and advances (or repeats the directive). |

---

## 4. Concepts you need

**Constitution** (`constitution/*.md`, version in `constitution/VERSION`). 18 rules. Each has an ID, severity and an `enforcement` tag:
- `gate` — mechanically checkable, blocks writes (e.g. CONST-CORE-001 spec before code, -002 RED before GREEN, -004 config integrity, CONST-AI-002).
- `review` — needs judgment, so it's caught by routing to a reviewer agent, not pre-write (e.g. no hardcoded secrets, no LLM keys in client code, auth verified server-side, financial logic is auto-critical).

**Risk levels** (`risk/rubric.md`, rule-based, no LLM, first match wins):

| Level | Triggered by | Needs |
|---|---|---|
| critical | keywords like `trading, order, payment, wallet, ledger, funds, withdraw, deposit` | spec, RED→GREEN, security review, **human approval** |
| high | `auth, password, token, session, credential, crypto, secret, pii` | spec, RED→GREEN, security review |
| medium | touches a `gatedGlobs` path | spec, RED→GREEN, code review |
| low | docs / non-gated | nothing extra |

Levels only escalate; nothing auto-lowers them.

**Specs.** Five types — `product, domain, api, data, infra` — each with a JSON Schema in `specs/schema/` and an example in `templates/`. Each spec has a stable ID (e.g. `APX-API-001`), a version, and a status (`draft → active → superseded/deprecated`); only one version can be `active`. Domain specs may declare state machines, which `generate_tests` turns into test cases.

**Human approval for critical changes.** Claude records a decision with `status: pending_approval`; the gate stays shut. A human runs `bin/harness approve <decision-id>` in a real terminal.

**Workflows** (details in `workflows/*.md`; the code in `packages/core/src/workflow-definitions.ts` is authoritative):

| Workflow | Stages |
|---|---|
| `new-feature` | spec → risk → tests (observed RED) → implement → review → finalize → trace |
| `security-change` | security_review → risk (must be ≥ high) → human approval → implement → finalize |
| `hotfix` | risk → human approval → implement → finalize (retroactive audit note) |

A stage advances only when the server sees evidence (an active spec, a recorded red test run, an approved decision…). The `implement` and `finalize` stages are self-reported decisions, because nothing else can prove them.

**Directives.** The universal "next step" envelope, e.g. `{ "action": "establish_red_phase", "reason": "..." }`. Tools return them and hooks print them to stderr so Claude can self-correct. Defined in `packages/core/src/directives.ts`.

**Per-project config** — `<project>/.claude/harness.config.json`:

```json
{
  "gatedGlobs":  ["src/**/*.ts", "src/**/*.tsx"],      // writes need an open gate
  "exemptGlobs": ["**/*.md", "**/*.lock", "**/*.json"], // never gated (checked first)
  "testGlobs":   ["**/*.test.ts", "**/*.spec.ts"],      // always writable (tests must exist to go RED)
  "testCommands": [                                     // first matching entry is used
    { "globs": ["**/*.py"],            "command": "pytest" },
    { "globs": ["**/*.ts","**/*.tsx"], "command": "npm test" }
  ]
}
```
Precedence: `exempt` > `test` > `gated` > `ungated`.

---

## 5. Getting started

Prerequisites: Docker, Node 22 + npm (for development only), Claude Code, and your projects living under one folder (default `~/projects`).

```bash
# 1. Build the image (context must be the repo root)
docker build -f server/Dockerfile -t harness-os:latest .

# 2. Start Postgres + the gate daemon
cd db && HARNESS_PROJECTS_ROOT=$HOME/projects docker compose up -d
```

3. **Register the MCP server once** in `~/.claude.json` (see `RUNBOOK.md` for the full snippet). It runs `docker run --rm -i --network harness_os_default ... harness-os:latest mcp-serve` with `DATABASE_URL` set and the `constitution/` and `specs/` folders mounted read-only.

4. **Optionally** put `bin/harness` on your `PATH`.

5. **Onboard each project** (interactive, from a real terminal):
   ```bash
   bin/harness init ~/projects/my-app [--prefix MYAPP]
   ```
   This detects the stack, writes `.claude/{hooks,settings.json,harness.config.json,agents/AGENTS.md}`, runs `git init` if needed, commits, and records the trust baseline. Then just open the project in Claude Code.

> ⚠️ `RUNBOOK.md` and `.claude/settings.local.json` contain the author's machine paths (`/home/lehoa/projects/...`). Replace them with your own.

### Day-to-day commands

| Situation | Command |
|---|---|
| Critical change is `pending_approval` | `bin/harness approve <decision-id>` |
| You intentionally edited `harness.config.json`, `enforce-gate.sh` or `settings.json` and everything is blocked | `bin/harness reconcile-config <project>` |
| Find a decision id | `audit_report` tool, or `SELECT id, rationale FROM decisions WHERE status='pending_approval';` |
| Check infra is up | `docker ps --format '{{.Names}}\t{{.Status}}' \| grep harness_` |

`bin/harness` env overrides: `HARNESS_NETWORK`, `HARNESS_IMAGE`, `HARNESS_DATABASE_URL`, `HARNESS_DAEMON_NAME`.

---

## 6. What to expect (and what not to)

**Expect:**
- Gated writes get **blocked** until a RED test run has been recorded. Claude sees the directive and will normally write/run a test first.
- Sessions start with a warning if `harness_postgres` isn't running; gated writes then fail closed.
- Every block, approval and decision is in the append-only `decisions` table. The DB role has no `UPDATE`/`DELETE` grant on it.
- Occasional false-positive blocks on `Bash` commands. This is intentional (false negatives are worse).

**Known limits (documented in `plan/IMPLEMENTATION_PLAN.md` §11–12):**
- **RED gate is project-wide**, not per file: any recent failing test opens the gate for any gated write (Open Item #14).
- **Bash write detection is a heuristic** (`>`, `>>`, `sed -i`, `tee`). The git-based revert backstop currently only covers the three tracked config files, not all source (Open Item #8).
- **Self-reported stages**: workflow `implement`/`finalize` and `validate_coverage`'s percentage are trusted (Open Item #15).
- **Projects must live under `$HARNESS_PROJECTS_ROOT`**; the daemon can't see anywhere else (Open Item #11).
- Start Claude Code from the **project root**; from a subdirectory the project looks uninitialized (fails closed, Open Item #17).
- "Limited approval" for `hotfix` is the same mechanism as full approval; nothing narrows its scope.
- Default DB credentials in `docker-compose.yml` are for local use only. The DB has no host port, but change them if you expose it.
- Hook enforcement needs Docker running on the host, and Claude Code's `Bash` access to `docker exec`.

---

## 7. How to change things

| I want to… | Edit | Then |
|---|---|---|
| Change which files are gated/exempt, or the test command | `<project>/.claude/harness.config.json` | `bin/harness reconcile-config <project>` |
| Add or change a constitution rule | `constitution/<file>.md` **and** `db/seed/seed_constitution_v1.sql` (kept in sync by hand), bump `constitution/VERSION` | Recreate the DB volume (init scripts only run on an empty data dir) |
| Change risk keywords or levels | `packages/core/src/risk.ts` and `risk/rubric.md` | Rebuild image |
| Add/modify a spec type | `specs/schema/<type>.schema.json` + `templates/<type>.example.json` | Rebuild image (schemas are baked in) |
| Change a workflow's stages | `packages/core/src/workflow-definitions.ts` (+ `workflows/*.md`) | Rebuild image |
| Add an MCP tool | New file in `server/src/tools/`, register it in `server/src/index.ts`, add logic in `packages/core` | Rebuild image, restart Claude Code session |
| Change what a gate checks | `packages/core/src/gates.ts` (shared by hook and MCP) | Rebuild image, **recreate** `harness_gate_daemon` |
| Change the hook behavior for all new projects | `scaffold/.claude/hooks/*` | Rebuild image; existing projects need `reconcile-config` (and a manual copy) |
| Change the stack → reviewer mapping `init` stamps | `packages/core/src/stack-detection.ts` | Rebuild image |
| Add a DB table | New numbered file in `db/init/` | Fresh DB volume (no migration tool yet) |

Rule of thumb: **logic goes in `packages/core`**; tools and CLIs should stay thin wrappers. After any change to `packages/core`, `server`, `cli`, `scaffold` or `specs`, **rebuild the Docker image** — the containers run the baked copy, not your working tree.

### Development

```bash
npm install
npm run build          # tsc --build for all workspaces
npm run lint           # type-check (tsc --build)
npm test               # vitest; integration tests need Docker (testcontainers → real Postgres 16)
npm run test:coverage  # 80% coverage is the project's bar
```

Tests are colocated as `*.test.ts` in `packages/core/src` and `cli/src`; tool tests are in `server/tests/unit`.

---

## 8. Where to read more

- `RUNBOOK.md` — copy-paste operations.
- `plan/IMPLEMENTATION_PLAN.md` — full design (§2 enforcement architecture, §6 workflows, §11 open items, §12 what was built and which real bugs were found).
- `constitution/core.md` — rule format and the index of all rules.
- `risk/rubric.md`, `workflows/*.md` — classifier and workflow behavior.
