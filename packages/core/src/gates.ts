import type { Pool } from 'pg';
import { recordDecision } from './audit.js';
import { verifyConfigIntegrity } from './config-integrity.js';
import { type Directive, reconcileConfigDirective, runHarnessInitDirective } from './directives.js';

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
 * Phase 1 scope only: config-integrity is the one hard gate that exists
 * before the Specification Registry (Phase 2) ships. `enforce-gate.sh` calls
 * this via `harness gate-check` for every Edit|Write|gated-Bash; spec/test
 * gates are added to this same function in Phase 2 (§5.2), not a new one.
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

  return { pass: true };
}
