import { Link } from 'react-router-dom';
import { GAMES, gamePath, type GameEntry } from '../games/registry.js';

function GameCard({ game }: { game: GameEntry }) {
  return (
    <Link className="game-card" to={gamePath(game)} style={{ ['--accent' as string]: game.accent }}>
      <span className="game-card__mark" aria-hidden>
        {game.mark}
      </span>
      <span className="game-card__body">
        <strong className="game-card__name">{game.name}</strong>
        <span className="game-card__tagline">{game.tagline}</span>
        <span className="game-card__meta">
          {game.players} · {game.duration}
        </span>
      </span>
      <span className="game-card__go">进入 →</span>
    </Link>
  );
}

export default function PlatformHomePage() {
  return (
    <div className="page page--platform">
      <header className="hero">
        <p className="hero__eyebrow">线上小游戏聚合平台</p>
        <h1 className="hero__title">交我PLAY</h1>
        <p className="hero__subtitle">
          不用注册，设个昵称就能开房。把 6 位房间号发给朋友，浏览器里直接开玩。
        </p>
      </header>

      <section className="steps">
        <div className="step">
          <span className="step__no">1</span>
          <div>
            <strong>选一个游戏</strong>
            <p>点下面的游戏卡片进入。</p>
          </div>
        </div>
        <div className="step">
          <span className="step__no">2</span>
          <div>
            <strong>开房或加房</strong>
            <p>自己创建拿房间号，或输入朋友的房间号加入。</p>
          </div>
        </div>
        <div className="step">
          <span className="step__no">3</span>
          <div>
            <strong>房主开局</strong>
            <p>至少 2 人在线，房主点开始就能玩。</p>
          </div>
        </div>
      </section>

      <main>
        <h2 className="section-title">
          可玩的游戏
          <span className="section-title__count">{GAMES.length} 款</span>
        </h2>
        <div className="game-grid">
          {GAMES.map((game) => (
            <GameCard key={game.slug} game={game} />
          ))}
          <div className="game-card game-card--soon" aria-disabled="true">
            <span className="game-card__mark" aria-hidden>
              +
            </span>
            <span className="game-card__body">
              <strong className="game-card__name">更多小游戏</strong>
              <span className="game-card__tagline">正在筹备，敬请期待</span>
            </span>
          </div>
        </div>
      </main>

      <footer className="footer">
        房间最多 8 人 · 无需账号 · 刷新页面会自动回到原房间
      </footer>
    </div>
  );
}
