import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ErrorPayload,
  ServerToClientEvents,
} from '@jiaowoplay/shared';
import { ApiError } from './api.js';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/** 同源连接：开发走 Vite 代理，生产走 Nginx，无需额外配置地址 */
export function getSocket(): GameSocket {
  if (socket) return socket;
  socket = io('/', {
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Number.POSITIVE_INFINITY,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5_000,
    randomizationFactor: 0.4,
    timeout: 10_000,
    withCredentials: false,
  });
  return socket;
}

export function hasSocket(): boolean {
  return socket !== null;
}

export function dropSocket(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

type AckResponse<T> = { ok: true; data: T } | { ok: false; error: ErrorPayload };

/** 把服务端 ack 统一转成 Promise，失败时抛出带 code 的 ApiError */
export function emitAck<T>(
  event: string,
  payload?: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  const target = getSocket();
  return new Promise<T>((resolve, reject) => {
    const args: unknown[] = [event];
    if (payload !== undefined) args.push(payload);
    args.push((error: Error | null, response: unknown) => {
      if (error) {
        reject(new ApiError('NETWORK', '与服务器的通信超时，请检查网络后重试', 0));
        return;
      }
      const result = response as AckResponse<T> | undefined;
      if (result?.ok) {
        resolve(result.data);
        return;
      }
      const failure = result && !result.ok ? result.error : undefined;
      reject(
        new ApiError(
          failure?.code ?? 'UNKNOWN',
          failure?.message ?? '操作失败，请稍后重试',
          400,
          failure?.field,
        ),
      );
    });

    const timed = target.timeout(timeoutMs) as unknown as { emit: (...a: unknown[]) => void };
    timed.emit(...args);
  });
}
