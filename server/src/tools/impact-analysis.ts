import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { impactAnalysis } from '@harness-os/core';

export function registerImpactAnalysisTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'impact_analysis',
    {
      title: 'Impact Analysis',
      description:
        'Given a spec_id, returns every other spec that depends on it (directly or transitively), ' +
        'via spec_dependencies. Use before changing a spec to see what else needs review.',
      inputSchema: {
        spec_id: z.string(),
      },
    },
    async (args) => {
      const dependents = await impactAnalysis(pool, args.spec_id);
      return { content: [{ type: 'text', text: JSON.stringify(dependents, null, 2) }] };
    },
  );
}
