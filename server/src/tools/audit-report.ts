import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { auditReport } from '@harness-os/core';

export function registerAuditReportTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'audit_report',
    {
      title: 'Audit Report',
      description: 'Returns the full append-only decision log for a project, most recent first.',
      inputSchema: {
        project_path: z.string(),
      },
    },
    async (args) => {
      const decisions = await auditReport(pool, args.project_path);
      return {
        content: [{ type: 'text', text: JSON.stringify(decisions, null, 2) }],
      };
    },
  );
}
