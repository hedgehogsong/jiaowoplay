import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { logger } from '../logger.js';
import { SCHEMA_SQL } from './schema.js';

export type SqliteDatabase = Database.Database;

/** CREATE TABLE IF NOT EXISTS 不会给已存在的表补列，所以旧库要单独迁移 */
function ensureColumns(db: SqliteDatabase): void {
  const columns = db.prepare(`PRAGMA table_info(game_sessions)`).all() as { name: string }[];
  if (!columns.some((column) => column.name === 'host_player_id')) {
    db.exec(`ALTER TABLE game_sessions ADD COLUMN host_player_id TEXT`);
    logger.info('已为 game_sessions 补上 host_player_id 列');
  }
}

export function openDatabase(dbPath: string): SqliteDatabase {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  ensureColumns(db);
  logger.info('数据库已就绪', { dbPath });
  return db;
}
