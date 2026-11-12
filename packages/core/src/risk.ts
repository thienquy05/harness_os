import type { Pool } from 'pg';
import { query } from './db.js';
import { readHarnessConfig } from './harness-config.js';
import { verifyConfigIntegrity } from './config-integrity.js';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

// Mirrors risk/rubric.md's classification rule exactly — keep both in sync.
const CRITICAL_KEYWORDS = [
  'trading', 'trade', 'order', 'payment', 'financial', 'wallet', 'ledger', 'funds', 'withdraw', 'deposit',
];
const HIGH_KEYWORDS = [
  'auth', 'oauth', 'authenticate', 'authentication', 'authorize', 'authorization', 'password', 'token', 'session', 'credential', 'crypto', 'secret', 'pii', 'personal data',
];

export interface RiskAssessmentInput {
  requestDescription: string;
  touchedPaths?: string[];
}

/** Per-project keyword overrides: `risk` in .claude/harness.config.json (checksummed with the rest of it). */
export interface RiskOverrides {
  ignoreKeywords?: string[];
  extraCritical?: string[];
  extraHigh?: string[];
}

export interface RiskAssessment {
  level: RiskLevel;
  rationale: string;
  factors: Record<string, unknown>;
  requiredGates: string[];
}

/**
 * Whole words only ("border" is not "order", "author" is not "auth"). Identifiers are split into words
 * (camelCase, ACRONYMWord, digits, snake_case), and common inflections are allowed
 * (payments, authenticated, withdrawal, cryptography).
 */
function matchesAny(haystack: string, keywords: string[]): string[] {
  const words = haystack
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return keywords.filter((keyword) => {
    const k = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${k}(?:s|es|d|ed|ing|al|ation|ations|ic|graphy|graphic)?\\b`).test(words);
  });
}

/** Rule-based, deterministic — no LLM call (§2.4). Same inputs always produce the same level. */
export function assessRisk(input: RiskAssessmentInput, overrides: RiskOverrides = {}): RiskAssessment {
  const searchText = [input.requestDescription, ...(input.touchedPaths ?? [])].join(' ');
  const ignored = new Set((overrides.ignoreKeywords ?? []).map((k) => k.toLowerCase()));
  const keep = (list: string[]) => list.filter((k) => !ignored.has(k.toLowerCase()));
  const CRITICAL_KEYWORDS_P = keep([...CRITICAL_KEYWORDS, ...(overrides.extraCritical ?? [])]);
  const HIGH_KEYWORDS_P = keep([...HIGH_KEYWORDS, ...(overrides.extraHigh ?? [])]);

  const criticalMatches = matchesAny(searchText, CRITICAL_KEYWORDS_P);
  if (criticalMatches.length > 0) {
    return {
      level: 'critical',
      rationale: `Auto-critical: matched financial/trading keyword(s): ${criticalMatches.join(', ')} (CONST-ARCH-001).`,
      factors: { rule: 'auto-critical-keyword', matched: criticalMatches },
      requiredGates: ['spec', 'tests', 'review:security', 'human-ack'],
    };
  }

  const highMatches = matchesAny(searchText, HIGH_KEYWORDS_P);
  if (highMatches.length > 0) {
    return {
      level: 'high',
      rationale: `Auto-high: matched security-sensitive keyword(s): ${highMatches.join(', ')}.`,
      factors: { rule: 'auto-high-keyword', matched: highMatches },
      requiredGates: ['spec', 'tests', 'review:security'],
    };
  }

  if (input.touchedPaths && input.touchedPaths.length > 0) {
    return {
      level: 'medium',
      rationale: 'Touches a gated path with no security/financial keyword match.',
      factors: { rule: 'gated-path', touchedPaths: input.touchedPaths },
      requiredGates: ['spec', 'tests', 'review:code'],
    };
  }

  return {
    level: 'low',
    rationale: 'No gated path or sensitive keyword matched.',
    factors: { rule: 'default' },
    requiredGates: [],
  };
}

export interface StoredRiskAssessment extends RiskAssessment {
  id: number;
  requestDescription: string;
  projectPath: string;
}

/** Escalation-only by convention (risk/rubric.md): nothing here lowers a level once assigned. */
export async function assessAndRecordRisk(
  pool: Pool,
  input: RiskAssessmentInput & { projectPath: string },
): Promise<StoredRiskAssessment> {
  // Overrides apply only from a config that still matches its verified checksum (an agent could
  // otherwise write an override, assess, and restore the file). A project without a readable or
  // verified config (not initialized, or not mounted here) uses the global rubric.
  const verified = await verifyConfigIntegrity(pool, input.projectPath).then((r) => r.ok, () => false);
  const overrides = verified
    ? await readHarnessConfig(input.projectPath).then((c) => c.risk ?? {}, () => ({}))
    : {};
  const assessment = assessRisk(input, overrides);
  if (Object.keys(overrides).length > 0) assessment.factors = { ...assessment.factors, overrides };
  const rows = await query<{ id: number }>(
    pool,
    `INSERT INTO risk_assessments (request_description, factors, level, rationale, required_gates, project_path)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.requestDescription,
      JSON.stringify(assessment.factors),
      assessment.level,
      assessment.rationale,
      assessment.requiredGates,
      input.projectPath,
    ],
  );
  return {
    ...assessment,
    id: rows[0].id,
    requestDescription: input.requestDescription,
    projectPath: input.projectPath,
  };
}
