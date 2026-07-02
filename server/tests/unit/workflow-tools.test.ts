import type { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@harness-os/core', () => {
  class WorkflowRunNotFoundError extends Error {}
  class UnknownWorkflowError extends Error {}
  return {
    WORKFLOW_DEFINITIONS: { 'new-feature': {}, 'security-change': {}, hotfix: {} },
    runWorkflow: vi.fn(async (_pool: unknown, input: Record<string, unknown>) => ({
      runId: 1,
      workflowName: input.workflowName,
      stage: 'spec',
      status: 'in_progress',
      directive: { action: 'create_spec', reason: 'r' },
    })),
    workflowStatus: vi.fn(async (_pool: unknown, input: Record<string, unknown>) => {
      if (input.runId === 999) {
        throw new WorkflowRunNotFoundError('no such run');
      }
      return {
        runId: input.runId,
        workflowName: 'new-feature',
        stage: 'risk',
        status: 'in_progress',
        directive: { action: 'assess_risk', reason: 'r' },
      };
    }),
    UnknownWorkflowError,
    WorkflowRunNotFoundError,
  };
});

import { registerRunWorkflowTool } from '../../src/tools/run-workflow.js';
import { registerWorkflowStatusTool } from '../../src/tools/workflow-status.js';
import { runWorkflow, workflowStatus } from '@harness-os/core';

function newServerAndPool(): { server: McpServer; pool: Pool } {
  return { server: new McpServer({ name: 'test', version: '0.0.0' }), pool: {} as Pool };
}

describe('run_workflow tool', () => {
  it('forwards args and returns the first stage directive', async () => {
    const { server, pool } = newServerAndPool();
    registerRunWorkflowTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['run_workflow'];
    const result = await tool.handler(
      { workflow_name: 'new-feature', project_path: '/p', spec_id: 'APX-DOM-001' },
      {} as never,
    );
    expect(runWorkflow).toHaveBeenCalledWith(pool, {
      workflowName: 'new-feature',
      projectPath: '/p',
      specId: 'APX-DOM-001',
    });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.stage).toBe('spec');
    expect(parsed.directive.action).toBe('create_spec');
  });
});

describe('workflow_status tool', () => {
  it('forwards run_id/decision_id and returns the current stage directive', async () => {
    const { server, pool } = newServerAndPool();
    registerWorkflowStatusTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['workflow_status'];
    const result = await tool.handler({ run_id: 1, decision_id: 7 }, {} as never);
    expect(workflowStatus).toHaveBeenCalledWith(pool, { runId: 1, decisionId: 7 });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.stage).toBe('risk');
  });

  it('returns a workflow_run_error directive instead of throwing for an unknown run', async () => {
    const { server, pool } = newServerAndPool();
    registerWorkflowStatusTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['workflow_status'];
    const result = await tool.handler({ run_id: 999 }, {} as never);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.action).toBe('workflow_run_error');
  });
});
