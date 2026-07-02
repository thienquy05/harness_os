import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { recordTraceabilityEdge } from '@harness-os/core';

export function registerTraceArtifactTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'trace_artifact',
    {
      title: 'Trace Artifact',
      description:
        'Records a traceability edge between two artifacts (e.g. constitution_rule -> spec, spec -> test, ' +
        'test -> commit_sha, review -> decision_id). New edges always start non-stale; specs.ts flips ' +
        'stale=true automatically when the spec at either end is superseded.',
      inputSchema: {
        project_path: z.string(),
        from_type: z.string(),
        from_id: z.string(),
        to_type: z.string(),
        to_id: z.string(),
      },
    },
    async (args) => {
      const edge = await recordTraceabilityEdge(pool, {
        projectPath: args.project_path,
        fromType: args.from_type,
        fromId: args.from_id,
        toType: args.to_type,
        toId: args.to_id,
      });
      return { content: [{ type: 'text', text: JSON.stringify(edge, null, 2) }] };
    },
  );
}
