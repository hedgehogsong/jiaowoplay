import { Link } from 'react-router-dom';
import { GAMES } from '../../games/registry.js';
import { useAdminGuard } from '../../components/admin/RequireAdmin.js';

export default function AdminHomePage() {
  const { signOut } = useAdminGuard();

  return (
    <div className="page page--admin">
      <header className="admin-topbar">
        <div>
          <p className="admin-eyebrow">Developer Console</p>
          <h1 className="admin-title">后台管理</h1>
        </div>
        <div className="admin-topbar__actions">
          <Link className="btn btn--ghost btn--sm" to="/">
            返回前台
          </Link>
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
            退出登录
          </button>
        </div>
      </header>

      <h2 className="admin-section-title">游戏</h2>
      <div className="admin-games">
        {GAMES.map((game) => (
          <Link
            key={game.slug}
            className="admin-game-card"
            to={`/admin/game/${game.slug}`}
            style={{ ['--accent' as string]: game.accent }}
          >
            <span className="admin-game-card__mark" aria-hidden>
              {game.mark}
            </span>
            <span className="admin-game-card__body">
              <strong>{game.name}</strong>
              <span className="admin-game-card__slug">/admin/game/{game.slug}</span>
            </span>
            <span className="admin-game-card__go">数据看板 →</span>
          </Link>
        ))}
      </div>

      <p className="hint">后台数据只读，展示全部历史对局，包含尚未揭晓轮次的提交内容。</p>
    </div>
  );
}
