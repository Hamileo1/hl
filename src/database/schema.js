/**
 * Database Schema Definition for Hope Network Discord Bot
 */
function initSchema(db) {
  db.exec(`
    -- Users table for tracking members and total XP
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      xp INTEGER DEFAULT 0,
      join_date TEXT,
      inviter_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- XP History / Audit Log table
    CREATE TABLE IF NOT EXISTS xp_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      event_id TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Invite Relationships table
    CREATE TABLE IF NOT EXISTS invites (
      invitee_id TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      invite_code TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invitee_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (inviter_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Hope Node Operator invite reward tracking table
    CREATE TABLE IF NOT EXISTS node_invite_rewards (
      invitee_id TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      rewarded_xp INTEGER NOT NULL,
      rewarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invitee_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Social Media Events tracking table
    CREATE TABLE IF NOT EXISTS social_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      platform TEXT NOT NULL,
      action TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rewarded_xp INTEGER NOT NULL,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Webhook raw logs / idempotency table
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      payload TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- DISBOARD bump tracking table
    CREATE TABLE IF NOT EXISTS disboard_bumps (
      message_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      rewarded_xp INTEGER NOT NULL,
      bumped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_xp_history_user_id ON xp_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);
    CREATE INDEX IF NOT EXISTS idx_invites_inviter_id ON invites(inviter_id);
  `);
}

module.exports = { initSchema };
