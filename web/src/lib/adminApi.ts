import type {
  AdminLoginResult,
  AdminSessionDetail,
  AdminSessionListPage,
  ErrorPayload,
} from '@jiaowoplay/shared';

export class AdminApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
  }
}

/** 401 意味着本地 Token 已失效，调用方应清掉它并退回前台 */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

export function isAdminUnavailable(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 503;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AdminApiError('NETWORK', '无法连接服务器，请检查网络后重试', 0);
  }
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const error = (body as { error?: ErrorPayload } | null)?.error;
    throw new AdminApiError(
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `请求失败（${response.status}）`,
      response.status,
    );
  }
  return body as T;
}

export const adminApi = {
  login(username: string, password: string): Promise<AdminLoginResult> {
    return request<AdminLoginResult>('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  },

  listSessions(token: string, page: number, limit: number): Promise<AdminSessionListPage> {
    return request<AdminSessionListPage>(
      `/api/admin/sessions?page=${encodeURIComponent(String(page))}&limit=${encodeURIComponent(String(limit))}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
  },

  async getSession(token: string, id: string): Promise<AdminSessionDetail> {
    const body = await request<{ session: AdminSessionDetail }>(
      `/api/admin/sessions/${encodeURIComponent(id)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    return body.session;
  },
};
