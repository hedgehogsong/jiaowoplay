import type { PlayerView } from '@jiaowoplay/shared';

interface Props {
  players: PlayerView[];
  selfId: string | null;
  maxPlayers: number;
  gameRunning: boolean;
}

export default function MemberList({ players, selfId, maxPlayers, gameRunning }: Props) {
  return (
    <div className="members">
      <div className="members__head">
        <h2>成员</h2>
        <span className="members__count">
          {players.length}/{maxPlayers}
        </span>
      </div>
      <ul className="members__list">
        {players.map((player) => (
          <li
            key={player.id}
            className={`member ${player.isOnline ? '' : 'member--offline'} ${
              player.id === selfId ? 'member--self' : ''
            } ${player.isDeveloper ? 'member--dev' : ''}`}
          >
            <span className="member__avatar" aria-hidden>
              {Array.from(player.nickname)[0] ?? '?'}
            </span>
            <span className="member__name">
              {player.nickname}
              {player.id === selfId && <em className="member__you">（我）</em>}
            </span>
            <span className="member__tags">
              {player.isHost && <span className="tag tag--host">房主</span>}
              {player.isDeveloper && <span className="tag tag--dev">开发者</span>}
              {gameRunning && !player.isActive && <span className="tag">等待区</span>}
              {gameRunning && player.isActive && player.hasSubmitted && (
                <span className="tag tag--ok">已提交</span>
              )}
              {!player.isOnline && <span className="tag tag--warn">离线</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
