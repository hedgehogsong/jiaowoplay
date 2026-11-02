import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@jiaowoplay/shared';
import { ApiError, api } from '../lib/api.js';
import { loadLastRoomCode, loadNickname, saveNickname, saveRoomCredentials } from '../lib/storage.js';

const CODE_PATTERN = new RegExp(`[${ROOM_CODE_ALPHABET}]`, 'g');

function sanitizeCode(raw: string): string {
  return (raw.toUpperCase().match(CODE_PATTERN) ?? []).join('').slice(0, ROOM_CODE_LENGTH);
}

export default function HomePage() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState(loadNickname);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const lastRoom = loadLastRoomCode();

  const nicknameLength = Array.from(nickname.trim()).length;
  const nicknameValid = nicknameLength >= NICKNAME_MIN_LENGTH && nicknameLength <= NICKNAME_MAX_LENGTH;
  const codeValid = code.length === ROOM_CODE_LENGTH;

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
      const result = await api.createRoom(trimmed);
      saveRoomCredentials({
        code: result.code,
        playerId: result.playerId,
        reconnectToken: result.reconnectToken,
      });
      navigate(`/room/${result.code}`);
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
      const result = await api.joinRoom(code, trimmed);
      saveRoomCredentials({
        code: result.code,
        playerId: result.playerId,
        reconnectToken: result.reconnectToken,
      });
      navigate(`/room/${result.code}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '加入房间失败，请重试');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page page--home">
      <header className="hero">
        <p className="hero__eyebrow">线上小游戏聚合平台</p>
        <h1 className="hero__title">交我PLAY</h1>
        <p className="hero__subtitle">
          不用注册，设个昵称就能开房。首个游戏「同词相见」：每轮各自写一个词，全员写出同一个词就相遇成功。
        </p>
      </header>

      <main className="home-grid">
        <section className="panel">
          <h2>1. 设置昵称</h2>
          <label className="field">
            <span className="field__label">昵称（{NICKNAME_MIN_LENGTH}-{NICKNAME_MAX_LENGTH} 个字符，房间内不可重名）</span>
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
            {busy === 'create' ? '创建中…' : '创建房间'}
          </button>

          <div className="divider"><span>或</span></div>

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

          {error && <p className="alert" role="alert">{error}</p>}
          {lastRoom && (
            <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate(`/room/${lastRoom}`)}>
              回到上次的房间 {lastRoom}
            </button>
          )}
        </section>

        <section className="panel panel--rules">
          <h2>同词相见怎么玩</h2>
          <ol className="rules rules--ordered">
            <li>房主开局后，房间内所有在线玩家进入第一轮。</li>
            <li>每轮每人提交一个词，提交前看不到别人的，全员提交后统一揭晓。</li>
            <li>第一轮自由输入；之后你的词要同时关联上一轮揭晓的所有词。</li>
            <li>所有人写出完全相同的词（去首尾空格后比较）即全员相遇，本局胜利。</li>
            <li>只有部分人同词时不算胜利，但会记录「局部相遇」并进入下一轮。</li>
            <li>超时未提交视为弃权；可判定人数不足 2 人或轮次用尽则平局。</li>
          </ol>
        </section>
      </main>

      <footer className="footer">房间最多 8 人，至少 2 人开局 · 刷新页面会自动回到原房间</footer>
    </div>
  );
}
