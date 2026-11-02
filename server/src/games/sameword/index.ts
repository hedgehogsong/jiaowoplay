import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type RoomSettings,
} from '@jiaowoplay/shared';
import { AppError, ErrorCode } from '../../domain/errors.js';
import { validateWord } from '../../domain/validation.js';
import { defaultSettings } from '../../domain/validation.js';
import type {
  EvaluateContext,
  GameDefinition,
  GameOutcomeInfo,
  RoundInput,
  RoundJudgement,
  RoundSubmissionInput,
  StartContext,
} from '../Game.js';
import {
  OUTCOME_LABELS,
  collectPreviousWords,
  evaluateAfterRound,
  judgeRound,
} from './rules.js';
import type { GameOutcome, GameType } from '@jiaowoplay/shared';

export class SameWordGame implements GameDefinition {
  readonly type: GameType = 'sameword';
  readonly label = '同词相见';
  readonly description =
    '每轮所有人各自提交一个词，提交前互相看不到。若全员提交完全相同的词即相遇成功；' +
    '从第二轮起，你的词需要同时关联上一轮揭晓的所有词。';
  readonly minPlayers = MIN_PLAYERS;
  readonly maxPlayers = MAX_PLAYERS;

  defaultSettings(): RoomSettings {
    return defaultSettings();
  }

  assertCanStart(context: StartContext): void {
    const count = context.onlinePlayers.length;
    if (count < this.minPlayers) {
      throw new AppError(
        ErrorCode.INSUFFICIENT_PLAYERS,
        `至少需要 ${this.minPlayers} 名在线玩家才能开始，当前 ${count} 人`,
      );
    }
    if (count > this.maxPlayers) {
      throw new AppError(
        ErrorCode.ROOM_FULL,
        `最多支持 ${this.maxPlayers} 名玩家，当前 ${count} 人`,
      );
    }
    if (context.settings.winMode !== 'ALL_SAME') {
      throw new AppError(ErrorCode.SETTINGS_INVALID, '当前版本仅支持「全员同词」胜利模式');
    }
  }

  validateSubmission(payload: { word: string }): string {
    return validateWord(payload.word);
  }

  buildRoundPrompt(input: RoundInput): string {
    if (input.roundNumber <= 1 || input.previousWords.length === 0) {
      return '第一轮：自由输入一个词，提交后等待所有人揭晓。';
    }
    return `请让你的词同时关联上一轮：${input.previousWords.join('、')}`;
  }

  judgeRound(submissions: RoundSubmissionInput[]): RoundJudgement {
    return judgeRound(submissions);
  }

  evaluateAfterRound(context: EvaluateContext): GameOutcomeInfo | null {
    return evaluateAfterRound(context);
  }

  collectPreviousWords(submissions: RoundSubmissionInput[]): string[] {
    return collectPreviousWords(submissions);
  }

  outcomeLabel(outcome: GameOutcome): string {
    return OUTCOME_LABELS[outcome] ?? '对局结束';
  }
}

export const sameWordGame = new SameWordGame();
