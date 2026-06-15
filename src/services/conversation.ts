import { db } from '../db/database';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ChatMessage } from './grok';

interface DBUser {
  id: number;
  instagram_user_id: string;
  username: string | null;
  first_seen: number;
  last_activity: number;
  message_count: number;
  is_blocked: number;
  notes: string;
}

interface DBMessage {
  id: number;
  instagram_user_id: string;
  role: 'user' | 'assistant';
  content: string;
  meta_message_id: string | null;
  created_at: number;
}

export class ConversationService {
  getOrCreateUser(instagramUserId: string, username?: string): DBUser {
    const existing = db
      .prepare('SELECT * FROM users WHERE instagram_user_id = ?')
      .get(instagramUserId) as DBUser | undefined;

    if (existing) {
      if (username && username !== existing.username) {
        db.prepare('UPDATE users SET username = ? WHERE instagram_user_id = ?').run(username, instagramUserId);
        existing.username = username;
      }
      return existing;
    }

    db.prepare(
      'INSERT INTO users (instagram_user_id, username) VALUES (?, ?)'
    ).run(instagramUserId, username ?? null);

    return db
      .prepare('SELECT * FROM users WHERE instagram_user_id = ?')
      .get(instagramUserId) as DBUser;
  }

  isBlocked(instagramUserId: string): boolean {
    const user = db
      .prepare('SELECT is_blocked FROM users WHERE instagram_user_id = ?')
      .get(instagramUserId) as { is_blocked: number } | undefined;
    return user?.is_blocked === 1;
  }

  blockUser(instagramUserId: string): void {
    db.prepare('UPDATE users SET is_blocked = 1 WHERE instagram_user_id = ?').run(instagramUserId);
    logger.info({ instagramUserId }, 'User blocked');
  }

  unblockUser(instagramUserId: string): void {
    db.prepare('UPDATE users SET is_blocked = 0 WHERE instagram_user_id = ?').run(instagramUserId);
  }

  addMessage(
    instagramUserId: string,
    role: 'user' | 'assistant',
    content: string,
    metaMessageId?: string
  ): void {
    db.prepare(
      `INSERT OR IGNORE INTO messages (instagram_user_id, role, content, meta_message_id)
       VALUES (?, ?, ?, ?)`
    ).run(instagramUserId, role, content, metaMessageId ?? null);

    db.prepare(
      `UPDATE users SET last_activity = unixepoch(), message_count = message_count + 1
       WHERE instagram_user_id = ?`
    ).run(instagramUserId);
  }

  getHistory(instagramUserId: string, limit = 20): ChatMessage[] {
    const rows = db
      .prepare(
        `SELECT role, content FROM messages
         WHERE instagram_user_id = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(instagramUserId, limit) as Pick<DBMessage, 'role' | 'content'>[];

    return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  checkRateLimit(instagramUserId: string): boolean {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const result = db
      .prepare(
        `SELECT COUNT(*) as cnt FROM messages
         WHERE instagram_user_id = ? AND role = 'assistant' AND created_at > ?`
      )
      .get(instagramUserId, oneHourAgo) as { cnt: number };

    return result.cnt < config.limits.maxRepliesPerUserPerHour;
  }

  isMessageProcessed(metaMessageId: string): boolean {
    const row = db
      .prepare('SELECT 1 FROM processed_messages WHERE meta_message_id = ?')
      .get(metaMessageId);
    return row !== undefined;
  }

  markMessageProcessed(metaMessageId: string): void {
    db.prepare(
      'INSERT OR IGNORE INTO processed_messages (meta_message_id) VALUES (?)'
    ).run(metaMessageId);
  }

  getPendingOverride(instagramUserId: string): string | null {
    const row = db
      .prepare(
        `SELECT id, override_message FROM manual_overrides
         WHERE instagram_user_id = ? AND used = 0
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(instagramUserId) as { id: number; override_message: string } | undefined;

    if (!row) return null;
    db.prepare('UPDATE manual_overrides SET used = 1 WHERE id = ?').run(row.id);
    return row.override_message;
  }

  createOverride(instagramUserId: string, message: string): void {
    db.prepare(
      'INSERT INTO manual_overrides (instagram_user_id, override_message) VALUES (?, ?)'
    ).run(instagramUserId, message);
  }

  listConversations(limit = 50): DBUser[] {
    return db
      .prepare(
        'SELECT * FROM users ORDER BY last_activity DESC LIMIT ?'
      )
      .all(limit) as DBUser[];
  }

  getConversationMessages(instagramUserId: string): DBMessage[] {
    return db
      .prepare(
        'SELECT * FROM messages WHERE instagram_user_id = ? ORDER BY created_at ASC'
      )
      .all(instagramUserId) as DBMessage[];
  }

  getStats(): Record<string, number> {
    const today = Math.floor(Date.now() / 1000) - 86400;
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const messagesDay = (
      db.prepare('SELECT COUNT(*) as c FROM messages WHERE created_at > ?').get(today) as { c: number }
    ).c;
    const activeToday = (
      db.prepare('SELECT COUNT(*) as c FROM users WHERE last_activity > ?').get(today) as { c: number }
    ).c;
    const blocked = (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_blocked = 1').get() as { c: number }).c;

    return { totalUsers, messagesDay, activeToday, blocked };
  }
}

export const conversationService = new ConversationService();
