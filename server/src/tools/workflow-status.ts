import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UnknownWorkflowError, workflowStatus, WorkflowRunNotFoundError } from '@harness-os/core';

export function registerWorkflowStatusTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'workflow_status',
    {
      title: 'Workflow Status',
      description:
        'Re-checks the current stage of a workflow_run against real state and advances it if that stage is ' +
        'actually complete — returns the same directive again if not. Pass decision_id after your own ' +
        "record_decision(status='pending_approval') call for a stage that requires human approval, so the " +
        'server can track it via the existing harness approve mechanism.',
      inputSchema: {
        run_id: z.number().int(),
        decision_id: z.number().int().optional(),
      },
    },
    async (args) => {
      try {
        const result = await workflowStatus(pool, { runId: args.run_id, decisionId: args.decision_id });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        if (error instanceof WorkflowRunNotFoundError || error instanceof UnknownWorkflowError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ action: 'workflow_run_error', reason: error.message }) }],
          };
        }
        throw error;
      }
    },
  );
}
