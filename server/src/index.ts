#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPool } from '@harness-os/core';
import { loadConfig } from './config.js';
import { registerGetConstitutionTool } from './tools/get-constitution.js';
import { registerEvaluateGovernanceTool } from './tools/evaluate-governance.js';
import { registerAssessRiskTool } from './tools/assess-risk.js';
import { registerRecordDecisionTool } from './tools/record-decision.js';
import { registerAuditReportTool } from './tools/audit-report.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool({ connectionString: config.databaseUrl });

  const server = new McpServer({ name: 'harness-os', version: '0.1.0' });
  registerGetConstitutionTool(server, pool);
  registerEvaluateGovernanceTool(server, pool);
  registerAssessRiskTool(server, pool);
  registerRecordDecisionTool(server, pool);
  registerAuditReportTool(server, pool);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error('harness-os MCP server failed to start:', error);
  process.exit(1);
});
