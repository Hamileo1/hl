const db = require("../database/db");

/**
 * Ensure user exists in database with join date and inviter info if provided
 */
function ensureUser(userId, joinDate = null, inviterId = null) {
  const existing = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
  if (!existing) {
    db.prepare(`
      INSERT INTO users (user_id, xp, join_date, inviter_id)
      VALUES (?, 0, ?, ?)
    `).run(userId, joinDate || new Date().toISOString(), inviterId || null);
    return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
  }

  if (inviterId && !existing.inviter_id) {
    db.prepare("UPDATE users SET inviter_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(inviterId, userId);
    existing.inviter_id = inviterId;
  }
  return existing;
}

/**
 * Get user record with XP and history
 */
function getUser(userId) {
  return db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) || null;
}

/**
 * Award XP to a user.
 * @param {string} userId - Discord user ID
 * @param {number} amount - Amount of XP to award (must be > 0)
 * @param {string} reason - Reason for XP award
 * @param {string|null} eventId - Unique event identifier to prevent duplicate awards
 * @returns {object} { success: boolean, duplicate: boolean, newXp: number, entry: object }
 */
function awardXP(userId, amount, reason, eventId = null) {
  if (!userId || amount <= 0) {
    throw new Error("Invalid userId or amount for awarding XP.");
  }

  ensureUser(userId);

  // Check duplicate eventId if provided
  if (eventId) {
    const existing = db.prepare("SELECT id FROM xp_history WHERE event_id = ?").get(eventId);
    if (existing) {
      const user = getUser(userId);
      return { success: false, duplicate: true, newXp: user ? user.xp : 0, message: "Duplicate event ID" };
    }
  }

  let resultUserXp = 0;
  let historyEntry = null;

  const transaction = db.transaction(() => {
    // Insert into xp_history
    const historyRes = db.prepare(`
      INSERT INTO xp_history (user_id, amount, reason, event_id)
      VALUES (?, ?, ?, ?)
    `).run(userId, amount, reason, eventId || null);

    // Update user total XP
    db.prepare(`
      UPDATE users
      SET xp = xp + ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(amount, userId);

    const updatedUser = getUser(userId);
    resultUserXp = updatedUser ? updatedUser.xp : 0;
    historyEntry = db.prepare("SELECT * FROM xp_history WHERE id = ?").get(historyRes.lastInsertRowid);
  });

  try {
    transaction();
    return {
      success: true,
      duplicate: false,
      newXp: resultUserXp,
      history: historyEntry,
    };
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE constraint failed")) {
      const user = getUser(userId);
      return { success: false, duplicate: true, newXp: user ? user.xp : 0, message: "Duplicate event constraint" };
    }
    throw err;
  }
}

/**
 * Deduct XP from a user (for admin commands or penalties)
 */
function deductXP(userId, amount, reason) {
  if (!userId || amount <= 0) {
    throw new Error("Invalid userId or amount for deducting XP.");
  }

  ensureUser(userId);

  let newXp = 0;
  const transaction = db.transaction(() => {
    const negativeAmount = -Math.abs(amount);

    db.prepare(`
      INSERT INTO xp_history (user_id, amount, reason)
      VALUES (?, ?, ?)
    `).run(userId, negativeAmount, reason);

    db.prepare(`
      UPDATE users
      SET xp = MAX(0, xp + ?), updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `).run(negativeAmount, userId);

    const user = getUser(userId);
    newXp = user ? user.xp : 0;
  });

  transaction();
  return { success: true, newXp };
}

/**
 * Get XP reward history for a user
 */
function getXPHistory(userId, limit = 10) {
  return db.prepare(`
    SELECT * FROM xp_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

/**
 * Get top leaderboard
 */
function getLeaderboard(limit = 10) {
  return db.prepare(`
    SELECT user_id, xp, join_date, inviter_id
    FROM users
    ORDER BY xp DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  ensureUser,
  getUser,
  awardXP,
  deductXP,
  getXPHistory,
  getLeaderboard,
};
