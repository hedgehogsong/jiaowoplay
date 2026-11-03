import type { RoomStateView, RoundView } from '@jiaowoplay/shared';
import { formatCountdown, remainingMs, useNow } from '../../../hooks/useNow.js';
import { OUTCOME_TEXT } from '../../../hooks/useRoom.js';
import HistoryList from './HistoryList.js';
import RevealBoard from './RevealBoard.js';
import WordSubmit from './WordSubmit.js';

interface Props {
  room: RoomStateView;
  selfId: string | null;
  serverOffset: number;
  busy: boolean;
  title: string;
  onSubmit: (value: string) => Promise<void>;
}

/** 本轮揭晓后对局是否直接结束（全员同词 / 轮次上限 / 可判定人数不足） */
function isTerminalRound(game: RoomStateView['game'], round: RoundView | null): boolean {
  if (!game || !round) return false;
  if (round.allSame) return true;
  if (game.currentRound >= game.maxRounds) return true;
  const eligible = (round.submissions ?? []).filter(
    (submission) => !submission.isTimeout && submission.word !== null,
  ).length;
  return eligible < 2;
}

export default function GamePanel({ room, selfId, serverOffset, busy, title, onSubmit }: Props) {
  const now = useNow(500);
  const game = room.game;
  const me = room.players.find((player) => player.id === selfId) ?? null;

  if (!game) {
    return (
      <div className="panel panel--game">
        <h2>{title}</h2>
        <p className="empty">
          等待房主开始游戏。每轮所有人各自提交一个词，全员提交完全相同的词即相遇成功。
        </p>
        <ul className="rules">
          <li>第一轮自由输入。</li>
          <li>从第二轮起，你的词要同时关联上一轮揭晓的所有词。</li>
          <li>提交后不可修改，揭晓前看不到别人的词。</li>
          <li>默认最多 {room.settings.maxRounds} 轮，每轮 {Math.round(room.settings.submitTimeoutMs / 1000)} 秒。</li>
        </ul>
      </div>
    );
  }

  const rounds = game.rounds;
  const current = rounds[rounds.length - 1] ?? null;
  const isActive = me?.isActive ?? false;
  const submittedCount = room.players.filter((player) => player.isActive && player.hasSubmitted).length;
  const activeCount = room.players.filter((player) => player.isActive).length;

  const header = (
    <div className="game-head">
      <h2>{title}</h2>
      <div className="game-head__meta">
        <span className="chip">
          第 {game.currentRound}/{game.maxRounds} 轮
        </span>
        {game.phase === 'ROUND_COLLECT' && <span className="chip chip--live">收集词语中</span>}
        {game.phase === 'CHECK' && <span className="chip chip--live">判定中</span>}
        {game.phase === 'ROUND_REVEAL' && <span className="chip chip--ok">已揭晓</span>}
        {game.phase === 'FINISHED' && <span className="chip">已结束</span>}
      </div>
    </div>
  );

  if (room.status === 'ENDED' || game.phase === 'FINISHED') {
    const lastRevealed = [...rounds].reverse().find((round) => round.status === 'REVEALED') ?? null;
    return (
      <div className="panel panel--game">
        {header}
        <div className={`result result--${game.outcome === 'ALL_MET' ? 'win' : 'draw'}`}>
          <strong>{OUTCOME_TEXT[game.outcome ?? ''] ?? '对局结束'}</strong>
          <p>
            共用 {game.totalRounds} 轮
            {game.winnerNicknames.length > 0 && ` · 相遇：${game.winnerNicknames.join('、')}`}
          </p>
        </div>
        {lastRevealed && <RevealBoard round={lastRevealed} selfId={selfId} />}
        <HistoryList rounds={rounds} selfId={selfId} />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="panel panel--game">
        {header}
        <p className="empty">你在等待区：对局已经开始，下一局开始时你会自动加入。</p>
        {current?.status === 'REVEALED' && <RevealBoard round={current} selfId={selfId} />}
        <HistoryList rounds={rounds} selfId={selfId} />
      </div>
    );
  }

  return (
    <div className="panel panel--game">
      {header}

      {current?.status === 'COLLECTING' && game.phase === 'ROUND_COLLECT' && (
        <WordSubmit
          prompt={current.prompt}
          roundNumber={current.roundNumber}
          deadline={game.collectDeadline}
          serverOffset={serverOffset}
          submitted={me?.hasSubmitted ?? false}
          submittedCount={submittedCount}
          activeCount={activeCount}
          maxLength={room.limits.wordMaxLength}
          busy={busy}
          onSubmit={onSubmit}
        />
      )}

      {game.phase === 'CHECK' && <p className="empty">判定中…</p>}

      {current?.status === 'REVEALED' && game.phase === 'ROUND_REVEAL' && (
        <>
          <RevealBoard round={current} selfId={selfId} />
          <div className="next-round">
            {isTerminalRound(game, current) ? (
              <span className="hint">正在结算本局…</span>
            ) : (
              <span className="hint">
                {formatCountdown(remainingMs(game.revealUntil, now, serverOffset))}后进入下一轮
              </span>
            )}
          </div>
        </>
      )}

      <HistoryList rounds={rounds} selfId={selfId} />
    </div>
  );
}
