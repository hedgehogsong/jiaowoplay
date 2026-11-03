import type { ErrorPayload, GameType, JoinResult, PublicRoomInfo } from '@jiaowoplay/shared';

export class ApiError extends Error {
  readonly code: string;
  readonly field?: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (field !== undefined) this.field = field;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('NETWORK', '无法连接服务器，请检查网络后重试', 0);
  }

  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (body as { error?: ErrorPayload } | null)?.error;
    throw new ApiError(
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `请求失败（${response.status}）`,
      response.status,
      error?.field,
    );
  }
  return body as T;
}

export const api = {
  createRoom(
    nickname: string,
    gameType?: GameType,
    settings?: Record<string, unknown>,
  ): Promise<JoinResult> {
    return request<JoinResult>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        nickname,
        ...(gameType ? { gameType } : {}),
        ...(settings ? { settings } : {}),
      }),
    });
  },

  joinRoom(code: string, nickname: string): Promise<JoinResult> {
    return request<JoinResult>(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    });
  },

  roomInfo(code: string): Promise<{ room: PublicRoomInfo }> {
    return request<{ room: PublicRoomInfo }>(`/api/rooms/${encodeURIComponent(code)}`);
  },

  roomHistory(code: string, limit = 10): Promise<{ code: string; sessions: unknown[] }> {
    return request<{ code: string; sessions: unknown[] }>(
      `/api/rooms/${encodeURIComponent(code)}/history?limit=${limit}`,
    );
  },
};
