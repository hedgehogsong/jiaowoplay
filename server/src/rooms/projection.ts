import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  WORD_MAX_LENGTH,
  WORD_MIN_LENGTH,
} from '@jiaowoplay/shared';
import type {
  PublicRoomInfo,
  RoomLimits,
  RoomStateView,
  RoundView,
  SubmissionView,
} from '@jiaowoplay/shared';
import type { GameRoom } from './Room.js';
import type { Player } from '../domain/types.js';
import { toRoundView } from './roundView.js';

export const ROOM_LIMITS: RoomLimits = {
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  nicknameMinLength: NICKNAME_MIN_LENGTH,
  nicknameMaxLength: NICKNAME_MAX_LENGTH,
  wordMinLength: WORD_MIN_LENGTH,
  wordMaxLength: WORD_MAX_LENGTH,
};

/** 按观察者视角裁剪房间状态；viewerPlayerId 为 null 时不含 you 字段 */
export function projectRoomState(room: GameRoom, viewerPlayerId: string | null): RoomStateView {
  const data = room.data;
  const session = data.session;
  const viewer = viewerPlayerId ? data.players.get(viewerPlayerId) ?? null : null;

  const currentRound = session ? session.rounds[session.rounds.length - 1] ?? null : null;

  return {
    code: data.code,
    status: data.status,
    hostPlayerId: data.hostPlayerId,
    gameType: data.gameType,
    settings: { ...data.settings },
    players: room.playersSorted().map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isHost: player.isHost,
      isOnline: player.isOnline,
      isActive: player.isActive,
      hasSubmitted: Boolean(
        session &&
          currentRound &&
          currentRound.status === 'COLLECTING' &&
          currentRound.submissions.has(player.id),
      ),
      joinedAt: player.joinedAt,
    })),
    game: session
      ? {
          sessionId: session.id,
          gameType: session.gameType,
          phase: session.phase,
          currentRound: session.currentRound,
          maxRounds: session.maxRounds,
          outcome: session.outcome,
          winnerPlayerIds: [...session.winnerPlayerIds],
          winnerNicknames: session.winnerPlayerIds
            .map((id) => data.players.get(id)?.nickname)
            .filter((name): name is string => typeof name === 'string'),
          totalRounds: session.rounds.filter((round) => round.status === 'REVEALED').length,
          rounds: session.rounds.map((round) => toRoundView(round, data.players)),
          collectDeadline:
            currentRound && currentRound.status === 'COLLECTING'
              ? currentRound.collectDeadline
              : null,
          revealUntil:
            currentRound && currentRound.status === 'REVEALED' ? currentRound.revealUntil : null,
        }
      : null,
    you: viewer ? { playerId: viewer.id, nickname: viewer.nickname } : null,
    limits: ROOM_LIMITS,
    serverTime: Date.now(),
  };
}

export function projectPublicRoomInfo(room: GameRoom): PublicRoomInfo {
  const data = room.data;
  const players = room.playersSorted();
  const host = data.players.get(data.hostPlayerId) ?? null;
  return {
    code: data.code,
    status: data.status,
    gameType: data.gameType,
    hostNickname: host?.nickname ?? null,
    playerCount: players.length,
    maxPlayers: MAX_PLAYERS,
    onlineCount: players.filter((player) => player.isOnline).length,
    currentRound: data.session?.currentRound ?? null,
    maxRounds: data.session?.maxRounds ?? null,
  };
}
