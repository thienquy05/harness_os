import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { query } from './db.js';

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Enforcement = 'gate' | 'review';

export interface ConstitutionRule {
  ruleId: string;
  domain: string;
  text: string;
  severity: Severity;
  enforcement: Enforcement;
}

export interface Constitution {
  version: string;
  rules: ConstitutionRule[];
}

interface ConstitutionRuleRow {
  rule_id: string;
  domain: string;
  text: string;
  severity: string;
  enforcement: string;
}

const RULE_HEADING = /^##\s+(CONST-[A-Z]+-\d+)\s+—\s+.+$/;
const FIELD_LINE = /^-\s+(severity|enforcement|domain):\s*(.+)$/;
const REQUIRED_FIELDS = ['domain', 'severity', 'enforcement'] as const;

interface PartialRule {
  ruleId: string;
  domain?: string;
  severity?: string;
  enforcement?: string;
  bodyLines: string[];
}

function isCompleteRule(rule: PartialRule): rule is PartialRule & {
  domain: string;
  severity: string;
  enforcement: string;
} {
  return REQUIRED_FIELDS.every((field) => rule[field] !== undefined);
}

/** Parses the `## CONST-<DOMAIN>-<NNN> — Title` rule format documented in constitution/core.md. */
export function parseConstitutionMarkdown(content: string): ConstitutionRule[] {
  const rules: ConstitutionRule[] = [];
  let current: PartialRule | null = null;

  const flush = (): void => {
    if (current && isCompleteRule(current)) {
      rules.push({
        ruleId: current.ruleId,
        domain: current.domain,
        severity: current.severity as Severity,
        enforcement: current.enforcement as Enforcement,
        text: current.bodyLines.join(' ').trim(),
      });
    }
    current = null;
  };

  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(RULE_HEADING);
    if (heading) {
      flush();
      current = { ruleId: heading[1], bodyLines: [] };
      continue;
    }
    if (!current) continue;
    const field = line.match(FIELD_LINE);
    if (field) {
      const [, key, value] = field;
      current[key as 'severity' | 'enforcement' | 'domain'] = value.trim();
      continue;
    }
    if (line.trim().length > 0) {
      current.bodyLines.push(line.trim());
    }
  }
  flush();

  return rules;
}

/** Project-local rules replace a global rule with the same id; net-new project rules are appended. */
export function mergeRuleSets(
  globalRules: ConstitutionRule[],
  overrideRules: ConstitutionRule[],
): ConstitutionRule[] {
  const merged = new Map(globalRules.map((rule) => [rule.ruleId, rule]));
  for (const rule of overrideRules) {
    merged.set(rule.ruleId, rule);
  }
  return Array.from(merged.values()).sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

async function defaultReadProjectOverrides(projectPath: string): Promise<string[]> {
  const dir = join(projectPath, '.claude', 'constitution');
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const mdFiles = entries.filter((entry) => entry.endsWith('.md'));
  return Promise.all(mdFiles.map((file) => readFile(join(dir, file), 'utf-8')));
}

export interface GetConstitutionOptions {
  projectPath?: string;
  /** Injectable for tests; defaults to reading `<projectPath>/.claude/constitution/*.md`. */
  readProjectOverrides?: (projectPath: string) => Promise<string[]>;
}

export async function getConstitution(
  pool: Pool,
  options: GetConstitutionOptions = {},
): Promise<Constitution> {
  const versionRows = await query<{ version: string }>(
    pool,
    'SELECT version FROM constitution_versions ORDER BY created_at DESC LIMIT 1',
  );
  if (versionRows.length === 0) {
    throw new Error('No constitution version found — has the seed been applied?');
  }
  const version = versionRows[0].version;

  const ruleRows = await query<ConstitutionRuleRow>(
    pool,
    `SELECT cr.rule_id, cr.domain, cr.text, cr.severity, cr.enforcement
     FROM constitution_rules cr
     JOIN constitution_versions cv ON cr.version_id = cv.id
     WHERE cv.version = $1 AND cr.superseded_by IS NULL
     ORDER BY cr.rule_id`,
    [version],
  );
  const globalRules: ConstitutionRule[] = ruleRows.map((row) => ({
    ruleId: row.rule_id,
    domain: row.domain,
    text: row.text,
    severity: row.severity as Severity,
    enforcement: row.enforcement as Enforcement,
  }));

  if (!options.projectPath) {
    return { version, rules: globalRules };
  }

  const reader = options.readProjectOverrides ?? defaultReadProjectOverrides;
  const overrideContents = await reader(options.projectPath);
  const overrideRules = overrideContents.flatMap(parseConstitutionMarkdown);

  return { version, rules: mergeRuleSets(globalRules, overrideRules) };
}
