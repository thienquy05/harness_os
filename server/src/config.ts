export interface ServerConfig {
  databaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set (see db/docker-compose.yml / server/Dockerfile)');
  }
  return { databaseUrl };
}
