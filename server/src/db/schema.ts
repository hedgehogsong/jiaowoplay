/** 内嵌建表语句，避免生产构建时还要额外拷贝 .sql 资源文件 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS game_sessions (
  id                TEXT PRIMARY KEY,
  room_id           TEXT NOT NULL,
  room_code         TEXT NOT NULL,
  game_type         TEXT NOT NULL,
  status            TEXT NOT NULL,
  outcome           TEXT,
  current_round     INTEGER NOT NULL DEFAULT 0,
  max_rounds        INTEGER NOT NULL,
  win_mode          TEXT NOT NULL DEFAULT 'ALL_SAME',
  winner_player_ids TEXT NOT NULL DEFAULT '[]',
  players           TEXT NOT NULL DEFAULT '[]',
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_room_code   ON game_sessions (room_code);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at  ON game_sessions (started_at);

CREATE TABLE IF NOT EXISTS rounds (
  id               TEXT PRIMARY KEY,
  game_session_id  TEXT NOT NULL REFERENCES game_sessions (id) ON DELETE CASCADE,
  round_number     INTEGER NOT NULL,
  status           TEXT NOT NULL,
  all_same         INTEGER NOT NULL DEFAULT 0,
  partial_meetings TEXT NOT NULL DEFAULT '[]',
  previous_words   TEXT NOT NULL DEFAULT '[]',
  started_at       INTEGER NOT NULL,
  revealed_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds (game_session_id, round_number);

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,
  round_id        TEXT NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  game_session_id TEXT NOT NULL,
  player_id       TEXT NOT NULL,
  nickname        TEXT NOT NULL,
  word            TEXT,
  is_timeout      INTEGER NOT NULL DEFAULT 0,
  submitted_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_submissions_round   ON submissions (round_id);
CREATE INDEX IF NOT EXISTS idx_submissions_session ON submissions (game_session_id);

CREATE TABLE IF NOT EXISTS game_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  game_session_id TEXT NOT NULL,
  round_number    INTEGER,
  type            TEXT NOT NULL,
  payload         TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON game_events (game_session_id, created_at);
`;
