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

**As-built, differs from the sketch above — see §12.6 for why:** a headless CLI can't invoke the ECC
`project-init` skill, so `harness-init.ts` reimplements a small, dependency-free stack sniff
(`packages/core/src/stack-detection.ts`) instead of calling out to it. §1.3's checkpoint was resolved by
generalizing it, not by confirming the ApexTrade-specific draft as-is (user's explicit choice, §12.6): the
stamped `AGENTS.md` names already-existing ECC reviewer agents mechanically mapped from the detected stack,
not the hardcoded FastAPI/React list — §1.3's draft stays open, deferred to Phase 4's actual ApexTrade
retrofit.

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
| 2 — Spec Registry + Verification Gates + Traceability | **✅ Done — built, tested (131 tests total), verified end-to-end against real Docker/Postgres, including a real, in-session Claude-Code-triggered `enforce-gate.sh` RED→write→GREEN→re-blocked cycle (§12.4) that caught and fixed a genuine absolute-path relativization bug no synthetic test reached (Open Item #16, resolved).** | Phase 1 |
| 3, part A — Workflow Engine | **✅ Done — built, tested (152 tests total), verified via a real MCP round trip against the running server (§12.5): a live `run_workflow` → `assess_risk` → `workflow_status` sequence correctly advanced a real `hotfix` run stage-by-stage against real Postgres evidence.** | Phases 1–2 |
| 3, part B — Per-Project Scaffold (`harness init`) | **✅ Done — built, tested (186 tests total), verified via a real, ephemeral writable-mount `docker run harness-init` against a fresh throwaway project, followed by a real `claude -p` fire proving the freshly-stamped config actually governs a write (§12.6). Caught and fixed three real bugs no unit test reached, then three more (one requiring a two-pass fix) in a post-review hardening pass (§12.6a).** | Phase 3 part A |
| 4 — ApexTrade retrofit | Not started | Phases 1–3; Pass 1/2 additionally need ApexTrade backend code to exist |

---

## 11. Open Items

1. ~~**Pipeline diagram**~~ — resolved: all four conference slides attached and reconciled (§0 decision 2, §4's state-machine addition).
2. **SKILLS.md / AGENTS.md drafts** (§1.3) — partially resolved: asked the user at Phase 3 part B implementation time (the checkpoint's own "confirm or edit before file generation" applies exactly there, since that's when scaffold stamping first happens) whether `harness-init.ts` should stamp the ApexTrade-specific draft verbatim or generalize it. User chose to generalize (§12.6) — `AGENTS.md` is now stamped from a mechanical stack→known-reviewer-agent-name table, no ApexTrade-specific or SKILLS.md content ever written to disk. The original draft itself (§1.3) is still unconfirmed and stays open, deferred to Phase 4's actual ApexTrade retrofit, where SKILLS.md's three proposed skills would need their own separate sign-off.
3. **Reddit post content** — unfetchable by tool restriction; paste the body if you want it mapped.
4. **HTTP transport alternative** (§2.2) — flag if you'd rather not use stdio/`docker run` per invocation.
5. ~~**Human-ack env var naming**~~ — resolved in mechanism (§2.1, §3.5a: `decisions.status` + TTY-gated `harness approve`), env var name itself still needs picking at implementation time (e.g. `HARNESS_REQUIRE_TTY_APPROVAL`).
6. **`test → commit_sha` traceability edge source** — `trace_artifact` (Phase 2 part B, §12.4) can record this edge once a commit SHA exists, but nothing calls it automatically yet. Still needs a concrete trigger (likely a `PostToolUse`-on-commit hook, or `record_decision` called at the end of a workflow's Work stage with the resulting SHA) — decide at Phase 3 implementation time (the Workflow Engine is the natural place to own this), not blocking the plan.
7. **`run_workflow`'s directive-stepping protocol** — how Claude fetches step N+1 of a multi-step directive sequence (poll `workflow_status`? server returns the next directive inline after `record_decision`?) — decide at Phase 3 implementation time.
8. **`Bash`-heuristic false-positive tolerance** (§2.1, component 1) — shipped conservative in Phase 1 (`scaffold/.claude/hooks/parse-tool-call.mjs`: recognizes `>`/`>>` redirects, `sed -i ... FILE`, `tee FILE`; anything else is treated as a non-write and falls through to the PostToolUse revert backstop). Verified in §12.1 that a real Bash-mediated tamper of a tracked config file gets caught and reverted even though the PreToolUse heuristic wasn't in the loop for that test. Still needs real-world tuning from dogfooding — not yet done, since Phase 1 hasn't been used in an actual working session yet.
9. ~~**`git` precondition for `post-bash-revert.sh`**~~ **Resolved for any project scaffolded via `harness-init.ts` (§12.6):** `harness-init.ts` now runs `git init` itself when the target isn't already a git repo, before calling `recordVerifiedConfig` — so post-bash-revert.sh's precondition holds for every project from the moment it's initialized. ApexTrade specifically (§0.1) will get this for free once Phase 4 runs `harness init` against it, rather than needing a separate manual `git init` step.
10. **`config_checksums` bootstrap trust** (§3.5a) — mechanism confirmed working (§12.1): `recordVerifiedConfig` is the exact function `harness-init.ts` (Phase 3) will call; tested directly since `harness-init` itself doesn't exist yet. The "run by a human, not delegated to in-session Claude Code" note still applies and isn't yet written into `docs/` (no `docs/*.md` files exist yet — deferred, low urgency until Phase 3).
11. **NEW — persistent `harness_gate_daemon` can't see arbitrary governed-project paths** (found during implementation, not anticipated in the original plan): `docker exec` into an already-running container can't attach a new bind mount per call, unlike `docker run -v ...` (§2.3's mechanism for the ephemeral mcp-serve container). Fixed by mounting one broad projects root (`$HARNESS_PROJECTS_ROOT`, default `$HOME/projects`) into `harness_gate_daemon` at `/workspaces:ro`, with path translation in `packages/core/src/project-path.ts` applied only at the point of file access — `project_path` columns in Postgres always store the canonical host path. Verified in §12.1. Residual limitation: any governed project living outside `$HARNESS_PROJECTS_ROOT` is invisible to the daemon — acceptable for a solo-developer setup where all projects live under `~/projects`, but worth flagging if that ever changes.
12. **NEW — `gate-daemon`'s "warm connection pool" doesn't survive `docker exec`** (§2.2's phrasing needed a correction, not just an implementation detail): each `docker exec harness_gate_daemon ... gate-check` spawns a brand-new OS process, which cannot share the daemon's own in-memory `pg.Pool`. What's actually saved by keeping the container warm is `docker run`'s image/container-creation cost, not connection setup — each invocation still opens its own lightweight pg connection over the container-local network, which is cheap on its own. `gate-daemon.ts`'s real job is just: stay alive, fail fast at startup if `DATABASE_URL` is wrong, heartbeat every 60s.
13. ~~**NEW — the runtime Docker image (`node:22-slim`) has no `git` binary**~~ **Resolved in Phase 3 part B (§12.6), and reframed on the way:** the original framing assumed `git` alone was the fix, since `commitTrackedConfig` had only ever been observed running inside `harness_gate_daemon` (read-only `/workspaces` mount). Building `harness-init.ts` surfaced that its own git-writing work *cannot* run there at all — a read-only mount rejects the write before git even matters (confirmed empirically: `touch` inside `harness_gate_daemon` fails with `Read-only file system`). Fixed with two changes together: (a) `RUN apt-get install -y git` in `server/Dockerfile`'s runtime stage (the fix this item originally asked for), and (b) `harness-init.ts` invoked via its own ephemeral `docker run --rm -i --network harness_os_default -v <path>:<path> harness-os:latest harness-init ...` — a **writable** mount at the project path, mirroring `mcp-serve`'s invocation model (§2.3), not `gate-check`'s `docker exec harness_gate_daemon` model. `reconcile-config` still runs via `docker exec harness_gate_daemon` and so still silently no-ops its git commit today (now for a *different* reason than before — `EROFS` instead of `ENOENT`) — not fixed in this pass since it's outside Part B's scope, named here so it isn't mistaken for already resolved.
14. **NEW — TDD RED-phase gate's "any failing test satisfies the gate" imprecision** (§12.4, named during design, not found empirically): `gates.ts`'s red-phase check only looks at the *most recent* `test_runs` row for the whole project — it doesn't verify the failing test is actually related to the file being written. A project that's already red for an unrelated reason opens the gate for any implementation write with zero real TDD enforcement, and nothing detects this. Precise spec-to-file linkage needs `workflow_runs.spec_id` (Phase 3) to exist; this is a deliberate, documented scope boundary for Phase 2, not a bug — see §12.4's design-decision log for the full reasoning.
15. **NEW — `validate_coverage` trusts the reported percentage** (§12.4): unlike `recordTestRun`, there's no host-side interception verifying the number Claude reports — coverage tool output format varies too much per language/runner to intercept generically the way one configured test command string can be. A narrower instance of the same self-report risk named for Option 1's residual gap (item below).
16. ~~**Part B's `enforce-gate.sh`/`parse-tool-call.mjs` changes have only been script-level verified, not fired by a real Claude Code session.**~~ **Resolved — and it caught a real bug.** A real, in-session `claude -p` fire against a throwaway project (`~/projects/harness-partb-realfire`, prepped with `recordVerifiedConfig` and a side-channel-controlled test command, cleaned up afterward) found that `gates.ts`'s red-phase check called `classifyFile` with the raw `tool_input.file_path` — always an **absolute** path in a real payload — against globs like `"src/**/*.ts"`, which `minimatch` never matches against an absolute string. Every existing test (`gates.test.ts`) had used a relative path for convenience, so the gate silently gated nothing in practice: the first real fire wrote a gated file with zero test runs recorded, no block at all. Fixed in `gates.ts` by relativizing `input.filePath` against `input.projectPath` (`node:path`'s `relative()`) before calling `classifyFile`, whenever the incoming path is absolute — a regression test using an absolute path was added to `gates.test.ts` first (confirmed RED against the old code), then the fix made it pass. Full cycle then re-verified against ground truth (Postgres `test_runs` rows and the actual filesystem, not the nested session's own narration): write blocked with `establish_red_phase` (0 test runs) → Claude ran the configured test command, hook recorded a real RED → write succeeded → Claude ran the test command again, hook recorded a real GREEN → next gated write blocked again (timed out retrying, since the fixture's side-channel had no way to produce a fresh RED — expected, not a bug). This is exactly the class of bug §12.3 flagged as only reachable by a real fire, not a synthetic payload — the synthetic payload used to "verify" this gate earlier in Part B used a relative path too, and would have kept passing forever.
17. **NEW — the relativization fix (item 16) trusts `input.projectPath` (`payload.cwd`) to equal the project root.** The real fire launched `claude -p` from the root, so `relative(projectPath, filePath)` resolved correctly. A session launched from a subdirectory of a governed project would compute the wrong relative path against `gatedGlobs`. This fails *closed*, not open — `readHarnessConfig`/`verifyConfigIntegrity` would find no `config_checksums` row for that subdirectory path and return `run_harness_init` — so it's a UX/robustness wart (a legitimate session launched from a subdir looks uninitialized), not a security hole. Not blocking; worth a real fire from a subdirectory whenever `harness-init.ts` (Phase 3) makes this easy to test.
18. **NEW — git's dubious-ownership check (post-CVE-2022-24765) blocks `commitTrackedConfig`/`harness-init.ts` the moment the writable-mount model (item 13's fix) is actually used** (found during Phase 3 part B's live fire, §12.6, not anticipated by any prior design note): the container always runs as root, but a host-bind-mounted project directory is owned by the host user — git refuses to operate on a repo whose top-level directory belongs to a different uid than the running process unless explicitly exempted. First fire failed with `git rev-parse` succeeding (no `.git` yet, unrelated reason) then `git init` succeeding, then the *second* `git rev-parse` call moments later (from `commitTrackedConfig`, called right after) failing with `fatal: detected dubious ownership`. Fixed by running `git config --global --add safe.directory <path>` (harmless here — the "attacker" and "victim" in the CVE this check guards against are the same developer's own container and host account) before every git operation touching a governed project, in both `config-integrity.ts`'s `commitFiles` and `harness-init.ts`'s `ensureGitRepo`.
19. **NEW — a fresh `docker run --rm` container has no persistent `~/.gitconfig`, so `git commit` has no author identity** (found immediately after fixing item 18, same real fire, §12.6): `git commit` failed with "Please tell me who you are" — unit tests never caught this because they run on the host, which already has repo-local `user.name`/`user.email` configured. Fixed by passing `-c user.name=harness-os -c user.email=harness-os@localhost` inline on the commit invocation itself (not written to global config) — these are machine-generated commits, so a fixed bot identity is correct, with the real human already named in the message body via `verifiedBy`.
20. **NEW — `recordVerifiedConfig`'s commit only covers the three CONST-CORE-004-tracked files, leaving the rest of a fresh `.claude/` scaffold permanently untracked** (found by inspecting `git status` after the item 18/19 fixes let a real commit finally succeed, §12.6): `AGENTS.md` and three of the four hook scripts (`check-harness-infra.sh`, `parse-tool-call.mjs`, `post-bash-revert.sh`) are outside `TRACKED_CONFIG_FILES`'s scope by design (§2.1 component 3 only ever meant to protect the CONST-CORE-004 enforcement files, not the whole scaffold), so they were never committed by anything. Not a security gap (`post-bash-revert.sh`'s revert backstop is also scoped to just those three files, so the untracked extras were never at risk of being deleted) but a real git-hygiene gap a fresh project shouldn't start with. Fixed by extracting `commitTrackedConfig`'s git logic into a reusable `commitFiles(fsPath, relFiles, message)` (exported from `config-integrity.ts`), and having `harness-init.ts` call it once for the whole `.claude/` directory right after scaffolding, before `recordVerifiedConfig` runs its own narrower commit (which then correctly no-ops with nothing new to commit for the three already-committed files).

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

### 12.3 What's explicitly NOT done yet as of Phase 1 (Phase 2's own "not done yet" items are in §12.4)

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

### 12.4 Phase 2 — verification record

**Part A (Specification Registry) — done.** `specs/schema/{product,domain,api,data,infra}.schema.json`
(JSON Schema 2020-12, via the `Ajv2020` class — plain `Ajv` only bundles draft-07) +
`templates/*.example.json`, `db/init/0002_specs.sql` (`specs` with a partial unique index enforcing "at
most one active version per spec_id", `spec_dependencies`), `packages/core/src/specs.ts`
(`createSpec`/`getActiveSpec`/`listSpecs`/`impactAnalysis`/`findTransitiveDependents`/
`enumerateStateMachineTestCases`), `server/src/tools/{create-spec,validate-spec,impact-analysis}.ts`.
Two real bugs found via a manual MCP round trip against the running server (not by a pre-existing unit
test): an Ajv validator-cache race (concurrent first-time compiles of the same schema `$id` threw
"already exists" — fixed by caching the in-flight `Promise<ValidateFunction>` synchronously, before any
`await`, instead of the resolved value) and missing `dependsOn` wiring (`addSpecDependency` existed but
nothing called it). Both reproduced as unit tests, fixed, and re-verified against a rebuilt image. 89
tests at Part A's checkpoint.

**Part B (Verification Gates + Traceability Graph) — done.** New files: `db/init/0005_traceability.sql`
(`traceability_edges`, UPDATE-able unlike `decisions`/`config_checksums` since stale-propagation flips a
flag on existing rows), `db/init/0009_test_runs.sql` (not in the original §5 sketch —
`test_runs(id, project_path, command, phase, exit_code, created_at)`, append-only), `packages/core/src/
{harness-config,test-runs,traceability,coverage}.ts`, `server/src/tools/{generate-tests,validate-coverage,
request-review,trace-artifact}.ts`. Extended: `gates.ts` (TDD red-phase check), `directives.ts`
(`requireRedPhaseDirective`, `requestReviewDirective`), `specs.ts` (`buildTestGenerationPlan`,
stale-propagation on version bump), `scaffold/.claude/hooks/{parse-tool-call.mjs,enforce-gate.sh}`. 130
tests total at Part B's checkpoint (unit + two real-Postgres integration suites via testcontainers).

**Option 1 vs Option 2 — the decision and what it actually resolves.** Before implementation, two
options were discussed for where TDD red-phase test execution happens: (1) host-side, via the
checksummed `enforce-gate.sh`, or (2) daemon-side, inside per-project containers. You chose Option 1.
Investigating *why* Option 2 wasn't viable turned up a concrete confirmation, not just a preference:
`harness_gate_daemon` mounts every governed project **read-only** (`docker-compose.yml`'s
`${HARNESS_PROJECTS_ROOT}:/workspaces:ro`) and its image (`node:22-slim`, this repo's own dependencies
only) has no non-JS toolchain and no project-specific `node_modules` guarantee — it structurally cannot
run an arbitrary project's real test command. Option 1 was the only one that could actually work, not
just the one with a better security posture.

**What Option 1 actually closes, and what it explicitly doesn't.** The load-bearing invariant, confirmed
working via live-fire testing (see below): `enforce-gate.sh` — not Claude, not `gate-check.js` running
inside the daemon — spawns the test command itself, host-side, and passes the *observed* exit code into
`recordTestRun`. Claude's own identical Bash invocation still runs afterward unblocked, so it sees full
test output as normal; the hook's copy exists purely to produce a trustworthy result. `recordTestRun`
additionally cross-checks the reported command string against `harness.config.json`'s checksummed
`testCommands` (CONST-CORE-004 tracks that file), rejecting anything that isn't the configured command or
that command as a prefix followed by a space — a prefix match, so it accepts legitimate scoping (a
trailing test-file path) but can't distinguish that from an appended `|| true` or `; exit 0`, which would
flow through the sanctioned hook path and record a false green. Named as the same accepted risk class as
the paragraph below, not closed. **What this does not close** (named explicitly, not
glossed over, matching the posture already established for the Bash-write heuristic and for
`package.json`'s own test script being editable): a determined Claude could still construct
`docker exec harness_gate_daemon node cli/dist/gate-check.js --mode record-test-run --command "<the real
configured command>" --exit-code 1` directly via its own Bash tool, without ever having run that command,
since `gate-check` has no way to cryptographically prove *who* produced a given exit code — only that the
claimed command matches the checksummed config. This is a deliberate scope boundary, not an oversight:
closing it fully would require either daemon-side execution (ruled out above) or new infrastructure
(e.g. a per-invocation signed attestation) disproportionate to the threat model of a solo-developer
setup. The mitigating factor is that this bypass is conspicuous — a hand-crafted `docker exec ... 
record-test-run` call is a large, auditable deviation from normal tool use, not a one-line lie in chat,
and every recorded run's `command` field is itself part of the decision log for forensic review.

**Two additional hardenings adopted, both cheap, neither closing the gap above:**
- **Red-before-green invariant**: `recordTestRun` rejects a `green` result unless the *most recently
  recorded* run for the project was `red` — ties the two ends of a TDD cycle to the same observation
  sequence, so green can't be recorded without an intervening red, and the gate re-closes after every
  green (verified live below). Deliberately not framework-specific failing-test-*count* tracking (e.g.
  "3 failing -> 0 failing"), which would require parsing per-runner output formats — judged not worth the
  fragility for what it would add on top of the phase-sequencing check.
- **120s timeout** on the hook's own verification run (`enforce-gate.sh`), so a hung test command can't
  stall a PreToolUse hook — and therefore Claude Code itself — indefinitely. A timeout is recorded as a
  (possibly spurious) RED, a known, documented imprecision rather than a silent hang.

**Named, not closed, residual imprecision in the gate itself** (Open Item #14): the red-phase check only
looks at the project's *most recent* `test_runs` row — it has no way to confirm the failing test is
related to the file being written. A project that's already red for an unrelated reason opens the gate
for any implementation write with no real enforcement. Precise spec-to-file linkage needs
`workflow_runs.spec_id`, which is Phase 3 territory (the Workflow Engine), not something to backfill into
Phase 2's coarser, project-wide gate.

**Spec-version stale propagation — tested against real state change, not query text.** `createSpec`'s
supersede branch now calls `markEdgesStaleForEntity(client, 'spec', String(oldRow.id))` inside the same
transaction as the version bump. Rather than asserting "the UPDATE ran" against a mocked pool (which
would pass even if the query typed the id wrong against `traceability_edges`' TEXT columns and silently
matched zero rows), `specs.integration.test.ts` runs the real migrations against a `testcontainers`
Postgres, records a real edge, bumps the spec, and asserts the edge's `stale` column actually flipped —
plus a second test confirming an unrelated edge is untouched.

**Script-level verification (synthetic payload) — done. Real in-session fire — not done yet.** Part B's
red-phase gate was verified against the real, rebuilt Docker image and a throwaway project
(`~/projects/harness-part-b-live-test`, cleaned up afterward — checksums, decisions, and test_runs rows
deleted from Postgres, project directory removed): a synthetic PreToolUse Bash payload piped into the
actual `enforce-gate.sh` script (not just `gate-check.js` directly) correctly intercepted a command
matching the configured `testCommands` entry, ran it host-side, and recorded the real exit code. Full
cycle confirmed: `Write` to a `gatedGlobs` file blocked (`establish_red_phase`) before any run → hook
records RED → `Write` passes → hook records GREEN (same command string, parameterized via a side-channel
file rather than editing the checksummed `harness.config.json` mid-test, which would have tripped
config-integrity drift and produced a false signal) → `Write` blocked again, confirming the gate re-closes
after green rather than staying open indefinitely.

This is the same category of test §12.1 called its own "live-fire test" — a hand-crafted but realistically
shaped payload run directly against the script, not a real Claude Code session, and it was **not**
equivalent to §12.3's real, in-session Claude-Code-triggered fire.

**Real, in-session fire — done, via `claude -p` against a throwaway project (Open Item #16).** Rather than
asking the user to interactively restart a session (§12.3's original mechanism), `claude -p` was smoke-tested
first (headless, no auth/permission hang) and then used to drive a genuine, separate Claude Code process
rooted at `~/projects/harness-partb-realfire` — its own `settings.json` parse, its own PreToolUse hook
invocation, its own `enforce-gate.sh` execution, not this session's. The project was config-verified via
`recordVerifiedConfig` first (so the integrity gate passes and the red-phase gate — Part B's actual new
logic — is what gets exercised, not the older `run_harness_init` path), with `gatedGlobs` matching a real
target file and a test command controlled by a side-channel exit-code file so RED/GREEN could be toggled
without touching the checksummed `harness.config.json`.

**It caught a real bug, exactly as §12.3 predicted a real fire would.** `gates.ts`'s red-phase check called
`classifyFile` with the raw `tool_input.file_path` from the hook payload — always an **absolute** path in a
real session — against globs written relative to the project root (`"src/**/*.ts"`). `minimatch` never
matches an absolute string against that pattern, so the gate silently gated nothing: the first real fire
wrote straight through with zero test runs recorded, no block at all. Every existing test in
`gates.test.ts`, and the synthetic payload used for the "script-level" verification above, had used a
relative path for convenience — the exact blind spot §12.3 warned about, bugs living in the gap between the
script's internal logic and Claude Code's real hook-invocation plumbing. Fixed by relativizing
`input.filePath` against `input.projectPath` in `gates.ts` (`node:path`'s `relative()`) before calling
`classifyFile`. TDD discipline followed even for this post-hoc fix: a regression test using an absolute
path was added to `gates.test.ts` first, confirmed RED against the unfixed code, then the fix made it
green. 131 tests total after this fix.

**Re-verified against ground truth after the fix, not the nested session's own narration** (Postgres
`test_runs` rows and the actual filesystem): `Write` blocked with `establish_red_phase` (zero test runs
recorded) → asked to create the file, Claude ran the configured test command itself, the hook recorded a
real RED (`exit_code=1`) → the same write retried and succeeded, file present on disk → asked to run the
tests again, hook recorded a real GREEN (`exit_code=0`) → a second gated write blocked again (the process
timed out retrying, since the fixture's side-channel had no way to produce a fresh RED on demand — expected
behavior given the fixture, not a bug). Full cycle confirmed live. Throwaway project, `config_checksums`,
`decisions`, and `test_runs` rows all cleaned up afterward.

**Double execution, watched for and not an issue here:** this design runs the project's test command once
inside the hook (to observe the trustworthy exit code) and Claude runs it again itself in its own
subsequent Bash call (to see the output). For the side-channel-file fixture used here both runs are
idempotent, so this wasn't exercised under a genuinely stateful suite (DB fixtures, a bound port, generated
files) — still worth watching the first time this runs against a real project with such a suite.

**Post-implementation review pass (before check-in), two small fixes:** (1) `recordTestRun`'s
red-before-green check and `getLatestTestRun` both ordered by `created_at DESC LIMIT 1` with no tiebreak —
two rows landing in the same timestamp tick made "latest" non-deterministic, which for a state machine
keyed on "most recent phase" could leave the gate open when it should close. Added `, id DESC` as an
explicit tiebreak in both queries. (2) The command cross-check's doc comment overclaimed what the prefix
match actually protects against — it said it "matches...with scoping arguments appended," which reads as
though scoping is the only thing a trailing string could be; reworded to say plainly that a prefix match
can't distinguish a legitimate scoping path from an appended `|| true`, and named as the same accepted risk
class as the docker-exec bypass rather than presented as closed. Docker image rebuilt and
`harness_gate_daemon` recreated after both fixes; full 130-test suite and `tsc --build` still clean.

**Discovered in the same pass, unrelated to Part B's own logic** (Open Item #13): the runtime Docker
image has no `git` binary, so `config-integrity.ts`'s `commitTrackedConfig` — which runs inside
`harness_gate_daemon` for every CLI subcommand dispatched via `docker-entrypoint.sh`, not just
`gate-check` — always fails with `ENOENT` and is silently absorbed by the same catch-all as "not a git
repo" (Open Item #9). The checksum row itself is unaffected (this only breaks the auto-commit
convenience), but it affects every project, not just non-git ones. Pre-existing since Phase 1; deferred
to Phase 3 (`harness-init.ts` inherits it the moment it calls `recordVerifiedConfig`) since it's outside
Option 1/Part B's scope.

---

### 12.5 Phase 3, part A — Workflow Engine — verification record

**Design decision surfaced to the user before writing code, per plan §6's own open item #7 ("how Claude
fetches step N+1 — decide at implementation time").** Two shapes were on the table: return the whole
directive sequence up front and trust Claude to walk it faithfully, or make the server authoritative —
`run_workflow` returns one directive at a time, and `workflow_status` advances only after checking real
evidence for the current stage. The user chose **server-authoritative**, matching every other spine already
built in this system (append-only decisions, host-observed test runs, the gate re-closing on green) — all
of which already distrust self-report over server state. Returning the whole sequence and hoping a review or
approval stage doesn't get silently skipped would have been the one piece of this system that didn't hold
itself to that standard.

**What got built.** `db/init/0006_workflow_runs.sql` (`workflow_runs(id, workflow_name, spec_id,
project_path, status, current_stage, stage_started_at, pending_decision_id, started_at, completed_at)` —
UPDATE-able, unlike the append-only tables, since this is "where is this run right now," not a log; the
actual audit trail for what happened at each stage still lives in `decisions`). `packages/core/src/
{workflow-runs,workflow-definitions,workflows}.ts`: `workflow-runs.ts` is the raw persistence layer;
`workflow-definitions.ts` defines the three workflows from plan §6 as ordered stage lists, each stage
pairing a real `isComplete` check against a `directive` function; `workflows.ts` is the two functions the
MCP tools call (`runWorkflow` starts a run and returns stage 1's directive; `workflowStatus` re-checks the
*current* stage's evidence on every call and advances at most one stage — it never trusts a prior call
already confirmed completion, so a stale result can't skip a stage). Two new MCP tools, `run_workflow` and
`workflow_status`, registered in `server/src/index.ts`. Three workflow docs (`workflows/{new-feature,
security-change,hotfix}.md`) documenting the exact stage/evidence table each workflow implements — not just
plan §6's original prose sketch. 152 tests total (was 131 at the end of §12.4): 5 for `workflow-runs.ts`
persistence (fake-pool unit tests, mirroring `gates.test.ts`'s style), 12 for `workflow-definitions.ts`'s
stage logic, 3 for the two new MCP tools, and one real-Postgres integration test
(`workflows.integration.test.ts`, `testcontainers`) walking the entire `hotfix` workflow end to end against
real `workflow_runs`/`decisions`/`risk_assessments` rows — chosen over a mocked-pool test for the same reason
`specs.integration.test.ts` was (plan §12.4): a fake pool asserting "the right query ran" would pass even if
a stage's real evidence check silently matched zero rows.

**Stage-completion evidence, concretely — real checks reused wherever a real backing table already exists,
self-report named explicitly wherever one doesn't:**
- `spec` → `getActiveSpec` returns non-null for the run's `spec_id` (real).
- `risk` → a `risk_assessments` row exists for the project since the stage started, optionally floored to a
  minimum level (`security-change` requires High/Critical — a floor Claude must actually hit via a real
  `assess_risk` call, never an override the engine silently applies) (real).
- `tests` → `getLatestTestRun` returns `phase: 'red'` — reuses Phase 2's host-observed red-phase check
  directly, not a new self-report surface (real).
- `review` → a `decisions` row with `action = "request_review"` exists — reuses the `request_review` tool's
  own `recordDecision` call (real).
- `approval` → reuses Phase 1's human-ack mechanism directly: Claude calls `record_decision` itself
  (`status: 'pending_approval'`), reports the resulting id back via `workflow_status({ run_id, decision_id
  })`, which persists it onto the run so the stage can call the existing `isDecisionApproved` (real, and no
  new approval-tracking mechanism invented).
- `trace` → a `traceability_edges` row exists for the project since the stage started (real).
- `implement`, `security_review`, `finalize` → **self-report**: a `decisions` row with a workflow-and-stage-
  scoped action string (`workflow:<name>:<stage>`) recorded via `record_decision`. Named explicitly, not
  glossed over: there is no artifact "implementing a feature" or "finalizing a run" produces that the server
  could check independently the way it checks a spec row or a host-observed test run — the same accepted
  risk class as `validate_coverage`'s trusted percentage (§12.4, Open Item #15), not a new kind of gap.

**Verified against the real running server, not just tests** (matching how Phase 2 Part A was verified,
per the same reasoning §12.4 used to distinguish a real fire from a synthetic one — these are MCP tools, not
hooks, so the equivalent real-world check is a genuine MCP round trip, not `claude -p`): a real
`docker run harness-os:latest mcp-serve` was driven over stdio with hand-written JSON-RPC —
`initialize` → `tools/call run_workflow` (started a real `hotfix` run, confirmed via `SELECT ... FROM
workflow_runs` in Postgres) → `tools/call assess_risk` in a separate invocation (avoiding a real race
surfaced by the first attempt: concurrent stdio requests can complete out of order, so a `workflow_status`
call issued in the same batch as `assess_risk` isn't guaranteed to see it committed yet — not a server bug,
a reminder that MCP request ordering isn't FIFO) → `tools/call workflow_status`, which correctly advanced
the run from `risk` to `approval` and returned the `record_pending_approval` directive. `workflow_status`
called with a nonexistent `run_id` returned a structured `workflow_run_error`, not a thrown exception.
Throwaway `workflow_runs`/`risk_assessments` rows cleaned up afterward.

**Deliberately deferred to Phase 3 part B or later, not silently missing:**
- Open Item #13 (no `git` in the runtime image) is now genuinely due, not just flagged — `harness-init.ts`
  (part B) will call `recordVerifiedConfig`, whose `commitTrackedConfig` still no-ops on `ENOENT`. Fix is the
  one-line `RUN apt-get install -y git` this was deferred for.
- The throwaway-project + `claude -p` harness built for §12.4's Open Item #16 fire is the natural end-to-end
  test for `harness init` itself once it exists (does a freshly-stamped project's hooks actually fire?) —
  reuse it rather than building a new verification harness for part B.
- `security-change.md` and `hotfix.md` each name their own open gaps honestly (which `orch-*` skill a
  security fix should route through; what "limited approval" was actually meant to bound) rather than
  silently picking an answer and presenting it as settled.

### 12.6 Phase 3, part B — Per-Project Scaffold (`harness init`) — verification record

**Two things had to be settled with the user before writing code, called out by `advisor()` before
implementation started, not discovered partway through.**

First, the execution model. §12.5 had already flagged Open Item #13 as "genuinely due" once part B started —
but building it surfaced that installing `git` alone wasn't sufficient. Empirically confirmed first:
`docker exec harness_gate_daemon sh -c "touch /workspaces/x"` fails with `Read-only file system` — the
daemon's `/workspaces` mount (§2.3) is deliberately `:ro`, a security property (the daemon can't be coerced
into writing to governed projects), not something to relax. `harness-init.ts` needs to write `.claude/`,
`git init`/commit, and record a Postgres row in one command — no single existing invocation model
(`docker exec` into the daemon, or a host-native process with no DB access) can do all three. Resolved by
invoking `harness-init` via its own ephemeral, writable-mount `docker run`, mirroring `mcp-serve`'s pattern
(§2.3) rather than `gate-check`'s `docker exec` pattern:
```
docker run --rm -i --network harness_os_default \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v <project-path>:<project-path> \
  -e DATABASE_URL=postgres://harness_app:harness_app@harness_postgres:5432/harness_os \
  harness-os:latest harness-init --project-path <project-path> [--prefix <PREFIX>]
```
No `HARNESS_WORKSPACES_ROOT`/`HARNESS_HOST_PROJECTS_ROOT` env vars set for this invocation — same
ambient-passthrough behavior `project-path.ts`'s `resolveProjectFsPath` already has for `mcp-serve`, since the
mount is at the identical host path. `--user`/`-e HOME` were added after a post-implementation review caught
that the first version of this command (root, no `--user`) leaves every file it creates root-owned on the
host — see §12.6a, Open Item #21.

Second, §1.3's checkpoint. Plan §7 says `harness-init.ts` substitutes "stack-specific reviewer names (§1.3)"
into stamped files, but §1.3's draft `AGENTS.md` is hardcoded to ApexTrade's specific stack (FastAPI/React) —
not generic, and `harness-init.ts` is meant to run against any project. Asked the user directly rather than
picking silently: generalize into a mechanical stack→known-reviewer-agent-name table (no new content
invented, so no sign-off needed), confirm the ApexTrade draft verbatim (correct for ApexTrade, wrong for
everything else), or skip reviewer-name stamping entirely for v1. User chose to generalize (Open Item #2).

**What got built.** `packages/core/src/stack-detection.ts` — `detectStack(projectPath)` sniffs
`package.json`/`pyproject.toml`/`requirements.txt`/`go.mod`/`Cargo.toml`/`db/**/*.sql` (no `project-init`
skill invocation — a headless CLI can't call a Claude skill, an accepted boundary, not a shortcut); pure
`buildScaffoldDefaults(stack)` maps the result to `gatedGlobs`/`testGlobs`/`testCommands` and a reviewer-agent
list, always including the cross-cutting `code-reviewer`/`tdd-guide`/`architect` trio plus stack-specific
names (`typescript-reviewer`/`react-reviewer`, `python-reviewer`/`fastapi-reviewer`/`django-reviewer`,
`go-reviewer`, `rust-reviewer`, `database-reviewer` on a detected `db/*.sql` signal) — every name already
exists in the ECC agent roster, none invented. `cli/src/harness-init.ts` — TTY-gated like `harness
approve`/`harness reconcile-config` (§2.1, §3.5a: this establishes the root of the config-integrity trust
chain, so it must be a human decision, architecturally unreachable by Claude Code's own Bash tool), refuses
to re-initialize an already-initialized project (points at `reconcile-config` instead), prompts for
confirmation showing the detected stack, then copies `scaffold/.claude/{hooks,settings.json}` verbatim,
stamps `harness.config.json` with the detected defaults plus a `specPrefix` field (derived from the directory
name if `--prefix` isn't given), writes `.claude/agents/AGENTS.md` from the reviewer list, `git init`s the
target if it isn't already a repo, and calls `recordVerifiedConfig` to establish the checksum baseline.
`server/Dockerfile` gained `RUN apt-get install -y git` in the runtime stage and `COPY scaffold scaffold` (the
image never bundled `scaffold/.claude/` before — nothing needed to read it until now). 30 new tests (182
total, was 152 at the end of §12.5): 20 for `stack-detection.ts` (real temp-dir fixtures for `detectStack`,
pure-function tests for `buildScaffoldDefaults`), 9 for `harness-init.ts` (mocks `createPool`/
`recordVerifiedConfig`/`verifyConfigIntegrity` from `@harness-os/core` while letting `detectStack`/
`buildScaffoldDefaults` run for real against a real temp dir, matching the project's general preference for
real behavior over mocks wherever the real thing is cheap and available), plus one new regression case added
to `config-integrity.test.ts` for the git-identity bug below.

**Verified against real infrastructure, not just tests — and this is where it earned its keep.** Per
`advisor()`'s explicit warning before implementation ("if you hand-assemble anything harness-init is supposed
to produce, you're re-testing the manual path, not the tool"): built the image, ran the real ephemeral
`docker run harness-init` command above against a fresh throwaway project under `~/projects/`, confirmed via
direct filesystem/git/Postgres inspection (not the command's own stdout) that `.claude/` was stamped
correctly, `config_checksums` held real rows, and the git history was clean — then ran a real `claude -p`
fire (via a small Python pty helper script, since `docker run -it` refuses a non-terminal stdin and this
command is TTY-gated) against the freshly-scaffolded project, asking it to write a gated `.ts` file. Verified
via ground truth exactly as the standing instruction requires: the nested session's own transcript said
"created the file," but the real proof was `test_runs`/`decisions` rows in Postgres showing it was gated
correctly — blocked, ran the configured test command twice to establish a real RED, then succeeded — the full
chain (harness-init's stamped `gatedGlobs`, its checksums, `enforce-gate.sh`'s absolute-path fix from §12.4,
and the red-phase gate) all working together, produced entirely by `harness-init.ts` itself with zero manual
config assembly.

This first real fire caught three genuine bugs in sequence, none reachable by a unit test since all three are
properties of a real container running as root against a real host-owned bind mount — documented in full as
Open Items #18–20:
1. Git's dubious-ownership check (post-CVE-2022-24765) rejected every git operation on the mounted directory.
2. Once fixed, the ephemeral container's `git commit` failed next — no persistent `~/.gitconfig` means no
   author identity, and every unit test runs on a host that already has one.
3. Once fixed, `git status` showed `AGENTS.md` and three of the four hook scripts as permanently untracked —
   `recordVerifiedConfig`'s commit is deliberately scoped to only the three CONST-CORE-004 files, so nothing
   else it copies was ever meant to be committed by that call.

Each was fixed with the same TDD discipline as every prior real-fire bug in this project: reproduced first
(the exact `git rev-parse`/`git commit` failure, run directly against the built image via `docker run
--entrypoint sh`), fixed in `config-integrity.ts`/`harness-init.ts`, re-verified against the real container
end to end after each fix, and only declared done once a completely clean fire — no warnings, a linear git
history, `git status` empty — was reproduced from scratch against a brand-new throwaway project.

**Deliberately deferred, not silently missing:**
- `reconcile-config` still runs via `docker exec harness_gate_daemon` (the read-only-mount model) and so
  still can't actually commit its own re-verified config — named as the second half of Open Item #13 rather
  than fixed in this pass, since migrating its invocation model is a separate, distinct change from
  `harness-init.ts`'s own scope.
- §1.3's original ApexTrade-specific `AGENTS.md`/`SKILLS.md` draft is still unconfirmed — the generalized
  mechanical mapping resolves what `harness-init.ts` needed, not the draft itself, which stays open for
  Phase 4.
- Throwaway verification projects and their `~/.claude.json` trust-dialog entries were cleaned up after
  (root-owned `.claude`/`.git` contents from running as root required a throwaway `docker run alpine rm -rf`
  rather than a plain host `rm -rf`, itself a small real-world consequence of the same root-vs-host-uid
  mismatch behind Open Item #18).

### 12.6a Post-implementation review — three more real bugs, caught before check-in

`advisor()` was called once more after §12.6's "fully done" self-assessment and before reporting completion to
the user, per the standing practice of consulting it before declaring a task finished. It found the completed
work self-consistent but flagged that the real-fire verification in §12.6 had passed only because *the person
running it* (this session) applied workarounds — `safe.directory`, an inline bot identity, an `alpine rm -rf`
for cleanup — that an actual user would never know to apply. That was a real signal, not noise: it meant a
property of the *delivered command*, not just the verification process, was untested. Two concrete findings,
both confirmed empirically before being treated as real:

1. **Open Item #21 — root-owned scaffold (blocking).** Every file `harness-init` creates
   (`.claude/`, `.git/`) was owned by `root` on the host, because the ephemeral `docker run` in §12.6 never
   set `--user`. Confirmed with `ls -la` after a real fire (`-rw-r--r-- 1 root root ...`) and by reproducing
   the failure a plain host user hits next: `touch .claude/settings.json` and `git commit` both fail outright
   without a `sudo` or `safe.directory` workaround the user was never told to apply — directly contradicting
   §2.1 component 3's own stated design constraint that the tracked config files "have to stay writable, since
   legitimate config changes are normal." Fixed by adding `--user "$(id -u):$(id -g)" -e HOME=/tmp` to the
   documented invocation (now reflected above). Re-verified with a fresh real fire: files land host-owned
   (`-rw-r--r-- 1 lehoa lehoa ...`), and the host user can `git commit`/edit `.claude/settings.json`
   immediately afterward with zero workarounds. The `safe.directory` exemption in `commitFiles`/`ensureGitRepo`
   was left in place as defense-in-depth (covers a project already owned by some third uid), but is no longer
   load-bearing for the common case, since the container's uid now matches the mount owner exactly.

2. **Open Item #22 — `reconcile-config` crash on the read-only mount (real regression, not pre-existing) —
   and a second-pass correction after the first fix was itself incomplete.** Installing `git` in the runtime
   image (§12.6, for `harness-init`'s sake) changed `reconcile-config`'s failure mode without anyone touching
   `reconcile-config.ts` itself. Before: no `git` binary meant `git rev-parse --is-inside-work-tree` itself
   failed, `commitFiles` treated that as "not a repo," warned, and returned cleanly. After: `git` exists, so
   `rev-parse` (a read) succeeds against the daemon's `:ro` mount, execution reaches `git add` (a write), which
   throws with `EROFS` — uncaught, since `commitFiles` only ever wrapped the "not a repo" branch, and
   `reconcile-config.ts`'s `main` has no try/catch around `recordVerifiedConfig`. The checksum row is inserted
   *before* the doomed commit attempt, so an uncaught throw here would leave the DB and git HEAD diverged — the
   exact split-brain `recordVerifiedConfig`'s own doc comment says commitTrackedConfig exists to prevent.
   Reproduced directly (`chmod 555 .git` on a real repo: `rev-parse` still succeeds, `git add` fails with
   `Unable to create .git/index.lock: Permission denied`), confirmed a new regression test failed against the
   pre-fix code.

   **First pass (insufficient, caught by a second `advisor()` call before check-in):** wrapped the `git
   add`/`status`/`commit` sequence in `commitFiles` in its own try/catch, degrading to the same warn-only
   posture as the "not a repo" branch. This stopped the crash but not the underlying split-brain — the checksum
   row is inserted regardless of whether the commit lands, so `reconcile-config` would print "Config re-verified
   and trusted" and exit 0 while git HEAD still held stale content. That's exactly `recordVerifiedConfig`'s own
   documented failure mode (2): post-bash-revert.sh's next Bash call would revert the file back to the stale
   HEAD content, which then mismatches the *new* DB hash and blocks every gated write. A crash was loud and
   wrong; a silent "trusted" was quiet and just as wrong — it converted a loud failure into a silent wedge.

   **Second pass (shipped):** `commitFiles`/`commitTrackedConfig`/`recordVerifiedConfig` now return whether the
   commit actually succeeded (`{ committed: boolean }`) instead of `void`. `reconcile-config.ts` checks this and
   refuses to report success when `committed` is `false`: it prints a specific explanation (DB is trusted, HEAD
   is not, the next gated write may be reverted and then blocked) and exits `1`, pointing at the still-open
   second half of Open Item #13 (migrate to a writable-mount invocation) as the real fix. `harness-init.ts` gets
   the same check defensively, even though its own writable-mount commit is expected to always succeed. This
   does not close Open Item #13's second half — a `reconcile-config` run on the daemon's read-only mount still
   cannot actually commit — but it stops the command from *lying* about it. Re-verified with two real fires:
   `harness-init` on the writable mount now prints no warning at all (clean commit, `committed: true`); the
   same drift scenario run via `docker exec harness_gate_daemon` against the real `:ro` mount now exits `1`
   with the explicit warning, instead of the first pass's exit `0` "Config re-verified and trusted."

**A third, unrelated bug surfaced incidentally while re-verifying the daemon for finding #2, not originally in
scope — fixed rather than left as a footnote, since it undermines the core `gate-check` invocation model.**

3. **Open Item #23 — `gate-daemon.ts`'s heartbeat was `unref()`'d, so the daemon was never actually
   persistent.** While recreating `harness_gate_daemon` to pick up the Open Item #22 fix, `docker inspect
   --format '{{.RestartCount}}'` climbed from 0 to 1 within 8 seconds of a clean start, with no error in the
   container logs (exit code 0). Root cause: `gate-daemon.ts`'s only job is to stay alive (§2.2's "warm
   container avoids `docker run`'s cold-start" design), but its heartbeat `setInterval` was `unref()`'d —
   telling Node not to count that timer when deciding whether the event loop has more work. With no server
   socket and nothing else ref'd, the event loop drained and the process exited almost immediately after
   startup. This had been invisible in every prior session: `db/docker-compose.yml` sets
   `restart: unless-stopped` on this container, so it was being silently resurrected every few seconds the
   entire time, and every previous `docker ps` check in this project's history happened to land inside one of
   those brief "just restarted" windows, showing `Up N seconds` and looking healthy. Confirmed by recreating
   the container both by hand (`docker run -d`, no restart policy: exited cleanly, `RestartCount: 0`, status
   `Exited (0)` moments later) and via `docker compose up -d` (restart policy active: `RestartCount` visibly
   incrementing). Fixed by removing the `.unref()` call — this interval is deliberately the only thing keeping
   the daemon's event loop alive, so unref'ing it was always wrong for this specific process, not a tuning
   choice. Re-verified with a real fire: `RestartCount: 0`, status `running`, sustained for 15+ seconds after a
   fresh `docker compose up -d harness_gate_daemon`, and the read-only-mount `reconcile-config` fire for
   finding #2 ran against this same daemon instance throughout without it ever restarting underneath the test.

All three were fixed with the same discipline as Open Items #18–20: reproduced empirically first (never
assumed from reading code alone), a regression test added and confirmed RED against the pre-fix code via `git
stash` where a unit-testable repro existed (#22, #23), then GREEN after the fix, and a full real-infrastructure
re-fire (rebuilt image, recreated both containers, re-ran the exact failing scenario) before being called
resolved — and for #22 specifically, a *second* `advisor()` call caught that the first fix's real-fire
verification had only checked "does it crash," not "does it now lie about success," which is what forced the
`{ committed: boolean }` second pass. 186 tests total (was 182 in §12.6): one case in `config-integrity.test.ts`
plus one each in `harness-init.test.ts` and `reconcile-config.test.ts` for #22's two passes, one case in
`gate-daemon.test.ts` for #23.

---

Phase 1 + Phase 2 + Phase 3 (parts A and B) shipped: constitution + risk engine + decision/audit log + the
4-component enforcement mechanism (Phase 1); the Specification Registry, TDD red-phase gate with host-side
verified test execution, and traceability graph with stale-propagation (Phase 2); the server-authoritative
Workflow Engine — `run_workflow`/`workflow_status`, three defined workflows, real-state stage advancement
reusing Phase 1/2's own mechanisms wherever a backing table exists (Phase 3 part A); and now `harness-init.ts`
— mechanical stack detection, a stamped `.claude/` scaffold with stack-appropriate gates and reviewer names,
git init/commit, and `recordVerifiedConfig`, all as one TTY-gated command via its own ephemeral writable-mount
`docker run` (Phase 3 part B). 186 tests, tsc-clean, verified against real Docker/Postgres throughout —
including two manual MCP round trips in Phase 2 that caught real bugs unit tests alone missed, a real-Postgres
integration test proving stale-propagation actually mutates state, a real, in-session `claude -p`-triggered
fire that caught and fixed a genuine absolute-path relativization bug in the red-phase gate (§12.4, Open Item
#16), a real MCP round trip confirming the workflow engine advances only on real evidence (§12.5), a real
`docker run harness-init` fire followed by a real `claude -p` write that caught and fixed three genuine
root-vs-host-uid git bugs in the same session before confirming the full stamped-scaffold-to-gated-write chain
actually works end to end (§12.6, Open Items #18–20), and a post-implementation `advisor()` review that caught
three more real bugs before check-in — root-owned scaffold files, a `reconcile-config` crash regression, and a
`gate-daemon` liveness bug masked for the project's entire history by compose's restart policy (§12.6a, Open
Items #21–23).

### 12.6b `bin/harness` — human-facing wrapper script (closes Open Item #13's second half)

Asked for directly by the user (not pre-specified in the plan): the raw `docker run`/`docker exec` invocations
for `init`/`reconcile-config`/`approve` are long, easy to mistype, and this session had already mistyped
variants of them repeatedly. `bin/harness` wraps all three:

```
bin/harness init <project-path> [--prefix PREFIX]
bin/harness reconcile-config <project-path>
bin/harness approve <decision-id>
```

`init` and `reconcile-config` use the same ephemeral, writable-mount, host-uid `docker run` established for
`harness-init` in §12.6a (Open Item #21) — resolves the project path to an absolute path first, since `-v` and
`--project-path` must agree exactly (`project-path.ts`'s ambient-passthrough assumption). `approve` only ever
touches Postgres, never a project's filesystem, so it reaches the already-warm `harness_gate_daemon` via
`docker exec` instead of paying a `docker run` cold start. All three keep the underlying commands' own TTY gate
(§2.1, §3.5a) and add a friendlier pre-check (`[ -t 0 ]`) so a piped/non-interactive invocation fails with a
harness-specific message before Docker's own less-obvious one.

**Consequence, not just convenience: this closes Open Item #13's second half.** Routing `reconcile-config`
through the same writable-mount model as `init` — instead of `docker exec harness_gate_daemon` against its
read-only mount — means its git commit now actually succeeds. Verified with a real fire: `bin/harness init`
against a fresh throwaway project, drifted `.claude/settings.json` by hand, `bin/harness reconcile-config`
against the same project — exited 0 with no warning, and `git status --porcelain` came back clean (the commit
landed), where the same scenario via `docker exec harness_gate_daemon` in §12.6a's verification exited 1 with
the Open Item #22 warning. `reconcile-config.ts` itself was not touched — the fix is entirely in which
invocation model a human is told to use.

---

Phase 3 (both parts) is now fully done, including the post-review hardening pass and the `bin/harness` wrapper.
Remaining, per the plan's own checkpoint discipline: Phase 4 (ApexTrade retrofit, §9) has not been started and
should not begin without explicit confirmation; §1.3's original ApexTrade-specific `AGENTS.md`/`SKILLS.md`
draft is still unconfirmed (Open Item #2) — Phase 3 part B resolved what `harness-init.ts` itself needed by
generalizing past it, not by confirming the draft. Open Item #13 is now fully closed (§12.6b) — both halves
(no `git` in the image, and `reconcile-config`'s inability to commit) are resolved, and the MCP server itself
is confirmed live in this environment (`mcp__harness-os__*` tools available, backed by two running `mcp-serve`
containers).