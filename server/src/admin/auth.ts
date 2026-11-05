import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config.js';
import { AppError, ErrorCode } from '../domain/errors.js';

export interface AdminTokenPayload {
  sub: string;
  scope: 'admin';
  u: string;
}

const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 5;

/** 摘要成等长再比较，避免长度差异带来的时序侧信道 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export class LoginFailureTracker {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = MAX_FAILURES_PER_WINDOW,
    private readonly windowMs = FAILURE_WINDOW_MS,
  ) {}

  /** 超出窗口则抛 429；应在校验凭据之前调用 */
  assertAllowed(key: string, now = Date.now()): void {
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length > 0) this.attempts.set(key, recent);
    if (recent.length >= this.maxFailures) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        '登录失败次数过多，请 10 分钟后再试',
        429,
      );
    }
  }

  recordFailure(key: string, now = Date.now()): void {
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < this.windowMs);
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 2_000) this.prune(now);
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  private prune(now: number): void {
    for (const [key, times] of this.attempts) {
      const recent = times.filter((time) => now - time < this.windowMs);
      if (recent.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, recent);
    }
  }

  reset(): void {
    this.attempts.clear();
  }
}

export function issueAdminToken(
  config: AppConfig,
): { token: string; expiresInSeconds: number } {
  if (!config.adminJwtSecret) {
    throw new AppError(ErrorCode.ADMIN_UNAVAILABLE, '后台未配置签名密钥，暂不可用', 503);
  }
  const expiresInSeconds = config.adminTokenTtlSeconds;
  const token = jwt.sign(
    { sub: 'admin', scope: 'admin', u: config.adminUser } satisfies AdminTokenPayload,
    config.adminJwtSecret,
    { expiresIn: expiresInSeconds },
  );
  return { token, expiresInSeconds };
}

export function verifyAdminToken(config: AppConfig, rawToken: string): AdminTokenPayload {
  if (!config.adminJwtSecret) {
    throw new AppError(ErrorCode.ADMIN_UNAVAILABLE, '后台未配置签名密钥，暂不可用', 503);
  }
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(rawToken, config.adminJwtSecret);
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    throw new AppError(
      ErrorCode.ADMIN_UNAUTHORIZED,
      expired ? '登录已过期，请重新登录' : '登录凭证无效，请重新登录',
      401,
    );
  }
  if (typeof decoded === 'string' || decoded.scope !== 'admin') {
    throw new AppError(ErrorCode.ADMIN_UNAUTHORIZED, '登录凭证无效，请重新登录', 401);
  }
  return decoded as unknown as AdminTokenPayload;
}

/** 校验账号密码；失败抛 401，调用方负责记录失败次数 */
export function assertAdminCredentials(config: AppConfig, username: string, password: string): void {
  if (!config.adminUser || !config.adminPass || !config.adminJwtSecret) {
    throw new AppError(ErrorCode.ADMIN_UNAVAILABLE, '后台未配置管理员账号，暂不可用', 503);
  }
  const userOk = constantTimeEquals(username, config.adminUser);
  const passOk = constantTimeEquals(password, config.adminPass);
  if (!userOk || !passOk) {
    throw new AppError(ErrorCode.ADMIN_UNAUTHORIZED, '账号或密码错误', 401);
  }
}

export function extractBearer(header: string | undefined): string {
  const raw = (header ?? '').trim();
  if (!raw) return '';
  const [scheme, token] = raw.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AppError(ErrorCode.ADMIN_UNAUTHORIZED, '缺少登录凭证', 401);
  }
  return token.trim();
}
