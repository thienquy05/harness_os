import type { Pool } from 'pg';
import { isDecisionApproved } from './audit.js';
import {
  buildDirective,
  invokeAgentDirective,
  requireHumanApprovalDirective,
  type Directive,
} from './directives.js';
import { query } from './db.js';
import type { RiskLevel } from './risk.js';
import { getActiveSpec } from './specs.js';
import { getLatestTestRun } from './test-runs.js';
import type { WorkflowRunRow } from './workflow-runs.js';

export interface WorkflowStageContext {
  pool: Pool;
  run: WorkflowRunRow;
}

export interface WorkflowStageDefinition {
  name: string;
  isComplete: (ctx: WorkflowStageContext) => Promise<boolean>;
  directive: (run: WorkflowRunRow) => Directive;
}

export interface WorkflowDefinition {
  name: string;
  stages: WorkflowStageDefinition[];
}

/**
 * Every checkpoint stage without a natural backing table (implement,
 * security_review, finalize) is completed by Claude calling record_decision
 * with this exact, workflow-and-stage-scoped action string. This is a
 * self-report, the same accepted risk class as validate_coverage's trusted
 * percentage (plan §12.4, Open Item #15) — named here, not hidden, because
 * there is no real artifact "implementing a feature" or "finalizing a run"
 * produces that the server could check independently the way it checks a
 * spec row, a host-observed test run, or a traceability edge.
 */
function checkpointAction(workflowName: string, stage: string): string {
  return `workflow:${workflowName}:${stage}`;
}

async function hasRiskAssessmentSince(
  pool: Pool,
  projectPath: string,
  since: string,
  minLevels?: RiskLevel[],
): Promise<boolean> {
  const rows = await query<{ level: RiskLevel }>(
    pool,
    `SELECT level FROM risk_assessments WHERE project_path = $1 AND created_at > $2
     ORDER BY created_at DESC LIMIT 1`,
    [projectPath, since],
  );
  if (rows.length === 0) return false;
  if (!minLevels) return true;
  return minLevels.includes(rows[0].level);
}

async function hasDecisionSince(pool: Pool, projectPath: string, action: string, since: string): Promise<boolean> {
  const rows = await query(
    pool,
    `SELECT id FROM decisions WHERE project_path = $1 AND action = $2 AND created_at > $3 LIMIT 1`,
    [projectPath, action, since],
  );
  return rows.length > 0;
}

async function hasTraceabilityEdgeSince(pool: Pool, projectPath: string, since: string): Promise<boolean> {
  const rows = await query(
    pool,
    `SELECT id FROM traceability_edges WHERE project_path = $1 AND created_at > $2 LIMIT 1`,
    [projectPath, since],
  );
  return rows.length > 0;
}

function specStage(): WorkflowStageDefinition {
  return {
    name: 'spec',
    isComplete: async ({ pool, run }) => (run.specId ? (await getActiveSpec(pool, run.specId)) !== null : false),
    directive: (run) =>
      buildDirective(
        'create_spec',
        `This workflow requires an active spec ("${run.specId}") before continuing — call create_spec if it ` +
          `doesn't exist yet, or confirm its status is 'active'.`,
        { specId: run.specId },
      ),
  };
}

/** `minLevels` implements the plan's "risk forced ≥High" for security-change — a floor Claude must hit via a real assess_risk call, not an override applied here. */
function riskStage(minLevels?: RiskLevel[]): WorkflowStageDefinition {
  return {
    name: 'risk',
    isComplete: ({ pool, run }) => hasRiskAssessmentSince(pool, run.projectPath, run.stageStartedAt, minLevels),
    directive: () =>
      buildDirective(
        'assess_risk',
        minLevels
          ? `Call assess_risk for this change. This workflow requires the result to be ${minLevels.join(' or ')} — ` +
              `if it comes back lower, escalate to a human rather than forcing the level.`
          : `Call assess_risk for this change.`,
        minLevels ? { minLevels } : {},
      ),
  };
}

function testsStage(): WorkflowStageDefinition {
  return {
    name: 'tests',
    isComplete: async ({ pool, run }) => (await getLatestTestRun(pool, run.projectPath))?.phase === 'red',
    directive: () =>
      buildDirective(
        'establish_red_phase',
        `This workflow requires a host-observed RED test run before implementation — run this project's ` +
          `configured test command via Bash; enforce-gate.sh intercepts and records the real result.`,
      ),
  };
}

function implementStage(workflowName: string, skill: string): WorkflowStageDefinition {
  const action = checkpointAction(workflowName, 'implement');
  return {
    name: 'implement',
    isComplete: ({ pool, run }) => hasDecisionSince(pool, run.projectPath, action, run.stageStartedAt),
    directive: () =>
      buildDirective(
        'invoke_skill',
        `Run the ${skill} skill to implement this change, then call record_decision with action "${action}" ` +
          `once it's done — this stage completes only once that decision is recorded.`,
        { skill },
      ),
  };
}

function reviewStage(): WorkflowStageDefinition {
  return {
    name: 'review',
    isComplete: ({ pool, run }) => hasDecisionSince(pool, run.projectPath, 'request_review', run.stageStartedAt),
    directive: () =>
      buildDirective(
        'call_request_review',
        `Call request_review with this change's risk level and touched files — this stage completes once that ` +
          `call is recorded.`,
      ),
  };
}

function securityReviewStage(): WorkflowStageDefinition {
  const action = checkpointAction('security-change', 'security_review');
  return {
    name: 'security_review',
    isComplete: ({ pool, run }) => hasDecisionSince(pool, run.projectPath, action, run.stageStartedAt),
    directive: () => ({
      ...invokeAgentDirective(
        'security-reviewer',
        [],
        `This workflow requires a security review before risk assessment. Once done, call record_decision ` +
          `with action "${action}".`,
      ),
    }),
  };
}

/**
 * Reuses Phase 1's human-ack mechanism (isDecisionApproved) rather than
 * reinventing approval tracking: Claude calls record_decision itself
 * (status='pending_approval') and reports the resulting id back via
 * workflow_status, which persists it onto the run (workflow-runs.ts's
 * setPendingDecisionId) before re-checking isComplete.
 */
function approvalStage(): WorkflowStageDefinition {
  return {
    name: 'approval',
    isComplete: ({ pool, run }) =>
      run.pendingDecisionId === null ? Promise.resolve(false) : isDecisionApproved(pool, run.pendingDecisionId),
    directive: (run) =>
      run.pendingDecisionId === null
        ? buildDirective(
            'record_pending_approval',
            `This stage requires human approval. Call record_decision with status "pending_approval", then call ` +
              `workflow_status again passing the returned decision id.`,
          )
        : requireHumanApprovalDirective(
            run.pendingDecisionId,
            `Waiting for a human to run "harness approve ${run.pendingDecisionId}" before this workflow can continue.`,
          ),
  };
}

function finalizeStage(workflowName: string, note = ''): WorkflowStageDefinition {
  const action = checkpointAction(workflowName, 'finalize');
  return {
    name: 'finalize',
    isComplete: ({ pool, run }) => hasDecisionSince(pool, run.projectPath, action, run.stageStartedAt),
    directive: () =>
      buildDirective(
        'record_decision_checkpoint',
        `Call record_decision with action "${action}" to close out this workflow run.${note ? ` ${note}` : ''}`,
      ),
  };
}

function traceStage(): WorkflowStageDefinition {
  return {
    name: 'trace',
    isComplete: ({ pool, run }) => hasTraceabilityEdgeSince(pool, run.projectPath, run.stageStartedAt),
    directive: () =>
      buildDirective(
        'trace_artifact',
        `Call trace_artifact to link the implementation back to its spec/tests before this workflow completes.`,
      ),
  };
}

/**
 * Plan §6's three sketched workflows. Server-authoritative (per project
 * decision): each stage's isComplete checks real state — a spec row, a
 * host-observed test run, a decisions/traceability_edges row — never a
 * self-reported "done", except where named above (checkpointAction) as an
 * accepted, no-natural-artifact exception.
 */
export const WORKFLOW_DEFINITIONS: Record<string, WorkflowDefinition> = {
  'new-feature': {
    name: 'new-feature',
    stages: [
      specStage(),
      riskStage(),
      testsStage(),
      implementStage('new-feature', 'orch-add-feature'),
      reviewStage(),
      finalizeStage('new-feature'),
      traceStage(),
    ],
  },
  'security-change': {
    name: 'security-change',
    stages: [
      securityReviewStage(),
      riskStage(['critical', 'high']),
      approvalStage(),
      implementStage('security-change', 'orch-change-feature'),
      finalizeStage('security-change'),
    ],
  },
  hotfix: {
    name: 'hotfix',
    stages: [
      riskStage(),
      approvalStage(),
      implementStage('hotfix', 'orch-fix-defect'),
      finalizeStage('hotfix', 'This is a retroactive audit note for a fast-path fix, per plan §6.'),
    ],
  },
};

export function getWorkflowDefinition(name: string): WorkflowDefinition | undefined {
  return WORKFLOW_DEFINITIONS[name];
}
