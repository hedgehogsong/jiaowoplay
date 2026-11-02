import fs from 'node:fs';
import path from 'node:path';

function tryLoadEnv(): void {
  if (typeof process.loadEnvFile !== 'function') return;
  const here = import.meta.dirname;
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(here, '..', '.env'),
    path.resolve(here, '..', '..', '.env'),
    path.resolve(here, '..', '..', '..', '.env'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        process.loadEnvFile(file);
        return;
      }
    } catch {
      /* 忽略，继续尝试下一个候选路径 */
    }
  }
}

tryLoadEnv();

const SERVER_ROOT = path.resolve(import.meta.dirname, '..');

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export interface AppConfig {
  port: number;
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  dbPath: string;
  sessionSecret: string;
  corsOrigins: string[];
  staticDir: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  serverRoot: string;
}

export function loadConfig(): AppConfig {
  const nodeEnvRaw = (process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const nodeEnv = (
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development'
  ) as AppConfig['nodeEnv'];

  const dbPathRaw = process.env.DB_PATH?.trim() || './data/jiaowoplay.sqlite';
  const dbPath = path.isAbsolute(dbPathRaw)
    ? dbPathRaw
    : path.resolve(SERVER_ROOT, dbPathRaw);

  const staticDirRaw = process.env.STATIC_DIR?.trim() ?? '';
  const staticDir = staticDirRaw
    ? path.isAbsolute(staticDirRaw)
      ? staticDirRaw
      : path.resolve(SERVER_ROOT, staticDirRaw)
    : null;

  const logLevelRaw = (process.env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  const logLevel = (
    ['debug', 'info', 'warn', 'error'].includes(logLevelRaw)
      ? logLevelRaw
      : 'info'
  ) as AppConfig['logLevel'];

  return {
    port: intFromEnv('PORT', 3000),
    host: process.env.HOST?.trim() || (nodeEnv === 'production' ? '127.0.0.1' : '127.0.0.1'),
    nodeEnv,
    isProduction: nodeEnv === 'production',
    dbPath,
    sessionSecret: process.env.SESSION_SECRET?.trim() || '',
    corsOrigins: listFromEnv('CORS_ORIGIN', [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]),
    staticDir,
    logLevel,
    serverRoot: SERVER_ROOT,
  };
}

export const config = loadConfig();
