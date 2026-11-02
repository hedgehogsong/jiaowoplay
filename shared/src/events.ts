import type {
  GameType,
  PlayerView,
  RoomSettings,
  RoomStateView,
  RoundView,
  GameOutcome,
} from './types.js';

export interface ErrorPayload {
  code: string;
  message: string;
  field?: string;
}

export type Ack<T> = (
  res: { ok: true; data: T } | { ok: false; error: ErrorPayload },
) => void;

export interface JoinResult {
  code: string;
  playerId: string;
  reconnectToken: string;
  state: RoomStateView;
}

export interface CreateRoomPayload {
  nickname: string;
  gameType?: GameType;
  settings?: Partial<RoomSettings>;
}

export interface JoinRoomPayload {
  code: string;
  nickname: string;
}

export interface ReconnectPayload {
  code: string;
  reconnectToken: string;
}

export interface SubmissionAcceptedPayload {
  playerId: string;
  roundNumber: number;
  submittedCount: number;
  activeCount: number;
}

export interface RoundRevealedPayload {
  round: RoundView;
  revealUntil: number;
  allSame: boolean;
}

export interface GameEndedPayload {
  sessionId: string;
  outcome: GameOutcome;
  totalRounds: number;
  winnerPlayerIds: string[];
  winnerNicknames: string[];
  rounds: RoundView[];
}

export interface ClientToServerEvents {
  createRoom(payload: CreateRoomPayload, ack: Ack<JoinResult>): void;
  joinRoom(payload: JoinRoomPayload, ack: Ack<JoinResult>): void;
  reconnectRoom(payload: ReconnectPayload, ack: Ack<JoinResult>): void;
  setNickname(payload: { nickname: string }, ack: Ack<{ playerId: string }>): void;
  leaveRoom(ack: Ack<{ ok: true }>): void;
  requestRoomState(ack: Ack<RoomStateView>): void;
  startGame(ack: Ack<{ sessionId: string }>): void;
  submitWord(payload: { word: string }, ack: Ack<{ roundNumber: number }>): void;
  forceEndGame(ack: Ack<{ sessionId: string }>): void;
  restartGame(ack: Ack<{ sessionId: string }>): void;
  nextRound(ack: Ack<{ roundNumber: number }>): void;
}

export interface ServerToClientEvents {
  roomState(state: RoomStateView): void;
  reconnected(payload: { playerId: string; code: string }): void;
  playerJoined(payload: { player: PlayerView }): void;
  playerLeft(payload: { playerId: string; nickname: string; reason: string }): void;
  playerOnline(payload: { playerId: string; isOnline: boolean }): void;
  hostTransferred(payload: { hostPlayerId: string; nickname: string }): void;
  gameStarted(payload: {
    sessionId: string;
    gameType: GameType;
    roundNumber: number;
    startedAt: number;
  }): void;
  roundStarted(payload: {
    roundNumber: number;
    previousWords: string[];
    collectDeadline: number;
    prompt: string;
  }): void;
  submissionAccepted(payload: SubmissionAcceptedPayload): void;
  roundRevealed(payload: RoundRevealedPayload): void;
  gameEnded(payload: GameEndedPayload): void;
  error(payload: ErrorPayload): void;
}

export const EVENT_NAMES = {
  client: [
    'createRoom',
    'joinRoom',
    'reconnectRoom',
    'setNickname',
    'leaveRoom',
    'requestRoomState',
    'startGame',
    'submitWord',
    'forceEndGame',
    'restartGame',
    'nextRound',
  ],
  server: [
    'roomState',
    'reconnected',
    'playerJoined',
    'playerLeft',
    'playerOnline',
    'hostTransferred',
    'gameStarted',
    'roundStarted',
    'submissionAccepted',
    'roundRevealed',
    'gameEnded',
    'error',
  ],
} as const;
