import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '@jiaowoplay/shared';
import ConnectionBanner from '../components/ConnectionBanner.js';
import HostControls from '../components/HostControls.js';
import MemberList from '../components/MemberList.js';
import NicknameEditor from '../components/NicknameEditor.js';
import RoomCodeBadge from '../components/RoomCodeBadge.js';
import ToastStack from '../components/ToastStack.js';
import { findGameByType, gamePath } from '../games/registry.js';
import { useRoom } from '../hooks/useRoom.js';
import { loadNickname } from '../lib/storage.js';

const VALID_CODE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

function JoinCard({
  code,
  busy,
  notice,
  onJoin,
}: {
  code: string;
  busy: boolean;
  notice: string | null;
  onJoin: (nickname: string) => Promise<void>;
}) {
  const [nickname, setNickname] = useState(loadNickname);
  const length = Array.from(nickname.trim()).length;
  const valid = length >= NICKNAME_MIN_LENGTH && length <= NICKNAME_MAX_LENGTH;

  return (
    <section className="panel panel--join">
      <h2>加入房间 {code}</h2>
      <p className="hint">这个浏览器还没有该房间的身份，输入昵称即可加入。</p>
      <label className="field">
        <span className="field__label">昵称</span>
        <input
          className="input"
          value={nickname}
          maxLength={NICKNAME_MAX_LENGTH + 4}
          placeholder={`${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符`}
          onChange={(event) => setNickname(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid) void onJoin(nickname.trim());
          }}
        />
      </label>
      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={busy || !valid}
        onClick={() => void onJoin(nickname.trim())}
      >
        {busy ? '加入中…' : '加入房间'}
      </button>
      {notice && <p className="alert" role="alert">{notice}</p>}
    </section>
  );
}

export default function RoomPage() {
  const rawCode = (useParams<{ code: string }>().code ?? '').trim().toUpperCase();
  const navigate = useNavigate();
  const validCode = VALID_CODE.test(rawCode);
  const hook = useRoom(validCode ? rawCode : 'AAAAAA');

  const { room, status, needJoin, toasts, notice, busy, serverOffset, selfId, isHost } = hook;

  // 面板由注册表按房间的 gameType 选择，RoomPage 本身不绑定任何具体游戏
  const gameEntry = findGameByType(room?.gameType);
  const Panel = gameEntry?.panel;
  const gameName = gameEntry?.name ?? '游戏';

  if (!validCode) {
    return (
      <div className="page page--center">
        <section className="panel">
          <h2>房间号不合法</h2>
          <p className="hint">
            房间号应为 {ROOM_CODE_LENGTH} 位字符，且不包含易混淆的 0、O、1、I。
          </p>
          <Link className="btn btn--primary" to="/">返回首页</Link>
        </section>
      </div>
    );
  }

  const handleLeave = async () => {
    await hook.leave();
    navigate('/');
  };

  return (
    <div className="page page--room">
      <header className="topbar">
        <Link className="topbar__brand" to="/">
          交我PLAY
        </Link>
        <span className="topbar__crumb">/</span>
        {gameEntry ? (
          <Link className="topbar__crumb topbar__crumb--current" to={gamePath(gameEntry)}>
            {gameName}
          </Link>
        ) : (
          <span className="topbar__crumb topbar__crumb--current">{gameName}</span>
        )}
        <RoomCodeBadge code={room?.code ?? rawCode} />
        <div className="topbar__right">
          {room?.you && (
            <NicknameEditor
              current={room.you.nickname}
              minLength={room.limits.nicknameMinLength}
              maxLength={room.limits.nicknameMaxLength}
              busy={busy}
              onRename={hook.rename}
            />
          )}
          <span className={`chip ${status === 'connected' ? 'chip--ok' : 'chip--warn'}`}>
            {room?.status === 'PLAYING' ? '对局中' : room?.status === 'ENDED' ? '已结束' : '等待中'}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void handleLeave()}>
            离开房间
          </button>
        </div>
      </header>

      <ConnectionBanner status={status} />

      {notice && (
        <div className="banner banner--error" role="alert">
          {notice.message}
          <button type="button" className="btn btn--sm btn--ghost" onClick={hook.clearNotice}>
            知道了
          </button>
        </div>
      )}

      <main className="room-grid">
        {needJoin || !room ? (
          needJoin ? (
            <JoinCard
              code={rawCode}
              busy={busy}
              notice={notice?.message ?? null}
              onJoin={hook.join}
            />
          ) : (
            <section className="panel">
              <h2>正在恢复房间…</h2>
              <p className="hint">如果长时间没有响应，请检查网络或返回首页重新加入。</p>
            </section>
          )
        ) : (
          <>
            <section className="panel panel--members">
              <MemberList
                players={room.players}
                selfId={selfId}
                maxPlayers={room.limits.maxPlayers}
                gameRunning={room.status === 'PLAYING'}
              />
              <HostControls
                isHost={isHost}
                status={room.status}
                phase={room.game?.phase ?? null}
                busy={busy}
                onlineCount={room.players.filter((player) => player.isOnline).length}
                minPlayers={room.limits.minPlayers}
                onStart={hook.startGame}
                onRestart={hook.restartGame}
                onForceEnd={hook.forceEndGame}
                onNextRound={hook.nextRound}
              />
              {!isHost && room.status !== 'PLAYING' && (
                <p className="hint">等待房主开始游戏…</p>
              )}
            </section>

            {Panel ? (
              <Panel
                room={room}
                selfId={selfId}
                serverOffset={serverOffset}
                busy={busy}
                title={gameName}
                onSubmit={hook.submitWord}
              />
            ) : (
              <section className="panel panel--game">
                <h2>暂不支持的游戏</h2>
                <p className="hint">
                  这个房间使用的游戏「{room.gameType}」还没有对应的前端面板，请刷新或联系管理员更新。
                </p>
              </section>
            )}
          </>
        )}
      </main>

      <ToastStack toasts={toasts} onDismiss={hook.dismissToast} />
    </div>
  );
}
