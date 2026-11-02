export const ROOM_CODE_LENGTH = 6;

/** 排除易混淆字符 0 / O / 1 / I */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 12;

export const WORD_MIN_LENGTH = 1;
export const WORD_MAX_LENGTH = 20;

export const DEFAULT_MAX_ROUNDS = 20;
export const DEFAULT_SUBMIT_TIMEOUT_MS = 120_000;
export const DEFAULT_REVEAL_DURATION_MS = 10_000;

export const MAX_ROUNDS_LIMIT = { min: 3, max: 50 };
export const SUBMIT_TIMEOUT_LIMIT = { min: 5_000, max: 600_000 };
export const REVEAL_DURATION_LIMIT = { min: 1_000, max: 60_000 };

/** 房间空置多久后清理 */
export const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
/** 房主掉线多久后转移房主 */
export const HOST_OFFLINE_GRACE_MS = 30 * 1000;
/** 普通玩家掉线多久后视为离开对局 */
export const PLAYER_OFFLINE_GRACE_MS = 90 * 1000;
