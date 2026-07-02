#!/usr/bin/env node
import { createPool, recordDecision } from '@harness-os/core';

interface ParsedArgs {
  projectPath?: string;
  file?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-path') result.projectPath = argv[++i];
    else if (arg === '--file') result.file = argv[++i];
  }
  return result;
}

/**
 * Called only by post-bash-revert.sh (§2.1 component 4), immediately after it
 * `git checkout --`s (or removes) a tampered tracked config file. Logs the
 * fact at CRITICAL/rejected so the revert is auditable, not silent.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { projectPath, file } = parseArgs(argv);
  if (!projectPath || !file) {
    console.error('Usage: harness log-revert --project-path <p> --file <f>');
    return 2;
  }

  const pool = createPool();
  try {
    await recordDecision(pool, {
      actor: 'post-bash-revert.sh',
      action: 'revert_unauthorized_config_change',
      rationale: `Bash-mediated change to ${file} was reverted (uncommitted drift, no reconcile-config run). CONST-CORE-004.`,
      riskLevel: 'critical',
      status: 'rejected',
      projectPath,
      constitutionRulesApplied: ['CONST-CORE-004'],
    });
    return 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
