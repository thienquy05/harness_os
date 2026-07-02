import type { Pool } from 'pg';
import { recordDecision } from './audit.js';

const DEFAULT_COVERAGE_THRESHOLD = 80;

export interface ValidateCoverageInput {
  projectPath: string;
  coveragePercent: number;
  threshold?: number;
}

export interface CoverageResult {
  pass: boolean;
  coveragePercent: number;
  threshold: number;
}

/**
 * Deterministic threshold check against the coverage number Claude reports
 * (CLAUDE.md's global 80% minimum). Unlike test-runs.ts's recordTestRun,
 * this has no host-side execution to verify the reported number against —
 * coverage tooling output varies too much per language/runner to intercept
 * generically the way a single configured test command can be. Logged as a
 * decision either way so the reported number and outcome are auditable, but
 * this gate trusts the report — a known, narrower version of the same
 * self-report risk named for test-runs.ts (plan §12.3).
 */
export async function validateCoverage(pool: Pool, input: ValidateCoverageInput): Promise<CoverageResult> {
  const threshold = input.threshold ?? DEFAULT_COVERAGE_THRESHOLD;
  const pass = input.coveragePercent >= threshold;

  await recordDecision(pool, {
    actor: 'gate-daemon',
    action: 'validate_coverage',
    rationale: `Reported coverage ${input.coveragePercent}% against a ${threshold}% threshold: ${pass ? 'pass' : 'fail'}.`,
    riskLevel: 'low',
    status: pass ? 'approved' : 'rejected',
    projectPath: input.projectPath,
  });

  return { pass, coveragePercent: input.coveragePercent, threshold };
}
