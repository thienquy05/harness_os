import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildTestGenerationPlan, getActiveSpec } from '@harness-os/core';

/**
 * Never writes a test file itself (CONST-AI-002: no direct agent/code
 * invocation). Returns a write_tests directive naming the spec plus every
 * mechanically-derivable case harness-os could enumerate (domain
 * stateMachines only, see buildTestGenerationPlan) — Claude writes the test
 * file, then proves it RED via the Bash command enforce-gate.sh intercepts
 * (gates.ts's red-phase gate, plan §12.3).
 */
export function registerGenerateTestsTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'generate_tests',
    {
      title: 'Generate Tests',
      description:
        'Given a spec_id, returns a directive to write tests for it, including every state-transition ' +
        'case harness-os can mechanically enumerate from a domain spec\'s stateMachines.',
      inputSchema: {
        spec_id: z.string(),
      },
    },
    async (args) => {
      const spec = await getActiveSpec(pool, args.spec_id);
      if (!spec) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                action: 'spec_not_found',
                reason: `No active spec exists with spec_id "${args.spec_id}" — create it first with create_spec.`,
              }),
            },
          ],
        };
      }

      const plan = buildTestGenerationPlan(spec);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              action: 'write_tests',
              reason: `Write tests for "${spec.specId}" (${spec.type}). ${
                plan.stateMachineCases.length > 0
                  ? 'Every case below must become a test — valid transitions must succeed, invalid ones must be rejected.'
                  : 'No state machines to mechanically enumerate for this spec type; cover its content directly.'
              }`,
              ...plan,
            }),
          },
        ],
      };
    },
  );
}
