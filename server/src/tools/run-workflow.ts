import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { runWorkflow, UnknownWorkflowError, WORKFLOW_DEFINITIONS } from '@harness-os/core';

const WORKFLOW_NAMES = Object.keys(WORKFLOW_DEFINITIONS);

export function registerRunWorkflowTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'run_workflow',
    {
      title: 'Run Workflow',
      description:
        'Starts a governed multi-stage workflow (new-feature|security-change|hotfix, plan §6) and returns ' +
        "the FIRST stage's directive only — never the whole sequence. This engine is server-authoritative: " +
        'each stage advances only once workflow_status observes real evidence (an active spec, a ' +
        'host-observed red test run, a recorded decision, etc), never a self-reported "done". Call ' +
        'workflow_status with the returned run_id after acting on each directive.',
      inputSchema: {
        workflow_name: z.enum(WORKFLOW_NAMES as [string, ...string[]]),
        project_path: z.string().describe('Absolute path to the governed project.'),
        spec_id: z.string().optional().describe('Required for workflows whose first stages need an active spec.'),
      },
    },
    async (args) => {
      try {
        const result = await runWorkflow(pool, {
          workflowName: args.workflow_name,
          projectPath: args.project_path,
          specId: args.spec_id ?? null,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        if (error instanceof UnknownWorkflowError) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ action: 'unknown_workflow', reason: error.message }) }],
          };
        }
        throw error;
      }
    },
  );
}
