export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly field?: string;

  constructor(code: string, message: string, httpStatus = 400, field?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (field !== undefined) this.field = field;
  }

  toJSON(): { code: string; message: string; field?: string } {
    return this.field === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, field: this.field };
  }
}

export const ErrorCode = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_CODE_INVALID: 'ROOM_CODE_INVALID',
  NICKNAME_INVALID: 'NICKNAME_INVALID',
  NICKNAME_TAKEN: 'NICKNAME_TAKEN',
  NICKNAME_UNCHANGED: 'NICKNAME_UNCHANGED',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_HOST: 'NOT_HOST',
  INVALID_STATE: 'INVALID_STATE',
  INSUFFICIENT_PLAYERS: 'INSUFFICIENT_PLAYERS',
  GAME_NOT_RUNNING: 'GAME_NOT_RUNNING',
  NOT_ACTIVE_PLAYER: 'NOT_ACTIVE_PLAYER',
  ROUND_NOT_COLLECTING: 'ROUND_NOT_COLLECTING',
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  WORD_INVALID: 'WORD_INVALID',
  RECONNECT_FAILED: 'RECONNECT_FAILED',
  SETTINGS_INVALID: 'SETTINGS_INVALID',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
