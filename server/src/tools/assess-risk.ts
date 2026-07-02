import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { assessAndRecordRisk } from '@harness-os/core';

export function registerAssessRiskTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'assess_risk',
    {
      title: 'Assess Risk',
      description:
        'Classifies a proposed change (critical|high|medium|low), rule-based and deterministic ' +
        '(see risk/rubric.md) — not LLM-backed. Persists the assessment and returns the required ' +
        'gates for that level.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the governed project.'),
        request_description: z.string().describe('Free-text description of the proposed change.'),
        touched_paths: z.array(z.string()).optional().describe('File paths the change is expected to touch.'),
      },
    },
    async (args) => {
      const assessment = await assessAndRecordRisk(pool, {
        projectPath: args.project_path,
        requestDescription: args.request_description,
        touchedPaths: args.touched_paths,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(assessment, null, 2) }],
      };
    },
  );
}
