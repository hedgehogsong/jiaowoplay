import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@jiaowoplay/shared';

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomString(length: number, alphabet: string): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) break;
    out += alphabet.charAt(byte % alphabet.length);
  }
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomString(20, ID_ALPHABET)}`;
}

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(0, ROOM_CODE_ALPHABET.length));
  }
  return code;
}

export function generateReconnectToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 定长安全比较，避免令牌校验的时序侧信道 */
export function safeTokenEqual(provided: string, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeRoomCode(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '');
}
