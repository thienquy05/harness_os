import { Pool, type QueryResultRow } from 'pg';

export interface DbConfig {
  connectionString: string;
}

export function createPool(config?: Partial<DbConfig>): Pool {
  const connectionString = config?.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set and no connectionString was provided');
  }
  return new Pool({ connectionString });
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
