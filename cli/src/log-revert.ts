#!/usr/bin/env node
import { createPool, recordDecision } from '@harness-os/core';

interface ParsedArgs {
  projectPath?: string;
  file?: string;
  kind?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-path') result.projectPath = argv[++i];
    else if (arg === '--file') result.file = argv[++i];
    else if (arg === '--kind') result.kind = argv[++i];
  }
  return result;
}

/**
 * Called only by post-bash-revert.sh (§2.1 component 4). Default kind: a tracked config file a Bash
 * call changed was restored to its content before the call. `--kind gated`: a gated file a Bash call
 * wrote while the gate was closed was flagged to Claude (not reverted, so no work is lost). Both are
 * logged as rejected so neither is silent.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { projectPath, file, kind } = parseArgs(argv);
  if (!projectPath || !file) {
    console.error('Usage: harness log-revert --project-path <p> --file <f> [--kind gated]');
    return 2;
  }

  const decision =
    kind === 'gated'
      ? {
          action: 'flag_ungated_bash_write',
          rationale: `A Bash call wrote gated file ${file} while no RED test run was recorded; flagged, not reverted. CONST-CORE-002.`,
          riskLevel: 'high' as const,
          constitutionRulesApplied: ['CONST-CORE-002'],
        }
      : {
          action: 'revert_unauthorized_config_change',
          rationale: `Bash-mediated change to ${file} was reverted (uncommitted drift, no reconcile-config run). CONST-CORE-004.`,
          riskLevel: 'critical' as const,
          constitutionRulesApplied: ['CONST-CORE-004'],
        };

  const pool = createPool();
  try {
    await recordDecision(pool, { actor: 'post-bash-revert.sh', status: 'rejected', projectPath, ...decision });
    return 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
