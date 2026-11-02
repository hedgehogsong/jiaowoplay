import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ErrorPayload,
  GameEndedPayload,
  JoinResult,
  RoomStateView,
  RoundRevealedPayload,
} from '@jiaowoplay/shared';
import { ApiError, api } from '../lib/api.js';
import { emitAck, getSocket } from '../lib/socket.js';
import {
  clearRoomCredentials,
  loadRoomCredentials,
  saveRoomCredentials,
  type RoomCredentials,
} from '../lib/storage.js';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warn';
}

export interface RoomActions {
  join(nickname: string): Promise<void>;
  startGame(): Promise<void>;
  restartGame(): Promise<void>;
  forceEndGame(): Promise<void>;
  nextRound(): Promise<void>;
  submitWord(word: string): Promise<void>;
  rename(nickname: string): Promise<void>;
  leave(): Promise<void>;
  retryAttach(): Promise<void>;
  dismissToast(id: number): void;
  clearNotice(): void;
}

export interface RoomHook extends RoomActions {
  room: RoomStateView | null;
  status: ConnectionStatus;
  needJoin: boolean;
  toasts: Toast[];
  notice: ErrorPayload | null;
  busy: boolean;
  serverOffset: number;
  selfId: string | null;
  isHost: boolean;
}

/** StrictMode 下 effect 会跑两次，用延迟断开避免刚连上就被清理逻辑踢掉 */
let pendingDisconnect: ReturnType<typeof setTimeout> | null = null;
let toastSequence = 0;

export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof ApiError) {
    return error.field
      ? { code: error.code, message: error.message, field: error.field }
      : { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { code: 'UNKNOWN', message: error.message };
  return { code: 'UNKNOWN', message: '未知错误' };
}

export const OUTCOME_TEXT: Record<string, string> = {
  ALL_MET: '全员相遇成功！',
  ROUND_LIMIT: '轮次用尽，本局平局',
  INSUFFICIENT_PLAYERS: '可判定人数不足，本局平局',
  HOST_ENDED: '房主结束了本局',
};

export function useRoom(code: string): RoomHook {
  const [room, setRoom] = useState<RoomStateView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [needJoin, setNeedJoin] = useState<boolean>(() => !loadRoomCredentials(code));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notice, setNotice] = useState<ErrorPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const credentialsRef = useRef<RoomCredentials | null>(loadRoomCredentials(code));
  const roomRef = useRef<RoomStateView | null>(null);

  const pushToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    toastSequence += 1;
    const id = toastSequence;
    setToasts((current) => [...current.slice(-4), { id, text, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4_500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const applyState = useCallback((state: RoomStateView) => {
    setServerOffset(state.serverTime - Date.now());
    roomRef.current = state;
    setRoom(state);
    setNeedJoin(false);
  }, []);

  const attach = useCallback(async () => {
    const credentials = loadRoomCredentials(code);
    credentialsRef.current = credentials;
    if (!credentials) {
      setNeedJoin(true);
      setStatus('connected');
      return;
    }
    try {
      const result = await emitAck<JoinResult>('reconnectRoom', credentials);
      const next: RoomCredentials = {
        code: result.code,
        playerId: result.playerId,
        reconnectToken: result.reconnectToken,
      };
      saveRoomCredentials(next);
      credentialsRef.current = next;
      applyState(result.state);
      setNotice(null);
      setStatus('connected');
    } catch (error) {
      clearRoomCredentials(code);
      credentialsRef.current = null;
      setNeedJoin(true);
      setStatus('connected');
      setNotice(toErrorPayload(error));
    }
  }, [applyState, code]);

  useEffect(() => {
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      pendingDisconnect = null;
    }

    const socket = getSocket();
    roomRef.current = null;
    setRoom(null);
    setNeedJoin(!loadRoomCredentials(code));

    const handleRoomState = (state: RoomStateView) => applyState(state);
    const handleReconnected = () => pushToast('已恢复房间身份', 'success');
    const handlePlayerJoined = (payload: { player: { nickname: string } }) =>
      pushToast(`${payload.player.nickname} 加入了房间`);
    const handlePlayerLeft = (payload: { nickname: string; reason: string }) =>
      pushToast(
        payload.reason === 'kicked'
          ? `${payload.nickname} 被移出房间`
          : `${payload.nickname} 离开了房间`,
        'warn',
      );
    const handlePlayerOnline = (payload: { playerId: string; isOnline: boolean }) => {
      const player = roomRef.current?.players.find((item) => item.id === payload.playerId);
      if (player) {
        pushToast(
          `${player.nickname} ${payload.isOnline ? '已上线' : '掉线了'}`,
          payload.isOnline ? 'success' : 'warn',
        );
      }
    };
    const handleHostTransferred = (payload: { nickname: string }) =>
      pushToast(`房主已转移给 ${payload.nickname}`, 'warn');
    const handleGameStarted = () => pushToast('对局开始！', 'success');
    const handleRoundRevealed = (payload: RoundRevealedPayload) =>
      pushToast(payload.allSame ? '本轮全员同词！' : '本轮已揭晓', payload.allSame ? 'success' : 'info');
    const handleGameEnded = (payload: GameEndedPayload) =>
      pushToast(OUTCOME_TEXT[payload.outcome] ?? '对局结束', payload.outcome === 'ALL_MET' ? 'success' : 'warn');
    const handleError = (payload: ErrorPayload) => {
      setNotice(payload);
      pushToast(payload.message, 'warn');
    };
    const handleConnect = () => {
      setStatus('connected');
      void attach();
    };
    const handleDisconnect = (reason: string) => {
      setStatus(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
    };
    const handleConnectError = () => setStatus('reconnecting');

    socket.on('roomState', handleRoomState);
    socket.on('reconnected', handleReconnected);
    socket.on('playerJoined', handlePlayerJoined);
    socket.on('playerLeft', handlePlayerLeft);
    socket.on('playerOnline', handlePlayerOnline);
    socket.on('hostTransferred', handleHostTransferred);
    socket.on('gameStarted', handleGameStarted);
    socket.on('roundRevealed', handleRoundRevealed);
    socket.on('gameEnded', handleGameEnded);
    socket.on('error', handleError);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    if (socket.connected) {
      setStatus('connected');
      void attach();
    } else {
      setStatus('connecting');
      socket.connect();
    }

    return () => {
      socket.off('roomState', handleRoomState);
      socket.off('reconnected', handleReconnected);
      socket.off('playerJoined', handlePlayerJoined);
      socket.off('playerLeft', handlePlayerLeft);
      socket.off('playerOnline', handlePlayerOnline);
      socket.off('hostTransferred', handleHostTransferred);
      socket.off('gameStarted', handleGameStarted);
      socket.off('roundRevealed', handleRoundRevealed);
      socket.off('gameEnded', handleGameEnded);
      socket.off('error', handleError);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      pendingDisconnect = setTimeout(() => {
        socket.disconnect();
      }, 80);
    };
  }, [applyState, attach, code, pushToast]);

  const runAction = useCallback(
    async <T,>(label: string, run: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await run();
      } catch (error) {
        const payload = toErrorPayload(error);
        setNotice(payload);
        pushToast(`${label}失败：${payload.message}`, 'warn');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [pushToast],
  );

  const join = useCallback(
    async (nickname: string) => {
      await runAction('加入房间', async () => {
        const result = await api.joinRoom(code, nickname);
        saveRoomCredentials({
          code: result.code,
          playerId: result.playerId,
          reconnectToken: result.reconnectToken,
        });
        const socket = getSocket();
        if (!socket.connected) socket.connect();
        await attach();
        pushToast('已加入房间', 'success');
      });
    },
    [attach, code, pushToast, runAction],
  );

  const retryAttach = useCallback(async () => {
    await runAction('重新连接', attach);
  }, [attach, runAction]);

  const startGame = useCallback(async () => {
    await runAction('开始游戏', () => emitAck<{ sessionId: string }>('startGame'));
  }, [runAction]);

  const restartGame = useCallback(async () => {
    await runAction('再来一局', () => emitAck<{ sessionId: string }>('restartGame'));
  }, [runAction]);

  const forceEndGame = useCallback(async () => {
    await runAction('结束对局', () => emitAck<{ sessionId: string }>('forceEndGame'));
  }, [runAction]);

  const nextRound = useCallback(async () => {
    await runAction('进入下一轮', () => emitAck<{ roundNumber: number }>('nextRound'));
  }, [runAction]);

  const submitWord = useCallback(
    async (word: string) => {
      await runAction('提交', () => emitAck<{ roundNumber: number }>('submitWord', { word }));
    },
    [runAction],
  );

  const rename = useCallback(
    async (nickname: string) => {
      await runAction('修改昵称', async () => {
        await emitAck<{ playerId: string }>('setNickname', { nickname });
        pushToast('昵称已更新', 'success');
      });
    },
    [pushToast, runAction],
  );

  const leave = useCallback(async () => {
    try {
      await emitAck<{ ok: true }>('leaveRoom', undefined, 3_000);
    } catch {
      /* 离开失败也要清理本地凭据 */
    }
    clearRoomCredentials(code);
    credentialsRef.current = null;
  }, [code]);

  const selfId = room?.you?.playerId ?? null;
  const isHost = useMemo(
    () => Boolean(room && selfId && room.hostPlayerId === selfId),
    [room, selfId],
  );

  return {
    room,
    status,
    needJoin,
    toasts,
    notice,
    busy,
    serverOffset,
    selfId,
    isHost,
    join,
    startGame,
    restartGame,
    forceEndGame,
    nextRound,
    submitWord,
    rename,
    leave,
    retryAttach,
    dismissToast,
    clearNotice: () => setNotice(null),
  };
}
