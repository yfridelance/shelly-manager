import path from 'node:path';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

const LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Directory of the built Angular bundle; only set in production. */
  staticDir: string | undefined;
  logLevel: LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${env['PORT']}`);
  }

  const logLevel = (env['LOG_LEVEL'] ?? 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${env['LOG_LEVEL']}`);
  }

  const staticDir = env['STATIC_DIR']?.trim();

  return {
    port,
    // Loopback by default: the app has no login and can factory-reset devices.
    // The container sets HOST=0.0.0.0 explicitly.
    host: env['HOST']?.trim() || '127.0.0.1',
    dataDir: path.resolve(env['DATA_DIR']?.trim() || 'data'),
    staticDir: staticDir ? path.resolve(staticDir) : undefined,
    logLevel,
  };
}
