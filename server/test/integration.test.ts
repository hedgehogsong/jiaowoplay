import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@jiaowoplay/shared';
import type { Ack, ErrorPayload, GameEndedPayload, JoinResult, RoundRevealedPayload } from '@jiaowoplay/shared';
import { createServerBundle, type ServerBundle } from '../src/bootstrap.js';

const BASE_URL = 'http://127.0.0.1';

let bundle: ServerBundle;
let origin: string;
const clients: ClientSocket[] = [];

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${origin}${path}`, init);
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

function connect(): Promise<ClientSocket> {
  const socket = ioClient(origin, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  }) as ClientSocket;
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => reject(error));
  });
}

function emitAck<T>(
  socket: ClientSocket,
  event: string,
  payload?: unknown,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const args = payload === undefined ? [event] : [event, payload];
    const withTimeout = socket as unknown as {
      timeout: (ms: number) => { emit: (...a: unknown[]) => void };
    };
    withTimeout.timeout(timeoutMs).emit(
      ...args,
      (error: Error | null, response: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        const result = response as Parameters<Ack<T>>[0];
        if (result.ok) resolve(result.data);
        else reject(Object.assign(new Error(result.error.message), { payload: result.error }));
      },
    );
  });
}

function waitFor<T>(socket: ClientSocket, event: string, timeoutMs = 8_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`等待事件超时：${event}`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function httpCreate(nickname: string, settings?: Record<string, unknown>) {
  const { status, body } = await json<JoinResult | { error: ErrorPayload }>('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings ? { nickname, settings } : { nickname }),
  });
  if (status !== 201) {
    throw new Error(`创建房间失败 ${status}: ${JSON.stringify(body)}`);
  }
  return body as JoinResult;
}

async function httpJoin(code: string, nickname: string) {
  const { status, body } = await json<JoinResult>(`/api/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  expect(status).toBe(200);
  return body;
}

beforeAll(async () => {
  bundle = createServerBundle({
    dbPath: ':memory:',
    host: '127.0.0.1',
    nodeEnv: 'test',
    isProduction: false,
    logLevel: 'error',
    staticDir: null,
  });
  const port = await bundle.start(0);
  origin = `${BASE_URL}:${port}`;
});

afterAll(async () => {
  for (const socket of clients) socket.disconnect();
  clients.length = 0;
  await bundle.close();
});

describe('REST 接口', () => {
  it('GET /health 返回运行状态', async () => {
    const { status, body } = await json<{ status: string; database: string }>('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.database).toBe('ok');
  });

  it('GET /api/games 列出可用游戏', async () => {
    const { body } = await json<{ games: { type: string; label: string }[] }>('/api/games');
    expect(body.games.map((game) => game.type)).toContain('sameword');
  });

  it('POST /api/rooms 创建房间并返回重连令牌', async () => {
    const { status, body } = await json<JoinResult>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: '房主' }),
    });
    expect(status).toBe(201);
    expect(body.code).toHaveLength(ROOM_CODE_LENGTH);
    expect(body.reconnectToken.length).toBeGreaterThan(20);
    expect(body.state.players).toHaveLength(1);
    expect(body.state.you?.nickname).toBe('房主');
  });

  it('非法昵称被拒绝且不泄露内部细节', async () => {
    const { status, body } = await json<{ error: ErrorPayload }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'a' }),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('NICKNAME_INVALID');
  });

  it('查询不存在的房间返回 404', async () => {
    const pattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
    expect(pattern.test('ABCDEF')).toBe(true);
    const { status, body } = await json<{ error: ErrorPayload }>('/api/rooms/ABCDEF');
    expect(status).toBe(404);
    expect(body.error.code).toBe('ROOM_NOT_FOUND');
  });

  it('格式非法的房间号返回 400', async () => {
    const { status, body } = await json<{ error: ErrorPayload }>('/api/rooms/0O1I');
    expect(status).toBe(400);
    expect(body.error.code).toBe('ROOM_CODE_INVALID');
  });

  it('GET /api/rooms/:code 返回公开信息', async () => {
    const created = await httpCreate('公开房主');
    await httpJoin(created.code, '访客');
    const { body } = await json<{
      room: { code: string; playerCount: number; hostNickname: string };
    }>(`/api/rooms/${created.code}`);
    expect(body.room.playerCount).toBe(2);
    expect(body.room.hostNickname).toBe('公开房主');
  });

  it('超出允许范围的房间设置被拒绝', async () => {
    const { status, body } = await json<{ error: ErrorPayload }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: '房主', settings: { maxRounds: 999 } }),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('SETTINGS_INVALID');
  });

  it('未启用的胜利模式被拒绝', async () => {
    const { status, body } = await json<{ error: ErrorPayload }>('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: '房主', settings: { winMode: 'ANY_PAIR' } }),
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('SETTINGS_INVALID');
  });
});

describe('Socket.IO 完整对局', () => {
  it('两人重连、开局、同词获胜并写入历史', async () => {
    const created = await httpCreate('阿甲', {
      maxRounds: 3,
      submitTimeoutMs: 5_000,
      revealDurationMs: 1_000,
    });
    const joined = await httpJoin(created.code, '阿乙');

    const hostSocket = await connect();
    const guestSocket = await connect();

    const hostAttach = await emitAck<JoinResult>(hostSocket, 'reconnectRoom', {
      code: created.code,
      reconnectToken: created.reconnectToken,
    });
    const guestAttach = await emitAck<JoinResult>(guestSocket, 'reconnectRoom', {
      code: joined.code,
      reconnectToken: joined.reconnectToken,
    });

    expect(hostAttach.playerId).toBe(created.playerId);
    expect(guestAttach.playerId).toBe(joined.playerId);
    expect(guestAttach.state.players.map((p) => p.nickname).sort()).toEqual(['阿乙', '阿甲'].sort());

    const started = await emitAck<{ sessionId: string }>(hostSocket, 'startGame');
    expect(started.sessionId).toBeTruthy();

    const guestRound = await waitFor<{ roundNumber: number; prompt: string }>(
      guestSocket,
      'roundStarted',
    );
    expect(guestRound.roundNumber).toBe(1);

    await emitAck<{ roundNumber: number }>(hostSocket, 'submitWord', { word: '  月亮  ' });

    const accepted = await waitFor<{ submittedCount: number; activeCount: number }>(
      guestSocket,
      'submissionAccepted',
    );
    expect(accepted).toMatchObject({ submittedCount: 1, activeCount: 2 });

    // 提交内容在揭晓前不应出现在任何广播里
    const stateBeforeReveal = await emitAck<JoinResult['state']>(
      guestSocket,
      'requestRoomState',
    );
    expect(stateBeforeReveal.game?.rounds[0]?.submissions).toBeNull();

    const revealedPromise = waitFor<RoundRevealedPayload>(guestSocket, 'roundRevealed');
    await emitAck<{ roundNumber: number }>(guestSocket, 'submitWord', { word: '月亮' });
    const revealed = await revealedPromise;

    expect(revealed.allSame).toBe(true);
    expect(revealed.round.submissions?.map((s) => s.word)).toEqual(['月亮', '月亮']);

    const ended = await waitFor<GameEndedPayload>(guestSocket, 'gameEnded');
    expect(ended.outcome).toBe('ALL_MET');
    expect(ended.totalRounds).toBe(1);
    expect(ended.winnerNicknames.sort()).toEqual(['阿乙', '阿甲'].sort());

    const { status, body } = await json<{ session: { totalRounds: number; outcome: string } }>(
      `/api/sessions/${started.sessionId}`,
    );
    expect(status).toBe(200);
    expect(body.session.outcome).toBe('ALL_MET');
    expect(body.session.totalRounds).toBe(1);
  });

  it('非房主开局被拒绝', async () => {
    const created = await httpCreate('房主');
    const joined = await httpJoin(created.code, '成员');

    const hostSocket = await connect();
    const guestSocket = await connect();
    await emitAck<JoinResult>(hostSocket, 'reconnectRoom', {
      code: created.code,
      reconnectToken: created.reconnectToken,
    });
    await emitAck<JoinResult>(guestSocket, 'reconnectRoom', {
      code: joined.code,
      reconnectToken: joined.reconnectToken,
    });

    await expect(emitAck(guestSocket, 'startGame')).rejects.toMatchObject({
      payload: { code: 'NOT_HOST' },
    });
  });

  it('非法词语被拒绝', async () => {
    const created = await httpCreate('阿甲', {
      submitTimeoutMs: 5_000,
      revealDurationMs: 1_000,
    });
    const joined = await httpJoin(created.code, '阿乙');

    const hostSocket = await connect();
    const guestSocket = await connect();
    await emitAck<JoinResult>(hostSocket, 'reconnectRoom', {
      code: created.code,
      reconnectToken: created.reconnectToken,
    });
    await emitAck<JoinResult>(guestSocket, 'reconnectRoom', {
      code: joined.code,
      reconnectToken: joined.reconnectToken,
    });
    await emitAck<{ sessionId: string }>(hostSocket, 'startGame');

    await expect(emitAck(hostSocket, 'submitWord', { word: '   ' })).rejects.toMatchObject({
      payload: { code: 'WORD_INVALID' },
    });
    await expect(
      emitAck(hostSocket, 'submitWord', { word: '一二三四五六七八九十一二三四五六七八九十一' }),
    ).rejects.toMatchObject({ payload: { code: 'WORD_INVALID' } });
    await expect(
      emitAck(hostSocket, 'submitWord', { word: '带\u0000控制符' }),
    ).rejects.toMatchObject({ payload: { code: 'WORD_INVALID' } });

    // 非法提交后仍可正常提交
    await expect(emitAck(hostSocket, 'submitWord', { word: '月亮' })).resolves.toMatchObject({
      roundNumber: 1,
    });
  });
});
