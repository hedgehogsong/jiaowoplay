import { createServerBundle } from './bootstrap.js';
import { config } from './config.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  if (config.isProduction && (!config.sessionSecret || config.sessionSecret === 'change-me-to-a-long-random-string')) {
    logger.warn('SESSION_SECRET 未配置为随机值，生产环境请务必修改');
  }

  const bundle = createServerBundle();
  const port = await bundle.start();

  logger.info('交我PLAY 服务已启动', {
    port,
    host: config.host,
    nodeEnv: config.nodeEnv,
    database: bundle.history ? 'enabled' : 'disabled',
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('正在关闭服务', { signal });
    bundle
      .close()
      .then(() => {
        logger.info('服务已关闭');
        process.exit(0);
      })
      .catch((error: Error) => {
        logger.error('关闭服务时出错', { error: error.message });
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', { error: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常', { error: error.message, stack: error.stack });
  });
}

main().catch((error: Error) => {
  logger.error('启动失败', { error: error.message, stack: error.stack });
  process.exit(1);
});
