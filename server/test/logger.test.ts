import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../src/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('日志脱敏', () => {
  // 测试环境 LOG_LEVEL=error，只有 error 级会真正输出
  it('password / token / secret 的值不会进入日志', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('后台登录尝试', {
      ip: '127.0.0.1',
      username: 'hedgehogsong',
      password: 'super-secret-value',
      token: 'jwt.abc.def',
      sessionSecret: 'another-secret',
    });

    const output = spy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).not.toContain('super-secret-value');
    expect(output).not.toContain('jwt.abc.def');
    expect(output).not.toContain('another-secret');
    expect(output).toContain('[redacted]');
    // 非敏感字段照常输出，便于排查
    expect(output).toContain('username=hedgehogsong');
  });

  it('超长字符串被截断，避免日志被灌爆', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('异常负载', { detail: 'x'.repeat(1_200) });
    const output = spy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output.length).toBeLessThan(800);
  });
});
