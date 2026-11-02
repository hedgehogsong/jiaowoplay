import type {
  GameOutcome,
  GameType,
  PartialMeeting,
  RoomSettings,
} from '@jiaowoplay/shared';

export interface ActivePlayerRef {
  playerId: string;
  nickname: string;
}

export interface RoundInput {
  roundNumber: number;
  previousWords: string[];
  activePlayers: ActivePlayerRef[];
}

export interface RoundSubmissionInput {
  playerId: string;
  nickname: string;
  /** null 表示弃权/超时 */
  word: string | null;
  isTimeout: boolean;
}

export interface WordGroup {
  word: string;
  playerIds: string[];
  nicknames: string[];
}

export interface RoundJudgement {
  /** 可参与判定的提交数（排除弃权） */
  eligibleCount: number;
  allSame: boolean;
  groups: WordGroup[];
  /** 规模 >= 2 的词组；allSame 为真时为空 */
  partialMeetings: PartialMeeting[];
}

export interface GameOutcomeInfo {
  outcome: GameOutcome;
  winnerPlayerIds: string[];
}

export interface EvaluateContext {
  judgement: RoundJudgement;
  roundNumber: number;
  settings: RoomSettings;
}

export interface StartContext {
  onlinePlayers: ActivePlayerRef[];
  settings: RoomSettings;
}

/**
 * 一个可插拔的小游戏定义。房间状态机只负责成员、时序与持久化，
 * 具体规则、文案与胜负判定全部由实现类提供，新增游戏只需注册新的定义。
 */
export interface GameDefinition {
  readonly type: GameType;
  readonly label: string;
  readonly description: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;

  defaultSettings(): RoomSettings;
  /** 开局前校验，不满足条件时抛 AppError */
  assertCanStart(context: StartContext): void;
  /** 校验单个提交，返回规范化后的值 */
  validateSubmission(payload: { word: string }): string;
  /** 本轮输入区的引导文案 */
  buildRoundPrompt(input: RoundInput): string;
  judgeRound(submissions: RoundSubmissionInput[], settings: RoomSettings): RoundJudgement;
  /** 返回 null 表示对局继续 */
  evaluateAfterRound(context: EvaluateContext): GameOutcomeInfo | null;
  /** 从上一轮提交中提炼出下一轮需要关联的词 */
  collectPreviousWords(submissions: RoundSubmissionInput[]): string[];
  outcomeLabel(outcome: GameOutcome): string;
}
