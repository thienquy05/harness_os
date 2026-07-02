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

export function requireHumanApprovalDirective(decisionId: number, reason: string): Directive {
  return buildDirective('require_human_approval', reason, { decisionId });
}
