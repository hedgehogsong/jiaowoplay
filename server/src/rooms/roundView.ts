import type { RoundView, SubmissionView } from '@jiaowoplay/shared';
import type { Player, Round } from '../domain/types.js';

function toSubmissionViews(round: Round, players: Map<string, Player>): SubmissionView[] {
  return [...round.submissions.values()].map((submission) => ({
    playerId: submission.playerId,
    nickname:
      submission.nickname || players.get(submission.playerId)?.nickname || '未知玩家',
    word: submission.word,
    isTimeout: submission.isTimeout,
  }));
}

/** 单独抽出，避免 Room 与 projection 之间产生运行时循环依赖 */
export function toRoundView(round: Round, players: Map<string, Player>): RoundView {
  const revealed = round.status === 'REVEALED';
  return {
    roundNumber: round.roundNumber,
    status: round.status,
    previousWords: [...round.previousWords],
    // 未揭晓时绝不下发提交内容
    submissions: revealed ? toSubmissionViews(round, players) : null,
    allSame: round.allSame,
    partialMeetings: round.partialMeetings.map((meeting) => ({ ...meeting })),
    startedAt: round.startedAt,
    revealedAt: round.revealedAt,
  };
}
