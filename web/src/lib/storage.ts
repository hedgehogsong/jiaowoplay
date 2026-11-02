const NICKNAME_KEY = 'jiaowoplay:nickname';
const LAST_ROOM_KEY = 'jiaowoplay:lastRoomCode';
const ROOM_KEY_PREFIX = 'jiaowoplay:room:';

export interface RoomCredentials {
  code: string;
  playerId: string;
  reconnectToken: string;
}

function read(store: Storage | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Storage | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* 隐私模式下写入失败时退化为内存态，不影响本次会话 */
  }
}

function remove(store: Storage | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadNickname(): string {
  return read(local(), NICKNAME_KEY) ?? '';
}

export function saveNickname(nickname: string): void {
  write(local(), NICKNAME_KEY, nickname);
}

function parseCredentials(raw: string | null): RoomCredentials | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RoomCredentials>;
    if (!parsed.code || !parsed.playerId || !parsed.reconnectToken) return null;
    return {
      code: parsed.code,
      playerId: parsed.playerId,
      reconnectToken: parsed.reconnectToken,
    };
  } catch {
    return null;
  }
}

/**
 * 同一浏览器的多个标签页共享 localStorage，
 * 因此身份优先存 sessionStorage（每个标签页独立），localStorage 仅作兜底，
 * 这样一个浏览器开两个窗口就能扮演同一房间里的两名玩家。
 */
export function saveRoomCredentials(credentials: RoomCredentials): void {
  const key = `${ROOM_KEY_PREFIX}${credentials.code}`;
  const raw = JSON.stringify(credentials);
  write(session(), key, raw);
  write(local(), key, raw);
  write(local(), LAST_ROOM_KEY, credentials.code);
}

export function loadRoomCredentials(code: string): RoomCredentials | null {
  const key = `${ROOM_KEY_PREFIX}${code}`;
  return parseCredentials(read(session(), key)) ?? parseCredentials(read(local(), key));
}

export function clearRoomCredentials(code: string): void {
  const key = `${ROOM_KEY_PREFIX}${code}`;
  remove(session(), key);
  remove(local(), key);
  if (read(local(), LAST_ROOM_KEY) === code) remove(local(), LAST_ROOM_KEY);
}

export function loadLastRoomCode(): string | null {
  const code = read(local(), LAST_ROOM_KEY);
  if (!code) return null;
  return loadRoomCredentials(code) ? code : null;
}
