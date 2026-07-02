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
import { registerCreateSpecTool } from './tools/create-spec.js';
import { registerValidateSpecTool } from './tools/validate-spec.js';
import { registerImpactAnalysisTool } from './tools/impact-analysis.js';
import { registerGenerateTestsTool } from './tools/generate-tests.js';
import { registerValidateCoverageTool } from './tools/validate-coverage.js';
import { registerRequestReviewTool } from './tools/request-review.js';
import { registerTraceArtifactTool } from './tools/trace-artifact.js';
import { registerRunWorkflowTool } from './tools/run-workflow.js';
import { registerWorkflowStatusTool } from './tools/workflow-status.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool({ connectionString: config.databaseUrl });

  const server = new McpServer({ name: 'harness-os', version: '0.1.0' });
  registerGetConstitutionTool(server, pool);
  registerEvaluateGovernanceTool(server, pool);
  registerAssessRiskTool(server, pool);
  registerRecordDecisionTool(server, pool);
  registerAuditReportTool(server, pool);
  registerCreateSpecTool(server, pool);
  registerValidateSpecTool(server);
  registerImpactAnalysisTool(server, pool);
  registerGenerateTestsTool(server, pool);
  registerValidateCoverageTool(server, pool);
  registerRequestReviewTool(server, pool);
  registerTraceArtifactTool(server, pool);
  registerRunWorkflowTool(server, pool);
  registerWorkflowStatusTool(server, pool);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error('harness-os MCP server failed to start:', error);
  process.exit(1);
});
