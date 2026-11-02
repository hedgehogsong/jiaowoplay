import type {
  GameOutcome,
  GamePhase,
  GameType,
  PartialMeeting,
  RoomSettings,
  RoomStatus,
  RoundStatus,
} from '@jiaowoplay/shared';

export interface Player {
  id: string;
  roomId: string;
  nickname: string;
  reconnectToken: string;
  isHost: boolean;
  isOnline: boolean;
  /** 是否参与当前对局；开局后加入者为 false */
  isActive: boolean;
  socketId: string | null;
  joinedAt: number;
  lastSeenAt: number;
  offlineSince: number | null;
}

export interface Submission {
  id: string;
  playerId: string;
  /** 提交时的昵称快照，保证历史记录可读 */
  nickname: string;
  word: string | null;
  isTimeout: boolean;
  submittedAt: number | null;
}

export interface Round {
  id: string;
  roundNumber: number;
  status: RoundStatus;
  previousWords: string[];
  submissions: Map<string, Submission>;
  allSame: boolean;
  partialMeetings: PartialMeeting[];
  startedAt: number;
  revealedAt: number | null;
  collectDeadline: number;
  revealUntil: number | null;
}

export interface GameSession {
  id: string;
  roomId: string;
  gameType: GameType;
  phase: GamePhase;
  currentRound: number;
  maxRounds: number;
  settings: RoomSettings;
  outcome: GameOutcome | null;
  winnerPlayerIds: string[];
  activePlayerIds: Set<string>;
  rounds: Round[];
  startedAt: number;
  endedAt: number | null;
}

export interface RoomData {
  id: string;
  code: string;
  hostPlayerId: string;
  status: RoomStatus;
  gameType: GameType;
  settings: RoomSettings;
  createdAt: number;
  lastActivityAt: number;
  emptySince: number | null;
  players: Map<string, Player>;
  session: GameSession | null;
}
