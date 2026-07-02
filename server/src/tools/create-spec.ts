import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSpec, SPEC_TYPES, SpecDependencyError, SpecValidationError } from '@harness-os/core';

export function registerCreateSpecTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'create_spec',
    {
      title: 'Create Spec',
      description:
        'Registers a spec (product|domain|api|data|infra) against its JSON schema. Rejects invalid ' +
        'content outright — never writes a row that failed schema validation. If a spec with this ' +
        'spec_id already exists, supersedes the prior version and creates the next one, atomically.',
      inputSchema: {
        project_path: z.string().describe('Absolute path to the governed project.'),
        spec_id: z.string().describe('Business identifier, e.g. APX-API-001.'),
        type: z.enum(SPEC_TYPES as [string, ...string[]]),
        title: z.string(),
        content: z.record(z.unknown()).describe('Spec content matching its type schema.'),
        depends_on: z
          .array(z.string())
          .optional()
          .describe('spec_ids of other specs this one depends on. Each must already exist as an active spec.'),
      },
    },
    async (args) => {
      try {
        const spec = await createSpec(pool, {
          projectPath: args.project_path,
          specId: args.spec_id,
          type: args.type as (typeof SPEC_TYPES)[number],
          title: args.title,
          content: args.content,
          dependsOn: args.depends_on,
        });
        return { content: [{ type: 'text', text: JSON.stringify(spec, null, 2) }] };
      } catch (error) {
        if (error instanceof SpecValidationError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ action: 'fix_spec_content', reason: error.message, errors: error.errors }),
              },
            ],
          };
        }
        if (error instanceof SpecDependencyError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ action: 'fix_spec_dependency', reason: error.message }),
              },
            ],
          };
        }
        throw error;
      }
    },
  );
}
