import type { PartialMeeting } from '@jiaowoplay/shared';
import type {
  EvaluateContext,
  GameOutcomeInfo,
  RoundJudgement,
  RoundSubmissionInput,
  WordGroup,
} from '../Game.js';

/** 判定用的规范化：仅去首尾空格，随后精确比较 */
export function normalizeWordForJudgement(word: string): string {
  return word.trim();
}

export function isEligible(submission: RoundSubmissionInput): boolean {
  return !submission.isTimeout && submission.word !== null;
}

/** 按规范化后的词分组，保留提交顺序 */
export function groupByWord(
  submissions: RoundSubmissionInput[],
): Map<string, RoundSubmissionInput[]> {
  const groups = new Map<string, RoundSubmissionInput[]>();
  for (const submission of submissions) {
    if (!isEligible(submission) || submission.word === null) continue;
    const key = normalizeWordForJudgement(submission.word);
    if (key.length === 0) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(submission);
    else groups.set(key, [submission]);
  }
  return groups;
}

export function toWordGroups(groups: Map<string, RoundSubmissionInput[]>): WordGroup[] {
  return [...groups.entries()].map(([word, submissions]) => ({
    word,
    playerIds: submissions.map((s) => s.playerId),
    nicknames: submissions.map((s) => s.nickname),
  }));
}

export function toPartialMeetings(groups: WordGroup[]): PartialMeeting[] {
  return groups
    .filter((group) => group.playerIds.length >= 2)
    .map((group) => ({
      word: group.word,
      playerIds: group.playerIds,
      nicknames: group.nicknames,
    }));
}

/**
 * 同词相『交』判定：
 * - 弃权者不参与判定
 * - 可判定人数 < 2 → 人数不足
 * - 全部可判定者词相同 → 全员相遇
 * - 否则记录规模 >= 2 的「局部相遇」，对局继续
 */
export function judgeRound(submissions: RoundSubmissionInput[]): RoundJudgement {
  const eligible = submissions.filter(isEligible);
  const grouped = toWordGroups(groupByWord(eligible));
  const eligibleCount = eligible.length;
  const allSame = eligibleCount >= 2 && grouped.length === 1;

  return {
    eligibleCount,
    allSame,
    groups: grouped,
    partialMeetings: allSame ? [] : toPartialMeetings(grouped),
  };
}

export function evaluateAfterRound(context: EvaluateContext): GameOutcomeInfo | null {
  const { judgement, roundNumber, settings } = context;

  if (judgement.eligibleCount < 2) {
    return { outcome: 'INSUFFICIENT_PLAYERS', winnerPlayerIds: [] };
  }
  if (judgement.allSame) {
    const winners = judgement.groups[0];
    return { outcome: 'ALL_MET', winnerPlayerIds: winners ? [...winners.playerIds] : [] };
  }
  if (roundNumber >= settings.maxRounds) {
    return { outcome: 'ROUND_LIMIT', winnerPlayerIds: [] };
  }
  return null;
}

/** 下一轮需要关联的词：上一轮全部已揭晓词，去重并保留首次出现顺序 */
export function collectPreviousWords(submissions: RoundSubmissionInput[]): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const submission of submissions) {
    if (!isEligible(submission) || submission.word === null) continue;
    const word = normalizeWordForJudgement(submission.word);
    if (word.length === 0 || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

export const OUTCOME_LABELS: Record<string, string> = {
  ALL_MET: '全员相遇成功',
  ROUND_LIMIT: '轮次用尽，平局',
  INSUFFICIENT_PLAYERS: '可判定人数不足，平局',
  HOST_ENDED: '房主结束了本局',
  ABANDONED: '中途流局/全员流失',
};
