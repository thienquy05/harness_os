import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface DbConfig {
  connectionString: string;
}

/** Anything with pg's `.query` shape — a bare Pool, or a client checked out inside a transaction. */
export type Queryable = Pool | PoolClient;

export function createPool(config?: Partial<DbConfig>): Pool {
  const connectionString = config?.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set and no connectionString was provided');
  }
  return new Pool({ connectionString });
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  db: Queryable,
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(text, params);
  return result.rows;
}

/**
 * Spec-version bumps (Phase 2) need "supersede the prior row, insert the new
 * one, and mark dependent traceability_edges stale" to happen atomically —
 * a partial write here would leave the spec registry and the traceability
 * graph disagreeing about which version is current.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
