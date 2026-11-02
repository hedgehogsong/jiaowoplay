import { useState } from 'react';
import type { RoundView } from '@jiaowoplay/shared';
import RevealBoard from './RevealBoard.js';

interface Props {
  rounds: RoundView[];
  selfId: string | null;
}

export default function HistoryList({ rounds, selfId }: Props) {
  const [open, setOpen] = useState(false);
  const revealed = rounds.filter((round) => round.status === 'REVEALED');

  if (revealed.length === 0) return null;

  return (
    <div className="history">
      <button type="button" className="history__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '收起' : '展开'}历史记录（{revealed.length} 轮）
      </button>
      {open && (
        <div className="history__body">
          {[...revealed].reverse().map((round) => (
            <RevealBoard key={round.roundNumber} round={round} selfId={selfId} compact />
          ))}
        </div>
      )}
    </div>
  );
}
