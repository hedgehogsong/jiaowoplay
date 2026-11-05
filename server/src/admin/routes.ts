import { Router, type Request } from 'express';
import { z } from 'zod';
import { isAdminConfigured, type AppConfig } from '../config.js';
import type { HistoryRepository } from '../db/repository.js';
import { AppError, ErrorCode } from '../domain/errors.js';
import { logger } from '../logger.js';
import {
  LoginFailureTracker,
  assertAdminCredentials,
  extractBearer,
  issueAdminToken,
  verifyAdminToken,
  type AdminTokenPayload,
} from './auth.js';

const credentialsSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
});

export interface AdminRouterDeps {
  config: AppConfig;
  history: HistoryRepository | null;
  failures?: LoginFailureTracker;
}

export function createAdminRouter({ config, history, failures }: AdminRouterDeps): Router {
  const router = Router();
  const tracker = failures ?? new LoginFailureTracker();

  const requireConfigured = (): void => {
    if (!isAdminConfigured(config)) {
      throw new AppError(ErrorCode.ADMIN_UNAVAILABLE, '后台未启用', 503);
    }
    if (!history) {
      throw new AppError(ErrorCode.ADMIN_UNAVAILABLE, '历史数据库不可用，后台暂无法读取数据', 503);
    }
  };

  const requireAdmin = (req: Request): AdminTokenPayload => {
    requireConfigured();
    const token = extractBearer(req.headers.authorization);
    return verifyAdminToken(config, token);
  };

  router.post('/login', (req, res, next) => {
    try {
      requireConfigured();
      const key = req.ip ?? 'unknown';
      tracker.assertAllowed(key);

      const parsed = credentialsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        tracker.recordFailure(key);
        logger.warn('后台登录参数不合法', { ip: key });
        throw new AppError(ErrorCode.ADMIN_UNAUTHORIZED, '账号或密码错误', 401);
      }

      try {
        assertAdminCredentials(config, parsed.data.username, parsed.data.password);
      } catch (error) {
        tracker.recordFailure(key);
        // 只记录尝试的账号，绝不记录密码或 token
        logger.warn('后台登录失败', { ip: key, username: parsed.data.username });
        throw error;
      }

      tracker.recordSuccess(key);
      const issued = issueAdminToken(config);
      logger.info('后台登录成功', { ip: key, username: parsed.data.username });
      res.json(issued);
    } catch (error) {
      next(error);
    }
  });

  router.get('/sessions', (req, res, next) => {
    try {
      requireAdmin(req);
      if (!history) throw new AppError(ErrorCode.ADMIN_UNAVAILABLE, '历史数据库不可用', 503);
      const parsed = querySchema.safeParse(req.query ?? {});
      const page = parsed.success ? parsed.data.page : 1;
      const limit = parsed.success ? parsed.data.limit : 20;
      res.json(history.listAdminSessions(page, limit));
    } catch (error) {
      next(error);
    }
  });

  router.get('/sessions/:id', (req, res, next) => {
    try {
      requireAdmin(req);
      if (!history) throw new AppError(ErrorCode.ADMIN_UNAVAILABLE, '历史数据库不可用', 503);
      const id = String(req.params.id ?? '').trim();
      if (id.length === 0 || id.length > 64) {
        throw new AppError(ErrorCode.INVALID_PAYLOAD, '对局 ID 不合法', 400);
      }
      const detail = history.getAdminSession(id);
      if (!detail) {
        throw new AppError(ErrorCode.ROOM_NOT_FOUND, '未找到该对局记录', 404);
      }
      res.json({ session: detail });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
