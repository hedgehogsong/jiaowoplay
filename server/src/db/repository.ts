import type {
  GameOutcome,
  GameType,
  HistoricalRound,
  HistoricalSession,
  PartialMeeting,
  WinMode,
} from '@jiaowoplay/shared';
import { logger } from '../logger.js';
import type { SqliteDatabase } from './index.js';

export interface SessionRecord {
  id: string;
  roomId: string;
  roomCode: string;
  gameType: GameType;
  maxRounds: number;
  winMode: WinMode;
  players: { playerId: string; nickname: string }[];
  startedAt: number;
}

export interface RoundRecord {
  id: string;
  gameSessionId: string;
  roundNumber: number;
  previousWords: string[];
  startedAt: number;
}

export interface SubmissionRecord {
  id: string;
  roundId: string;
  gameSessionId: string;
  playerId: string;
  nickname: string;
  word: string | null;
  isTimeout: boolean;
  submittedAt: number | null;
}

interface SessionRow {
  id: string;
  room_code: string;
  game_type: string;
  outcome: string | null;
  current_round: number;
  max_rounds: number;
  winner_player_ids: string;
  players: string;
  started_at: number;
  ended_at: number | null;
}

interface RoundRow {
  id: string;
  game_session_id: string;
  round_number: number;
  all_same: number;
  partial_meetings: string;
  previous_words: string;
  started_at: number;
  revealed_at: number | null;
}

interface SubmissionRow {
  player_id: string;
  nickname: string;
  word: string | null;
  is_timeout: number;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 对局历史持久化。所有写入失败只记录日志、不抛出，
 * 保证 SQLite 异常不会中断正在进行的实时对局。
 */
export class HistoryRepository {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  private safe(label: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      logger.warn('历史记录写入失败', { label, error: (error as Error).message });
    }
  }

  createSession(record: SessionRecord): void {
    this.safe('createSession', () => {
      this.db
        .prepare(
          `INSERT INTO game_sessions
             (id, room_id, room_code, game_type, status, outcome, current_round,
              max_rounds, win_mode, winner_player_ids, players, started_at, ended_at)
           VALUES (@id, @roomId, @roomCode, @gameType, 'active', NULL, 0,
              @maxRounds, @winMode, '[]', @players, @startedAt, NULL)`,
        )
        .run({
          id: record.id,
          roomId: record.roomId,
          roomCode: record.roomCode,
          gameType: record.gameType,
          maxRounds: record.maxRounds,
          winMode: record.winMode,
          players: JSON.stringify(record.players),
          startedAt: record.startedAt,
        });
    });
  }

  setSessionRound(id: string, currentRound: number): void {
    this.safe('setSessionRound', () => {
      this.db
        .prepare(`UPDATE game_sessions SET current_round = @currentRound WHERE id = @id`)
        .run({ id, currentRound });
    });
  }

  finishSession(input: {
    id: string;
    currentRound: number;
    outcome: GameOutcome;
    winnerPlayerIds: string[];
    endedAt: number;
  }): void {
    this.safe('finishSession', () => {
      this.db
        .prepare(
          `UPDATE game_sessions
              SET current_round = @currentRound,
                  outcome = @outcome,
                  status = 'finished',
                  winner_player_ids = @winnerPlayerIds,
                  ended_at = @endedAt
            WHERE id = @id`,
        )
        .run({
          id: input.id,
          currentRound: input.currentRound,
          outcome: input.outcome,
          winnerPlayerIds: JSON.stringify(input.winnerPlayerIds),
          endedAt: input.endedAt,
        });
    });
  }

  createRound(record: RoundRecord): void {
    this.safe('createRound', () => {
      this.db
        .prepare(
          `INSERT INTO rounds
             (id, game_session_id, round_number, status, all_same,
              partial_meetings, previous_words, started_at, revealed_at)
           VALUES (@id, @gameSessionId, @roundNumber, 'COLLECTING', 0, '[]', @previousWords, @startedAt, NULL)`,
        )
        .run({
          id: record.id,
          gameSessionId: record.gameSessionId,
          roundNumber: record.roundNumber,
          previousWords: JSON.stringify(record.previousWords),
          startedAt: record.startedAt,
        });
    });
  }

  finalizeRound(input: {
    id: string;
    allSame: boolean;
    partialMeetings: PartialMeeting[];
    revealedAt: number;
  }): void {
    this.safe('finalizeRound', () => {
      this.db
        .prepare(
          `UPDATE rounds
              SET status = 'REVEALED',
                  all_same = @allSame,
                  partial_meetings = @partialMeetings,
                  revealed_at = @revealedAt
            WHERE id = @id`,
        )
        .run({
          id: input.id,
          allSame: input.allSame ? 1 : 0,
          partialMeetings: JSON.stringify(input.partialMeetings),
          revealedAt: input.revealedAt,
        });
    });
  }

  createSubmission(record: SubmissionRecord): void {
    this.safe('createSubmission', () => {
      this.db
        .prepare(
          `INSERT INTO submissions
             (id, round_id, game_session_id, player_id, nickname, word, is_timeout, submitted_at)
           VALUES (@id, @roundId, @gameSessionId, @playerId, @nickname, @word, @isTimeout, @submittedAt)`,
        )
        .run({
          id: record.id,
          roundId: record.roundId,
          gameSessionId: record.gameSessionId,
          playerId: record.playerId,
          nickname: record.nickname,
          word: record.word,
          isTimeout: record.isTimeout ? 1 : 0,
          submittedAt: record.submittedAt,
        });
    });
  }

  recordEvent(input: {
    gameSessionId: string;
    roundNumber?: number | null;
    type: string;
    payload?: Record<string, unknown>;
    createdAt: number;
  }): void {
    this.safe('recordEvent', () => {
      this.db
        .prepare(
          `INSERT INTO game_events (game_session_id, round_number, type, payload, created_at)
           VALUES (@gameSessionId, @roundNumber, @type, @payload, @createdAt)`,
        )
        .run({
          gameSessionId: input.gameSessionId,
          roundNumber: input.roundNumber ?? null,
          type: input.type,
          payload: JSON.stringify(input.payload ?? {}),
          createdAt: input.createdAt,
        });
    });
  }

  getSession(sessionId: string): HistoricalSession | null {
    const session = this.db
      .prepare(`SELECT * FROM game_sessions WHERE id = ?`)
      .get(sessionId) as SessionRow | undefined;
    if (!session) return null;

    const rounds = this.db
      .prepare(`SELECT * FROM rounds WHERE game_session_id = ? ORDER BY round_number ASC`)
      .all(sessionId) as RoundRow[];

    const submissionStmt = this.db.prepare(
      `SELECT player_id, nickname, word, is_timeout FROM submissions WHERE round_id = ? ORDER BY rowid ASC`,
    );

    const winnerPlayerIds = parseJson<string[]>(session.winner_player_ids, []);
    const players = parseJson<{ playerId: string; nickname: string }[]>(session.players, []);
    const nicknameOf = new Map(players.map((p) => [p.playerId, p.nickname]));

    const historicalRounds: HistoricalRound[] = rounds.map((round) => {
      const rows = submissionStmt.all(round.id) as SubmissionRow[];
      return {
        roundNumber: round.round_number,
        allSame: round.all_same === 1,
        partialMeetings: parseJson<PartialMeeting[]>(round.partial_meetings, []),
        startedAt: round.started_at,
        revealedAt: round.revealed_at,
        submissions: rows.map((row) => ({
          playerId: row.player_id,
          nickname: row.nickname,
          word: row.word,
          isTimeout: row.is_timeout === 1,
        })),
      };
    });

    return {
      id: session.id,
      roomCode: session.room_code,
      gameType: session.game_type as GameType,
      outcome: (session.outcome as GameOutcome | null) ?? null,
      totalRounds: historicalRounds.filter((r) => r.revealedAt !== null).length,
      maxRounds: session.max_rounds,
      winnerPlayerIds,
      winnerNicknames: winnerPlayerIds
        .map((id) => nicknameOf.get(id))
        .filter((name): name is string => typeof name === 'string'),
      players,
      rounds: historicalRounds,
      startedAt: session.started_at,
      endedAt: session.ended_at,
    };
  }

  listSessionsByRoom(roomCode: string, limit = 20): HistoricalSession[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM game_sessions WHERE room_code = ? ORDER BY started_at DESC LIMIT ?`,
      )
      .all(roomCode, limit) as { id: string }[];
    return rows
      .map((row) => this.getSession(row.id))
      .filter((session): session is HistoricalSession => session !== null);
  }
}
