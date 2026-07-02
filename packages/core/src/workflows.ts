import type { Pool } from 'pg';
import type { Directive } from './directives.js';
import { getWorkflowDefinition } from './workflow-definitions.js';
import {
  advanceWorkflowRun,
  completeWorkflowRun,
  createWorkflowRun,
  getWorkflowRun,
  setPendingDecisionId,
  type WorkflowRunRow,
  type WorkflowRunStatus,
} from './workflow-runs.js';

export class UnknownWorkflowError extends Error {
  constructor(workflowName: string) {
    super(`"${workflowName}" is not a registered workflow (see workflow-definitions.ts).`);
    this.name = 'UnknownWorkflowError';
  }
}

export class WorkflowRunNotFoundError extends Error {
  constructor(runId: number) {
    super(`No workflow_runs row with id ${runId}.`);
    this.name = 'WorkflowRunNotFoundError';
  }
}

export interface RunWorkflowInput {
  workflowName: string;
  specId?: string | null;
  projectPath: string;
}

export interface WorkflowStepResult {
  runId: number;
  workflowName: string;
  stage: string;
  status: WorkflowRunStatus;
  directive?: Directive;
}

function toStepResult(run: WorkflowRunRow, directive?: Directive): WorkflowStepResult {
  return { runId: run.id, workflowName: run.workflowName, stage: run.currentStage, status: run.status, directive };
}

/** Starts a run at the workflow's first stage and returns that stage's directive — never the whole sequence (see plan §6's server-authoritative decision). */
export async function runWorkflow(pool: Pool, input: RunWorkflowInput): Promise<WorkflowStepResult> {
  const definition = getWorkflowDefinition(input.workflowName);
  if (!definition) {
    throw new UnknownWorkflowError(input.workflowName);
  }
  const firstStage = definition.stages[0];
  const run = await createWorkflowRun(pool, {
    workflowName: input.workflowName,
    specId: input.specId ?? null,
    projectPath: input.projectPath,
    firstStage: firstStage.name,
  });
  return toStepResult(run, firstStage.directive(run));
}

export interface WorkflowStatusInput {
  runId: number;
  /** Reported by Claude after its own record_decision(status='pending_approval') call — see approvalStage in workflow-definitions.ts. */
  decisionId?: number;
}

/**
 * The only way a run advances. Re-checks the *current* stage's real-state
 * evidence on every call — never trusts that a prior call already confirmed
 * it, and never advances more than one stage per call (a stage skipped by
 * a stale isComplete result would be a hole; re-verifying here closes it).
 */
export async function workflowStatus(pool: Pool, input: WorkflowStatusInput): Promise<WorkflowStepResult> {
  let run = await getWorkflowRun(pool, input.runId);
  if (!run) {
    throw new WorkflowRunNotFoundError(input.runId);
  }
  if (run.status === 'completed') {
    return toStepResult(run);
  }

  const definition = getWorkflowDefinition(run.workflowName);
  if (!definition) {
    throw new UnknownWorkflowError(run.workflowName);
  }

  if (input.decisionId !== undefined) {
    await setPendingDecisionId(pool, run.id, input.decisionId);
    run = await getWorkflowRun(pool, run.id);
    if (!run) {
      throw new WorkflowRunNotFoundError(input.runId);
    }
  }

  const stageIndex = definition.stages.findIndex((stage) => stage.name === run!.currentStage);
  const stage = definition.stages[stageIndex];
  const complete = await stage.isComplete({ pool, run });
  if (!complete) {
    return toStepResult(run, stage.directive(run));
  }

  const nextStage = definition.stages[stageIndex + 1];
  if (!nextStage) {
    await completeWorkflowRun(pool, run.id);
    const completed = await getWorkflowRun(pool, run.id);
    return toStepResult(completed!);
  }

  await advanceWorkflowRun(pool, run.id, nextStage.name);
  const advanced = await getWorkflowRun(pool, run.id);
  return toStepResult(advanced!, nextStage.directive(advanced!));
}
