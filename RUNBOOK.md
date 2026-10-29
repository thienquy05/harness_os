# Harness OS Runbook

Operational checklist for using harness-os governance day to day. See
`plan/IMPLEMENTATION_PLAN.md` for the design and implementation history —
this file is just the "what do I actually type" reference.

## One-time machine setup

Skip this if `harness_postgres`/`harness_gate_daemon` are already running and
the MCP server is already registered in `~/.claude.json`.

```bash
docker build -f server/Dockerfile -t harness-os:latest .
cd db && HARNESS_PROJECTS_ROOT=$HOME/projects docker compose up -d
```

Register the MCP server once, in `~/.claude.json`:

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

This is global — one registration, available regardless of which project you
have open. It gives Claude Code the governance tools, but enforcement is
still scoped per-project until you run `harness init` (below).

Optional: put `bin/harness` on your `PATH` so it's just `harness <command>`
from anywhere:

```bash
ln -s /home/lehoa/projects/harness-os/bin/harness /usr/local/bin/harness
# or
export PATH="/home/lehoa/projects/harness-os/bin:$PATH"   # in ~/.bashrc / ~/.zshrc
```

## Every time you start a new project

**0. Sanity-check the infra is up** (catches a stopped daemon before it
wastes your time):

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep harness_
```

Expect `harness_postgres` and `harness_gate_daemon` both `Up`. If not:

```bash
cd /home/lehoa/projects/harness-os/db && HARNESS_PROJECTS_ROOT=$HOME/projects docker compose up -d
```

**1. Put the new project under `~/projects`** (or wherever
`$HARNESS_PROJECTS_ROOT` points) — the gate daemon can only see that one
mounted tree. If your project lives elsewhere, either move it or restart the
daemon with `HARNESS_PROJECTS_ROOT` pointed at its parent.

**2. Scaffold governance for it** (interactive — confirm the detected stack
with `y`):

```bash
bin/harness init /home/lehoa/projects/<new-project> [--prefix YOURPREFIX]
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
bin/harness reconcile-config /home/lehoa/projects/<project>
```

**A write got classified Critical risk and is sitting `pending_approval`:**

```bash
bin/harness approve <decision-id>
```

Find the id via the `audit_report` MCP tool, or:

```sql
SELECT id, rationale FROM decisions WHERE status = 'pending_approval';
```

against `harness_postgres`.

**`harness_postgres` was created before the latest `db/init` or `db/seed` files.**
Init scripts run only on an empty data directory, so an older database can lack
tables (`test_runs` made every gated check crash) or the constitution seed
(`get_constitution` says "No constitution version found"). Apply each missing
file once, as the container's admin user:

```bash
docker exec -i harness_postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/0009_test_runs.sql
docker exec -i harness_postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/seed/seed_constitution_v1.sql
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

Known residual risks:
- A fabricated direct `docker exec harness_gate_daemon node cli/dist/gate-check.js
  --mode record-test-run --exit-code 1` call records a RED that no test
  produced (plan §12.3). Nothing on the same machine can rule that out.
- A deliberate filesystem attack by the same user (racing the hooks, changing
  files outside a Bash call, editing `.git/harness-bash`) is out of scope.
- The time limit stops the test command itself; processes it started can
  outlive it.
- A `git pull` that fetches new commits while the gate is closed is flagged
  (noise, nothing is changed).
