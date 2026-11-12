# Harness OS Runbook

Operational checklist for using harness-os governance day to day. See
`plan/IMPLEMENTATION_PLAN.md` for the design and implementation history —
this file is just the "what do I actually type" reference.

Works on macOS (Docker Desktop) and Linux or WSL2 (Docker Engine). Two values
are used throughout; set them once in your shell profile (`~/.zshrc` or
`~/.bashrc`):

```bash
export HARNESS_HOME="$HOME/path/to/harness_os"   # where this repository is cloned
export HARNESS_PROJECTS_ROOT="$HOME/projects"     # the folder that holds every governed project
```

## One-time machine setup

Skip this if `harness_postgres`/`harness_gate_daemon` are already running and
the MCP server is already registered.

```bash
cd "$HARNESS_HOME"
docker build -f server/Dockerfile -t harness-os:latest .
cd db && docker compose up -d        # reads HARNESS_PROJECTS_ROOT from your environment
```

Register the MCP server once, in `~/.claude.json` (user scope). JSON does not
expand variables, so replace `<HARNESS_HOME>` and `<HARNESS_PROJECTS_ROOT>`
with the absolute paths from above:

```json
"harness-os": {
  "type": "stdio",
  "command": "docker",
  "args": ["run", "--rm", "-i", "--init",
            "--label", "harness.role=mcp",
            "--network", "harness_os_default",
            "-v", "<HARNESS_HOME>/constitution:/gov/constitution:ro",
            "-v", "<HARNESS_HOME>/specs:/gov/specs:ro",
            "-v", "<HARNESS_PROJECTS_ROOT>:/workspaces:ro",
            "-e", "HARNESS_WORKSPACES_ROOT=/workspaces",
            "-e", "HARNESS_HOST_PROJECTS_ROOT=<HARNESS_PROJECTS_ROOT>",
            "-e", "DATABASE_URL=postgres://harness_app:harness_app@harness_postgres:5432/harness_os",
            "harness-os:latest", "mcp-serve"]
}
```

- `--init` and the server's own signal handling make the container stop when
  the session ends; `harness.role=mcp` lets cleanup tools find any that did not.
- The read-only projects mount lets `assess_risk` read each project's risk
  overrides (`risk/rubric.md`); without it the global rubric applies.

This is global — one registration, available regardless of which project you
have open. It gives Claude Code the governance tools, but enforcement is
still scoped per-project until you run `harness init` (below).

Optional: put `bin/harness` on your `PATH` so it's just `harness <command>`
from anywhere:

```bash
export PATH="$HARNESS_HOME/bin:$PATH"   # in ~/.zshrc / ~/.bashrc
```

## Every time you start a new project

**0. Sanity-check the infra is up** (catches a stopped daemon before it
wastes your time):

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep harness_
```

Expect `harness_postgres` and `harness_gate_daemon` both `Up`. If not:

```bash
cd "$HARNESS_HOME/db" && docker compose up -d
```

**1. Put the new project under `$HARNESS_PROJECTS_ROOT`** — the gate daemon
can only see that one mounted tree. If your project lives elsewhere, either
move it or restart the daemon with `HARNESS_PROJECTS_ROOT` pointed at its
parent (and update the MCP registration's mount to match).

**2. Scaffold governance for it** (interactive — confirm the detected stack
with `y`):

```bash
harness init "$HARNESS_PROJECTS_ROOT/<new-project>" [--prefix YOURPREFIX]
```

This detects your stack, writes
`.claude/{hooks,settings.json,harness.config.json,agents/AGENTS.md}`, `git
init`s if needed, commits it, and records the trust baseline.

**3. Open the project in Claude Code and work normally.** Nothing else to
do — `.claude/settings.json` wires the enforcement hooks in automatically
from here.

## As-needed, not per-project

**You deliberately edited a tracked config file**
(`harness.config.json`, `hooks/enforce-gate.sh`, `settings.json`) and now
every write is blocked citing drift:

```bash
harness reconcile-config "$HARNESS_PROJECTS_ROOT/<project>"
```

**A write got classified Critical risk and is sitting `pending_approval`:**

```bash
harness approve <decision-id>
```

Find the id via the `audit_report` MCP tool, or:

```sql
SELECT id, rationale FROM decisions WHERE status = 'pending_approval';
```

against `harness_postgres`.

**Risk levels are too high for harmless words in one project** (for example
"financial" in an app that only shows cost estimates): add `risk` overrides to
that project's `.claude/harness.config.json` (`risk/rubric.md`), then
`harness reconcile-config` it.

**`harness_postgres` was created before the latest `db/init` or `db/seed` files.**
Init scripts run only on an empty data directory, so an older database can lack
tables (`test_runs` made every gated check crash) or the constitution seed
(`get_constitution` says "No constitution version found"). Apply each missing
file once, as the container's admin user:

```bash
docker exec -i harness_postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/0009_test_runs.sql
docker exec -i harness_postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/seed/seed_constitution_v1.sql
```

**MCP containers from ended sessions are still running** (images built before
the shutdown fix, or a crash): list and stop them.

```bash
docker ps --filter label=harness.role=mcp --format '{{.Names}}\t{{.RunningFor}}'
docker stop <name>
```

## What the gate does and does not stop

The hooks are a guardrail for an agent that works in the open, not a sandbox:
they run as the same user as the agent.

Stopped or flagged:
- A Write, Edit or recognized Bash write (`>`, `>>`, `sed -i`, `tee`) to a
  `gatedGlobs` file before harness-os has itself seen a failing test run.
- Any other Bash command that changes a gated file while the gate is closed:
  flagged to the agent and logged as `flag_ungated_bash_write`, not reverted
  (a revert could lose work). Committing the change in the same command does
  not hide it; a checkout of a commit that already existed does not count.
- A Bash command that changes a tracked config file (content, mode, symlink or
  hard link) so that it no longer verifies: restored to its state before the
  command; what was found is kept in `.git/harness-bash/quarantine/`.
- Test runs that did not complete (not runnable, or stopped after
  `HARNESS_TEST_TIMEOUT_SECONDS`, default 120) are not recorded.
- A test command with a pipe, list, redirect or substitution after the
  configured command: only the configured command runs and is recorded, so
  `| tail` cannot hide a failure and `| grep -q x` cannot fake a RED.

How a recorded test run looks to the agent: the hook runs the suite once, in
its own process group, records the exit code, and blocks the agent's identical
call with the result (exit code, last `HARNESS_TEST_OUTPUT_LINES` lines, default
80, and the full log path). That block is the result, not an error.

Known residual risks:
- A fabricated direct `docker exec harness_gate_daemon node cli/dist/gate-check.js
  --mode record-test-run --exit-code 1` call records a RED that no test
  produced (plan §12.3). Nothing on the same machine can rule that out.
- A deliberate filesystem attack by the same user (racing the hooks, changing
  files outside a Bash call, editing `.git/harness-bash`) is out of scope.
- A `git pull` that fetches new commits while the gate is closed is flagged
  (noise, nothing is changed).
