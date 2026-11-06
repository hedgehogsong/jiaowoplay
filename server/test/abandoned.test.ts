import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_OFFLINE_GRACE_MS } from '@jiaowoplay/shared';
import { createServerBundle, type ServerBundle } from '../src/bootstrap.js';
import { openDatabase } from '../src/db/index.js';
import { HistoryRepository } from '../src/db/repository.js';
import type { GameRoom } from '../src/rooms/Room.js';
import { RoomManager } from '../src/rooms/RoomManager.js';
import {
  createFakeNotifier,
  recordingHistory,
  type AbandonCall,
  type RecordedEvent,
} from './helpers.js';

const T0 = 1_700_000_000_000;
const SECRET_A = '秘密甲9527';
const SECRET_B = '秘密乙9528';
const SESSION_ID = 'gs_crashed0001';

/** 造一局「第 1 轮已揭晓、第 2 轮收集到一半就断气」的残局 */
function seedCrashedGame(history: HistoryRepository): string {
  history.createSession({
    id: SESSION_ID,
    roomId: 'rm_crashed',
    roomCode: 'CRSH23',
    gameType: 'sameword',
    maxRounds: 20,
    winMode: 'ALL_SAME',
    players: [
      { playerId: 'pl_b', nickname: '乙乙' },
      { playerId: 'pl_a', nickname: '甲甲' },
    ],
    hostPlayerId: 'pl_a',
    startedAt: T0,
  });

  history.createRound({
    id: 'rd_1',
    gameSessionId: SESSION_ID,
    roundNumber: 1,
    previousWords: [],
    startedAt: T0 + 1_000,
  });
  history.createSubmission({
    id: 'sb_1',
    roundId: 'rd_1',
    gameSessionId: SESSION_ID,
    playerId: 'pl_a',
    nickname: '甲甲',
    word: '苹果',
    isTimeout: false,
    submittedAt: T0 + 1_500,
  });
  history.createSubmission({
    id: 'sb_2',
    roundId: 'rd_1',
    gameSessionId: SESSION_ID,
    playerId: 'pl_b',
    nickname: '乙乙',
    word: '香蕉',
    isTimeout: false,
    submittedAt: T0 + 1_600,
  });
  history.finalizeRound({ id: 'rd_1', allSame: false, partialMeetings: [], revealedAt: T0 + 2_000 });

  history.createRound({
    id: 'rd_2',
    gameSessionId: SESSION_ID,
    roundNumber: 2,
    previousWords: ['苹果', '香蕉'],
    startedAt: T0 + 3_000,
  });
  history.createSubmission({
    id: 'sb_3',
    roundId: 'rd_2',
    gameSessionId: SESSION_ID,
    playerId: 'pl_a',
    nickname: '甲甲',
    word: SECRET_A,
    isTimeout: false,
    submittedAt: T0 + 4_000,
  });
  history.createSubmission({
    id: 'sb_4',
    roundId: 'rd_2',
    gameSessionId: SESSION_ID,
    playerId: 'pl_b',
    nickname: '乙乙',
    word: SECRET_B,
    isTimeout: false,
    submittedAt: T0 + 5_000,
  });
  history.setSessionRound(SESSION_ID, 2);
  return SESSION_ID;
}

describe('流局收尾写库', () => {
  const bundles: ServerBundle[] = [];
  const databases = new Set<ReturnType<typeof openDatabase>>();
  const tempDirs: string[] = [];

  function memoryRepo(): HistoryRepository {
    const db = openDatabase(':memory:');
    databases.add(db);
    return new HistoryRepository(db);
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    for (const bundle of bundles) await bundle.close();
    for (const db of databases) db.close();
    for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('对账把残局写成 ABANDONED 终态，且不写 revealed_at', () => {
    const history = memoryRepo();
    const id = seedCrashedGame(history);

    expect(history.reconcileAbandonedSessions(T0 + 60_000)).toBe(1);

    const detail = history.getAdminSession(id);
    expect(detail?.status).toBe('finished');
    expect(detail?.outcome).toBe('ABANDONED');
    expect(detail?.winnerNicknames).toEqual([]);
    // ended_at 取最后活动时间而不是对账时刻，否则后台「时长」是几天的假数字
    expect(detail?.endedAt).toBe(T0 + 5_000);
    expect(detail?.durationMs).toBe(5_000);

    const abandoned = detail?.rounds.find((round) => round.roundNumber === 2);
    expect(abandoned?.status).toBe('ABANDONED');
    expect(abandoned?.revealedAt).toBeNull();
    // 词保留在库中，后台照样读得到
    expect(abandoned?.submissions.map((item) => item.word)).toEqual([SECRET_A, SECRET_B]);

    const revealed = detail?.rounds.find((round) => round.roundNumber === 1);
    expect(revealed?.status).toBe('REVEALED');

    // 房主排在参与人第一位（快照里乙乙先加入，但房主是甲甲）
    expect(detail?.hostNickname).toBe('甲甲');
    expect(detail?.players.map((player) => player.nickname)).toEqual(['甲甲', '乙乙']);
  });

  it('对账幂等：第二次不再处理，也不会碰已判定胜负的对局', () => {
    const history = memoryRepo();
    const id = seedCrashedGame(history);

    expect(history.reconcileAbandonedSessions(T0 + 60_000)).toBe(1);
    expect(history.reconcileAbandonedSessions(T0 + 60_000)).toBe(0);

    // 房主强制结束的真实胜负不能被流局覆盖
    history.finishSession({
      id,
      currentRound: 2,
      outcome: 'HOST_ENDED',
      winnerPlayerIds: ['pl_a'],
      endedAt: T0 + 9_000,
    });
    expect(history.abandonSession({ id, currentRound: 2, endedAt: T0 + 9_999, reason: 'shutdown' })).toBe(
      false,
    );
    const detail = history.getAdminSession(id);
    expect(detail?.outcome).toBe('HOST_ENDED');
    expect(detail?.endedAt).toBe(T0 + 9_000);
  });

  it('时钟回拨时 ended_at 不会超过对账时刻', () => {
    const history = memoryRepo();
    const id = seedCrashedGame(history);
    // 最后活动时间在 now 之后（例如写入时时钟偏快）
    history.reconcileAbandonedSessions(T0 + 1_000);
    const detail = history.getAdminSession(id);
    expect(detail?.endedAt).toBeLessThanOrEqual(T0 + 1_000);
    expect(detail?.durationMs ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('废弃轮次写入 session_abandoned 事件，带上流局原因', () => {
    const db = openDatabase(':memory:');
    databases.add(db);
    const history = new HistoryRepository(db);
    const id = seedCrashedGame(history);
    history.reconcileAbandonedSessions(T0 + 60_000);

    const events = db
      .prepare(`SELECT type, payload FROM game_events WHERE game_session_id = ? ORDER BY rowid`)
      .all(id) as { type: string; payload: string }[];
    const abandoned = events.filter((event) => event.type === 'session_abandoned');
    expect(abandoned).toHaveLength(1);
    expect(JSON.parse(abandoned[0]?.payload ?? '{}').reason).toBe('startup_reconcile');
  });

  it('前台历史接口查不到废弃轮次的词，后台接口查得到', () => {
    const history = memoryRepo();
    const id = seedCrashedGame(history);
    history.reconcileAbandonedSessions(T0 + 60_000);

    const publicSession = history.getSession(id);
    expect(publicSession?.outcome).toBe('ABANDONED');
    const publicWords = JSON.stringify(publicSession);
    expect(publicWords).not.toContain(SECRET_A);
    expect(publicWords).not.toContain(SECRET_B);
    expect(publicWords).toContain('苹果');

    const adminSession = JSON.stringify(history.getAdminSession(id));
    expect(adminSession).toContain(SECRET_A);
    expect(adminSession).toContain(SECRET_B);
  });
});

describe('房间销毁与进程关闭都会收尾对局', () => {
  let manager: RoomManager;
  let events: RecordedEvent[];
  let created: GameRoom[];
  let calls: AbandonCall[];

  beforeEach(() => {
    events = [];
    created = [];
    calls = [];
    manager = new RoomManager({
      history: recordingHistory(calls),
      createNotifier: (room) => {
        created.push(room);
        return createFakeNotifier(events);
      },
      sweepIntervalMs: 60_000,
    });
  });

  /** 开一局并让两名玩家全部离线 */
  function startThenDropAll(): { room: GameRoom; sessionId: string; hostId: string } {
    const { room, player } = manager.createRoom({ nickname: '房主大人' });
    const guest = manager.joinRoom(room.code, '路人甲');
    room.setOnline(player.id, true, 'sock-host');
    room.setOnline(guest.player.id, true, 'sock-guest');
    const { sessionId } = room.startGame(player.id);
    room.setOnline(player.id, false, null);
    room.setOnline(guest.player.id, false, null);
    return { room, sessionId, hostId: player.id };
  }

  afterEach(() => {
    manager?.stopSweeper();
    for (const room of created ?? []) room.dispose();
    vi.useRealTimers();
  });

  it('全员离线回收房间时把进行中的对局标记为流局', () => {
    vi.useFakeTimers();
    const { room, sessionId } = startThenDropAll();
    const code = room.code;

    const removed = manager.sweepOnce(Date.now() + PLAYER_OFFLINE_GRACE_MS + 1);
    expect(removed).toContain(code);
    expect(calls).toEqual([{ id: sessionId, currentRound: 1, reason: 'room_reclaimed' }]);
    expect(room.data.session?.outcome).toBe('ABANDONED');
    expect(room.data.session?.rounds[0]?.status).toBe('ABANDONED');
  });

  it('进程关闭收尾以 shutdown 原因流局，并清空房间表', () => {
    const { room, sessionId } = startThenDropAll();

    manager.disposeAll('shutdown');
    expect(calls).toEqual([{ id: sessionId, currentRound: 1, reason: 'shutdown' }]);
    expect(room.isDisposed).toBe(true);
    expect(manager.stats().rooms).toBe(0);
  });

  it('已经判定胜负的对局不会被 dispose 覆盖', () => {
    const { room, sessionId, hostId } = startThenDropAll();
    room.forceEndGame(hostId);
    calls.length = 0;

    manager.disposeAll('shutdown');
    expect(calls).toEqual([]);
    expect(room.data.session?.id).toBe(sessionId);
    expect(room.data.session?.outcome).toBe('HOST_ENDED');
  });
});

describe('旧库迁移', () => {
  it('缺少 host_player_id 列的旧库会被补上该列', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwp-migrate-'));
    const dbPath = path.join(dir, 'legacy.sqlite');
    const legacy = new Database(dbPath);
    // 线上现库的建表语句：没有 host_player_id
    legacy.exec(`CREATE TABLE game_sessions (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, room_code TEXT NOT NULL,
      game_type TEXT NOT NULL, status TEXT NOT NULL, outcome TEXT,
      current_round INTEGER NOT NULL DEFAULT 0, max_rounds INTEGER,
      win_mode TEXT NOT NULL DEFAULT 'ALL_SAME', winner_player_ids TEXT NOT NULL DEFAULT '[]',
      players TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL, ended_at INTEGER)`);
    legacy.close();

    const db = openDatabase(dbPath);
    const columns = (db.prepare('PRAGMA table_info(game_sessions)').all() as { name: string }[]).map(
      (column) => column.name,
    );
    expect(columns).toContain('host_player_id');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('启动对账（真实启动路径）', () => {
  const ADMIN_USER = '对账管理员';
  const ADMIN_PASS = 'abandon-test-pass';
  const ADMIN_SECRET = 'abandon-test-jwt-secret-value';

  async function bootOnFileDb(): Promise<{ bundle: ServerBundle; origin: string }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jwp-abandon-'));
    const dbPath = path.join(dir, 'jiaowoplay.sqlite');
    const seedDb = openDatabase(dbPath);
    seedCrashedGame(new HistoryRepository(seedDb));
    seedDb.close();

    const bundle = createServerBundle({
      dbPath,
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
    return { bundle, origin: `http://127.0.0.1:${port}` };
  }

  it('崩溃遗留的 active 对局在下次启动后被补成流局，词仍不外泄', async () => {
    const { bundle, origin } = await bootOnFileDb();
    try {
      const publicRes = await fetch(`${origin}/api/sessions/${SESSION_ID}`);
      expect(publicRes.status).toBe(200);
      const body = (await publicRes.json()) as {
        session: { outcome: string | null; endedAt: number | null; rounds: { submissions: { word: string | null }[] }[] };
      };
      expect(body.session.outcome).toBe('ABANDONED');
      expect(body.session.endedAt).toBe(T0 + 5_000);
      expect(JSON.stringify(body.session)).not.toContain(SECRET_A);

      const roomHistory = await fetch(`${origin}/api/rooms/CRSH23/history`);
      expect(roomHistory.status).toBe(200);
      expect(JSON.stringify(await roomHistory.json())).not.toContain(SECRET_A);

      const login = await fetch(`${origin}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
      });
      expect(login.status).toBe(200);
      const { token } = (await login.json()) as { token: string };

      const adminRes = await fetch(`${origin}/api/admin/sessions/${SESSION_ID}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(adminRes.status).toBe(200);
      const admin = (await adminRes.json()) as {
        session: {
          outcome: string | null;
          status: string;
          rounds: { roundNumber: number; status: string; submissions: { word: string | null }[] }[];
        };
      };
      expect(admin.session.outcome).toBe('ABANDONED');
      expect(admin.session.status).toBe('finished');
      const round2 = admin.session.rounds.find((round) => round.roundNumber === 2);
      expect(round2?.status).toBe('ABANDONED');
      expect(round2?.submissions.map((item) => item.word)).toEqual([SECRET_A, SECRET_B]);
    } finally {
      await bundle.close();
    }
  });
});
