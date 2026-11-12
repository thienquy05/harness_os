import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { minimatch } from 'minimatch';
import { resolveProjectFsPath } from './project-path.js';
import type { RiskOverrides } from './risk.js';

export interface TestCommandConfig {
  globs: string[];
  command: string;
}

export interface HarnessConfig {
  gatedGlobs: string[];
  exemptGlobs: string[];
  testGlobs: string[];
  testCommands: TestCommandConfig[];
  /** Optional per-project risk keyword overrides (risk/rubric.md). */
  risk?: RiskOverrides;
}

export async function readHarnessConfig(projectPath: string): Promise<HarnessConfig> {
  const configPath = join(resolveProjectFsPath(projectPath), '.claude', 'harness.config.json');
  const raw = JSON.parse(await readFile(configPath, 'utf-8')) as Partial<HarnessConfig>;
  return {
    gatedGlobs: raw.gatedGlobs ?? [],
    exemptGlobs: raw.exemptGlobs ?? [],
    testGlobs: raw.testGlobs ?? [],
    testCommands: raw.testCommands ?? [],
    ...(raw.risk ? { risk: validRiskOverrides(raw.risk) } : {}),
  };
}

/** Keeps only lists of strings, so a mistyped `"extraHigh": "nfc"` is ignored rather than split into letters. */
function validRiskOverrides(risk: unknown): RiskOverrides {
  const out: RiskOverrides = {};
  for (const key of ['ignoreKeywords', 'extraCritical', 'extraHigh'] as const) {
    const list = (risk as Record<string, unknown> | null)?.[key];
    if (Array.isArray(list) && list.every((k) => typeof k === 'string' && k.trim() !== '')) out[key] = list;
  }
  return out;
}

export type FileClassification = 'exempt' | 'test' | 'gated' | 'ungated';

/**
 * Precedence — exempt overrides everything (docs/locks are always writable),
 * testGlobs takes priority over gatedGlobs (a test file must be creatable
 * before it can go RED, per plan §5.1), and anything matching neither
 * gatedGlobs nor the higher-priority globs is simply not gated at all — a
 * project with gatedGlobs: [] gates nothing (matches gates.test.ts's existing
 * Phase 1 fixture).
 */
export function classifyFile(config: HarnessConfig, filePath: string): FileClassification {
  if (config.exemptGlobs.some((pattern) => minimatch(filePath, pattern))) return 'exempt';
  if (config.testGlobs.some((pattern) => minimatch(filePath, pattern))) return 'test';
  if (config.gatedGlobs.some((pattern) => minimatch(filePath, pattern))) return 'gated';
  return 'ungated';
}
