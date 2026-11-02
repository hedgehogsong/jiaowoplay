import { config } from './config.js';

const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVEL_ORDER;

/** 出现这些字段时一律不落日志，避免泄露重连令牌等敏感信息 */
const REDACTED_KEYS = new Set([
  'reconnectToken',
  'token',
  'password',
  'secret',
  'sessionSecret',
  'authorization',
]);

const MIN_LEVEL = LEVEL_ORDER[config.logLevel];

function safeValue(key: string, value: unknown): unknown {
  if (REDACTED_KEYS.has(key)) return '[redacted]';
  if (typeof value === 'string' && value.length > 400) return `${value.slice(0, 400)}…`;
  return value;
}

function serialize(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    const safe = safeValue(key, value);
    parts.push(
      typeof safe === 'object' && safe !== null ? `${key}=${JSON.stringify(safe)}` : `${key}=${String(safe)}`,
    );
  }
  return parts.join(' ');
}

function write(level: Level, message: string, payload?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${
    payload ? ` ${serialize(payload)}` : ''
  }`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, payload?: Record<string, unknown>) => write('debug', message, payload),
  info: (message: string, payload?: Record<string, unknown>) => write('info', message, payload),
  warn: (message: string, payload?: Record<string, unknown>) => write('warn', message, payload),
  error: (message: string, payload?: Record<string, unknown>) => write('error', message, payload),
};
