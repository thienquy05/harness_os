import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SPEC_TYPES, validateSpecContent } from '@harness-os/core';

/**
 * Dry-run validation — preview whether content would pass schema validation
 * without writing anything. create_spec runs the same check internally as a
 * write precondition; this tool exists so Claude can check before committing
 * to a create_spec call. No DB access needed, unlike every other tool here.
 */
export function registerValidateSpecTool(server: McpServer): void {
  server.registerTool(
    'validate_spec',
    {
      title: 'Validate Spec',
      description: 'Checks spec content against its type schema without writing anything.',
      inputSchema: {
        type: z.enum(SPEC_TYPES as [string, ...string[]]),
        content: z.record(z.unknown()),
      },
    },
    async (args) => {
      const result = await validateSpecContent(args.type as (typeof SPEC_TYPES)[number], args.content);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
