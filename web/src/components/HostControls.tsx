import type { GamePhase, RoomStatus } from '@jiaowoplay/shared';

interface Props {
  isHost: boolean;
  status: RoomStatus;
  phase: GamePhase | null;
  busy: boolean;
  onlineCount: number;
  minPlayers: number;
  onStart: () => void;
  onRestart: () => void;
  onForceEnd: () => void;
  onNextRound: () => void;
}

export default function HostControls({
  isHost,
  status,
  phase,
  busy,
  onlineCount,
  minPlayers,
  onStart,
  onRestart,
  onForceEnd,
  onNextRound,
}: Props) {
  if (!isHost) return null;

  const canStart = status !== 'PLAYING' && onlineCount >= minPlayers;

  return (
    <div className="host-controls">
      <span className="host-controls__label">房主操作</span>
      <div className="host-controls__buttons">
        {status === 'ENDED' && (
          <button type="button" className="btn btn--primary" disabled={busy || !canStart} onClick={onRestart}>
            再来一局
          </button>
        )}
        {status === 'WAITING' && (
          <button type="button" className="btn btn--primary" disabled={busy || !canStart} onClick={onStart}>
            开始游戏
          </button>
        )}
        {status === 'PLAYING' && phase === 'ROUND_REVEAL' && (
          <button type="button" className="btn" disabled={busy} onClick={onNextRound}>
            立即下一轮
          </button>
        )}
        {status === 'PLAYING' && (
          <button type="button" className="btn btn--danger" disabled={busy} onClick={onForceEnd}>
            结束本局
          </button>
        )}
      </div>
      {status !== 'PLAYING' && onlineCount < minPlayers && (
        <p className="hint hint--warn">至少需要 {minPlayers} 名在线玩家才能开始</p>
      )}
    </div>
  );
}
