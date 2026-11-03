import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '@jiaowoplay/shared';
import { findGameBySlug } from '../games/registry.js';
import { ApiError, api } from '../lib/api.js';
import { loadLastRoomCode, loadNickname, saveNickname, saveRoomCredentials } from '../lib/storage.js';

const CODE_PATTERN = new RegExp(`[${ROOM_CODE_ALPHABET}]`, 'g');

function sanitizeCode(raw: string): string {
  return (raw.toUpperCase().match(CODE_PATTERN) ?? []).join('').slice(0, ROOM_CODE_LENGTH);
}

export default function GameLobbyPage() {
  const navigate = useNavigate();
  const game = findGameBySlug(useParams<{ slug: string }>().slug);
  const [nickname, setNickname] = useState(loadNickname);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const lastRoom = loadLastRoomCode();

  if (!game) {
    return (
      <div className="page page--center">
        <section className="panel panel--error">
          <h2>没有找到这个游戏</h2>
          <p className="hint">它可能已经下线，或者链接拼错了。</p>
          <Link className="btn btn--primary" to="/">
            返回平台首页
          </Link>
        </section>
      </div>
    );
  }

  const nicknameLength = Array.from(nickname.trim()).length;
  const nicknameValid =
    nicknameLength >= NICKNAME_MIN_LENGTH && nicknameLength <= NICKNAME_MAX_LENGTH;
  const codeValid = code.length === ROOM_CODE_LENGTH;

  const enter = (result: Awaited<ReturnType<typeof api.createRoom>>) => {
    saveRoomCredentials({
      code: result.code,
      playerId: result.playerId,
      reconnectToken: result.reconnectToken,
    });
    navigate(`/room/${result.code}`);
  };

  const handleCreate = async () => {
    if (!nicknameValid) {
      setError(`昵称需为 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符`);
      return;
    }
    setBusy('create');
    setError(null);
    try {
      const trimmed = nickname.trim();
      saveNickname(trimmed);
      enter(await api.createRoom(trimmed, game.gameType));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '创建房间失败，请重试');
    } finally {
      setBusy(null);
    }
  };

  const handleJoin = async () => {
    if (!nicknameValid) {
      setError(`昵称需为 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符`);
      return;
    }
    if (!codeValid) {
      setError(`请输入 ${ROOM_CODE_LENGTH} 位房间号`);
      return;
    }
    setBusy('join');
    setError(null);
    try {
      const trimmed = nickname.trim();
      saveNickname(trimmed);
      enter(await api.joinRoom(code, trimmed));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加入房间失败，请重试');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page page--lobby">
      <header className="topbar">
        <Link className="topbar__brand" to="/">
          交我PLAY
        </Link>
        <span className="topbar__crumb">/</span>
        <span className="topbar__crumb topbar__crumb--current">{game.name}</span>
        <div className="topbar__right">
          <Link className="btn btn--ghost btn--sm" to="/">
            换个游戏
          </Link>
        </div>
      </header>

      <section className="lobby-hero">
        <span className="lobby-hero__mark" aria-hidden style={{ ['--accent' as string]: game.accent }}>
          {game.mark}
        </span>
        <div>
          <h1 className="lobby-hero__name">{game.name}</h1>
          <p className="lobby-hero__tagline">{game.tagline}</p>
          <p className="lobby-hero__meta">
            {game.players} · {game.duration}
          </p>
        </div>
      </section>

      <main className="home-grid">
        <section className="panel">
          <h2>1. 设置昵称</h2>
          <label className="field">
            <span className="field__label">
              昵称（{NICKNAME_MIN_LENGTH}-{NICKNAME_MAX_LENGTH} 个字符，房间内不可重名）
            </span>
            <input
              className="input"
              value={nickname}
              maxLength={NICKNAME_MAX_LENGTH + 4}
              placeholder="例如：小交同学"
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <p className="hint">昵称只保存在你自己的浏览器里，随时可以修改。</p>
        </section>

        <section className="panel">
          <h2>2. 创建或加入房间</h2>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy !== null || !nicknameValid}
            onClick={handleCreate}
          >
            {busy === 'create' ? '创建中…' : `创建${game.name}房间`}
          </button>

          <div className="divider">
            <span>或</span>
          </div>

          <label className="field">
            <span className="field__label">房间号</span>
            <input
              className="input input--code"
              value={code}
              inputMode="text"
              autoComplete="off"
              placeholder={`${ROOM_CODE_LENGTH} 位字母或数字`}
              onChange={(event) => setCode(sanitizeCode(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleJoin();
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn--block"
            disabled={busy !== null || !nicknameValid || !codeValid}
            onClick={handleJoin}
          >
            {busy === 'join' ? '加入中…' : '加入房间'}
          </button>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {lastRoom && (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`/room/${lastRoom}`)}
            >
              回到上次的房间 {lastRoom}
            </button>
          )}
        </section>

        <section className="panel panel--rules">
          <h2>玩法介绍</h2>
          <p className="hint">{game.summary}</p>
          <ol className="rules rules--ordered">
            {game.rules.map((rule, index) => (
              <li key={index}>{rule}</li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
