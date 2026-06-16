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
      is_blocked         INTEGER NOT NULL DEFAULT 0,
      notes              TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_users_ig_id ON users(instagram_user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      instagram_user_id  TEXT NOT NULL,
      role               TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content            TEXT NOT NULL,
      meta_message_id    TEXT UNIQUE,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (instagram_user_id) REFERENCES users(instagram_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(instagram_user_id, created_at);

    CREATE TABLE IF NOT EXISTS manual_overrides (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      instagram_user_id  TEXT NOT NULL,
      override_message   TEXT NOT NULL,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      used               INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      meta_message_id    TEXT PRIMARY KEY,
      processed_at       INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS saas_users (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      email                TEXT NOT NULL UNIQUE,
      password_hash        TEXT NOT NULL,
      name                 TEXT NOT NULL,
      stripe_customer_id   TEXT,
      plan                 TEXT NOT NULL DEFAULT 'free',
      plan_expires_at      INTEGER,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      is_active            INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS personas (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL,
      name                 TEXT NOT NULL,
      age                  INTEGER DEFAULT 22,
      nationality          TEXT DEFAULT 'European',
      bio                  TEXT DEFAULT '',
      personality          TEXT NOT NULL DEFAULT '',
      tone                 TEXT NOT NULL DEFAULT '',
      avatar_prompt        TEXT DEFAULT '',
      is_active            INTEGER NOT NULL DEFAULT 1,
      is_nsfw_enabled      INTEGER NOT NULL DEFAULT 0,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY(user_id) REFERENCES saas_users(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      persona_id           INTEGER NOT NULL,
      user_id              INTEGER NOT NULL,
      name                 TEXT NOT NULL,
      description          TEXT DEFAULT '',
      price                REAL NOT NULL,
      currency             TEXT NOT NULL DEFAULT 'USD',
      type                 TEXT NOT NULL DEFAULT 'photo_pack',
      is_active            INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(persona_id) REFERENCES personas(id)
    );

    CREATE TABLE IF NOT EXISTS instagram_connections (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL UNIQUE,
      ig_account_id        TEXT NOT NULL,
      ig_username          TEXT,
      access_token         TEXT NOT NULL,
      persona_id           INTEGER,
      connected_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY(user_id) REFERENCES saas_users(id)
    );

    CREATE TABLE IF NOT EXISTS generated_images (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL,
      persona_id           INTEGER NOT NULL,
      style                TEXT NOT NULL,
      prompt               TEXT NOT NULL,
      image_url            TEXT NOT NULL,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY(user_id) REFERENCES saas_users(id)
    );

    CREATE TABLE IF NOT EXISTS generated_content (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              INTEGER NOT NULL,
      persona_id           INTEGER NOT NULL,
      trend_topic          TEXT,
      caption              TEXT NOT NULL,
      hashtags             TEXT NOT NULL DEFAULT '',
      image_url            TEXT,
      content_type         TEXT NOT NULL DEFAULT 'post',
      platform             TEXT NOT NULL DEFAULT 'instagram',
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY(user_id) REFERENCES saas_users(id)
    );
  `);

  logger.info('DB migrations complete.');
}

// Allow running directly: tsx src/db/migrations.ts
if (require.main === module) {
  runMigrations();
  process.exit(0);
}
