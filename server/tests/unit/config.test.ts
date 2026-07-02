import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('reads DATABASE_URL from the provided env', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://harness_app:harness_app@harness_postgres:5432/harness_os' });
    expect(config.databaseUrl).toBe('postgres://harness_app:harness_app@harness_postgres:5432/harness_os');
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
