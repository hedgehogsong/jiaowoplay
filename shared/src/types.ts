export type GameType = 'sameword';

export const GAME_TYPES: GameType[] = ['sameword'];

export type RoomStatus = 'WAITING' | 'PLAYING' | 'ENDED';

export type GamePhase = 'ROUND_COLLECT' | 'CHECK' | 'ROUND_REVEAL' | 'FINISHED';

/** ABANDONED = 房间销毁或服务重启时仍未结束，判为中途流局 */
export type RoundStatus = 'COLLECTING' | 'REVEALED' | 'ABANDONED';

export type GameOutcome =
  | 'ALL_MET'
  | 'ROUND_LIMIT'
  | 'INSUFFICIENT_PLAYERS'
  | 'HOST_ENDED'
  /** 全员流失或进程退出导致对局未能正常结束 */
  | 'ABANDONED';

/** ALL_SAME = 全员同词胜利；ANY_PAIR = 任意两人同词即胜利（预留，MVP 未启用） */
export type WinMode = 'ALL_SAME' | 'ANY_PAIR';

export interface RoomSettings {
  maxRounds: number;
  submitTimeoutMs: number;
  revealDurationMs: number;
  winMode: WinMode;
}

export interface PlayerView {
  id: string;
  nickname: string;
  isHost: boolean;
  isOnline: boolean;
  /** 昵称命中开发者名单，仅用于展示特殊标识，不代表任何权限 */
  isDeveloper: boolean;
  /** 是否参与当前对局（开局后加入者为 false） */
  isActive: boolean;
  /** 本轮是否已提交（仅对局中且活跃时有意义） */
  hasSubmitted: boolean;
  joinedAt: number;
}

export interface SubmissionView {
  playerId: string;
  nickname: string;
  /** 弃权时为 null */
  word: string | null;
  isTimeout: boolean;
}

export interface PartialMeeting {
  word: string;
  playerIds: string[];
  nicknames: string[];
}

export interface RoundView {
  roundNumber: number;
  status: RoundStatus;
  /** 上一轮所有已揭晓词，用于提示玩家做关联 */
  previousWords: string[];
  /** 服务端生成的本轮引导文案 */
  prompt: string;
  /** 未揭晓时为 null，避免泄露 */
  submissions: SubmissionView[] | null;
  allSame: boolean;
  partialMeetings: PartialMeeting[];
  startedAt: number;
  revealedAt: number | null;
}

export interface GameView {
  sessionId: string;
  gameType: GameType;
  phase: GamePhase;
  currentRound: number;
  maxRounds: number;
  outcome: GameOutcome | null;
  winnerPlayerIds: string[];
  winnerNicknames: string[];
  totalRounds: number;
  rounds: RoundView[];
  /** 本轮提交截止时间（epoch ms），ROUND_COLLECT 期间有值 */
  collectDeadline: number | null;
  /** 揭晓展示截止时间（epoch ms），ROUND_REVEAL 期间有值 */
  revealUntil: number | null;
}

export interface RoomLimits {
  minPlayers: number;
  maxPlayers: number;
  nicknameMinLength: number;
  nicknameMaxLength: number;
  wordMinLength: number;
  wordMaxLength: number;
}

/** 重连令牌只在加入/重连的应答里下发，不随广播状态重复暴露 */
export interface SelfView {
  playerId: string;
  nickname: string;
}

/** 服务端广播给单个客户端的房间投影（按视角裁剪） */
export interface RoomStateView {
  code: string;
  status: RoomStatus;
  hostPlayerId: string;
  gameType: GameType;
  settings: RoomSettings;
  players: PlayerView[];
  game: GameView | null;
  you: SelfView | null;
  limits: RoomLimits;
  serverTime: number;
}

/** 不含敏感字段的公开房间信息，用于 GET /api/rooms/:code */
export interface PublicRoomInfo {
  code: string;
  status: RoomStatus;
  gameType: GameType;
  hostNickname: string | null;
  playerCount: number;
  maxPlayers: number;
  onlineCount: number;
  currentRound: number | null;
  maxRounds: number | null;
}

export interface HistoricalSubmission {
  playerId: string;
  nickname: string;
  word: string | null;
  isTimeout: boolean;
}

export interface HistoricalRound {
  roundNumber: number;
  allSame: boolean;
  partialMeetings: PartialMeeting[];
  startedAt: number;
  revealedAt: number | null;
  submissions: HistoricalSubmission[];
}

export interface HistoricalSession {
  id: string;
  roomCode: string;
  gameType: GameType;
  outcome: GameOutcome | null;
  totalRounds: number;
  maxRounds: number;
  winnerPlayerIds: string[];
  winnerNicknames: string[];
  players: { playerId: string; nickname: string }[];
  rounds: HistoricalRound[];
  startedAt: number;
  endedAt: number | null;
}

/* ------------------------------------------------------------------ 后台管理 */

export interface AdminSessionSummary {
  id: string;
  roomCode: string;
  gameType: GameType;
  /** active 只在该局此刻真的在打时出现；进程退出留下的残局会被对账成 finished + ABANDONED */
  status: string;
  outcome: GameOutcome | null;
  currentRound: number;
  maxRounds: number;
  /** 已写入的轮次总数，包含尚未揭晓的那一轮 */
  roundCount: number;
  revealedRoundCount: number;
  playerCount: number;
  players: { playerId: string; nickname: string }[];
  winnerNicknames: string[];
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
}

export interface AdminSessionListPage {
  total: number;
  page: number;
  limit: number;
  items: AdminSessionSummary[];
}

export interface AdminSubmission {
  playerId: string;
  nickname: string;
  /** 后台可见全部词，包括尚未揭晓的 */
  word: string | null;
  isTimeout: boolean;
  submittedAt: number | null;
}

export interface AdminRound {
  roundNumber: number;
  /** ABANDONED 表示这一轮被流局作废，词仍在库里且只对后台可见 */
  status: RoundStatus;
  /** null 表示这一轮从未揭晓（例如房主中途强制结束） */
  revealedAt: number | null;
  allSame: boolean;
  partialMeetings: PartialMeeting[];
  previousWords: string[];
  startedAt: number;
  submissions: AdminSubmission[];
}

export interface AdminSessionDetail extends AdminSessionSummary {
  rounds: AdminRound[];
}

export interface AdminLoginResult {
  token: string;
  expiresInSeconds: number;
}
