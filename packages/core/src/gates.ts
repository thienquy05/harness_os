import { isAbsolute, relative } from 'node:path';
import type { Pool } from 'pg';
import { recordDecision } from './audit.js';
import { verifyConfigIntegrity } from './config-integrity.js';
import {
  type Directive,
  reconcileConfigDirective,
  requireRedPhaseDirective,
  runHarnessInitDirective,
} from './directives.js';
import { classifyFile, readHarnessConfig } from './harness-config.js';
import { getLatestTestRun } from './test-runs.js';

export interface GateCheckInput {
  projectPath: string;
  tool: string;
  filePath?: string;
}

export interface GateCheckResult {
  pass: boolean;
  directive?: Directive;
}

/**
 * Config-integrity is the one hard gate for every tool call (Phase 1). Phase
 * 2 part B adds the TDD RED-phase gate on top of it (§5.2): a Write/Edit to
 * a file matching gatedGlobs is blocked unless the most recently *recorded*
 * test_runs row for this project is 'red' — recorded, not self-reported, by
 * enforce-gate.sh actually running the test command host-side (test-runs.ts,
 * plan §12.3). The spec-validation and review gates named in plan §5.1 are
 * enforced inside their respective MCP tools (generate_tests, request_review)
 * rather than here, since they gate what Claude is *told to do next*, not a
 * specific file write.
 */
export async function checkGate(pool: Pool, input: GateCheckInput): Promise<GateCheckResult> {
  const integrity = await verifyConfigIntegrity(pool, input.projectPath);

  if (!integrity.initialized) {
    return { pass: false, directive: runHarnessInitDirective(input.projectPath) };
  }

  if (!integrity.ok) {
    await recordDecision(pool, {
      actor: 'gate-daemon',
      action: 'block_write',
      rationale: `Config integrity drift detected in: ${integrity.mismatches.join(', ')} (CONST-CORE-004).`,
      constitutionRulesApplied: ['CONST-CORE-004'],
      riskLevel: 'critical',
      status: 'rejected',
      projectPath: input.projectPath,
    });
    return { pass: false, directive: reconcileConfigDirective(integrity.mismatches) };
  }

  if ((input.tool === 'Write' || input.tool === 'Edit') && input.filePath) {
    const config = await readHarnessConfig(input.projectPath);
    // gatedGlobs/testGlobs/exemptGlobs are written relative to the project
    // root, but a real PreToolUse payload's tool_input.file_path is always
    // absolute — classifyFile's minimatch never matches an absolute path
    // against a pattern like "src/**/*.ts". Only surfaced by a real,
    // in-session Claude-Code-triggered fire (plan §12.4 Open Item #16);
    // every prior test used a relative path and missed it.
    const relativeFilePath = isAbsolute(input.filePath)
      ? relative(input.projectPath, input.filePath)
      : input.filePath;
    if (classifyFile(config, relativeFilePath) === 'gated') {
      const latestRun = await getLatestTestRun(pool, input.projectPath);
      if (latestRun?.phase !== 'red') {
        return { pass: false, directive: requireRedPhaseDirective(input.filePath) };
      }
    }
  }

  return { pass: true };
}
