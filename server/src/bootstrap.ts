import http from 'node:http';
import type express from 'express';
import { config as defaultConfig, type AppConfig } from './config.js';
import { openDatabase, type SqliteDatabase } from './db/index.js';
import { HistoryRepository } from './db/repository.js';
import { logger } from './logger.js';
import { attachSocketServer, type TypedServer } from './realtime/socketServer.js';
import { createNotifierFor } from './realtime/notifier.js';
import { RoomManager } from './rooms/RoomManager.js';
import { createApp } from './app.js';

export interface ServerBundle {
  config: AppConfig;
  app: express.Express;
  httpServer: http.Server;
  io: TypedServer;
  manager: RoomManager;
  history: HistoryRepository | null;
  database: SqliteDatabase | null;
  start(portOverride?: number): Promise<number>;
  close(): Promise<void>;
}

export function createServerBundle(configOverride: Partial<AppConfig> = {}): ServerBundle {
  const config: AppConfig = { ...defaultConfig, ...configOverride };

  let database: SqliteDatabase | null = null;
  let history: HistoryRepository | null = null;
  try {
    database = openDatabase(config.dbPath);
    history = new HistoryRepository(database);
  } catch (error) {
    logger.error('数据库初始化失败，历史持久化已禁用', {
      dbPath: config.dbPath,
      error: (error as Error).message,
    });
  }

  let io: TypedServer | null = null;

  const manager = new RoomManager({
    history,
    createNotifier: (room) => {
      if (!io) throw new Error('Socket.IO 尚未初始化');
      return createNotifierFor(io, room);
    },
  });

  const app = createApp({ config, manager, history });
  const httpServer = http.createServer(app);
  io = attachSocketServer(httpServer, manager, {
    corsOrigins: config.isProduction ? config.corsOrigins : true,
  });

  manager.startSweeper();

  const bundle: ServerBundle = {
    config,
    app,
    httpServer,
    io,
    manager,
    history,
    database,
    start(portOverride?: number): Promise<number> {
      const port = portOverride ?? config.port;
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
          httpServer.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.removeListener('error', onError);
          const address = httpServer.address();
          const actualPort = typeof address === 'object' && address ? address.port : port;
          resolve(actualPort);
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port, config.host);
      });
    },
    async close(): Promise<void> {
      manager.stopSweeper();
      await new Promise<void>((resolve) => io?.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      try {
        database?.close();
      } catch {
        /* 忽略关闭异常 */
      }
    },
  };

  return bundle;
}
