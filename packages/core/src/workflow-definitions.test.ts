import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { getWorkflowDefinition, WORKFLOW_DEFINITIONS } from './workflow-definitions.js';
import type { WorkflowRunRow } from './workflow-runs.js';

const PAST = new Date(Date.now() - 60_000).toISOString();

function baseRun(overrides: Partial<WorkflowRunRow> = {}): WorkflowRunRow {
  return {
    id: 1,
    workflowName: 'new-feature',
    specId: 'APX-DOM-001',
    projectPath: '/p',
    status: 'in_progress',
    currentStage: 'spec',
    stageStartedAt: PAST,
    pendingDecisionId: null,
    startedAt: PAST,
    completedAt: null,
    ...overrides,
  };
}

function fakePool(fixtures: {
  activeSpec?: boolean;
  riskAssessments?: Array<{ level: string; created_at: string }>;
  decisions?: Array<{ action: string; created_at: string; status?: string; id?: number }>;
  traceabilityEdges?: Array<{ created_at: string }>;
}): Pool {
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes('FROM specs')) {
        return { rows: fixtures.activeSpec ? [{ id: 1, spec_id: params[0], status: 'active' }] : [] };
      }
      if (text.includes('FROM risk_assessments')) {
        const since = params[1] as string;
        const rows = (fixtures.riskAssessments ?? []).filter((r) => r.created_at > since);
        return { rows: rows.length > 0 ? [rows[rows.length - 1]] : [] };
      }
      if (text.includes('FROM decisions WHERE id')) {
        const [id] = params as [number];
        const found = (fixtures.decisions ?? []).find((d) => d.id === id);
        return { rows: found ? [{ status: found.status ?? 'approved' }] : [] };
      }
      if (text.includes('FROM decisions')) {
        const [, action, since] = params as [string, string, string];
        const rows = (fixtures.decisions ?? []).filter((d) => d.action === action && d.created_at > since);
        return { rows: rows.map((r) => ({ id: r.id ?? 1 })) };
      }
      if (text.includes('FROM traceability_edges')) {
        const since = params[1] as string;
        const rows = (fixtures.traceabilityEdges ?? []).filter((e) => e.created_at > since);
        return { rows };
      }
      throw new Error(`Unexpected query in fake pool: ${text}`);
    },
  } as unknown as Pool;
}

describe('getWorkflowDefinition', () => {
  it('returns the three defined workflows by name', () => {
    expect(getWorkflowDefinition('new-feature')?.stages.map((s) => s.name)).toEqual([
      'spec',
      'risk',
      'tests',
      'implement',
      'review',
      'finalize',
      'trace',
    ]);
    expect(getWorkflowDefinition('security-change')?.stages.map((s) => s.name)).toEqual([
      'security_review',
      'risk',
      'approval',
      'implement',
      'finalize',
    ]);
    expect(getWorkflowDefinition('hotfix')?.stages.map((s) => s.name)).toEqual([
      'risk',
      'approval',
      'implement',
      'finalize',
    ]);
  });

  it('returns undefined for an unknown workflow name', () => {
    expect(getWorkflowDefinition('not-a-real-workflow')).toBeUndefined();
  });

  it('every registered workflow includes a finalize (record_decision) stage', () => {
    for (const def of Object.values(WORKFLOW_DEFINITIONS)) {
      expect(def.stages.some((s) => s.name === 'finalize')).toBe(true);
    }
  });
});

describe('new-feature stages', () => {
  const def = getWorkflowDefinition('new-feature')!;

  it('spec stage completes once the spec is active', async () => {
    const stage = def.stages.find((s) => s.name === 'spec')!;
    const run = baseRun();
    expect(await stage.isComplete({ pool: fakePool({ activeSpec: false }), run })).toBe(false);
    expect(await stage.isComplete({ pool: fakePool({ activeSpec: true }), run })).toBe(true);
  });

  it('risk stage completes on any risk_assessments row since stage start, no floor', async () => {
    const stage = def.stages.find((s) => s.name === 'risk')!;
    const run = baseRun({ currentStage: 'risk' });
    const pool = fakePool({ riskAssessments: [{ level: 'low', created_at: new Date().toISOString() }] });
    expect(await stage.isComplete({ pool, run })).toBe(true);
  });

  it('tests stage completes only once the latest recorded test run is red', async () => {
    const stage = def.stages.find((s) => s.name === 'tests')!;
    const run = baseRun({ currentStage: 'tests' });
    const redPool = {
      query: async (text: string) => {
        if (text.includes('FROM test_runs')) {
          return { rows: [{ id: 1, project_path: '/p', command: 'npm test', phase: 'red', exit_code: 1, created_at: PAST }] };
        }
        throw new Error(`unexpected: ${text}`);
      },
    } as unknown as Pool;
    expect(await stage.isComplete({ pool: redPool, run })).toBe(true);
  });

  it('review stage completes once a request_review decision is recorded', async () => {
    const stage = def.stages.find((s) => s.name === 'review')!;
    const run = baseRun({ currentStage: 'review' });
    const now = new Date().toISOString();
    const pool = fakePool({ decisions: [{ action: 'request_review', created_at: now }] });
    expect(await stage.isComplete({ pool, run })).toBe(true);
  });

  it('implement stage completes once its workflow-scoped checkpoint decision is recorded', async () => {
    const stage = def.stages.find((s) => s.name === 'implement')!;
    const run = baseRun({ currentStage: 'implement' });
    const now = new Date().toISOString();
    const pool = fakePool({ decisions: [{ action: 'workflow:new-feature:implement', created_at: now }] });
    expect(await stage.isComplete({ pool, run })).toBe(true);
    expect(await stage.isComplete({ pool: fakePool({}), run })).toBe(false);
  });

  it('trace stage completes once a traceability edge is recorded', async () => {
    const stage = def.stages.find((s) => s.name === 'trace')!;
    const run = baseRun({ currentStage: 'trace' });
    const now = new Date().toISOString();
    expect(await stage.isComplete({ pool: fakePool({ traceabilityEdges: [{ created_at: now }] }), run })).toBe(true);
    expect(await stage.isComplete({ pool: fakePool({}), run })).toBe(false);
  });
});

describe('security-change risk stage', () => {
  it('requires a High or Critical assessment, not just any assessment', async () => {
    const def = getWorkflowDefinition('security-change')!;
    const stage = def.stages.find((s) => s.name === 'risk')!;
    const run = baseRun({ workflowName: 'security-change', currentStage: 'risk' });
    const now = new Date().toISOString();
    const lowPool = fakePool({ riskAssessments: [{ level: 'low', created_at: now }] });
    const highPool = fakePool({ riskAssessments: [{ level: 'high', created_at: now }] });
    expect(await stage.isComplete({ pool: lowPool, run })).toBe(false);
    expect(await stage.isComplete({ pool: highPool, run })).toBe(true);
  });
});

describe('approval stage', () => {
  it('is incomplete with no pending decision id, and checks isDecisionApproved once one is set', async () => {
    const def = getWorkflowDefinition('hotfix')!;
    const stage = def.stages.find((s) => s.name === 'approval')!;
    const noDecision = baseRun({ workflowName: 'hotfix', currentStage: 'approval', pendingDecisionId: null });
    expect(await stage.isComplete({ pool: fakePool({}), run: noDecision })).toBe(false);

    const pending = baseRun({ workflowName: 'hotfix', currentStage: 'approval', pendingDecisionId: 7 });
    const pendingPool = fakePool({ decisions: [{ id: 7, action: 'x', created_at: PAST, status: 'pending_approval' }] });
    expect(await stage.isComplete({ pool: pendingPool, run: pending })).toBe(false);

    const approvedPool = fakePool({ decisions: [{ id: 7, action: 'x', created_at: PAST, status: 'approved' }] });
    expect(await stage.isComplete({ pool: approvedPool, run: pending })).toBe(true);
  });

  it('directive differs before and after a pending decision id is recorded', () => {
    const def = getWorkflowDefinition('hotfix')!;
    const stage = def.stages.find((s) => s.name === 'approval')!;
    const before = stage.directive(baseRun({ pendingDecisionId: null }));
    expect(before.action).toBe('record_pending_approval');

    const after = stage.directive(baseRun({ pendingDecisionId: 7 }));
    expect(after.action).toBe('require_human_approval');
    expect(after.decisionId).toBe(7);
  });
});
