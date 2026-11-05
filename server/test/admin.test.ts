import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type {
  AdminSessionDetail,
  AdminSessionListPage,
  ErrorPayload,
  HistoricalSession,
  JoinResult,
} from '@jiaowoplay/shared';
import { createServerBundle, type ServerBundle } from '../src/bootstrap.js';

const ADMIN_USER = 'hedgehogsong';
const ADMIN_PASS = 'unit-test-admin-pass-1234';
const ADMIN_SECRET = 'unit-test-jwt-secret-0123456789abcdef';

let bundle: ServerBundle;
let origin: string;
let token = '';
const sockets: ClientSocket[] = [];

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${origin}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}

const postJson = <T>(path: string, body: unknown, headers?: Record<string, string>) =>
  call<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const getJson = <T>(path: string, withToken = true) =>
  call<T>(path, { headers: withToken ? { authorization: `Bearer ${token}` } : {} });

function connect(): Promise<ClientSocket> {
  const socket = ioClient(origin, { transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function ack<T>(socket: ClientSocket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const args = payload === undefined ? [event] : [event, payload];
    (socket as unknown as { timeout: (ms: number) => { emit: (...a: unknown[]) => void } })
      .timeout(10_000)
      .emit(...args, (error: Error | null, result: { ok: boolean; data: T; error?: ErrorPayload }) => {
        if (error) return reject(error);
        if (result.ok) return resolve(result.data);
        reject(new Error(JSON.stringify(result.error)));
      });
  });
}

async function createRoomWithTwoPlayers(): Promise<{
  code: string;
  host: ClientSocket;
  guest: ClientSocket;
  sessionId: string;
}> {
  const created = await postJson<JoinResult>('/api/rooms', {
    nickname: '后台甲',
    settings: { submitTimeoutMs: 30_000, revealDurationMs: 1_000 },
  });
  if (created.status !== 201) throw new Error(`建房失败 ${JSON.stringify(created.body)}`);
  const joined = await postJson<JoinResult>(`/api/rooms/${created.body.code}/join`, {
    nickname: '后台乙',
  });

  const host = await connect();
  const guest = await connect();
  await ack(host, 'reconnectRoom', {
    code: created.body.code,
    reconnectToken: created.body.reconnectToken,
  });
  await ack(guest, 'reconnectRoom', {
    code: joined.body.code,
    reconnectToken: joined.body.reconnectToken,
  });
  const started = await ack<{ sessionId: string }>(host, 'startGame');
  return { code: created.body.code, host, guest, sessionId: started.sessionId };
}

beforeAll(async () => {
  bundle = createServerBundle({
    dbPath: ':memory:',
    host: '127.0.0.1',
    nodeEnv: 'test',
    isProduction: false,
    logLevel: 'error',
    staticDir: null,
    adminUser: ADMIN_USER,
    adminPass: ADMIN_PASS,
    adminJwtSecret: ADMIN_SECRET,
    adminTokenTtlSeconds: 3600,
  });
  const port = await bundle.start(0);
  origin = `http://127.0.0.1:${port}`;

  const login = await postJson<{ token: string }>(`/api/admin/login`, {
    username: ADMIN_USER,
    password: ADMIN_PASS,
  });
  expect(login.status).toBe(200);
  token = login.body.token;
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await bundle.close();
});

describe('后台登录', () => {
  it('密码错误返回 401，且不区分账号是否存在', async () => {
    const wrongPass = await postJson<{ error: ErrorPayload }>('/api/admin/login', {
      username: ADMIN_USER,
      password: 'wrong-password',
    });
    expect(wrongPass.status).toBe(401);
    expect(wrongPass.body.error.code).toBe('ADMIN_UNAUTHORIZED');
    expect(wrongPass.body.error.message).toBe('账号或密码错误');

    const wrongUser = await postJson<{ error: ErrorPayload }>('/api/admin/login', {
      username: 'nobody-here',
      password: ADMIN_PASS,
    });
    expect(wrongUser.status).toBe(401);
    expect(wrongUser.body.error.message).toBe('账号或密码错误');
  });

  it('空参数与超长参数也被拒绝', async () => {
    const empty = await postJson<{ error: ErrorPayload }>('/api/admin/login', {});
    expect(empty.status).toBe(401);
    const huge = await postJson<{ error: ErrorPayload }>('/api/admin/login', {
      username: ADMIN_USER,
      password: 'x'.repeat(500),
    });
    expect(huge.status).toBe(401);
  });

  it('连续失败 5 次后触发限流 429', async () => {
    // 前面已经失败过若干次，这里继续打到超限
    let lastStatus = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await postJson<{ error: ErrorPayload }>('/api/admin/login', {
        username: ADMIN_USER,
        password: `bad-${attempt}`,
      });
      lastStatus = response.status;
      if (response.status === 429) break;
    }
    expect(lastStatus).toBe(429);
    expect(token).toBeTruthy();
  });
});

describe('后台接口鉴权', () => {
  it('没有 Token 返回 401', async () => {
    const anonymous = await getJson<{ error: ErrorPayload }>('/api/admin/sessions', false);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('ADMIN_UNAUTHORIZED');
  });

  it('伪造或篡改的 Token 返回 401', async () => {
    const forged = await call<{ error: ErrorPayload }>('/api/admin/sessions', {
      headers: { authorization: 'Bearer a.b.c' },
    });
    expect(forged.status).toBe(401);

    const tampered = await call<{ error: ErrorPayload }>('/api/admin/sessions', {
      headers: { authorization: `Bearer ${token.slice(0, -2)}xx` },
    });
    expect(tampered.status).toBe(401);
  });

  it('缺少 Bearer 前缀也被拒绝', async () => {
    const raw = await call<{ error: ErrorPayload }>('/api/admin/sessions', {
      headers: { authorization: token },
    });
    expect(raw.status).toBe(401);
  });

  it('有效 Token 可拉取分页列表', async () => {
    const page = await getJson<AdminSessionListPage>('/api/admin/sessions?page=1&limit=5');
    expect(page.status).toBe(200);
    expect(page.body.limit).toBe(5);
    expect(page.body.page).toBe(1);
    expect(Array.isArray(page.body.items)).toBe(true);
    expect(page.body.total).toBeGreaterThanOrEqual(page.body.items.length);
  });

  it('非法分页参数回落到默认值而不是报错', async () => {
    const page = await getJson<AdminSessionListPage>('/api/admin/sessions?page=0&limit=abc');
    expect(page.status).toBe(200);
    expect(page.body.page).toBe(1);
    expect(page.body.limit).toBe(20);
  });
});

describe('前后台数据隔离', () => {
  it('房主强制结束后，未揭晓轮次的词：前台查不到、后台能查到', async () => {
    const SECRET = '绝密轮次词7788';
    const { code, host, sessionId } = await createRoomWithTwoPlayers();

    await ack(host, 'submitWord', { word: SECRET });
    await ack(host, 'forceEndGame');

    // 前台公开接口：必须仍然看不到
    const publicHistory = await call<{ code: string; sessions: HistoricalSession[] }>(
      `/api/rooms/${code}/history`,
    );
    expect(publicHistory.status).toBe(200);
    expect(JSON.stringify(publicHistory.body)).not.toContain(SECRET);
    const publicRound = publicHistory.body.sessions[0]?.rounds[0];
    expect(publicRound?.revealedAt).toBeNull();
    expect(publicRound?.submissions).toEqual([]);

    // 后台接口：必须能看到全部数据
    const adminDetail = await getJson<{ session: AdminSessionDetail }>(
      `/api/admin/sessions/${sessionId}`,
    );
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.session.rounds).toHaveLength(1);
    const adminRound = adminDetail.body.session.rounds[0];
    expect(adminRound?.revealedAt).toBeNull();
    expect(adminRound?.submissions.map((item) => item.word)).toContain(SECRET);
    // 后台统计里这一轮计入 roundCount 但不计入 revealedRoundCount
    expect(adminDetail.body.session.roundCount).toBe(1);
    expect(adminDetail.body.session.revealedRoundCount).toBe(0);
    expect(adminDetail.body.session.outcome).toBe('HOST_ENDED');
  });

  it('已揭晓的对局在后台同样完整，且列表带时长与人数', async () => {
    const { host, guest, sessionId } = await createRoomWithTwoPlayers();
    await ack(host, 'submitWord', { word: '同步' });
    await ack(guest, 'submitWord', { word: '同步' });
    await new Promise((resolve) => guest.once('gameEnded', resolve));

    const detail = await getJson<{ session: AdminSessionDetail }>(
      `/api/admin/sessions/${sessionId}`,
    );
    expect(detail.body.session.outcome).toBe('ALL_MET');
    expect(detail.body.session.winnerNicknames.sort()).toEqual(['后台乙', '后台甲'].sort());
    expect(detail.body.session.durationMs).not.toBeNull();
    expect(detail.body.session.playerCount).toBe(2);
  });

  it('未配置后台凭据时接口返回 503 而不是弱口令放行', async () => {
    const disabled = createServerBundle({
      dbPath: ':memory:',
      nodeEnv: 'test',
      isProduction: false,
      logLevel: 'error',
      staticDir: null,
      adminUser: '',
      adminPass: '',
      adminJwtSecret: '',
    });
    const port = await disabled.start(0);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/sessions`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(503);
      const login = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'your-admin-name', password: 'change-me-on-server' }),
      });
      expect(login.status).toBe(503);
    } finally {
      await disabled.close();
    }
  });
});
