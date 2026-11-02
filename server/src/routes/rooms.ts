import { Router } from 'express';
import type { ErrorRequestHandler } from 'express';
import type { HistoryRepository } from '../db/repository.js';
import { AppError, ErrorCode, isAppError } from '../domain/errors.js';
import {
  parseCreateRoomPayload,
  parseJoinRoomPayload,
  validateNickname,
  validateRoomCode,
} from '../domain/validation.js';
import { listGames } from '../games/registry.js';
import { logger } from '../logger.js';
import { projectPublicRoomInfo, projectRoomState } from '../rooms/projection.js';
import type { RoomManager } from '../rooms/RoomManager.js';

export function createRoomsRouter(
  manager: RoomManager,
  history: HistoryRepository | null,
): Router {
  const router = Router();

  router.get('/games', (_req, res) => {
    res.json({ games: listGames() });
  });

  router.post('/rooms', (req, res, next) => {
    try {
      const payload = parseCreateRoomPayload(req.body);
      const { room, player } = manager.createRoom({
        nickname: payload.nickname,
        gameType: payload.gameType,
        settings: payload.settings,
      });
      res.status(201).json({
        code: room.code,
        playerId: player.id,
        reconnectToken: player.reconnectToken,
        state: projectRoomState(room, player.id),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/rooms/:code/join', (req, res, next) => {
    try {
      const code = validateRoomCode(req.params.code);
      const body = (req.body ?? {}) as { nickname?: unknown };
      const nickname = validateNickname(body.nickname);
      const { room, player } = manager.joinRoom(code, nickname);
      res.status(200).json({
        code: room.code,
        playerId: player.id,
        reconnectToken: player.reconnectToken,
        state: projectRoomState(room, player.id),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/rooms/:code', (req, res, next) => {
    try {
      const code = validateRoomCode(req.params.code);
      const room = manager.getRoom(code);
      if (!room) {
        throw new AppError(ErrorCode.ROOM_NOT_FOUND, '房间不存在或已关闭', 404);
      }
      res.json({ room: projectPublicRoomInfo(room) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/rooms/:code/history', (req, res, next) => {
    try {
      const code = validateRoomCode(req.params.code);
      if (!history) {
        throw new AppError(ErrorCode.INTERNAL, '历史记录不可用', 503);
      }
      const limitRaw = Number.parseInt(String(req.query.limit ?? '20'), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 20;
      res.json({ code, sessions: history.listSessionsByRoom(code, limit) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/sessions/:id', (req, res, next) => {
    try {
      const id = String(req.params.id ?? '').trim();
      if (id.length === 0 || id.length > 64) {
        throw new AppError(ErrorCode.INVALID_PAYLOAD, '对局 ID 不合法', 400);
      }
      if (!history) {
        throw new AppError(ErrorCode.INTERNAL, '历史记录不可用', 503);
      }
      const session = history.getSession(id);
      if (!session) {
        throw new AppError(ErrorCode.ROOM_NOT_FOUND, '未找到该对局记录', 404);
      }
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (isAppError(error)) {
    res.status(error.httpStatus).json({ error: error.toJSON() });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  logger.error('请求处理失败', { error: message });
  res.status(500).json({ error: { code: ErrorCode.INTERNAL, message: '服务器内部错误' } });
};
