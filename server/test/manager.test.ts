import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '@jiaowoplay/shared';
import { AppError } from '../src/domain/errors.js';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@jiaowoplay/shared';
import { RoomManager } from '../src/rooms/RoomManager.js';
import type { GameRoom } from '../src/rooms/Room.js';
import { createFakeNotifier, type RecordedEvent } from './helpers.js';

function expectErrorCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`期望抛出 ${code}，但调用没有失败`);
}

describe('RoomManager', () => {
  let manager: RoomManager;
  const events: RecordedEvent[] = [];
  const created: GameRoom[] = [];

  beforeEach(() => {
    events.length = 0;
    created.length = 0;
    manager = new RoomManager({
      history: null,
      createNotifier: (room) => {
        created.push(room);
        return createFakeNotifier(events);
      },
      sweepIntervalMs: 60_000,
    });
  });

  afterEach(() => {
    manager.stopSweeper();
    for (const room of manager.listRooms()) room.dispose();
  });

  it('创建房间生成合法且不重复的房间号', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const { room } = manager.createRoom({ nickname: `房主${i}` });
      expect(room.code).toHaveLength(ROOM_CODE_LENGTH);
      for (const char of room.code) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
      expect(codes.has(room.code)).toBe(false);
      codes.add(room.code);
    }
    expect(codes.size).toBe(50);
  });

  it('创建者成为房主', () => {
    const { room, player } = manager.createRoom({ nickname: '房主' });
    expect(room.data.hostPlayerId).toBe(player.id);
    expect(player.isHost).toBe(true);
    expect(room.data.status).toBe('WAITING');
  });

  it('加入不存在的房间报错', () => {
    expectErrorCode(() => manager.joinRoom('ZZZZZZ', '路人'), 'ROOM_NOT_FOUND');
  });

  it('房间内昵称重复被拒绝，且大小写不敏感', () => {
    const { room } = manager.createRoom({ nickname: 'Alice' });
    expectErrorCode(() => manager.joinRoom(room.code, 'alice'), 'NICKNAME_TAKEN');
    expect(room.data.players.size).toBe(1);
  });

  it('房间满员后拒绝加入', () => {
    const { room } = manager.createRoom({ nickname: '房主' });
    for (let i = 1; i < MAX_PLAYERS; i += 1) {
      manager.joinRoom(room.code, `玩家${i}`);
    }
    expect(room.data.players.size).toBe(MAX_PLAYERS);
    expectErrorCode(() => manager.joinRoom(room.code, '第九人'), 'ROOM_FULL');
  });

  it('凭 reconnectToken 可恢复同一身份', () => {
    const { room, player } = manager.createRoom({ nickname: '房主' });
    const joined = manager.joinRoom(room.code, '乙');

    const restoredHost = manager.reconnect(room.code, player.reconnectToken);
    expect(restoredHost.player.id).toBe(player.id);

    const restoredGuest = manager.reconnect(room.code, joined.player.reconnectToken);
    expect(restoredGuest.player.id).toBe(joined.player.id);
    expect(restoredGuest.room.code).toBe(room.code);
  });

  it('错误的 reconnectToken 被拒绝', () => {
    const { room } = manager.createRoom({ nickname: '房主' });
    expectErrorCode(
      () => manager.reconnect(room.code, 'x'.repeat(43)),
      'RECONNECT_FAILED',
    );
  });

  it('leaveRoom 会移除成员并触发 playerLeft 广播', () => {
    const { room, player } = manager.createRoom({ nickname: '房主' });
    const joined = manager.joinRoom(room.code, '乙');
    manager.leaveRoom(room.code, joined.player.id);
    expect(room.data.players.has(joined.player.id)).toBe(false);
    expect(room.getPlayer(player.id)).toBeDefined();
    expect(events.some((e) => e.event === 'playerLeft')).toBe(true);
  });

  it('空房间超过保留期后被巡检回收', () => {
    const { room, player } = manager.createRoom({ nickname: '房主' });
    const code = room.code;
    manager.leaveRoom(code, player.id);

    expect(manager.sweepOnce(Date.now())).toEqual([]);
    expect(manager.getRoom(code)).toBeDefined();

    const removed = manager.sweepOnce(Date.now() + 6 * 60 * 1000);
    expect(removed).toContain(code);
    expect(manager.getRoom(code)).toBeUndefined();
  });

  it('stats 汇总房间与人数', () => {
    const { room } = manager.createRoom({ nickname: '房主' });
    manager.joinRoom(room.code, '乙');
    manager.createRoom({ nickname: '另一个' });
    expect(manager.stats()).toEqual({ rooms: 2, players: 3, playing: 0 });
  });
});
