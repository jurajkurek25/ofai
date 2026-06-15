import { db } from './database';
import { logger } from '../utils/logger';

export function runMigrations(): void {
  logger.info('Running DB migrations...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      instagram_user_id  TEXT NOT NULL UNIQUE,
      username           TEXT,
      first_seen         INTEGER NOT NULL DEFAULT (unixepoch()),
      last_activity      INTEGER NOT NULL DEFAULT (unixepoch()),
      message_count      INTEGER NOT NULL DEFAULT 0,
      is_blocked         INTEGER NOT NULL DEFAULT 0,  -- 0 = active, 1 = blocked
      notes              TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_users_ig_id ON users(instagram_user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      instagram_user_id  TEXT NOT NULL,
      role               TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content            TEXT NOT NULL,
      meta_message_id    TEXT UNIQUE,                 -- original Meta message ID (dedup)
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (instagram_user_id) REFERENCES users(instagram_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(instagram_user_id, created_at);

    CREATE TABLE IF NOT EXISTS manual_overrides (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      instagram_user_id  TEXT NOT NULL,
      override_message   TEXT NOT NULL,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      used               INTEGER NOT NULL DEFAULT 0   -- 0 = pending, 1 = sent
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      meta_message_id    TEXT PRIMARY KEY,
      processed_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  logger.info('DB migrations complete.');
}

// Allow running directly: tsx src/db/migrations.ts
if (require.main === module) {
  runMigrations();
  process.exit(0);
}
