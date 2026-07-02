import type { Pool } from 'pg';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getConstitution } from '@harness-os/core';

export function registerGetConstitutionTool(server: McpServer, pool: Pool): void {
  server.registerTool(
    'get_constitution',
    {
      title: 'Get Constitution',
      description:
        'Returns the current versioned constitution: global rules, each tagged severity ' +
        '(critical|high|medium|low) and enforcement (gate|review), merged with any ' +
        'project-local overrides found under <project_path>/.claude/constitution/*.md.',
      inputSchema: {
        project_path: z
          .string()
          .optional()
          .describe('Absolute path to the governed project, for project-local rule overrides.'),
      },
    },
    async (args) => {
      const constitution = await getConstitution(pool, { projectPath: args.project_path });
      return {
        content: [{ type: 'text', text: JSON.stringify(constitution, null, 2) }],
      };
    },
  );
}
