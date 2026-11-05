import type { AdminRound } from '@jiaowoplay/shared';
import { formatDateTime } from '../../lib/format.js';

function RoundBubble({ nickname, word, isTimeout }: { nickname: string; word: string | null; isTimeout: boolean }) {
  return (
    <li className={`bubble ${isTimeout || word === null ? 'bubble--empty' : ''}`}>
      <span className="bubble__who">{nickname}</span>
      <span className="bubble__arrow" aria-hidden>
        →
      </span>
      <span className="bubble__word">{isTimeout || word === null ? '弃权' : word}</span>
    </li>
  );
}

export default function RoundTimeline({ rounds }: { rounds: AdminRound[] }) {
  if (rounds.length === 0) {
    return <p className="admin-empty">这一局还没有写入任何轮次。</p>;
  }

  return (
    <ol className="timeline">
      {rounds.map((round) => (
        <li key={round.roundNumber} className={`timeline__item ${round.revealedAt === null ? 'timeline__item--hidden' : ''}`}>
          <div className="timeline__head">
            <strong>第 {round.roundNumber} 轮</strong>
            {round.revealedAt === null ? (
              <span className="tag tag--warn">
                {round.status === 'ABANDONED' ? '已废弃' : '未揭晓'}
              </span>
            ) : round.allSame ? (
              <span className="tag tag--ok">全员同词</span>
            ) : round.partialMeetings.length > 0 ? (
              <span className="tag tag--warn">
                局部相遇：{round.partialMeetings.map((m) => m.nicknames.join(' 与 ')).join('；')}
              </span>
            ) : (
              <span className="tag">无人同词</span>
            )}
            <span className="timeline__time">{formatDateTime(round.startedAt)}</span>
          </div>

          {round.previousWords.length > 0 && (
            <p className="timeline__link">需关联上一轮：{round.previousWords.join('、')}</p>
          )}

          <ul className="bubbles">
            {round.submissions.map((submission) => (
              <RoundBubble
                key={submission.playerId}
                nickname={submission.nickname}
                word={submission.word}
                isTimeout={submission.isTimeout}
              />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
