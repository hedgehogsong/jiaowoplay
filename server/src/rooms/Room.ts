import {
  EMPTY_ROOM_TTL_MS,
  HOST_OFFLINE_GRACE_MS,
  MIN_PLAYERS,
  PLAYER_OFFLINE_GRACE_MS,
  isDeveloperNickname,
} from '@jiaowoplay/shared';
import type { GameOutcome, ServerToClientEvents } from '@jiaowoplay/shared';
import type { HistoryRepository, AbandonReason } from '../db/repository.js';
import { AppError, ErrorCode } from '../domain/errors.js';
import { newId, safeTokenEqual } from '../domain/ids.js';
import type { GameSession, Player, RoomData, Round, Submission } from '../domain/types.js';
import type { GameDefinition, RoundSubmissionInput } from '../games/Game.js';
import { logger } from '../logger.js';
import { toRoundView } from './roundView.js';

export type ServerEvent = keyof ServerToClientEvents;

export interface RoomNotifier {
  /** 由实时层按每个观察者的视角重新投影后下发 */
  broadcastState(): void;
  /** 用泛型绑定事件名与负载类型，避免 payload 写成 unknown 后静默跑偏 */
  broadcast<E extends ServerEvent>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  sendToPlayer<E extends ServerEvent>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
}

export interface RoomDeps {
  game: GameDefinition;
  history: HistoryRepository | null;
  notifier: RoomNotifier;
}

type Timer = ReturnType<typeof setTimeout>;

const MAX_ROOM_AGE_MS = 6 * 60 * 60 * 1000;

export class GameRoom {
  readonly data: RoomData;
  private readonly deps: RoomDeps;
  private submitTimer: Timer | null = null;
  private revealTimer: Timer | null = null;
  private disposed = false;

  constructor(data: RoomData, deps: RoomDeps) {
    this.data = data;
    this.deps = deps;
  }

  get code(): string {
    return this.data.code;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private now(): number {
    return Date.now();
  }

  touch(): void {
    this.data.lastActivityAt = this.now();
    if (this.data.players.size > 0) this.data.emptySince = null;
  }

  playersSorted(): Player[] {
    return [...this.data.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  onlinePlayers(): Player[] {
    return this.playersSorted().filter((player) => player.isOnline);
  }

  getPlayer(playerId: string): Player | undefined {
    return this.data.players.get(playerId);
  }

  findPlayerByToken(reconnectToken: string): Player | undefined {
    return this.playersSorted().find((player) =>
      safeTokenEqual(reconnectToken, player.reconnectToken),
    );
  }

  hasNickname(nickname: string, exceptPlayerId?: string): boolean {
    return [...this.data.players.values()].some(
      (player) =>
        player.nickname.toLowerCase() === nickname.toLowerCase() && player.id !== exceptPlayerId,
    );
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new AppError(ErrorCode.ROOM_NOT_FOUND, '房间已关闭', 404);
    }
  }

  private requireSession() {
    const session = this.data.session;
    if (!session) {
      throw new AppError(ErrorCode.GAME_NOT_RUNNING, '当前没有正在进行的对局');
    }
    return session;
  }

  private currentRound(): Round {
    const session = this.requireSession();
    const round = session.rounds[session.rounds.length - 1];
    if (!round) {
      throw new AppError(ErrorCode.INVALID_STATE, '对局状态异常：缺少当前轮次');
    }
    return round;
  }

  private assertHost(playerId: string): Player {
    this.assertAlive();
    const player = this.data.players.get(playerId);
    if (!player) {
      throw new AppError(ErrorCode.NOT_IN_ROOM, '你不在该房间中，请重新加入');
    }
    if (this.data.hostPlayerId !== playerId) {
      throw new AppError(ErrorCode.NOT_HOST, '只有房主可以执行该操作');
    }
    return player;
  }

  private clearSubmitTimer(): void {
    if (this.submitTimer) {
      clearTimeout(this.submitTimer);
      this.submitTimer = null;
    }
  }

  private clearRevealTimer(): void {
    if (this.revealTimer) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  // ---------------------------------------------------------------- 成员管理

  addPlayer(player: Player): void {
    this.assertAlive();
    this.data.players.set(player.id, player);
    this.data.emptySince = null;
    this.touch();
    this.deps.notifier.broadcast('playerJoined', {
      player: {
        id: player.id,
        nickname: player.nickname,
        isHost: player.isHost,
        isOnline: player.isOnline,
        isDeveloper: isDeveloperNickname(player.nickname),
        isActive: player.isActive,
        hasSubmitted: false,
        joinedAt: player.joinedAt,
      },
    });
    this.deps.notifier.broadcastState();
  }

  removePlayer(playerId: string, reason: string): void {
    this.assertAlive();
    const player = this.data.players.get(playerId);
    if (!player) return;

    const session = this.data.session;
    if (session && session.activePlayerIds.has(playerId)) {
      session.activePlayerIds.delete(playerId);
      player.isActive = false;
      const round = session.rounds[session.rounds.length - 1];
      if (round && round.status === 'COLLECTING') {
        round.submissions.delete(playerId);
        if (
          session.phase === 'ROUND_COLLECT' &&
          session.activePlayerIds.size > 0 &&
          round.submissions.size >= session.activePlayerIds.size
        ) {
          this.finishRound();
        }
      }
      if (
        this.data.status === 'PLAYING' &&
        session.phase !== 'FINISHED' &&
        session.activePlayerIds.size < MIN_PLAYERS
      ) {
        this.endGame('INSUFFICIENT_PLAYERS', []);
      }
    }

    this.data.players.delete(playerId);
    this.deps.notifier.broadcast('playerLeft', {
      playerId,
      nickname: player.nickname,
      reason,
    });

    if (this.data.hostPlayerId === playerId) this.transferHost();

    this.deps.notifier.broadcastState();
    this.touch();
    if (this.data.players.size === 0) this.data.emptySince = this.now();
  }

  setOnline(playerId: string, isOnline: boolean, socketId: string | null): void {
    const player = this.data.players.get(playerId);
    if (!player) return;
    if (player.isOnline === isOnline && player.socketId === socketId) return;

    player.isOnline = isOnline;
    player.socketId = isOnline ? socketId : null;
    player.lastSeenAt = this.now();
    player.offlineSince = isOnline ? null : this.now();
    this.data.emptySince = null;
    this.touch();

    this.deps.notifier.broadcast('playerOnline', { playerId, isOnline });
    this.deps.notifier.broadcastState();
  }

  renamePlayer(playerId: string, nickname: string): Player {
    this.assertAlive();
    const player = this.data.players.get(playerId);
    if (!player) {
      throw new AppError(ErrorCode.NOT_IN_ROOM, '你不在该房间中，请重新加入');
    }
    if (player.nickname === nickname) return player;
    if (this.hasNickname(nickname, playerId)) {
      throw new AppError(ErrorCode.NICKNAME_TAKEN, '房间内已有玩家使用该昵称，请换一个');
    }
    player.nickname = nickname;
    this.touch();
    this.deps.notifier.broadcastState();
    return player;
  }

  /** 房主转移：优先最早加入且在线的成员，全部离线时退回最早加入者 */
  transferHost(): Player | null {
    const ordered = this.playersSorted();
    const next = ordered.find((player) => player.isOnline) ?? ordered[0] ?? null;
    if (!next) {
      this.data.hostPlayerId = '';
      return null;
    }
    for (const player of ordered) player.isHost = player.id === next.id;
    // 全员离线时候选恒为同一人，巡检每 5 秒都会「转移」给现任房主。
    // 选中同一人就只校正标志位，不广播、不打日志，否则日志和前端都会被刷屏。
    if (next.id === this.data.hostPlayerId) return next;
    this.data.hostPlayerId = next.id;
    this.touch();
    this.deps.notifier.broadcast('hostTransferred', {
      hostPlayerId: next.id,
      nickname: next.nickname,
    });
    logger.info('房主已转移', { roomCode: this.data.code });
    return next;
  }

  // ---------------------------------------------------------------- 对局流程

  startGame(requestedBy: string): { sessionId: string } {
    this.assertHost(requestedBy);
    if (this.data.status === 'PLAYING') {
      throw new AppError(ErrorCode.INVALID_STATE, '对局已经在进行中');
    }
    const session = this.beginNewGame();
    return { sessionId: session.id };
  }

  restartGame(requestedBy: string): { sessionId: string } {
    this.assertHost(requestedBy);
    if (this.data.status === 'PLAYING') this.endGame('HOST_ENDED', []);
    const session = this.beginNewGame();
    return { sessionId: session.id };
  }

  private beginNewGame() {
    this.assertAlive();
    const online = this.onlinePlayers();
    this.deps.game.assertCanStart({
      onlinePlayers: online.map((player) => ({ playerId: player.id, nickname: player.nickname })),
      settings: this.data.settings,
    });

    const now = this.now();
    const session = {
      id: newId('gs'),
      roomId: this.data.id,
      gameType: this.data.gameType,
      phase: 'ROUND_COLLECT' as const,
      currentRound: 0,
      maxRounds: this.data.settings.maxRounds,
      settings: { ...this.data.settings },
      outcome: null,
      winnerPlayerIds: [] as string[],
      activePlayerIds: new Set(online.map((player) => player.id)),
      rounds: [] as Round[],
      startedAt: now,
      endedAt: null,
    };

    for (const player of this.data.players.values()) {
      player.isActive = session.activePlayerIds.has(player.id);
    }
    this.data.session = session;
    this.data.status = 'PLAYING';

    this.deps.history?.createSession({
      id: session.id,
      roomId: session.roomId,
      roomCode: this.data.code,
      gameType: session.gameType,
      maxRounds: session.maxRounds,
      winMode: session.settings.winMode,
      players: online.map((player) => ({ playerId: player.id, nickname: player.nickname })),
      hostPlayerId: this.data.hostPlayerId,
      startedAt: now,
    });
    this.deps.history?.recordEvent({
      gameSessionId: session.id,
      type: 'game_started',
      createdAt: now,
      payload: { activePlayerIds: [...session.activePlayerIds] },
    });

    this.deps.notifier.broadcast('gameStarted', {
      sessionId: session.id,
      gameType: session.gameType,
      roundNumber: 1,
      startedAt: now,
    });
    this.beginRound(1, []);
    this.touch();
    logger.info('对局开始', {
      roomCode: this.data.code,
      sessionId: session.id,
      activePlayers: session.activePlayerIds.size,
    });
    return session;
  }

  private beginRound(roundNumber: number, previousWords: string[]): Round {
    const session = this.requireSession();
    const now = this.now();
    const activePlayers = this.playersSorted()
      .filter((player) => session.activePlayerIds.has(player.id))
      .map((player) => ({ playerId: player.id, nickname: player.nickname }));

    const round: Round = {
      id: newId('rd'),
      roundNumber,
      status: 'COLLECTING',
      previousWords: [...previousWords],
      prompt: this.deps.game.buildRoundPrompt({
        roundNumber,
        previousWords: [...previousWords],
        activePlayers: activePlayers.slice(),
      }),
      submissions: new Map(),
      allSame: false,
      partialMeetings: [],
      startedAt: now,
      revealedAt: null,
      collectDeadline: now + session.settings.submitTimeoutMs,
      revealUntil: null,
    };

    session.rounds.push(round);
    session.currentRound = roundNumber;
    session.phase = 'ROUND_COLLECT';

    this.deps.history?.createRound({
      id: round.id,
      gameSessionId: session.id,
      roundNumber,
      previousWords: round.previousWords,
      startedAt: now,
    });
    this.deps.history?.setSessionRound(session.id, roundNumber);

    this.deps.notifier.broadcast('roundStarted', {
      roundNumber,
      previousWords: round.previousWords,
      collectDeadline: round.collectDeadline,
      prompt: round.prompt,
    });
    this.deps.notifier.broadcastState();

    this.scheduleSubmitTimeout(round);
    return round;
  }

  private scheduleSubmitTimeout(round: Round): void {
    this.clearSubmitTimer();
    const delay = Math.max(0, round.collectDeadline - this.now());
    this.submitTimer = setTimeout(() => {
      this.submitTimer = null;
      if (this.disposed) return;
      try {
        const current = this.data.session?.rounds[this.data.session.rounds.length - 1];
        if (current && current.id === round.id && current.status === 'COLLECTING') {
          logger.info('本轮提交超时，开始结算', {
            roomCode: this.data.code,
            roundNumber: round.roundNumber,
          });
          this.finishRound();
        }
      } catch (error) {
        logger.error('结算超时轮次失败', {
          roomCode: this.data.code,
          error: (error as Error).message,
        });
      }
    }, delay);
    if (typeof this.submitTimer === 'object' && this.submitTimer !== null) {
      (this.submitTimer as { unref?: () => void }).unref?.();
    }
  }

  submitWord(playerId: string, rawWord: string): { roundNumber: number } {
    this.assertAlive();
    const session = this.requireSession();
    if (this.data.status !== 'PLAYING') {
      throw new AppError(ErrorCode.GAME_NOT_RUNNING, '当前没有正在进行的对局');
    }
    if (session.phase !== 'ROUND_COLLECT') {
      throw new AppError(ErrorCode.ROUND_NOT_COLLECTING, '本轮已停止收集词语，请等待下一轮');
    }

    const round = this.currentRound();
    if (round.status !== 'COLLECTING') {
      throw new AppError(ErrorCode.ROUND_NOT_COLLECTING, '本轮已停止收集词语，请等待下一轮');
    }
    const player = this.data.players.get(playerId);
    if (!player) {
      throw new AppError(ErrorCode.NOT_IN_ROOM, '你不在该房间中，请重新加入');
    }
    if (!session.activePlayerIds.has(playerId)) {
      throw new AppError(ErrorCode.NOT_ACTIVE_PLAYER, '你不参与当前对局，可在下一局加入');
    }
    if (round.submissions.has(playerId)) {
      throw new AppError(ErrorCode.ALREADY_SUBMITTED, '本轮你已经提交过了');
    }

    const word = this.deps.game.validateSubmission({ word: rawWord });
    const now = this.now();
    const submission: Submission = {
      id: newId('sb'),
      playerId,
      nickname: player.nickname,
      word,
      isTimeout: false,
      submittedAt: now,
    };
    round.submissions.set(playerId, submission);

    this.deps.history?.createSubmission({
      id: submission.id,
      roundId: round.id,
      gameSessionId: session.id,
      playerId,
      nickname: submission.nickname,
      word,
      isTimeout: false,
      submittedAt: now,
    });

    this.deps.notifier.broadcast('submissionAccepted', {
      playerId,
      roundNumber: round.roundNumber,
      submittedCount: round.submissions.size,
      activeCount: session.activePlayerIds.size,
    });
    this.deps.notifier.broadcastState();
    this.touch();

    if (round.submissions.size >= session.activePlayerIds.size) {
      this.finishRound();
    }
    return { roundNumber: round.roundNumber };
  }

  /** 全员提交或超时后结算本轮：CHECK → ROUND_REVEAL → 下一轮 / 结束 */
  private finishRound(): void {
    const session = this.data.session;
    if (!session || session.phase === 'FINISHED') return;
    const round = session.rounds[session.rounds.length - 1];
    if (!round || round.status === 'REVEALED') return;

    this.clearSubmitTimer();
    this.clearRevealTimer();
    const now = this.now();

    for (const playerId of session.activePlayerIds) {
      if (round.submissions.has(playerId)) continue;
      const player = this.data.players.get(playerId);
      const submission: Submission = {
        id: newId('sb'),
        playerId,
        nickname: player?.nickname ?? '未知玩家',
        word: null,
        isTimeout: true,
        submittedAt: null,
      };
      round.submissions.set(playerId, submission);
      this.deps.history?.createSubmission({
        id: submission.id,
        roundId: round.id,
        gameSessionId: session.id,
        playerId,
        nickname: submission.nickname,
        word: null,
        isTimeout: true,
        submittedAt: null,
      });
    }

    session.phase = 'CHECK';

    const inputs: RoundSubmissionInput[] = [...round.submissions.values()].map((submission) => ({
      playerId: submission.playerId,
      nickname: submission.nickname,
      word: submission.word,
      isTimeout: submission.isTimeout,
    }));

    const judgement = this.deps.game.judgeRound(inputs, session.settings);
    round.allSame = judgement.allSame;
    round.partialMeetings = judgement.partialMeetings;
    round.status = 'REVEALED';
    round.revealedAt = now;
    round.revealUntil = now + session.settings.revealDurationMs;

    this.deps.history?.finalizeRound({
      id: round.id,
      allSame: round.allSame,
      partialMeetings: round.partialMeetings,
      revealedAt: now,
    });
    this.deps.history?.recordEvent({
      gameSessionId: session.id,
      roundNumber: round.roundNumber,
      type: round.allSame ? 'all_met' : judgement.partialMeetings.length > 0 ? 'partial_met' : 'no_met',
      createdAt: now,
      payload: {
        eligibleCount: judgement.eligibleCount,
        partialMeetings: judgement.partialMeetings,
      },
    });

    session.phase = 'ROUND_REVEAL';
    this.deps.notifier.broadcast('roundRevealed', {
      round: toRoundView(round, this.data.players),
      revealUntil: round.revealUntil,
      allSame: round.allSame,
    });
    this.deps.notifier.broadcastState();
    this.touch();

    const outcome = this.deps.game.evaluateAfterRound({
      judgement,
      roundNumber: round.roundNumber,
      settings: session.settings,
    });

    const previousWords = this.deps.game.collectPreviousWords(inputs);
    const delay = Math.max(0, round.revealUntil - this.now());

    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      if (this.disposed) return;
      try {
        if (outcome) this.endGame(outcome.outcome, outcome.winnerPlayerIds);
        else this.beginRound(round.roundNumber + 1, previousWords);
      } catch (error) {
        logger.error('推进下一轮失败', {
          roomCode: this.data.code,
          error: (error as Error).message,
        });
      }
    }, delay);
  }

  nextRound(requestedBy: string): { roundNumber: number } {
    this.assertHost(requestedBy);
    const session = this.requireSession();
    if (this.data.status !== 'PLAYING') {
      throw new AppError(ErrorCode.GAME_NOT_RUNNING, '当前没有正在进行的对局');
    }
    if (session.phase !== 'ROUND_REVEAL') {
      throw new AppError(ErrorCode.INVALID_STATE, '当前不在揭晓阶段，无法手动进入下一轮');
    }
    const round = this.currentRound();
    if (round.roundNumber >= session.maxRounds) {
      throw new AppError(ErrorCode.INVALID_STATE, '已达轮次上限');
    }
    this.clearRevealTimer();
    const inputs: RoundSubmissionInput[] = [...round.submissions.values()].map((submission) => ({
      playerId: submission.playerId,
      nickname: submission.nickname,
      word: submission.word,
      isTimeout: submission.isTimeout,
    }));
    const previousWords = this.deps.game.collectPreviousWords(inputs);
    const next = this.beginRound(round.roundNumber + 1, previousWords);
    return { roundNumber: next.roundNumber };
  }

  forceEndGame(requestedBy: string): { sessionId: string } {
    this.assertHost(requestedBy);
    const session = this.requireSession();
    if (this.data.status !== 'PLAYING') {
      throw new AppError(ErrorCode.INVALID_STATE, '当前没有正在进行的对局');
    }
    this.endGame('HOST_ENDED', []);
    return { sessionId: session.id };
  }

  private endGame(outcome: GameOutcome, winnerPlayerIds: string[]): void {
    const session = this.data.session;
    if (!session || session.phase === 'FINISHED') return;

    this.clearSubmitTimer();
    this.clearRevealTimer();
    const now = this.now();

    session.outcome = outcome;
    session.winnerPlayerIds = [...winnerPlayerIds];
    session.endedAt = now;
    session.phase = 'FINISHED';
    this.data.status = 'ENDED';
    for (const player of this.data.players.values()) player.isActive = false;

    this.deps.history?.finishSession({
      id: session.id,
      currentRound: session.currentRound,
      outcome,
      winnerPlayerIds: session.winnerPlayerIds,
      endedAt: now,
    });
    this.deps.history?.recordEvent({
      gameSessionId: session.id,
      roundNumber: session.currentRound,
      type: 'game_ended',
      createdAt: now,
      payload: { outcome, winnerPlayerIds: session.winnerPlayerIds },
    });

    this.deps.notifier.broadcast('gameEnded', {
      sessionId: session.id,
      outcome,
      totalRounds: session.rounds.filter((round) => round.status === 'REVEALED').length,
      winnerPlayerIds: session.winnerPlayerIds,
      winnerNicknames: session.winnerPlayerIds
        .map((id) => this.data.players.get(id)?.nickname)
        .filter((name): name is string => typeof name === 'string'),
      rounds: session.rounds.map((round) => toRoundView(round, this.data.players)),
    });
    this.deps.notifier.broadcastState();
    this.touch();
    logger.info('对局结束', { roomCode: this.data.code, sessionId: session.id, outcome });
  }

  // ---------------------------------------------------------------- 生命周期

  /**
   * 周期性巡检：处理房主掉线转移与房间回收。
   * 返回 true 表示房间应被销毁。
   */
  sweep(now: number): boolean {
    if (this.disposed) return true;

    const host = this.data.players.get(this.data.hostPlayerId);
    if (
      host &&
      !host.isOnline &&
      host.offlineSince !== null &&
      now - host.offlineSince >= HOST_OFFLINE_GRACE_MS &&
      this.data.players.size > 1
    ) {
      this.transferHost();
    }

    if (this.data.players.size === 0) {
      if (this.data.emptySince === null) this.data.emptySince = now;
      if (now - this.data.emptySince >= EMPTY_ROOM_TTL_MS) return true;
      return false;
    }

    this.data.emptySince = null;

    const allOffline = this.playersSorted().every((player) => !player.isOnline);
    if (allOffline) {
      const longestOffline = Math.max(
        ...this.playersSorted().map((player) => now - (player.offlineSince ?? now)),
      );
      if (longestOffline >= PLAYER_OFFLINE_GRACE_MS) return true;
    }

    if (now - this.data.createdAt >= MAX_ROOM_AGE_MS) return true;

    return false;
  }

  dispose(reason: AbandonReason = 'room_reclaimed'): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearSubmitTimer();
    this.clearRevealTimer();

    const session = this.data.session;
    if (session && session.phase !== 'FINISHED') this.abandonSession(session, reason);
  }

  /**
   * 房间销毁时给未结束的对局一个终态。
   * 不广播：回收路径下无人在线，发版路径下 socket 紧接着就被关掉。
   */
  private abandonSession(session: GameSession, reason: AbandonReason): void {
    const now = this.now();
    session.outcome = 'ABANDONED';
    session.winnerPlayerIds = [];
    session.endedAt = now;
    session.phase = 'FINISHED';
    for (const round of session.rounds) {
      if (round.status === 'COLLECTING') round.status = 'ABANDONED';
    }
    this.data.status = 'ENDED';
    for (const player of this.data.players.values()) player.isActive = false;

    const persisted = this.deps.history?.abandonSession({
      id: session.id,
      currentRound: session.currentRound,
      endedAt: now,
      reason,
    }) ?? false;

    logger.warn('对局未结束即被流局处理', {
      roomCode: this.data.code,
      sessionId: session.id,
      reason,
      persisted,
    });
  }
}
