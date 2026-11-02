import { Server, type Socket } from 'socket.io';
import type {
  Ack,
  ClientToServerEvents,
  ErrorPayload,
  ServerToClientEvents,
} from '@jiaowoplay/shared';
import { AppError, ErrorCode, isAppError } from '../domain/errors.js';
import { logger } from '../logger.js';
import { projectRoomState } from '../rooms/projection.js';
import type { GameRoom } from '../rooms/Room.js';
import type { RoomManager } from '../rooms/RoomManager.js';
import {
  parseCreateRoomPayload,
  parseJoinRoomPayload,
  parseReconnectPayload,
  parseSetNicknamePayload,
  parseSubmitWordPayload,
  validateNickname,
} from '../domain/validation.js';
import { TokenBucketLimiter, socketKey } from './rateLimit.js';

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface SocketData {
  playerId?: string;
  roomCode?: string;
  nickname?: string;
}

export interface SocketServerOptions {
  corsOrigins: string[] | boolean;
  joinCapacity?: number;
  joinRefillPerSecond?: number;
}

function toErrorPayload(error: unknown): ErrorPayload {
  if (isAppError(error)) return error.toJSON();
  if (error instanceof Error) {
    logger.error('未预期的服务端错误', { error: error.message, stack: error.stack });
    return { code: ErrorCode.INTERNAL, message: '服务器内部错误，请稍后重试' };
  }
  return { code: ErrorCode.INTERNAL, message: '服务器内部错误，请稍后重试' };
}

export function attachSocketServer(
  httpServer: Parameters<typeof Server.prototype.attach>[0],
  manager: RoomManager,
  options: SocketServerOptions,
): TypedServer {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: options.corsOrigins, credentials: false },
    maxHttpBufferSize: 1e4,
    pingInterval: 20_000,
    pingTimeout: 25_000,
    serveClient: false,
  });

  const joinLimiter = new TokenBucketLimiter(
    options.joinCapacity ?? 10,
    options.joinRefillPerSecond ?? 0.2,
  );

  io.engine.on('connection_error', (error: { message?: string; code?: number }) => {
    logger.warn('Socket.IO 握手失败', { code: error.code, message: error.message });
  });

  io.on('connection', (socket: TypedSocket) => {
    const data = socket.data as SocketData;
    const ip = socketKey(socket);
    logger.debug('socket 已连接', { socketId: socket.id, ip });

    const reply = <T>(ack: Ack<T> | undefined, run: () => T): void => {
      try {
        const result = run();
        ack?.({ ok: true, data: result });
      } catch (error) {
        const payload = toErrorPayload(error);
        if (ack) ack({ ok: false, error: payload });
        else socket.emit('error', payload);
        if (!isAppError(error)) {
          logger.error('事件处理失败', { event: 'unknown', error: (error as Error).message });
        }
      }
    };

    const attachToRoom = (room: GameRoom, playerId: string): void => {
      data.roomCode = room.code;
      data.playerId = playerId;
      data.nickname = room.getPlayer(playerId)?.nickname;
      void socket.join(room.code);
      room.setOnline(playerId, true, socket.id);
    };

    const detach = (): void => {
      const { playerId, roomCode } = data;
      if (!playerId || !roomCode) return;
      const room = manager.getRoom(roomCode);
      if (room) {
        const stillOnline = [...(io.sockets.adapter.rooms.get(roomCode) ?? [])].some((id) => {
          if (id === socket.id) return false;
          const other = io.sockets.sockets.get(id);
          return (other?.data as SocketData | undefined)?.playerId === playerId;
        });
        if (stillOnline) return;
        room.setOnline(playerId, false, null);
      }
    };

    socket.on('createRoom', (payload, ack) => {
      reply(ack, () => {
        if (!joinLimiter.allow(`create:${ip}`)) {
          throw new AppError(ErrorCode.RATE_LIMITED, '操作过于频繁，请稍后再试', 429);
        }
        const input = parseCreateRoomPayload(payload);
        const { room, player } = manager.createRoom({
          nickname: input.nickname,
          gameType: input.gameType,
          settings: input.settings,
        });
        attachToRoom(room, player.id);
        return {
          code: room.code,
          playerId: player.id,
          reconnectToken: player.reconnectToken,
          state: projectRoomState(room, player.id),
        };
      });
    });

    socket.on('joinRoom', (payload, ack) => {
      reply(ack, () => {
        if (!joinLimiter.allow(`join:${ip}`)) {
          throw new AppError(ErrorCode.RATE_LIMITED, '加入房间过于频繁，请稍后再试', 429);
        }
        const input = parseJoinRoomPayload(payload);
        const { room, player } = manager.joinRoom(input.code, input.nickname);
        attachToRoom(room, player.id);
        return {
          code: room.code,
          playerId: player.id,
          reconnectToken: player.reconnectToken,
          state: projectRoomState(room, player.id),
        };
      });
    });

    socket.on('reconnectRoom', (payload, ack) => {
      reply(ack, () => {
        const input = parseReconnectPayload(payload);
        const { room, player } = manager.reconnect(input.code, input.reconnectToken);
        attachToRoom(room, player.id);
        socket.emit('reconnected', { playerId: player.id, code: room.code });
        return {
          code: room.code,
          playerId: player.id,
          reconnectToken: player.reconnectToken,
          state: projectRoomState(room, player.id),
        };
      });
    });

    socket.on('setNickname', (payload, ack) => {
      reply(ack, () => {
        const { nickname } = parseSetNicknamePayload(payload);
        const { playerId, roomCode } = data;
        if (!playerId || !roomCode) {
          data.nickname = validateNickname(nickname);
          return { playerId: 'local' };
        }
        const room = manager.getRoom(roomCode);
        if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, '房间不存在或已关闭', 404);
        const player = room.renamePlayer(playerId, nickname);
        data.nickname = player.nickname;
        return { playerId: player.id };
      });
    });

    socket.on('requestRoomState', (ack) => {
      reply(ack, () => {
        const { playerId, roomCode } = data;
        if (!roomCode) throw new AppError(ErrorCode.NOT_IN_ROOM, '你还没有加入任何房间');
        const room = manager.getRoom(roomCode);
        if (!room) throw new AppError(ErrorCode.ROOM_NOT_FOUND, '房间不存在或已关闭', 404);
        return projectRoomState(room, playerId ?? null);
      });
    });

    socket.on('startGame', (ack) => {
      reply(ack, () => {
        const room = requireRoom(manager, data);
        return room.startGame(requirePlayerId(data));
      });
    });

    socket.on('restartGame', (ack) => {
      reply(ack, () => {
        const room = requireRoom(manager, data);
        return room.restartGame(requirePlayerId(data));
      });
    });

    socket.on('forceEndGame', (ack) => {
      reply(ack, () => {
        const room = requireRoom(manager, data);
        return room.forceEndGame(requirePlayerId(data));
      });
    });

    socket.on('nextRound', (ack) => {
      reply(ack, () => {
        const room = requireRoom(manager, data);
        return room.nextRound(requirePlayerId(data));
      });
    });

    socket.on('submitWord', (payload, ack) => {
      reply(ack, () => {
        const room = requireRoom(manager, data);
        const { word } = parseSubmitWordPayload(payload);
        return room.submitWord(requirePlayerId(data), word);
      });
    });

    socket.on('leaveRoom', (ack) => {
      reply(ack, () => {
        const { playerId, roomCode } = data;
        if (playerId && roomCode) {
          manager.leaveRoom(roomCode, playerId);
          void socket.leave(roomCode);
        }
        data.playerId = undefined;
        data.roomCode = undefined;
        return { ok: true as const };
      });
    });

    socket.on('disconnect', (reason) => {
      logger.debug('socket 断开', { socketId: socket.id, reason });
      detach();
    });
  });

  return io;
}

function requirePlayerId(data: SocketData): string {
  if (!data.playerId) {
    throw new AppError(ErrorCode.NOT_IN_ROOM, '你还没有加入任何房间，请重新加入');
  }
  return data.playerId;
}

function requireRoom(manager: RoomManager, data: SocketData): GameRoom {
  if (!data.roomCode) {
    throw new AppError(ErrorCode.NOT_IN_ROOM, '你还没有加入任何房间，请重新加入');
  }
  const room = manager.getRoom(data.roomCode);
  if (!room) {
    throw new AppError(ErrorCode.ROOM_NOT_FOUND, '房间不存在或已关闭', 404);
  }
  return room;
}
