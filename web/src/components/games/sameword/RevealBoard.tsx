import type { RoundView } from '@jiaowoplay/shared';

interface Props {
  round: RoundView;
  selfId: string | null;
  compact?: boolean;
}

export default function RevealBoard({ round, selfId, compact = false }: Props) {
  const submissions = round.submissions ?? [];

  return (
    <div className={`reveal ${compact ? 'reveal--compact' : ''}`}>
      <div className="reveal__head">
        <span className="chip">第 {round.roundNumber} 轮</span>
        {round.allSame && <span className="chip chip--ok">全员同词</span>}
        {!round.allSame && round.partialMeetings.length > 0 && (
          <span className="chip chip--warn">
            局部相遇：{round.partialMeetings.map((m) => m.nicknames.join(' 与 ')).join('；')}
          </span>
        )}
        {!round.allSame && round.partialMeetings.length === 0 && (
          <span className="chip">无人同词</span>
        )}
      </div>

      <ul className="reveal__list">
        {submissions.map((submission) => (
          <li
            key={submission.playerId}
            className={`word-card ${submission.playerId === selfId ? 'word-card--self' : ''} ${
              submission.isTimeout ? 'word-card--timeout' : ''
            }`}
          >
            <span className="word-card__name">{submission.nickname}</span>
            <span className="word-card__word">
              {submission.isTimeout || submission.word === null ? (
                <em>弃权</em>
              ) : (
                submission.word
              )}
            </span>
          </li>
        ))}
      </ul>

      {round.previousWords.length > 0 && (
        <p className="hint">上一轮关联词：{round.previousWords.join('、')}</p>
      )}
    </div>
  );
}
