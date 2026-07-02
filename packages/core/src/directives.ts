import type { RiskLevel } from './risk.js';

/**
 * Structured directives, per CONST-AI-002: Harness OS tools never invoke an
 * ECC agent/skill directly. They validate state and return one of these;
 * Claude Code reads it and acts. Every hook failure is directive-shaped too
 * (§2.1), so the same envelope is used everywhere a tool would otherwise say
 * "go do X".
 */
export interface Directive {
  action: string;
  reason: string;
  [key: string]: unknown;
}

export function buildDirective(
  action: string,
  reason: string,
  extra: Record<string, unknown> = {},
): Directive {
  return { action, reason, ...extra };
}

export function reconcileConfigDirective(mismatches: string[]): Directive {
  return buildDirective(
    'reconcile_config',
    `Config checksum mismatch on: ${mismatches.join(', ')}. This blocks every gated write until a human runs harness reconcile-config.`,
    { files: mismatches },
  );
}

export function runHarnessInitDirective(projectPath: string): Directive {
  return buildDirective(
    'run_harness_init',
    `No verified config checksums found for ${projectPath} — run harness init before gated writes can be evaluated.`,
    { projectPath },
  );
}

export function invokeAgentDirective(agent: string, files: string[], reason: string): Directive {
  return buildDirective('invoke_agent', reason, { agent, files });
}

/**
 * Mirrors risk.ts's assessRisk requiredGates convention (critical/high ->
 * review:security, medium -> review:code, low -> no review gate) without
 * re-deriving it from a fresh assessRisk call — request_review only needs
 * the risk level Claude already has from a prior assess_risk result.
 */
const RISK_LEVEL_REVIEW_AGENT: Record<RiskLevel, string | null> = {
  critical: 'security-reviewer',
  high: 'security-reviewer',
  medium: 'code-reviewer',
  low: null,
};

export function requestReviewDirective(riskLevel: RiskLevel, files: string[]): Directive {
  const agent = RISK_LEVEL_REVIEW_AGENT[riskLevel];
  if (!agent) {
    return buildDirective(
      'no_review_required',
      `Risk level "${riskLevel}" requires no review gate (risk/rubric.md).`,
      { riskLevel },
    );
  }
  return invokeAgentDirective(
    agent,
    files,
    `Risk level "${riskLevel}" requires a review from ${agent} before this change can be merged (risk/rubric.md).`,
  );
}

export function requireRedPhaseDirective(filePath: string): Directive {
  return buildDirective(
    'establish_red_phase',
    `"${filePath}" matches this project's gatedGlobs — it can't be written until harness-os has itself ` +
      `observed a failing test run. Run this project's configured test command (see harness.config.json's ` +
      `testCommands) via Bash; enforce-gate.sh intercepts and records the result, and this gate opens once ` +
      `it observes a non-zero exit.`,
    { filePath },
  );
}

export function requireHumanApprovalDirective(decisionId: number, reason: string): Directive {
  return buildDirective('require_human_approval', reason, { decisionId });
}
