import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { recordDecision, requestReviewDirective, type RiskLevel } from '@harness-os/core';

const RISK_LEVELS: RiskLevel[] = ['critical', 'high', 'medium', 'low'];

/**
 * Routes to a reviewer by risk level (risk.ts's requiredGates convention:
 * critical/high -> security-reviewer, medium -> code-reviewer, low -> no
 * review gate). Never invokes the reviewer agent itself (CONST-AI-002) —
 * returns an invoke_agent directive for Claude Code to act on.
 */
export function registerRequestReviewTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'request_review',
    {
      title: 'Request Review',
      description: 'Given a risk level and the files touched, returns which reviewer agent (if any) must run before merge.',
      inputSchema: {
        project_path: z.string(),
        risk_level: z.enum(RISK_LEVELS as [string, ...string[]]),
        files: z.array(z.string()),
      },
    },
    async (args) => {
      const riskLevel = args.risk_level as RiskLevel;
      const directive = requestReviewDirective(riskLevel, args.files);

      await recordDecision(pool, {
        actor: 'gate-daemon',
        action: 'request_review',
        rationale: directive.reason,
        riskLevel,
        projectPath: args.project_path,
      });

      return { content: [{ type: 'text', text: JSON.stringify(directive, null, 2) }] };
    },
  );
}
