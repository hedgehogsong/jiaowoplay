import { MAX_PLAYERS } from '@jiaowoplay/shared';
import type { GameType, RoomSettings, ServerToClientEvents } from '@jiaowoplay/shared';
import type { AbandonReason, HistoryRepository } from '../db/repository.js';
import { AppError, ErrorCode } from '../domain/errors.js';
import { generateReconnectToken, generateRoomCode, newId } from '../domain/ids.js';
import type { Player, RoomData } from '../domain/types.js';
import { getGame } from '../games/registry.js';
import { logger } from '../logger.js';
import { GameRoom, type RoomNotifier, type ServerEvent } from './Room.js';

const ROOM_CODE_MAX_ATTEMPTS = 24;
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

export interface RoomManagerDeps {
  history: HistoryRepository | null;
  createNotifier: (room: GameRoom) => RoomNotifier;
  sweepIntervalMs?: number;
}

export interface RoomAccess {
  room: GameRoom;
  player: Player;
}

function createPlayer(roomId: string, nickname: string, isHost: boolean): Player {
  const now = Date.now();
  return {
    id: newId('pl'),
    roomId,
    nickname,
    reconnectToken: generateReconnectToken(),
    isHost,
    isOnline: false,
    isActive: false,
    socketId: null,
    joinedAt: now,
    lastSeenAt: now,
    // 玩家先经 REST 建档、再由 socket 挂载身份。若始终没挂载成功，
    // 也要能从加入时刻起被巡检回收，所以这里不能留 null。
    offlineSince: now,
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly deps: RoomManagerDeps;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(deps: RoomManagerDeps) {
    this.deps = deps;
  }

  get size(): number {
    return this.rooms.size;
  }

  getRoom(code: string): GameRoom | undefined {
    return this.rooms.get(code);
  }

  listRooms(): GameRoom[] {
    return [...this.rooms.values()];
  }

  private allocateCode(): string {
    for (let attempt = 0; attempt < ROOM_CODE_MAX_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new AppError(ErrorCode.INTERNAL, '房间号分配失败，请稍后重试', 503);
  }

  createRoom(input: {
    nickname: string;
    gameType?: GameType;
    settings?: RoomSettings;
  }): RoomAccess {
    const gameType = input.gameType ?? 'sameword';
    const game = getGame(gameType);
    const settings = input.settings ?? game.defaultSettings();
    const code = this.allocateCode();
    const now = Date.now();

    const data: RoomData = {
      id: newId('rm'),
      code,
      hostPlayerId: '',
      status: 'WAITING',
      gameType,
      settings,
      createdAt: now,
      lastActivityAt: now,
      emptySince: null,
      players: new Map(),
      session: null,
    };

    const lazyNotifier = new LazyNotifier();
    const room = new GameRoom(data, {
      game,
      history: this.deps.history,
      notifier: lazyNotifier,
    });
    lazyNotifier.attach(this.deps.createNotifier(room));
    this.rooms.set(code, room);

    const host = createPlayer(data.id, input.nickname, true);
    data.hostPlayerId = host.id;
    room.addPlayer(host);

    logger.info('房间已创建', { roomCode: code, gameType });
    return { room, player: host };
  }

  joinRoom(code: string, nickname: string): RoomAccess {
    const room = this.rooms.get(code);
    if (!room || room.isDisposed) {
      throw new AppError(ErrorCode.ROOM_NOT_FOUND, '房间不存在或已关闭', 404);
    }
    if (room.data.players.size >= MAX_PLAYERS) {
      throw new AppError(ErrorCode.ROOM_FULL, `房间已满（最多 ${MAX_PLAYERS} 人）`);
    }
    if (room.hasNickname(nickname)) {
      throw new AppError(ErrorCode.NICKNAME_TAKEN, '房间内已有玩家使用该昵称，请换一个');
    }

    const player = createPlayer(room.data.id, nickname, false);
    room.addPlayer(player);
    logger.info('玩家加入房间', { roomCode: code, playerCount: room.data.players.size });
    return { room, player };
  }

  reconnect(code: string, reconnectToken: string): RoomAccess {
    const room = this.rooms.get(code);
    if (!room || room.isDisposed) {
      throw new AppError(ErrorCode.RECONNECT_FAILED, '房间不存在或已关闭，请重新创建或加入', 404);
    }
    const player = room.findPlayerByToken(reconnectToken);
    if (!player) {
      throw new AppError(ErrorCode.RECONNECT_FAILED, '身份校验失败，请重新加入房间', 403);
    }
    room.data.emptySince = null;
    room.touch();
    return { room, player };
  }

  leaveRoom(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.removePlayer(playerId, 'left');
  }

  removeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
    logger.info('房间已清理', { roomCode: code });
  }

  /** 进程退出前收尾所有房间：清掉计时器，并把没打完的对局写成流局而不是永久 active */
  disposeAll(reason: AbandonReason = 'shutdown'): void {
    for (const [code, room] of this.rooms) {
      try {
        room.dispose(reason);
      } catch (error) {
        logger.error('关闭房间失败', { roomCode: code, error: (error as Error).message });
      }
    }
    this.rooms.clear();
  }

  stats(): { rooms: number; players: number; playing: number } {
    let players = 0;
    let playing = 0;
    for (const room of this.rooms.values()) {
      players += room.data.players.size;
      if (room.data.status === 'PLAYING') playing += 1;
    }
    return { rooms: this.rooms.size, players, playing };
  }

  startSweeper(): void {
    if (this.sweeper) return;
    const interval = this.deps.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.sweeper = setInterval(() => this.sweepOnce(), interval);
    this.sweeper.unref?.();
  }

  stopSweeper(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  sweepOnce(now = Date.now()): string[] {
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      let shouldDispose = false;
      try {
        shouldDispose = room.sweep(now);
      } catch (error) {
        logger.error('房间巡检失败', { roomCode: code, error: (error as Error).message });
      }
      if (shouldDispose) {
        room.dispose();
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    if (removed.length > 0) logger.debug('已清理房间', { codes: removed.join(',') });
    return removed;
  }
}

/**
 * GameRoom 需要 notifier，而 notifier 又需要 room 实例做视角投影，
 * 用一层延迟转发打破构造期的循环依赖。
 */
class LazyNotifier implements RoomNotifier {
  private target: RoomNotifier | null = null;

  attach(target: RoomNotifier): void {
    this.target = target;
  }

  broadcastState(): void {
    this.target?.broadcastState();
  }

  broadcast<E extends ServerEvent>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    this.target?.broadcast(event, ...args);
  }

  sendToPlayer<E extends ServerEvent>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.target?.sendToPlayer(playerId, event, ...args);
  }
}
