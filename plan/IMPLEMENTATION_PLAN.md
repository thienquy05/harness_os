# Harness OS — Implementation Plan

Status: **Phase 1 implemented, tested, and verified end-to-end against real Docker containers.** See §12 for the full progress log and as-built design decisions. Phases 2–4 not yet started.
Repo: `~/projects/harness-os/` (git repository, branch `main`)
Author context: solo developer, WSL2 + Docker, ECC already installed, Claude Code + MCP.

This Harness OS build is a **standalone, fresh MCP server**, shipped as a **Docker container** — independent of any prior attempt or prior project configuration, and independent of any project it governs (including ApexTrade's own Docker stack).

---

## 0. Session Decisions (locked before this plan was written)

| # | Decision |
|---|----------|
| 1 | Retrofit portfolio: **ApexTrade only.** The other five named projects don't exist on this machine — dropped, not deferred. |
| 2 | Pipeline diagram: the Constitution→Spec→Tests→Code image in `plan/` is used for the **artifact dependency chain** (§6); Plan→Implement→Review→**Feedback**(named **Compound**, §9) is kept as a separate process-loop axis. Reconcile terminology once the correct diagram is attached. |
| 3 | Full detail, all phases, one document. |
| 4 | MCP server ships as a **Docker container** (this session's addition — see §2). |
| 5 | Enforcement hardened against self-disablement: config-integrity fail-closed check, `Bash`-tool gating + revert backstop, explicit hard-gate/soft-gate split, TTY-required human-ack, `testCommands` map, and domain-schema state-machine support added this session — see §2.1, §3.5a, §4, §5.2, §11. |

### 0.1 Ground truth

- `ApexTrade/prd/` now contains a complete, implementation-ready spec: `ApexTrade_Final_PRD.md` (27 sections: tech stack, backend design, 22-agent hierarchy, DB schema, security remediation, Docker architecture, CI/CD, milestones) plus `ApexTrade.zip` (existing React frontend prototype — screens, JSX, `screenshots/`). This is real, current, authoritative content for ApexTrade and is cited precisely where relevant (§8, §11) — not transcribed wholesale.
- Docker is installed, daemon reachable, no containers currently running, no local images.

---

## 1. Phase 0 — Discovery & Dedup Audit

### 1.1 ECC overlap table

| Capability | Status | Notes |
|---|---|---|
| Constitution Engine | Partially covered | ECC's `rules/ecc/common/` layering pattern exists as prose Claude reads. Missing: queryable, MCP-exposed, versioned, machine-enforced. Reuse the layering convention; build enforcement net-new. |
| Specification Registry | Net-new | `plan-prd`/`prp-prd`/`prp-plan` generate spec *content*; none assign persistent IDs, store dependency edges, or support impact analysis. Harness OS calls these skills to produce content, then registers it. |
| Risk Engine | Net-new | ECC's severity vocabulary (CRITICAL/HIGH/MEDIUM/LOW) is post-hoc, for review findings. No pre-implementation classifier exists. Reuse the vocabulary; build the classifier net-new. |
| TDD RED-phase enforcement | Covered, invoke don't rebuild | `tdd-guide` + `tdd-workflow`/`verification-loop` already do this. Harness OS's `generate_tests` doesn't reimplement it — it returns a directive and logs the outcome (see §2.1's enforce/execute boundary). |
| Review routing by risk | Covered, invoke don't rebuild | `code-reviewer`/`security-reviewer`/`architect`/stack reviewers already exist. `request_review` is a thin router. |
| Decision & Audit Log | Net-new | `recursive-decision-ledger` is recursive rollout/search reasoning, not an append-only governance log. No ECC equivalent. |
| Traceability Graph | Net-new | No ECC equivalent. |
| Workflow Engine | Substantially covered, wrap don't rebuild | `orch-add-feature`/`orch-build-mvp`/`orch-change-feature`/`orch-fix-defect`/`orch-refine-code` already orchestrate research→plan→TDD→review→gated commit. `run_workflow` gates and delegates; it does not re-implement orchestration. |
| Per-Project Scaffold | Substantially covered, extend don't rebuild | `project-init` already does stack detection + dry-run onboarding. `harness init` calls it first, then stamps the extra governance layer. |
| Portfolio audit tooling | Different purpose | `/harness-audit` scores the Claude Code harness setup itself (12 fixed categories), not application code. Used in Pass 3 (Equip), not Pass 1. |
| MCP server patterns | Covered, use as reference | `mcp-server-patterns` skill — basis for §2's stack choice. |
| Postgres patterns | Covered, use as reference | `postgres-patterns` skill + `database-reviewer` agent — used in §4/§5 schema review. |
| Multi-agent OS scaffolding | Adjacent, not overlapping | `agentic-os` builds agent runtimes; Harness OS governs an existing one (Claude Code). Different problem. |
| `/agent-sort` | Stale reference | On disk, not in the active skill registry this session. Manual mapping used instead (§1.3). |

**Bottom line:** Harness OS owns Constitution, Risk, Spec Registry, Decision/Audit Log, Traceability, and thin gate/route wrappers. ECC executes; Harness OS enforces and records.

### 1.2 Project portfolio

| Project | Status | Relevance |
|---|---|---|
| `ApexTrade` | Full PRD + UI prototype, no backend code yet | Sole Phase 4 retrofit target |
| `everything-claude-code` | ECC source, not a consumer project | Invoked, not retrofitted |
| `harness-os` | This repo | The governance layer |

### 1.3 SKILLS.md / AGENTS.md — draft for approval

**Draft `SKILLS.md`:**
- `harness-spec-authoring` — house style for specs against §4's schemas.
- `multi-agent-audit-trail` — immutable, evidence-tracked logging across independent agents (ApexTrade's own 22-agent hierarchy needs this; its PRD already designs an `audit_log` table independently — see §9).
- `frontend-secret-boundary-check` — a lightweight check that no LLM/API keys or full application state ever reach `window.*` or client bundles — directly motivated by ApexTrade's own documented CRITICAL-01/02 findings (§9).

**Draft `AGENTS.md`** (stack now confirmed by ApexTrade's Final PRD):
- `python-reviewer`, `fastapi-reviewer`, `security-reviewer` — ApexTrade backend (FastAPI, Python 3.12).
- `react-reviewer` — ApexTrade frontend (React 18.3 + Vite, per its migration plan).
- `database-reviewer` — Postgres 16 + TimescaleDB schema, both ApexTrade's and Harness OS's own.
- `typescript-reviewer`, `code-reviewer` — the harness-os server itself.
- `tdd-guide`, `code-reviewer`, `architect` — cross-cutting, invoked by the gates.

⛔ **Checkpoint: confirm or edit before Phase 0 file generation.**

### 1.4 External concepts captured

**Compound Engineering** (`every.to/guides/compound-engineering` + `github.com/EveryInc/compound-engineering-plugin`, fetched successfully):

| Concept | Where it lands |
|---|---|
| Brainstorm→Plan→Work→Simplify→Review→**Compound** loop, feeding the next Brainstorm | §9's Workflow Engine names stage 4 **Compound**: a write to the Decision/Audit Log + a traceability edge, queryable by the next `run_workflow` call. |
| "Extract taste into systems" | Already the Constitution Engine's job — confirms the design. |
| Plan-first, plans as source of truth for agents | Matches Spec Registry as single source of truth (§4); `create_spec`/`validate_spec` gate `run_workflow`'s Work stage. |
| P1/P2/P3 parallel review | Matches ECC's existing CRITICAL/HIGH/MEDIUM/LOW — externally validated, no new taxonomy. |
| "Safety nets, not review gates" | Informs §5: gates are automated checks, not manual chokepoints, except Critical risk (human-ack, §8/§9). |
| Git-native storage, no DB | Deliberate divergence — you want a queryable Postgres governance log across projects; their design optimizes for portability across CLIs instead. |

**Reddit post:** unfetchable — Claude Code's web-fetch tool cannot reach `reddit.com`/`old.reddit.com` (tool-level restriction). Paste the body if you want it mapped.

---

## 2. MCP Server Architecture — Docker Container, Stack, and Enforcement

### 2.1 The core design gap this section fixes: enforcement, not just an API

An MCP server is **passive** — it only runs when Claude Code chooses to call a tool. Nothing about "the server exists" makes Claude call `evaluate_governance` before writing code, or blocks a `Write` when no spec/tests exist. The pipeline image says "automated enforcement boundary... before code is accepted" — that requires an actual blocking mechanism, not just an available tool. Four components make this real — the last two added specifically to close the "the enforcer can be disabled by the thing it enforces" gap:

1. **A `PreToolUse` hook on `Edit|Write|Bash`**, shipped in the scaffold (`scaffold/.claude/hooks/enforce-gate.sh`), that runs on every write attempt in a governed project — including shell-mediated writes (`cat > file`, `sed -i`, heredocs via `Bash`), not just the `Edit`/`Write` tools. For `Edit|Write` the target path is exact; for `Bash` the hook applies a conservative heuristic (parses redirect targets / `sed -i` / `tee` arguments against `gatedGlobs`) and blocks anything it can't confidently classify as safe — false positives (blocking a legitimate non-code `Bash` write) are an acceptable cost, false negatives are not, since component 4 below is the backstop for whatever this misses. It exits non-zero — blocking the action, with a message — when the required gate for that risk level hasn't passed (e.g., no validated spec, tests not confirmed RED-then-GREEN).
2. **A `gate-check` CLI surface**, not just MCP tools. Hooks are shell commands; they cannot make MCP tool calls. `harness gate-check --project <path> --tool <name> --file <path>` queries the same Postgres state the MCP tools use and returns pass/fail. Both the MCP tools and the CLI share one core logic module so gate rules are defined once (§2.4).
3. **A config integrity check, so the enforcement layer can't disable itself.** Nothing stops Claude Code from directly editing `enforce-gate.sh` or `.claude/settings.json` — they have to stay writable, since legitimate config changes are normal, and trying to block edits to them is unenforceable anyway (same Bash-bypass problem, one level up). Instead of blocking the edit, `gate-daemon` fails closed on drift: at `harness init`, `harness.config.json` + `enforce-gate.sh` + `settings.json` are SHA-256 hashed and stored in `config_checksums` (§3.5a) as `verified`. On **every** `gate-check` call — not only when those files are touched — the daemon recomputes the hashes from the current on-disk files (read via the project's read-only mount) and compares. Mismatch → every gated write is denied, regardless of spec/test state, and a CRITICAL decision row is written automatically. The only way out is `harness reconcile-config --project <path>` (§3.5a), a CLI command run outside any Claude Code session.
4. **A `PostToolUse` hook on `Bash`** (`scaffold/.claude/hooks/post-bash-revert.sh`), the reactive backstop for whatever component 1's heuristic misses: after every `Bash` call it diffs the working tree (`git status --porcelain`, scoped to `gatedGlobs`) against the last known-good commit. If a gated file changed with no open gate covering it, the hook reverts that file (`git checkout --`) immediately and logs a CRITICAL decision. This makes "the governed project is a git repo" a `harness init` precondition (noted in §7).

**RED/GREEN must be observed, not asserted.** A version where Claude calls `record_decision` to *self-report* "tests are RED" is not enforcement — a model that skips or misreports it leaves no real barrier, even though the hook technically "checks" something. So `gate-check` itself executes the project's test command and reads the exit code:
- `gate-check --mode verify-red --spec <id> --test-path <path>` runs the project's configured test command (see `harness.config.json`, §2.4) scoped to the new test file, requires a **non-zero exit**, and only then writes the `decisions` row itself — Claude never writes this row directly.
- `gate-check --mode verify-green` reruns the same command after implementation and requires a **zero exit** before `request_review`'s gate opens.
- Both writes are hashed against the test file's content at observation time, so a later silent edit to weaken the test doesn't retroactively count as still-confirmed.

**Path scoping, so the hook is usable rather than either off or infuriating.** Every governed project gets a `harness.config.json` (stamped by `harness init`, §7) declaring:
- `gatedGlobs` — source paths that require an open gate before `Write`/`Edit`/`Bash`-write succeeds (e.g. `backend/app/**/*.py`, `frontend/js/**/*.jsx` for ApexTrade)
- `exemptGlobs` — never risk/spec-gated (docs, `*.md`, lockfiles). **Not** the same as untracked — `.claude/**` is writable but every write to it is covered by component 3 above, not silently ignored.
- `testGlobs` — matched paths are always writable (a test file must be creatable before it can go RED) but are the *only* thing `verify-red` will accept as the origin of a RED result
- `testCommands` — an array of `{ globs: string[], command: string }`, not a single string, since a project like ApexTrade needs `pytest` for `backend/**` and `vitest` for `frontend/**`. `gate-check` picks the first entry whose glob matches the test path it's verifying.

Without this, either every write is blocked (README edits included) until a spec exists — unusable — or the hook silently exempts everything — theater. `gates.ts` (§2.4) is the single place this scoping logic lives.

**Hard gates vs. soft gates, stated explicitly.** Components 1–4 above are deterministic and structural: they check whether a spec/test/checksum *exists and matches*, never whether code is *good*. Constitution rules that require judgment — "no LLM API keys called from browser code," "no full app state on `window.*`" — are **not** pre-write blockable by a rule-based gate; they're caught by `request_review`'s directive routing to `security-reviewer`/`code-reviewer` (post-write, §5), with the Critical-risk human-ack below as the backstop for anything a reviewer misses. Each rule in `constitution/*.md` carries an `enforcement: gate | review` tag so this distinction isn't left implicit per-rule.

**Human-ack, concretely.** A Critical-risk `record_decision` call is written with `status='pending_approval'`, not `'approved'` (schema, §3.5). `gate-check` treats a pending-approval decision the same as no decision — the gate stays shut. Approval only happens via `harness approve <decision_id>` (§3.5a), a CLI command that requires an interactive TTY (`isatty(stdin)` checked; refuses to run non-interactively) — Claude Code's `Bash` tool cannot self-approve its own Critical change, by construction, since tool-invoked shell commands aren't attached to a human's TTY.

**Enforce/execute boundary, stated explicitly:** a containerized server cannot spawn Claude Code's Task/Agent tool — agent invocation only happens in the client. Harness OS tools **never claim to invoke** `tdd-guide`/`security-reviewer`/`orch-*` skills directly. Instead they:
- Validate state (spec exists? risk assessed? tests RED-confirmed?)
- Return a **structured directive** (e.g., `{ action: "invoke_agent", agent: "security-reviewer", files: [...], reason: "risk=critical" }`)
- Record the outcome once Claude Code reports back (via `record_decision`)

Claude Code is the one that reads the directive and actually invokes the ECC agent/skill; the constitution (loaded into every session) is what makes Claude comply; the hook is what blocks if it doesn't. **Every hook failure is itself directive-shaped** — same JSON envelope as `directives.ts` (e.g. `{ action: "create_spec", reason: "no validated spec covers backend/app/orders.py", spec_type: "api" }`) written to stderr — so Claude can self-correct on its next turn instead of retrying blindly or stalling. This hook↔directive contract is documented in `docs/mcp-tool-reference.md`.

### 2.2 Container & transport decision

**Recommendation: stdio via `docker run --rm -i`, not a long-lived HTTP endpoint.** This matches standard local MCP server conventions, needs no exposed port or endpoint auth, and loses nothing on container exit because all state lives in a separate, persistent Postgres container. An HTTP transport (`{"type":"http","url":...}`) would only be justified for multiple concurrent clients sharing one always-on instance — not the case for a solo developer. Proceeding on this basis; flag if you want HTTP instead.

**Topology:**
```
harness_os_default (Docker bridge network, owned by this repo only —
                     explicitly NOT shared with apextrade_net or any
                     other governed project's network)
│
├── harness_postgres     (persistent, docker-compose, no host port
│                          exposed — reached only by containers on
│                          harness_os_default)
│
├── harness_gate_daemon  (persistent, docker-compose, same image as
│                          below, CMD=gate-daemon — long-lived process
│                          holding a warm DB connection pool; the hook
│                          reaches it via `docker exec harness_gate_daemon
│                          node cli/gate-check.js ...`, NOT `docker run`)
│
└── harness-os:latest    (ephemeral, `docker run --rm -i`, one process
     [mcp-serve mode]     per Claude Code session, stdio transport)
```

No host port mapping for `harness_postgres` — deliberately different from ApexTrade's own `docker-compose.yml` (which maps `5432:5432` on the host for local dev tooling). This avoids any port collision between the governance DB and a governed project's own DB, and keeps the governor fully decoupled from anything it governs.

**Why a persistent gate daemon, not `docker run --rm` per hook call:** `enforce-gate.sh` fires on every `Edit|Write` in a governed project — potentially many times per session. `docker run` has real cold-start cost (image layer setup + Node boot, several hundred ms to 1s+), and because `harness_postgres` deliberately has no host port, a host-native gate-check process can't reach it either. `docker exec` into an already-running container is fast (tens of ms) and keeps the no-host-port isolation intact. The MCP server itself (`mcp-serve` mode) stays ephemeral per session since it's only invoked when Claude explicitly calls a tool, not on every keystroke-adjacent file write — different call frequency, different tradeoff, hence two different lifecycles for the same image.

**Persistent memory, addressed explicitly (not silently dropped):** your original brief called for two Postgres containers — decision/audit log and persistent memory. This plan builds only one (`harness_postgres`, for constitution/specs/risk/decisions/traceability). Persistent memory across sessions is already served by the existing `memory` MCP server (`@modelcontextprotocol/server-memory`, already registered and running) — no second Postgres container is built for it in v1. If that MCP's storage model proves insufficient later, revisit as a separate, explicit decision — not folded into this plan by default.

### 2.3 Volume mounts & the `project_path` contract

Tools that touch files (`validate_coverage`, `validate_spec`, `trace_artifact` for commit SHAs, `gate-check`) need filesystem access the container doesn't have by default. Every such tool call carries an explicit `project_path` argument, and the container mounts:
- `~/projects/harness-os/constitution|specs|risk|templates` → read-only, always mounted (the governance layer's own state)
- The **target project directory** (e.g. `~/projects/ApexTrade`) → read-only mount, path passed at invocation time via `-v "$PROJECT_PATH:/workspace:ro"`, not baked into the image

The container never needs write access to a governed project's files — it validates and records, it doesn't edit code (matching "generated code is disposable," §5).

### 2.4 Stack, shared core, and determinism

**Stack: TypeScript/Node**, per `mcp-server-patterns`. A light monorepo, not a single package, so gate logic is defined once and shared between the MCP tool surface and the CLI gate-check surface (§2.1):

```
harness-os/
├── package.json                              # npm workspaces: packages/*, server, cli
├── .gitignore
├── README.md
├── CLAUDE.md
├── plan/
│   ├── PRD_Template.md
│   ├── 47f6940e-98f8-4bb5-ad74-5760489864ca.jpg
│   └── IMPLEMENTATION_PLAN.md                 # this file
├── constitution/
│   ├── VERSION
│   ├── core.md
│   ├── security.md
│   ├── architecture.md
│   ├── coding-standards.md
│   ├── ai-agent-boundaries.md
│   └── ai-output-standard.md                  # CONST-AI-001, §3.2
├── specs/
│   ├── schema/{product,domain,api,data,infra}.schema.json
│   └── registry/.gitkeep
├── risk/
│   └── rubric.md
├── workflows/
│   ├── new-feature.md
│   ├── security-change.md
│   └── hotfix.md
├── templates/
│   ├── PRD.md
│   └── spec-{product,domain,api,data,infra}.md
├── db/
│   ├── docker-compose.yml                     # harness_postgres + harness_gate_daemon, no host port (§2.2)
│   ├── init/                                  # mounted to /docker-entrypoint-initdb.d/ (§2.5)
│   │   ├── 0001_constitution.sql
│   │   ├── 0002_specs.sql
│   │   ├── 0003_risk_assessments.sql
│   │   ├── 0004_decision_log.sql
│   │   ├── 0005_traceability.sql
│   │   ├── 0006_workflow_runs.sql
│   │   └── 0007_config_checksums.sql             # tamper-evidence for hook/config files (§2.1, §3.5a)
│   └── seed/seed_constitution_v1.sql
├── packages/
│   └── core/                                  # shared by server/ and cli/ — gate logic lives once
│       ├── package.json
│       └── src/
│           ├── db.ts                          # pg client, connection from env
│           ├── constitution.ts                # loader + validator (global + project override merge)
│           ├── risk.ts                         # classifier
│           ├── specs.ts                        # create/validate/impact-analysis
│           ├── gates.ts                        # THE gate-check logic: path scoping (gated/exempt/test
│           │                                    # globs) + verify-red/verify-green test execution (§2.1)
│           ├── directives.ts                  # structured directive builder (§2.1) — no agent invocation
│           ├── config-integrity.ts             # SHA-256 hash + compare for hook/config drift (§2.1)
│           └── audit.ts                        # append-only ledger writes
├── server/                                     # MCP surface (thin wrappers over packages/core)
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile                              # builds harness-os:latest, ENTRYPOINT dispatches on CMD
│   ├── src/
│   │   ├── index.ts                           # MCP entrypoint, stdio transport
│   │   ├── config.ts
│   │   └── tools/
│   │       ├── get-constitution.ts
│   │       ├── evaluate-governance.ts
│   │       ├── create-spec.ts
│   │       ├── validate-spec.ts
│   │       ├── impact-analysis.ts
│   │       ├── assess-risk.ts
│   │       ├── generate-tests.ts               # returns directive, does not write tests itself
│   │       ├── validate-coverage.ts
│   │       ├── request-review.ts               # returns directive, does not invoke agents itself
│   │       ├── record-decision.ts
│   │       ├── trace-artifact.ts
│   │       ├── audit-report.ts
│   │       ├── run-workflow.ts                 # returns directive sequence, does not orchestrate itself
│   │       └── workflow-status.ts
│   └── tests/
│       ├── unit/                               # per-tool, mocked db — dogfoods CONST-002 (§2.6)
│       └── integration/                        # real Postgres via testcontainers or docker-compose.test.yml
├── cli/                                        # gate-check (daemon + verify modes) + harness init, same image
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── gate-check.ts                       # modes: check | verify-red | verify-green | verify-config — wraps packages/core/gates.ts + config-integrity.ts
│       ├── gate-daemon.ts                      # long-lived entrypoint, CMD for harness_gate_daemon (§2.2)
│       ├── approve.ts                          # `harness approve <decision_id>` — TTY-required, human-only (§2.1, §3.5a)
│       ├── reconcile-config.ts                 # `harness reconcile-config` — re-hash after a deliberate config change, human-only (§2.1, §3.5a)
│       └── harness-init.ts                     # calls project-init detection, then stamps scaffold/
├── scaffold/
│   └── .claude/
│       ├── constitution/{security,architecture,coding-standards}.md
│       ├── specifications/.gitkeep
│       ├── templates/PRD.md
│       ├── tests/.gitkeep
│       ├── agents/.gitkeep
│       ├── workflows/.gitkeep
│       ├── harness.config.json                 # gatedGlobs / exemptGlobs / testGlobs / testCommands (map, §2.1)
│       ├── settings.json                       # wires the three hooks below
│       └── hooks/
│           ├── check-harness-infra.sh          # SessionStart: docker ps check (§2.7)
│           ├── enforce-gate.sh                 # PreToolUse Edit|Write|Bash: `docker exec harness_gate_daemon ... gate-check` (§2.1, §2.2)
│           └── post-bash-revert.sh             # PostToolUse Bash: diff+revert backstop for gated files (§2.1)
└── docs/
    ├── mcp-tool-reference.md
    ├── decision-log-schema.md
    └── constitution-vs-ecc-rules.md
```

**Determinism, stated explicitly:** v1's `assess_risk`, `validate_spec`, and `gates.ts` are **rule-based, not LLM-backed** — no Anthropic API key inside the container, fully deterministic given the same DB state and inputs. This keeps the container secret-free and its behavior reproducible/testable. If a future version wants LLM-assisted risk classification, that's an explicit, separately-reviewed addition — not v1.

### 2.5 Migration/schema bootstrap

`db/init/*.sql` mount directly to `/docker-entrypoint-initdb.d/` on first container start (same pattern ApexTrade's own PRD uses in its §21.2) — numeric filename prefixes already sort correctly, no extra migration-runner dependency needed for v1, since schema is created once at first boot. If the schema needs to evolve after initial deployment, add a proper migration tool (e.g. `node-pg-migrate`) at that point — explicitly out of scope for v1 to avoid a dependency with nothing yet to migrate.

### 2.6 Testing strategy for harness-os itself

The server that enforces TDD must itself be TDD'd — this is the plan's own credibility test, and your CLAUDE.md coverage rule applies here too:
- `server/tests/unit/` — one file per tool, Postgres mocked, run in CI on every change.
- `server/tests/integration/` — real Postgres (via `docker-compose.yml` test override or `testcontainers-node`), exercises `packages/core/gates.ts` against actual DB state.
- `packages/core` gets its own unit tests colocated (`packages/core/src/*.test.ts`) since it's the shared logic both surfaces depend on — this is the highest-value test target in the whole repo.
- 80%+ coverage enforced the same way ECC enforces it elsewhere (`--cov-fail-under` equivalent for Node: `vitest --coverage.thresholds.lines=80`).

### 2.7 Session precondition hook

`scaffold/.claude/hooks/check-harness-infra.sh`, wired as `SessionStart`: runs `docker ps --filter name=harness_postgres --filter status=running -q`, warns (does not block) if empty, since not every session touches gated work.

---

## 3. Phase 1 (ships first) — Constitution Engine + Risk Engine + Decision/Audit Log

### 3.1 Files — ALL DONE (§12 has the full log; ✅ = built, tested, and verified)

- ✅ `constitution/{VERSION,core.md,security.md,architecture.md,coding-standards.md,ai-agent-boundaries.md,ai-output-standard.md}` — each rule tagged `enforcement: gate | review`. 18 rules total.
- ✅ `risk/rubric.md`
- ✅ `db/init/{0001_constitution.sql,0003_risk_assessments.sql,0004_decision_log.sql,0007_config_checksums.sql}` — plus two files not in the original sketch, added during implementation: `0000_roles.sql` (least-privilege `harness_app` role, §12.2 decision 1) and `0008_run_seed.sh` (auto-applies `db/seed/` on first boot — see §12.2 decision 2 for why `db/seed/` isn't itself under `docker-entrypoint-initdb.d/`).
- ✅ `db/docker-compose.yml` — `harness_postgres` + `harness_gate_daemon`, both running.
- ✅ `packages/core/src/{db.ts,constitution.ts,risk.ts,audit.ts,gates.ts,directives.ts,config-integrity.ts}` — plus `project-path.ts`, not in the original file list (§12.2 decision 3: a real gap in how the persistent `harness_gate_daemon` sees governed-project files, caught and fixed during implementation, not a nice-to-have).
- ✅ `server/src/{index.ts,config.ts}`, `server/src/tools/{get-constitution.ts,evaluate-governance.ts,assess-risk.ts,record-decision.ts,audit-report.ts}`
- ✅ `server/Dockerfile` — see §12.2 decision 4 for the build-context change vs. the original sketch.
- ✅ `cli/src/{gate-check.ts,gate-daemon.ts,approve.ts,reconcile-config.ts}` (minimal version shipped: constitution + risk gates + config-integrity check; RED/GREEN test-execution modes land in Phase 2, §5) — plus `log-revert.ts`, added to give the PostToolUse revert backstop something to call for audit logging (§12.2 decision 5).
- ✅ `scaffold/.claude/{harness.config.json,hooks/check-harness-infra.sh,hooks/enforce-gate.sh,hooks/post-bash-revert.sh}` — plus `settings.json` (wires the three hooks) and `hooks/parse-tool-call.mjs` (shared JSON-payload + Bash-heuristic parsing, reused by both hook scripts rather than duplicated, §12.2 decision 6).

### 3.2 `constitution/ai-output-standard.md` — content spec
> In Plan Mode, every step must enumerate the exact file(s) or directory path(s) to be created or edited. Vague steps ("update the config", "add validation") are non-compliant. Applies globally, in every project the harness touches, not per-session.

Registered as `CONST-AI-001` in `core.md`'s rule table (`CONST-<DOMAIN>-NNN` scheme, defined fresh for this repo).

### 3.3 `db/init/0001_constitution.sql` — schema (as built)
- `constitution_versions(id, version, created_at, description)`
- `constitution_rules(id, rule_id UNIQUE, version_id FK, domain, text, severity, created_at, superseded_by, enforcement)` — `enforcement` added during implementation (not in the original sketch): CONST-CORE-002 and §2.1 both require it queryable per-rule, not just present in markdown prose.

### 3.4 `db/init/0003_risk_assessments.sql` — schema
- `risk_assessments(id, request_description, factors JSONB, level, rationale, required_gates TEXT[], created_at, project_path)` — built exactly as sketched.

### 3.5 `db/init/0004_decision_log.sql` — schema (as built)
- `decisions(id, actor, action, rationale, constitution_rules_applied TEXT[], risk_level, status, approvals JSONB, project_path, created_at, related_decision_id)` — **append-only enforced by Postgres role privileges (no UPDATE/DELETE grant), not application logic — verified empirically: a direct `UPDATE`/`DELETE` attempt as `harness_app` returns `permission denied for table decisions` (§12.1).** `status` is `'approved'` by default for non-Critical writes (the row is only ever inserted after `gate-check` itself observed a pass), `'pending_approval'` for Critical-risk writes, or `'rejected'` for a logged block (added a third status value during implementation — a blocked write is neither approved nor pending, it's a fact that got recorded). `related_decision_id` — added during implementation, not in the original column list — is what makes "approve is a new row referencing the original, not an UPDATE" (as this section already said) actually implementable: `harness approve` inserts a new row with `related_decision_id` pointing at the original; `gate-check`/`isDecisionApproved` treats the original as approved if either its own `status='approved'` or any row with `related_decision_id` = its id has `status='approved'`.

### 3.5a `db/init/0007_config_checksums.sql` — schema (as built)
- `config_checksums(id, project_path, file_path, sha256, verified_at, verified_by, superseded_by)` — one row per tracked file (`harness.config.json`, `enforce-gate.sh`, `settings.json`) per project, written once at `harness init` (Phase 3; stood in for during Phase 1 testing by `recordVerifiedConfig`, which is exactly the function `harness-init.ts` will call) and only ever superseded (never updated in place) by `harness reconcile-config`, which requires a human to review the diff and confirm interactively (same TTY requirement as `harness approve`). `gate-check` recomputes and compares hashes against the latest non-superseded row for each file on every call (§2.1, component 3); any mismatch fails every gated write closed until reconciled. **Note:** `superseded_by` is present in the schema but intentionally never written to by app code — populating it would require an `UPDATE` on the old row, which would undermine the append-only guarantee. "Which row is current" is derived as the most recent `(project_path, file_path)` row by `verified_at` instead (kept for manual forensic annotation only). Verified end-to-end in §12.1.

### 3.6 Last step of Phase 1: register the server — DONE, as-built

**As-built, differs from the original sketch above in two ways — see §12.2 for why:**
`docker build -f server/Dockerfile -t harness-os:latest .` (context is the repo root, not `server/` —
the image bundles `packages/core` and `cli/` too), `docker compose -f db/docker-compose.yml up -d`
(brings up both `harness_postgres` and `harness_gate_daemon`), then registered in `~/.claude.json`:
```json
"harness-os": {
  "type": "stdio",
  "command": "docker",
  "args": ["run", "--rm", "-i", "--network", "harness_os_default",
            "-v", "/home/lehoa/projects/harness-os/constitution:/gov/constitution:ro",
            "-v", "/home/lehoa/projects/harness-os/specs:/gov/specs:ro",
            "-e", "DATABASE_URL=postgres://harness_app:harness_app@harness_postgres:5432/harness_os",
            "harness-os:latest", "mcp-serve"]
}
```
Note the DB user: `harness_app`, not `harness`/`harness_admin` — the append-only guarantee on
`decisions`/`config_checksums` only holds if the role the server actually connects as has no
UPDATE/DELETE grant (§12.2, decision 1). Verified working via a real `docker run` + manual MCP
JSON-RPC exchange (`initialize` → `tools/list` → `tools/call get_constitution`) — see §12.1.

**Gates activated after Phase 1:** `evaluate_governance` classifies risk and checks constitution rules before code is written; `enforce-gate.sh` blocks writes (including Bash-mediated ones) when Phase-1-scoped gates fail or config drift is detected; `record_decision`/`audit_report` produce the first real queryable data; Critical-risk writes require `harness approve` from a human TTY.

---

## 4. Phase 2, part A — Specification Registry

- `specs/schema/{product,domain,api,data,infra}.schema.json`, `templates/*`
- `domain.schema.json` gets a `stateMachines` field: `[{ name, states: string[], transitions: [{ from, to }] }]` — direct implementation of the "Specifying State Transitions" slide (valid paths listed explicitly; anything not listed, e.g. `Authorized → Refunded` skipping `Settled`, is invalid by omission). `generate_tests` reads this and emits one test per **valid** transition (must succeed) and one per **invalid** ordered pair not in the list (must be rejected) — maps directly onto ApexTrade's order/trade lifecycle.
- `db/init/0002_specs.sql`: `specs(id, spec_id UNIQUE, type, title, status, content JSONB, version, created_at, project_path)`, `spec_dependencies(spec_id FK, depends_on_spec_id FK)`
- `packages/core/src/specs.ts`, `server/src/tools/{create-spec.ts,validate-spec.ts,impact-analysis.ts}`
- Spec ID convention: `<PROJECT-PREFIX>-<DOMAIN>-NNN`, e.g. `APX-API-001`, prefix assigned at `harness init` time.

---

## 5. Phase 2, part B — Verification Gates + Traceability Graph

### 5.1 Gates map onto the pipeline image's 4 stages

| Image stage | Gate | Mechanism |
|---|---|---|
| Constitution | Pre-check | `evaluate_governance` non-blocking required before spec creation |
| Specification | Spec validation gate | `validate_spec` passes before tests are generated |
| Test Suite | TDD RED-phase gate | `generate_tests` returns a directive to produce failing tests citing a `spec_id`; `enforce-gate.sh` blocks `Write`s to `gatedGlobs` implementation files until `gate-check --mode verify-red` has **itself run the test command and observed a non-zero exit** — not until Claude merely reports RED (§2.1) |
| Generated Code (CI/CD gate before it) | Review gate | `request_review` returns a directive naming the risk-appropriate ECC reviewer; code is the disposable byproduct, regenerated on spec change — no "protect the code" mechanism is built |

### 5.2 Files
- `packages/core/src/gates.ts` (extended for this phase), `server/src/tools/{generate-tests.ts,validate-coverage.ts,request-review.ts}`
- `packages/core/src/directives.ts` (extended): declarative map, e.g. `{ riskLevel: "critical", reviewType: "security" } -> { action: "invoke_agent", agent: "security-reviewer" }`
- `db/init/0005_traceability.sql`: `traceability_edges(id, from_type, from_id, to_type, to_id, stale BOOLEAN DEFAULT false, created_at)` — rows like `constitution_rule -> spec`, `spec -> test`, `test -> commit_sha`, `review -> decision_id`
- **Spec-version propagation:** when `create_spec`/`validate_spec` bumps a spec's version (new row, prior row's `status` set to `superseded`), `specs.ts` marks every `traceability_edges` row where `from_id`/`to_id` matches the old spec version as `stale=true` in the same transaction. `verify-green` and `request_review` check for `stale=true` on the edges relevant to the file being touched and block/warn until `impact-analysis` is re-run and the dependent tests are re-confirmed RED→GREEN against the new version — code isn't silently left "passing" against a spec version that no longer exists.
- `server/src/tools/trace-artifact.ts`

**Gates activated after Phase 2:** spec-first enforced; TDD red-phase enforced and traced; review routing automatic by risk; full lineage queryable.

---

## 6. Phase 3, part A — Workflow Engine (Plan → Implement → Review → Compound)

- `workflows/new-feature.md`: spec → risk → tests(RED, directive) → directive to run `orch-add-feature` → review directive → `record_decision` → trace
- `workflows/security-change.md`: security review directive first → risk forced ≥High → approval checkpoint → directive to run `orch-change-feature`/`orch-fix-defect` → `record_decision`
- `workflows/hotfix.md`: fast-path risk (bounded) → limited approval → directive to run `orch-fix-defect` → `record_decision` (retroactive audit note)
- `db/init/0006_workflow_runs.sql`: `workflow_runs(id, workflow_name, spec_id, status, current_stage, started_at, completed_at)`
- `server/src/tools/{run-workflow.ts,workflow-status.ts}` — return directive **sequences**; Claude Code executes each step and reports back.

---

## 7. Phase 3, part B — Per-Project Scaffold (`harness init`)

- `cli/src/harness-init.ts` — calls `project-init`'s stack detection first, then copies `scaffold/.claude/` into the target project, substituting the project prefix (§4) and stack-specific reviewer names (§1.3) into the stamped files.

**Gates activated after Phase 3:** full workflow orchestration with logging; any project scaffolded with one command.

---

## 8. Guardrails Recommendation (grounded in ApexTrade's own Final PRD)

| Project | Risk factors (from its own PRD, §12/§17/§19) | Recommended gate posture |
|---|---|---|
| `ApexTrade` | Real stack now confirmed: Python 3.12/FastAPI, PostgreSQL 16 + TimescaleDB, Redis, React 18.3 + Vite, JWT RS256, live financial/options trading via Alpaca. Auto-Critical financial factor. | `assess_risk` hard-codes "financial/trading logic" as auto-Critical. Human-ack gate required for any change to `agents/trading/`, `risk_engine/`, or order-submission code paths. Constitution requires: no LLM/API calls from browser code (its own CRITICAL-01), no full state on `window.*` (CRITICAL-02), no client-side-only auth (CRITICAL-03) — these are direct constitution rules, not general reminders, since ApexTrade's own PRD already found these in its prototype. |
| `everything-claude-code` | None — tooling, not a product | Not retrofitted. |
| `harness-os` itself | Governs the governor | Constitution changes to `harness-os` require the "any change to the global constitution" human checkpoint from your original Human Checkpoints list — kept literally. |

No guardrails proposed for the five nonexistent projects (§0 decision 1).

---

## 9. Existing Project Retrofit — Fix → Equip (Phase 4, last, ApexTrade only)

Runs after Phase 1. `ApexTrade` has no backend code yet, so Pass 1/2 execute once implementation begins; Pass 3 (Equip) can run immediately since the PRD/spec content already exists.

### Pass 1 — Baseline Audit (read-only)
- Its own PRD (§19) **already documents three ready-made Critical/High findings** from direct review of the existing frontend prototype: **CRITICAL-01** (Claude API key called directly from `screens_copilot.jsx:57`), **CRITICAL-02** (full app state on `window.*` in `data.jsx:704`), **CRITICAL-03** (client-side-only auth via `localStorage` in `app.jsx:211`/`screens_auth.jsx:25`), plus HIGH-01/02/03 and MEDIUM-01..04. Pass 1 ingests these directly via `record_decision` rather than re-deriving them — real time savings, not duplicated work.
- Once backend code exists, run `security-reviewer`, `python-reviewer`, `fastapi-reviewer`, `react-reviewer` against it.
- Run `assess_risk` on the project as a whole → Critical, per §8.
- Output: prioritized findings list (seeded by the PRD's own findings above + reviewer output). No code changes in this pass.

### Pass 2 — Fix (prioritized, scoped)
- Critical/High findings fixed first as standalone PRs, scoped strictly to what Pass 1 flagged — the PRD's own §19 already specifies the exact fix for each (proxy LLM calls through `/api/v1/agents/copilot`, eliminate `window.*` globals, JWT+httpOnly cookie flow).
- Medium/Low findings become a backlog, fixed opportunistically.

### Pass 3 — Equip
- Run `harness init` on `ApexTrade` → stamps `.claude/` scaffold; can run now, independent of backend code existing.
- Run `/harness-audit` afterward to confirm the stamped scaffold itself scores well.
- Reverse-spec code with no formal spec entry once it exists, `status: reverse-engineered` until reviewed/promoted.
- Worth noting, not migrating: ApexTrade's own PRD already designs an **immutable, append-only `audit_log` table** (§17.1) for its own product data — independent validation that the append-only pattern in Harness OS's Decision Log (§3.5) is sound, from a completely separate spec.
- From this point forward, new ApexTrade changes go through Harness OS workflows (§6).

---

## 10. Phase Shippability Summary

| Phase | Ships independently? | Depends on |
|---|---|---|
| 1 — Constitution + Risk + Decision Log + enforcement hook | **✅ Done — built, tested (61 tests, 88% coverage), verified end-to-end against real Docker containers (§12.1)** | Nothing |
| 2 — Spec Registry + Verification Gates + Traceability | Not started | Phase 1 |
| 3 — Workflow Engine + Scaffold | Not started | Phases 1–2 |
| 4 — ApexTrade retrofit | Not started | Phases 1–3; Pass 1/2 additionally need ApexTrade backend code to exist |

---

## 11. Open Items

1. ~~**Pipeline diagram**~~ — resolved: all four conference slides attached and reconciled (§0 decision 2, §4's state-machine addition).
2. **SKILLS.md / AGENTS.md drafts** (§1.3) — need explicit sign-off before writing to disk.
3. **Reddit post content** — unfetchable by tool restriction; paste the body if you want it mapped.
4. **HTTP transport alternative** (§2.2) — flag if you'd rather not use stdio/`docker run` per invocation.
5. ~~**Human-ack env var naming**~~ — resolved in mechanism (§2.1, §3.5a: `decisions.status` + TTY-gated `harness approve`), env var name itself still needs picking at implementation time (e.g. `HARNESS_REQUIRE_TTY_APPROVAL`).
6. **`test → commit_sha` traceability edge source** — needs a concrete trigger (likely a `PostToolUse`-on-commit hook, or `record_decision` called at the end of a workflow's Work stage with the resulting SHA) — decide at Phase 2 implementation time, not blocking the plan.
7. **`run_workflow`'s directive-stepping protocol** — how Claude fetches step N+1 of a multi-step directive sequence (poll `workflow_status`? server returns the next directive inline after `record_decision`?) — decide at Phase 3 implementation time.
8. **`Bash`-heuristic false-positive tolerance** (§2.1, component 1) — shipped conservative in Phase 1 (`scaffold/.claude/hooks/parse-tool-call.mjs`: recognizes `>`/`>>` redirects, `sed -i ... FILE`, `tee FILE`; anything else is treated as a non-write and falls through to the PostToolUse revert backstop). Verified in §12.1 that a real Bash-mediated tamper of a tracked config file gets caught and reverted even though the PreToolUse heuristic wasn't in the loop for that test. Still needs real-world tuning from dogfooding — not yet done, since Phase 1 hasn't been used in an actual working session yet.
9. **`git` precondition for `post-bash-revert.sh`** (§2.1, component 4) — implemented as a soft precondition: the hook checks `git rev-parse --is-inside-work-tree` itself and prints a warning + exits 0 (doesn't crash) if the governed project isn't a git repo, rather than requiring `harness init` to enforce it upfront (harness-init.ts doesn't exist yet — Phase 3). ApexTrade isn't yet a git repo (§0.1) — still needs `git init` before Phase 4's Pass 3.
10. **`config_checksums` bootstrap trust** (§3.5a) — mechanism confirmed working (§12.1): `recordVerifiedConfig` is the exact function `harness-init.ts` (Phase 3) will call; tested directly since `harness-init` itself doesn't exist yet. The "run by a human, not delegated to in-session Claude Code" note still applies and isn't yet written into `docs/` (no `docs/*.md` files exist yet — deferred, low urgency until Phase 3).
11. **NEW — persistent `harness_gate_daemon` can't see arbitrary governed-project paths** (found during implementation, not anticipated in the original plan): `docker exec` into an already-running container can't attach a new bind mount per call, unlike `docker run -v ...` (§2.3's mechanism for the ephemeral mcp-serve container). Fixed by mounting one broad projects root (`$HARNESS_PROJECTS_ROOT`, default `$HOME/projects`) into `harness_gate_daemon` at `/workspaces:ro`, with path translation in `packages/core/src/project-path.ts` applied only at the point of file access — `project_path` columns in Postgres always store the canonical host path. Verified in §12.1. Residual limitation: any governed project living outside `$HARNESS_PROJECTS_ROOT` is invisible to the daemon — acceptable for a solo-developer setup where all projects live under `~/projects`, but worth flagging if that ever changes.
12. **NEW — `gate-daemon`'s "warm connection pool" doesn't survive `docker exec`** (§2.2's phrasing needed a correction, not just an implementation detail): each `docker exec harness_gate_daemon ... gate-check` spawns a brand-new OS process, which cannot share the daemon's own in-memory `pg.Pool`. What's actually saved by keeping the container warm is `docker run`'s image/container-creation cost, not connection setup — each invocation still opens its own lightweight pg connection over the container-local network, which is cheap on its own. `gate-daemon.ts`'s real job is just: stay alive, fail fast at startup if `DATABASE_URL` is wrong, heartbeat every 60s.

---

## 12. Implementation Progress Log

This section is the living record the user asked for: what's built, what's verified, and what was
decided (or corrected) during implementation that the original plan text didn't anticipate. Updated
after each phase, not just at the end.

### 12.1 Phase 1 — verification record

All of the following were run against real infrastructure, not mocked, before Phase 1 was considered
done:

- **Unit + integration test suite**: `npx vitest run --coverage` → 61 tests across 16 files, 88.45%
  line coverage (threshold: 80%). The integration test (`constitution.integration.test.ts`) spins up a
  real `postgres:16-alpine` via `testcontainers`, applies the actual `db/init/*.sql` + `db/seed/*.sql`
  files unmodified, and asserts `get_constitution` returns all 18 seeded rules with correct
  `severity`/`enforcement` tagging.
- **Type-check**: `npx tsc --build` across all three workspaces (`packages/core`, `server`, `cli`) —
  clean, no errors.
- **Append-only guarantee, verified empirically, not just asserted in code**: connected to
  `harness_postgres` as `harness_app` and ran a direct `UPDATE`/`DELETE` against `decisions` —
  Postgres itself returned `permission denied for table decisions` for both. The guarantee is
  enforced by the database role grants (`db/init/0000_roles.sql`, `0004_decision_log.sql`), not by
  application code choosing not to call `UPDATE`.
- **Docker image**: `docker build -f server/Dockerfile -t harness-os:latest .` — multi-stage build,
  clean.
- **MCP round trip (vertical slice 1)**: ran `docker run --rm -i --network harness_os_default -e
  DATABASE_URL=postgres://harness_app:harness_app@harness_postgres:5432/harness_os harness-os:latest
  mcp-serve`, piped a real `initialize` → `notifications/initialized` → `tools/list` →
  `tools/call get_constitution` JSON-RPC sequence over stdin, and got back a correctly-shaped MCP
  response containing all 5 registered tools and the full 18-rule constitution as JSON text content.
- **Hook → gate → block/revert round trip (vertical slice 2)**: created a real throwaway governed
  project under `~/projects/` (git-initialized, `.claude/` scaffold stamped and committed), then in
  sequence:
  1. `gate-check` against the un-initialized project → blocked with a `run_harness_init` directive.
  2. Called `recordVerifiedConfig` (the function `harness-init.ts` will call in Phase 3) → `gate-check`
     now passes (`{"pass":true}`).
  3. Appended a line to the project's `.claude/hooks/enforce-gate.sh` (simulating Claude Code
     tampering with the enforcement mechanism itself) → `gate-check` blocked with a
     `reconcile_config` directive naming the exact file, **and** a real `CRITICAL`/`rejected` row
     appeared in `decisions` for that project.
  4. Ran the actual `enforce-gate.sh` hook script (not a unit test — the real file, with a real
     Claude-Code-shaped JSON payload on stdin) → correctly exited `2` (Claude Code's block-and-show-
     stderr convention) with the directive JSON on stderr.
  5. Ran the actual `post-bash-revert.sh` hook script → detected the uncommitted drift via
     `git status --porcelain`, ran `git checkout --` to restore the tampered file, and logged a second
     `CRITICAL`/`rejected` decision (`revert_unauthorized_config_change`) via the new `log-revert` CLI
     command.
  6. Re-ran `gate-check` → passed again, working tree clean, full 3-row audit trail queryable via SQL.

  This is the concrete evidence behind "the enforcement mechanism resists being disabled by the thing
  it enforces" (§2.1) — not just an argument for why the design should work, but a reproduced failure
  and recovery.
- **MCP registration**: the stale `harness-os` entry in `~/.claude.json` (left over from the abandoned
  prior attempt, wrong DB host/user) was replaced with the corrected, verified entry — confirmed with
  the user first, since it's a global config change outside this repo. Takes effect on the next Claude
  Code session restart.

**Correction, post-advisor-review**: the original version of this section stopped short of the one
check that actually matters most — whether Claude Code itself, reading `scaffold/.claude/settings.json`,
would ever invoke `enforce-gate.sh` at all. Everything in the list above ran the hook scripts directly
(a real payload piped to the real file), which proves the *scripts* are correct but does not prove the
*wiring* is. That gap was real: cross-checking against the authoritative
`claude-code-settings.schema.json` bundled with the installed Claude Code VS Code extension
(`anthropic.claude-code-2.1.197-linux-x64/claude-code-settings.schema.json`) showed
`scaffold/.claude/settings.json` was using the wrong shape — a flat `{"matcher", "command",
"description"}` object per hook — when the schema requires a nested `{"matcher", "hooks": [{"type":
"command", "command": ...}]}` shape, with `hooks` a required property and `type: "command"` mandatory
on each entry. `description` is not a recognized field at all. This has been fixed in
`scaffold/.claude/settings.json` (§12.2 item 9 has the detail). A live, in-session
Claude-Code-triggered fire of the corrected hook is still unverified — see §12.3 — because testing it
requires the project to go through Claude Code's own trust flow and a session restart, neither of which
can be forced from inside a running session. Treat "the hook fires when Claude Code calls a gated tool"
as fixed-per-schema but not yet independently reproduced, not as proven the way the rest of §12.1 is.

### 12.2 Design decisions made during implementation (not pre-specified in the plan text)

1. **Least-privilege `harness_app` role, separate from the Postgres bootstrap superuser**
   (`db/init/0000_roles.sql`). The plan's registration example used `postgres://harness:harness@...`
   without saying which role that was. If the server/daemon connected as the same superuser Postgres
   is bootstrapped with (`POSTGRES_USER`), the "append-only, enforced by Postgres role privileges" claim
   in §3.5 would be false — a superuser bypasses all grants. `db/docker-compose.yml` now bootstraps
   Postgres as `harness_admin` (used only for `docker-entrypoint-initdb.d` and manual migrations) and
   creates a second role, `harness_app`, with `SELECT, INSERT` only on `decisions`/`config_checksums`.
   Every runtime component (`gate-daemon`, the MCP server) connects as `harness_app`.
2. **`db/seed/` isn't auto-applied by Postgres itself — a wrapper script bridges it**
   (`db/init/0008_run_seed.sh`). `docker-entrypoint-initdb.d` only scans its own top-level directory; it
   doesn't recurse into subdirectories, and a second host directory can't be bind-mounted onto the same
   container path as `db/init/`. Since the plan's file tree deliberately keeps `db/seed/` separate from
   `db/init/` (schema vs. versioned data), `0008_run_seed.sh` is a small shell script placed in `db/init/`
   that `psql -f`s everything under a second mount (`/gov-seed`, backed by `db/seed/` on the host) —
   preserving the separation the plan wanted without silently failing to seed anything.
3. **`packages/core/src/project-path.ts` — the biggest real gap caught during implementation.**
   §2.2 says `harness_gate_daemon` is persistent and reached via `docker exec`, and separately that
   tools need `project_path`-scoped read access to a governed project's files (§2.3). Those two facts
   are in tension: `docker exec` cannot attach a new bind mount the way `docker run -v` can, so a
   persistent daemon literally cannot see an arbitrary project's `.claude/` files unless something was
   mounted at container-creation time. Fixed with one broad read-only mount
   (`$HARNESS_PROJECTS_ROOT:/workspaces:ro` in `db/docker-compose.yml`) plus a path-translation function
   applied only where the filesystem is actually touched (`config-integrity.ts`'s `hashFile` calls) —
   `project_path` values stored in Postgres are always the canonical host path, unaffected by this.
4. **`server/Dockerfile`'s build context is the repo root, not `server/`.** The plan's §3.6 example
   command (`docker build -t harness-os:latest server/`) can't work once `harness_gate_daemon` and the
   CLI subcommands need to ship in the same image as the MCP server (§2.2 says they share one image) —
   a `server/`-only build context has no visibility into sibling workspace packages. The Dockerfile stays
   at `server/Dockerfile` to match the tree layout; the build command changed to
   `docker build -f server/Dockerfile -t harness-os:latest .`.
5. **`cli/src/log-revert.ts` — a small addition, not in the original file list.** `post-bash-revert.sh`
   needed a way to write an auditable `CRITICAL`/`rejected` decision after reverting a tampered file, and
   a hook is a shell script with no direct DB access. Rather than generalizing `gate-check` into a
   catch-all "log anything" command, `log-revert` is scoped narrowly to exactly this one call site
   (fixed `action='revert_unauthorized_config_change'`), consistent with the plan's own YAGNI-leaning
   style elsewhere.
6. **`scaffold/.claude/hooks/parse-tool-call.mjs` — shared by both hook scripts, not duplicated.**
   `enforce-gate.sh` (PreToolUse) and `post-bash-revert.sh` (PostToolUse) both need to parse the same
   Claude-Code-shaped JSON payload from stdin and apply the same conservative Bash-write-target
   heuristic (Open Item #8). Rather than embedding an equivalent `node -e '...'` one-liner twice, both
   scripts `eval` the output of this one shared file. Not in the plan's original file list, but a direct
   application of the plan's own coding-style rule against duplicating logic.
7. **Vitest resolves `@harness-os/core` to `packages/core/src/index.ts` directly, not `dist/`**
   (`vitest.config.ts`'s `resolve.alias`). Without this, every test run would need a `tsc --build` first
   since the workspace package's `main` field points at compiled output that doesn't exist until built.
   Tests now always exercise the same source being edited; the Docker image still runs a real
   `tsc --build` for the compiled runtime, so this doesn't weaken what actually ships.
8. **TDD discipline was strict for the two vertical slices (`db.ts`, `constitution.ts`,
   `config-integrity.ts`, `gates.ts`: test written and confirmed failing before implementation), looser
   for the repetitive breadth-first pass** (`risk.ts`, `audit.ts`, the five MCP tool wrappers, the four
   CLI commands: implementation and test written together, then run once to confirm green). Recorded
   here rather than silently claimed as uniformly strict — the shape of each of those files is
   mechanical once the pattern was established by the first few, and re-deriving RED for each one
   would have been process theater rather than real risk reduction.
9. **`scaffold/.claude/settings.json` used the wrong hook JSON shape — found by an advisor review, not
   by the test suite (nothing in Phase 1's tests exercised Claude Code's actual settings.json parser).**
   The shape written during initial implementation was flat (`{"matcher", "command", "description"}`
   per hook entry), copied from a pattern that appears in this user's own ECC rule files
   (`~/.claude/rules/ecc/web/hooks.md`, `typescript/hooks.md`). Cross-checked against
   `claude-code-settings.schema.json` (bundled with the installed `anthropic.claude-code` VS Code
   extension — the authoritative, versioned source, not a rules doc that may itself be stale) revealed
   the required shape nests a `hooks` array inside each matcher object, with `"type": "command"`
   mandatory per entry and no `description` field at all. Fixed in `scaffold/.claude/settings.json` for
   all three hook types (`SessionStart`, `PreToolUse`, `PostToolUse`). This would have been a **silent,
   total failure of the entire enforcement layer** — every Phase 1 test still would have passed, since
   none of them exercise Claude Code's own settings parser, only the hook scripts directly.
10. **`enforce-gate.sh` claimed to "fail closed on any internal error" but did not, under specific
    failure conditions — found by the same advisor review.** With `set -euo pipefail`, a crash inside
    `parse-tool-call.mjs` doesn't propagate as a failed command the way `set -e` needs to trigger: the
    crash happens inside a command substitution feeding `eval`'s argument, and `eval ""` on the
    resulting empty string succeeds. The subsequent unbound-variable read of `$HARNESS_TOOL_NAME` under
    `set -u` does abort the script, but with exit code 1 — and Claude Code only *blocks* a tool call on
    exit code 2 (any other non-zero is a non-blocking hook error, shown as a warning while the tool call
    proceeds). Net effect: a crash in the parser hook would have **let the gated write through**, the
    opposite of the stated intent. Fixed with an explicit `trap ... ERR` that forces exit 2 on any
    command failure, plus an explicit `-z "${HARNESS_TOOL_NAME:-}"` check right after the `eval` that
    also forces exit 2 if the parser produced no output at all.

    **Follow-up correction, found the moment this was tested live**: the first version of the `trap`
    fix broke the script's *legitimate* block path. `trap ... ERR` fires on any qualifying failing
    command **regardless of whether `set -e`/`set +e` is active** — it isn't gated by errexit, only by
    the same short exemption list (pipeline-non-last, `&&`/`||`-non-last, `if`/`while` test position,
    `!`-negated). `RESULT_JSON=$(docker exec ... gate-check.js ...)` is a bare assignment whose exit
    status *is* gate-check's exit status by bash's own rules for that specific form — none of the
    exemptions apply. So when gate-check intentionally exited 1 to signal "blocked," the ERR trap fired
    on it *before* the deliberate `if [[ $STATUS -ne 0 ]]` check ever ran, overwriting the real,
    useful directive JSON with the generic `internal_error` message. Confirmed by reproducing the exact
    failure with `bash -x` against a live-shaped PreToolUse payload (§12.1's live-fire test below) and
    watching the trap consume the assignment's exit status directly. Fixed by disabling the trap
    (`trap - ERR`) immediately before this one deliberate exit-status check and re-enabling it
    immediately after (`enforce-gate.sh` lines ~42–50) — the trap now only ever catches genuinely
    *unanticipated* failures, not the script's own intentional non-zero-exit signaling.
11. **`recordVerifiedConfig` now also commits the tracked config files to git, in the same call that
    records their hash — fixing a real divergence bug, found by the same advisor review.**
    `post-bash-revert.sh` has no DB access, so its backstop diffs the working tree against `git HEAD` as
    a proxy for "the verified baseline." Before this fix, `recordVerifiedConfig` (called today by
    `reconcile-config.ts`, and the function `harness-init.ts` will call in Phase 3) only wrote the
    Postgres row — it never committed. That meant DB-hash and git-HEAD could describe two different
    snapshots, with two concrete failure modes: (1) a freshly-initialized, never-committed `.claude/`
    shows as untracked, so the *first* Bash call's revert backstop would `rm -f` the entire harness
    config it exists to protect; (2) after a legitimate `reconcile-config` re-trust, the working tree
    still differed from the last commit, so the *next* Bash call would `git checkout --` the file back
    to its old content — which then mismatched the *new* DB hash, blocking every gated write until a
    human noticed. Fixed by having `recordVerifiedConfig` (`packages/core/src/config-integrity.ts`) run
    `git add` + `git commit` on the three tracked files itself, right after writing their checksums, so
    the two sources of truth can never drift apart. No-ops with a stderr warning outside a git repo
    (same posture as `post-bash-revert.sh`'s own precondition, Open Item #9). Two regression tests added
    (`config-integrity.test.ts`) reproduce both failure modes against a real, temporary git repo and
    assert `git status --porcelain` is clean afterward. **Forward requirement for Phase 3**:
    `harness-init.ts` MUST call `recordVerifiedConfig` (not write `.claude/` and commit separately) or
    this invariant breaks again the moment it's built.

### 12.3 What's explicitly NOT done yet (so this doesn't read as more complete than it is)

- `SKILLS.md` / `AGENTS.md` (§1.3) — still has its ⛔ checkpoint; Phase 1 never touched these files, and
  that checkpoint should be honored when Phase 3 (scaffold stamping) gets there, not skipped.
- `docs/{mcp-tool-reference.md,decision-log-schema.md,constitution-vs-ecc-rules.md}` — none written yet.
  Not blocking Phase 1's own correctness, but referenced by §2.1 as where the hook↔directive contract
  should be documented.
- `harness-init.ts` itself (Phase 3) — Phase 1 testing used `recordVerifiedConfig` directly as a
  stand-in, confirming the mechanism works, but the actual CLI command that runs `project-init`'s stack
  detection and stamps `scaffold/.claude/` into a target project doesn't exist yet.
- No real-world dogfooding session yet — the Bash-heuristic tuning (Open Item #8) and the git
  precondition (Open Item #9) are both verified to fail safely, but haven't been exercised by an actual
  Claude Code working session touching real gated files over time.
- ~~**A live, in-session Claude-Code-triggered fire of `enforce-gate.sh` has not been observed.**~~
  **Resolved and fully re-confirmed.** The user restarted a session inside
  `/home/lehoa/projects/harness-hook-live-test` (a throwaway governed project, scaffold stamped,
  deliberately left un-initialized in the DB) and asked Claude Code to create a file. Claude Code's own
  PreToolUse:Write hook fired for real, confirming the corrected `settings.json` shape (§12.2 item 9)
  actually wires up — this was the one thing no unit test could reach. It surfaced the `trap ... ERR`
  bug in the same motion (§12.2 item 10's follow-up correction): the first live call hit the trap firing
  on gate-check's intentional non-zero exit, returning a generic `internal_error` instead of the real
  `run_harness_init` directive. Root-caused by reproducing the exact failure locally with `bash -x`
  against a payload shaped like the live one, fixed by scoping the trap's disable/re-enable around the
  one deliberate exit-status check.

  First re-test attempt was a false positive in the other direction: the write *succeeded*, which looked
  like a regression but wasn't — while verifying the fix, `config_checksums` rows had been inserted
  directly for this project as part of testing the pass path, so it was no longer in the un-initialized
  state the test was designed around. Deleted those rows to put the project back in a genuinely
  un-initialized state, then asked for one more attempt: the write was **blocked, with the correct
  `{"action":"run_harness_init",...}` directive surfaced verbatim in Claude Code's own error message.**
  That's the full chain — Claude Code → `enforce-gate.sh` → `docker exec harness_gate_daemon` →
  `gate-check` → Postgres → directive JSON → back through the hook → Claude Code blocking the tool call
  and showing the human the reason — proven live, not just against hand-crafted payloads.

  Also caught in the same pass: the `harness-hook-live-test` project's `.claude/` was a stale `cp -r`
  snapshot from before the `enforce-gate.sh` fix, and `harness_gate_daemon` was still running the pre-fix
  Docker image — both had to be resynced/rebuilt before the reproduction was trustworthy. Recorded here
  as a reminder that "fixed in `scaffold/`" and "fixed in every place that copied from `scaffold/`" are
  not the same claim, and that a running long-lived container doesn't pick up a source fix until it's
  rebuilt and recreated.

---

Phase 1 shipped: constitution + risk engine + decision/audit log + the 4-component enforcement
mechanism, tested and verified end-to-end (§12.1). Next step, on your go-ahead: Phase 2
(Specification Registry + Verification Gates + Traceability Graph, §4–§5), starting with
`specs/schema/*.schema.json` and `db/init/0002_specs.sql`.