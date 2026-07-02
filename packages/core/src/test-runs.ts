import type { Pool } from 'pg';
import { recordDecision } from './audit.js';
import { query } from './db.js';
import { readHarnessConfig } from './harness-config.js';

export type TestRunPhase = 'red' | 'green';

export interface TestRunRow {
  id: number;
  projectPath: string;
  command: string;
  phase: TestRunPhase;
  exitCode: number;
  createdAt: string;
}

export interface RecordTestRunInput {
  projectPath: string;
  command: string;
  exitCode: number;
}

export class TestCommandMismatchError extends Error {
  constructor(command: string) {
    super(
      `"${command}" does not match any command configured in this project's harness.config.json ` +
        `testCommands — refusing to record a test run for it.`,
    );
    this.name = 'TestCommandMismatchError';
  }
}

export class GreenWithoutRedError extends Error {
  constructor(projectPath: string) {
    super(
      `Refusing to record a GREEN test run for ${projectPath}: the most recent recorded run was not RED. ` +
        `A green result only counts as proof of TDD discipline if it follows an observed failing run.`,
    );
    this.name = 'GreenWithoutRedError';
  }
}

function toTestRunRow(row: {
  id: number;
  project_path: string;
  command: string;
  phase: TestRunPhase;
  exit_code: number;
  created_at: string;
}): TestRunRow {
  return {
    id: row.id,
    projectPath: row.project_path,
    command: row.command,
    phase: row.phase,
    exitCode: row.exit_code,
    createdAt: row.created_at,
  };
}

/**
 * `command` must equal a configured testCommands entry, or have one as a
 * prefix followed by a space. This accepts legitimate scoping (a trailing
 * test-file path) but can't distinguish that from an appended `|| true` or
 * `; exit 0` — the prefix match doesn't inspect what follows. Checked
 * against harness.config.json read fresh off disk, not a caller-supplied
 * config, since CONST-CORE-004 tracks that file's checksum: a command that
 * doesn't match it can't have come from the project's real, tamper-evident
 * test configuration. The residual "trailing shell trickery" gap is the same
 * accepted risk class as plan §12.3's direct docker-exec bypass — not closed
 * here, just named.
 */
async function assertConfiguredCommand(projectPath: string, command: string): Promise<void> {
  const config = await readHarnessConfig(projectPath);
  const trimmed = command.trim();
  const matches = config.testCommands.some(
    (entry) => trimmed === entry.command || trimmed.startsWith(`${entry.command} `),
  );
  if (!matches) {
    throw new TestCommandMismatchError(command);
  }
}

/**
 * Records the outcome of a test command run — see plan §12.3 for why this
 * function never accepts a Claude-reported exit code directly: its only
 * caller is enforce-gate.sh (host-side, checksummed), which spawns the
 * command itself and passes the real exit code it observed. See the same
 * §12.3 note for the residual gap this doesn't close (a fabricated direct
 * `gate-check --mode record-test-run` invocation bypassing the hook).
 *
 * Rejects a green result whose most recent prior run for this project wasn't
 * red — ties the two ends of a red/green cycle to the same observation
 * sequence, so "green" can't be produced by simply never having run a red
 * test in the first place, or by re-recording green repeatedly.
 */
export async function recordTestRun(pool: Pool, input: RecordTestRunInput): Promise<TestRunRow> {
  await assertConfiguredCommand(input.projectPath, input.command);

  const phase: TestRunPhase = input.exitCode === 0 ? 'green' : 'red';

  if (phase === 'green') {
    const priorRows = await query<{ phase: TestRunPhase }>(
      pool,
      `SELECT phase FROM test_runs WHERE project_path = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [input.projectPath],
    );
    if (priorRows.length === 0 || priorRows[0].phase !== 'red') {
      throw new GreenWithoutRedError(input.projectPath);
    }
  }

  const rows = await query(
    pool,
    `INSERT INTO test_runs (project_path, command, phase, exit_code)
     VALUES ($1, $2, $3, $4)
     RETURNING id, project_path, command, phase, exit_code, created_at`,
    [input.projectPath, input.command, phase, input.exitCode],
  );
  const row = toTestRunRow(rows[0] as Parameters<typeof toTestRunRow>[0]);

  await recordDecision(pool, {
    actor: 'gate-daemon',
    action: 'record_test_run',
    rationale: `Observed a ${phase.toUpperCase()} result (exit ${input.exitCode}) for "${input.command}", run by enforce-gate.sh itself.`,
    riskLevel: 'low',
    projectPath: input.projectPath,
  });

  return row;
}

export async function getLatestTestRun(pool: Pool, projectPath: string): Promise<TestRunRow | null> {
  const rows = await query(
    pool,
    `SELECT id, project_path, command, phase, exit_code, created_at
     FROM test_runs WHERE project_path = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [projectPath],
  );
  return rows.length > 0 ? toTestRunRow(rows[0] as Parameters<typeof toTestRunRow>[0]) : null;
}
