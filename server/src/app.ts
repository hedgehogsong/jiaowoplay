import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import { logger } from './logger.js';
import { createHealthRouter } from './routes/health.js';
import { createRoomsRouter, errorHandler } from './routes/rooms.js';
import type { RoomManager } from './rooms/RoomManager.js';
import type { HistoryRepository } from './db/repository.js';

export interface AppDeps {
  config: AppConfig;
  manager: RoomManager;
  history: HistoryRepository | null;
}

export function createApp({ config, manager, history }: AppDeps): express.Express {
  const app = express();

  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);

  // 纯 HTTP 访问时不能启用 upgrade-insecure-requests，
  // 否则浏览器会把静态资源升级到 https，未配 443 时直接白屏。
  const publicOriginIsHttps = config.corsOrigins.some((origin) =>
    origin.toLowerCase().startsWith('https://'),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: publicOriginIsHttps ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // COOP / Origin-Agent-Cluster 仅在安全上下文生效；
      // 纯 HTTP + 裸 IP 时浏览器会直接忽略并各自报一条控制台错误，
      // 因此非 https 时不下发，等启用 TLS 后自动恢复。
      crossOriginOpenerPolicy: publicOriginIsHttps ? { policy: 'same-origin' } : false,
      originAgentCluster: publicOriginIsHttps,
      referrerPolicy: { policy: 'same-origin' },
    }),
  );

  app.use(
    cors({
      origin: config.isProduction ? config.corsOrigins : true,
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
    }),
  );

  app.use(express.json({ limit: '32kb' }));

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } },
  });

  const joinLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.method === 'GET',
    message: { error: { code: 'RATE_LIMITED', message: '创建/加入房间过于频繁，请稍后再试' } },
  });

  app.use('/api', apiLimiter, joinLimiter);
  app.use('/api', createRoomsRouter(manager, history));
  app.use('/health', createHealthRouter(manager, history !== null));

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    const indexHtml = path.join(config.staticDir, 'index.html');
    // Vite 产物带内容哈希，可长期不可变缓存；index.html 仍需每次回源
    app.use(
      '/assets',
      express.static(path.join(config.staticDir, 'assets'), {
        index: false,
        maxAge: '1y',
        immutable: true,
      }),
    );
    app.use(express.static(config.staticDir, { index: false, maxAge: '5m' }));
    app.get(/^(?!\/api|\/health|\/socket\.io).*/, (_req, res) => {
      res.sendFile(indexHtml);
    });
    logger.info('已托管前端静态资源', { staticDir: config.staticDir });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text/plain; charset=utf-8')
        .send('交我PLAY 服务已启动。前端未托管：请配置 STATIC_DIR 或用 npm run dev 启动 Vite。');
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  app.use(errorHandler);
  return app;
}
