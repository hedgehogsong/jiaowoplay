import { z } from 'zod';
import {
  GAME_TYPES,
  MAX_ROUNDS_LIMIT,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  REVEAL_DURATION_LIMIT,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SUBMIT_TIMEOUT_LIMIT,
  WORD_MAX_LENGTH,
  WORD_MIN_LENGTH,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_REVEAL_DURATION_MS,
  DEFAULT_SUBMIT_TIMEOUT_MS,
} from '@jiaowoplay/shared';
import type { GameType, RoomSettings, WinMode } from '@jiaowoplay/shared';
import { AppError, ErrorCode } from './errors.js';
import { normalizeRoomCode } from './ids.js';

/** 控制字符、零宽字符与双向控制符一律拒绝，防止界面伪造与日志注入 */
const FORBIDDEN_CHARS =
  /[\u0000-\u001F\u007F\u00AD\u0600-\u0605\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

function charLength(value: string): number {
  return Array.from(value).length;
}

export function validateNickname(input: unknown, field = 'nickname'): string {
  if (typeof input !== 'string') {
    throw new AppError(ErrorCode.NICKNAME_INVALID, '昵称必须是文本', 400, field);
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length === 0) {
    throw new AppError(ErrorCode.NICKNAME_INVALID, '昵称不能为空', 400, field);
  }
  if (FORBIDDEN_CHARS.test(value)) {
    throw new AppError(ErrorCode.NICKNAME_INVALID, '昵称包含不可见或非法字符', 400, field);
  }
  const length = charLength(value);
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    throw new AppError(
      ErrorCode.NICKNAME_INVALID,
      `昵称长度需为 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符`,
      400,
      field,
    );
  }
  return value;
}

export function validateWord(input: unknown): string {
  if (typeof input !== 'string') {
    throw new AppError(ErrorCode.WORD_INVALID, '词语必须是文本', 400, 'word');
  }
  const value = input.trim();
  if (FORBIDDEN_CHARS.test(value)) {
    throw new AppError(ErrorCode.WORD_INVALID, '词语包含不可见或非法字符', 400, 'word');
  }
  const length = charLength(value);
  if (length < WORD_MIN_LENGTH || length > WORD_MAX_LENGTH) {
    throw new AppError(
      ErrorCode.WORD_INVALID,
      `词语长度需为 ${WORD_MIN_LENGTH}-${WORD_MAX_LENGTH} 个字符`,
      400,
      'word',
    );
  }
  return value;
}

export function validateRoomCode(input: unknown): string {
  const code = normalizeRoomCode(input);
  if (!ROOM_CODE_PATTERN.test(code)) {
    throw new AppError(
      ErrorCode.ROOM_CODE_INVALID,
      `房间号格式不正确，应为 ${ROOM_CODE_LENGTH} 位字母或数字`,
      400,
      'code',
    );
  }
  return code;
}

export function validateGameType(input: unknown): GameType {
  if (input === undefined || input === null) return 'sameword';
  if (typeof input === 'string' && (GAME_TYPES as string[]).includes(input)) {
    return input as GameType;
  }
  throw new AppError(ErrorCode.INVALID_PAYLOAD, '不支持的游戏类型', 400, 'gameType');
}

const winModeSchema = z.enum(['ALL_SAME', 'ANY_PAIR']);

const settingsSchema = z.object({
  maxRounds: z
    .number()
    .int()
    .min(MAX_ROUNDS_LIMIT.min)
    .max(MAX_ROUNDS_LIMIT.max)
    .optional(),
  submitTimeoutMs: z
    .number()
    .int()
    .min(SUBMIT_TIMEOUT_LIMIT.min)
    .max(SUBMIT_TIMEOUT_LIMIT.max)
    .optional(),
  revealDurationMs: z
    .number()
    .int()
    .min(REVEAL_DURATION_LIMIT.min)
    .max(REVEAL_DURATION_LIMIT.max)
    .optional(),
  winMode: winModeSchema.optional(),
});

export function defaultSettings(): RoomSettings {
  return {
    maxRounds: DEFAULT_MAX_ROUNDS,
    submitTimeoutMs: DEFAULT_SUBMIT_TIMEOUT_MS,
    revealDurationMs: DEFAULT_REVEAL_DURATION_MS,
    winMode: 'ALL_SAME',
  };
}

export function validateSettings(input: unknown): RoomSettings {
  if (input === undefined || input === null) return defaultSettings();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(
      ErrorCode.SETTINGS_INVALID,
      issue ? `房间设置不合法：${issue.path.join('.') || '字段'} ${issue.message}` : '房间设置不合法',
      400,
    );
  }
  return { ...defaultSettings(), ...parsed.data };
}

/** MVP 只启用「全员同词」，其余模式保留枚举但不放行 */
export function assertWinModeSupported(winMode: WinMode): void {
  if (winMode !== 'ALL_SAME') {
    throw new AppError(ErrorCode.SETTINGS_INVALID, '当前版本仅支持「全员同词」胜利模式', 400);
  }
}

const createRoomPayloadSchema = z.object({
  nickname: z.unknown(),
  gameType: z.unknown().optional(),
  settings: z.unknown().optional(),
});

export function parseCreateRoomPayload(input: unknown): {
  nickname: string;
  gameType: GameType;
  settings: RoomSettings;
} {
  const parsed = createRoomPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(ErrorCode.INVALID_PAYLOAD, '创建房间的参数不完整', 400);
  }
  const nickname = validateNickname(parsed.data.nickname);
  const gameType = validateGameType(parsed.data.gameType);
  const settings = validateSettings(parsed.data.settings);
  assertWinModeSupported(settings.winMode);
  return { nickname, gameType, settings };
}

const joinRoomPayloadSchema = z.object({
  code: z.unknown(),
  nickname: z.unknown(),
});

export function parseJoinRoomPayload(input: unknown): { code: string; nickname: string } {
  const parsed = joinRoomPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(ErrorCode.INVALID_PAYLOAD, '加入房间的参数不完整', 400);
  }
  return {
    code: validateRoomCode(parsed.data.code),
    nickname: validateNickname(parsed.data.nickname),
  };
}

const reconnectPayloadSchema = z.object({
  code: z.unknown(),
  reconnectToken: z.string().min(16).max(128),
});

export function parseReconnectPayload(input: unknown): { code: string; reconnectToken: string } {
  const parsed = reconnectPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(ErrorCode.INVALID_PAYLOAD, '重连参数不完整', 400);
  }
  return {
    code: validateRoomCode(parsed.data.code),
    reconnectToken: parsed.data.reconnectToken,
  };
}

const submitWordPayloadSchema = z.object({ word: z.unknown() });

export function parseSubmitWordPayload(input: unknown): { word: string } {
  const parsed = submitWordPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(ErrorCode.INVALID_PAYLOAD, '提交词语的参数不完整', 400);
  }
  return { word: validateWord(parsed.data.word) };
}

export function parseSetNicknamePayload(input: unknown): { nickname: string } {
  const schema = z.object({ nickname: z.unknown() });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(ErrorCode.INVALID_PAYLOAD, '昵称参数不完整', 400);
  }
  return { nickname: validateNickname(parsed.data.nickname) };
}
