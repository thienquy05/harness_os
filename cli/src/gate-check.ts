#!/usr/bin/env node
import { checkGate, createPool } from '@harness-os/core';

interface ParsedArgs {
  projectPath?: string;
  tool?: string;
  filePath?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-path') result.projectPath = argv[++i];
    else if (arg === '--tool') result.tool = argv[++i];
    else if (arg === '--file') result.filePath = argv[++i];
  }
  return result;
}

/**
 * Phase 1 scope: `check` mode only (config-integrity gate). RED/GREEN
 * verify-red/verify-green modes land in Phase 2 once spec/test infrastructure
 * exists (§5.2) — this CLI's mode dispatch is written now so those modes are
 * additive, not a rewrite.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { projectPath, tool, filePath } = parseArgs(argv);
  if (!projectPath || !tool) {
    console.error(JSON.stringify({ action: 'usage_error', reason: '--project-path and --tool are required' }));
    return 2;
  }

  const pool = createPool();
  try {
    const result = await checkGate(pool, { projectPath, tool, filePath });
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
