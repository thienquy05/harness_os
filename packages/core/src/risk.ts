import type { Pool } from 'pg';
import { query } from './db.js';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

// Mirrors risk/rubric.md's classification rule exactly — keep both in sync.
const CRITICAL_KEYWORDS = [
  'trading', 'trade', 'order', 'payment', 'financial', 'wallet', 'ledger', 'funds', 'withdraw', 'deposit',
];
const HIGH_KEYWORDS = [
  'auth', 'authentication', 'authorization', 'password', 'token', 'session', 'credential', 'crypto', 'secret', 'pii', 'personal data',
];

export interface RiskAssessmentInput {
  requestDescription: string;
  touchedPaths?: string[];
}

export interface RiskAssessment {
  level: RiskLevel;
  rationale: string;
  factors: Record<string, unknown>;
  requiredGates: string[];
}

function matchesAny(haystack: string, keywords: string[]): string[] {
  const lower = haystack.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword));
}

/** Rule-based, deterministic — no LLM call (§2.4). Same inputs always produce the same level. */
export function assessRisk(input: RiskAssessmentInput): RiskAssessment {
  const searchText = [input.requestDescription, ...(input.touchedPaths ?? [])].join(' ');

  const criticalMatches = matchesAny(searchText, CRITICAL_KEYWORDS);
  if (criticalMatches.length > 0) {
    return {
      level: 'critical',
      rationale: `Auto-critical: matched financial/trading keyword(s): ${criticalMatches.join(', ')} (CONST-ARCH-001).`,
      factors: { rule: 'auto-critical-keyword', matched: criticalMatches },
      requiredGates: ['spec', 'tests', 'review:security', 'human-ack'],
    };
  }

  const highMatches = matchesAny(searchText, HIGH_KEYWORDS);
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
  const assessment = assessRisk(input);
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
