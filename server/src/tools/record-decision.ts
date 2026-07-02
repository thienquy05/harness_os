import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { recordDecision } from '@harness-os/core';

export function registerRecordDecisionTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'record_decision',
    {
      title: 'Record Decision',
      description:
        'Appends a row to the append-only Decision/Audit Log. Never used to self-assert a RED/GREEN ' +
        'test result (CONST-AI-003) — those are only written by gate-check after it observes the ' +
        'exit code itself.',
      inputSchema: {
        project_path: z.string(),
        actor: z.string().describe('Who/what made this decision, e.g. "claude-code", "security-reviewer".'),
        action: z.string(),
        rationale: z.string(),
        risk_level: z.enum(['critical', 'high', 'medium', 'low']),
        constitution_rules_applied: z.array(z.string()).optional(),
        status: z.enum(['approved', 'pending_approval', 'rejected']).optional(),
        related_decision_id: z.number().int().optional(),
      },
    },
    async (args) => {
      const result = await recordDecision(pool, {
        projectPath: args.project_path,
        actor: args.actor,
        action: args.action,
        rationale: args.rationale,
        riskLevel: args.risk_level,
        constitutionRulesApplied: args.constitution_rules_applied,
        status: args.status,
        relatedDecisionId: args.related_decision_id,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
