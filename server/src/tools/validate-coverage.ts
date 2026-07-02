import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { validateCoverage } from '@harness-os/core';

export function registerValidateCoverageTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'validate_coverage',
    {
      title: 'Validate Coverage',
      description:
        'Checks a reported coverage percentage against the 80% minimum (CLAUDE.md), or an explicit ' +
        'threshold override. Logs the outcome as a decision either way.',
      inputSchema: {
        project_path: z.string(),
        coverage_percent: z.number(),
        threshold: z.number().optional(),
      },
    },
    async (args) => {
      const result = await validateCoverage(pool, {
        projectPath: args.project_path,
        coveragePercent: args.coverage_percent,
        threshold: args.threshold,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
