#!/usr/bin/env node
import {
  checkGate,
  createPool,
  GreenWithoutRedError,
  recordTestRun,
  TestCommandMismatchError,
} from '@harness-os/core';

interface ParsedArgs {
  mode?: string;
  projectPath?: string;
  tool?: string;
  filePath?: string;
  command?: string;
  exitCode?: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') result.mode = argv[++i];
    else if (arg === '--project-path') result.projectPath = argv[++i];
    else if (arg === '--tool') result.tool = argv[++i];
    else if (arg === '--file') result.filePath = argv[++i];
    else if (arg === '--command') result.command = argv[++i];
    else if (arg === '--exit-code') result.exitCode = Number(argv[++i]);
  }
  return result;
}

async function runCheck(argv: ParsedArgs): Promise<number> {
  if (!argv.projectPath || !argv.tool) {
    console.error(JSON.stringify({ action: 'usage_error', reason: '--project-path and --tool are required' }));
    return 2;
  }

  const pool = createPool();
  try {
    const result = await checkGate(pool, { projectPath: argv.projectPath, tool: argv.tool, filePath: argv.filePath });
    if (result.pass) {
      console.log(JSON.stringify({ pass: true }));
      return 0;
    }
    console.error(JSON.stringify(result.directive));
    return 1;
  } finally {
    await pool.end();
  }
}

/**
 * Only caller is enforce-gate.sh (host-side, checksummed) — it spawns the
 * project's test command itself and passes the exit code it observed, never
 * a value Claude reports. See test-runs.ts's recordTestRun for the
 * command/config cross-check and the red-before-green invariant this
 * delegates to, and plan §12.3 for the residual gap neither of them closes.
 */
async function runRecordTestRun(argv: ParsedArgs): Promise<number> {
  if (!argv.projectPath || !argv.command || argv.exitCode === undefined || Number.isNaN(argv.exitCode)) {
    console.error(
      JSON.stringify({
        action: 'usage_error',
        reason: '--project-path, --command, and --exit-code are required for --mode record-test-run',
      }),
    );
    return 2;
  }

  const pool = createPool();
  try {
    const row = await recordTestRun(pool, {
      projectPath: argv.projectPath,
      command: argv.command,
      exitCode: argv.exitCode,
    });
    console.log(JSON.stringify(row));
    return 0;
  } catch (error) {
    if (error instanceof TestCommandMismatchError || error instanceof GreenWithoutRedError) {
      console.error(JSON.stringify({ action: 'test_run_rejected', reason: error.message }));
      return 1;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.mode === 'record-test-run') {
    return runRecordTestRun(parsed);
  }
  return runCheck(parsed);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
