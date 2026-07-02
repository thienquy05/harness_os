import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { assessAndRecordRisk, getConstitution } from '@harness-os/core';

/**
 * Non-blocking pre-check (§5.1: "Constitution | Pre-check | evaluate_governance
 * non-blocking required before spec creation"). Combines get_constitution +
 * assess_risk into one call so Claude Code has both the applicable rules and
 * the risk level before it starts creating a spec — it does not itself
 * gate anything; enforce-gate.sh + gate-check are what actually block.
 */
export function registerEvaluateGovernanceTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'evaluate_governance',
    {
      title: 'Evaluate Governance',
      description:
        'Returns the applicable constitution rules and a risk assessment for a proposed change, ' +
        'before any spec or code is written. Informational — does not block by itself.',
      inputSchema: {
        project_path: z.string(),
        request_description: z.string(),
        touched_paths: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const [constitution, riskAssessment] = await Promise.all([
        getConstitution(pool, { projectPath: args.project_path }),
        assessAndRecordRisk(pool, {
          projectPath: args.project_path,
          requestDescription: args.request_description,
          touchedPaths: args.touched_paths,
        }),
      ]);
      return {
        content: [{ type: 'text', text: JSON.stringify({ constitution, riskAssessment }, null, 2) }],
      };
    },
  );
}
