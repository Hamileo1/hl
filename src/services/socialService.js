const db = require("../database/db");
const { awardXP, ensureUser } = require("./xpService");

/**
 * Default XP table per social action if not provided in payload
 */
const DEFAULT_ACTION_XP = {
  repost: 20,
  share: 20,
  like: 10,
  content_creation: 50,
  comment: 10,
};

/**
 * Process incoming social media event from IFTTT or webhooks
 */
function processSocialEvent(payload) {
  const { eventId, platform, action, userId, amount, details } = payload;

  if (!eventId || !platform || !action || !userId) {
    return {
      success: false,
      status: 400,
      reason: "Missing required fields: eventId, platform, action, and userId are required.",
    };
  }

  // 1. Deduplication check via social_events table
  const existingEvent = db.prepare("SELECT * FROM social_events WHERE event_id = ?").get(eventId);
  if (existingEvent) {
    console.log(`[SocialService] Duplicate social event received: ${eventId}`);
    return {
      success: false,
      status: 409,
      duplicate: true,
      reason: "Duplicate social event ID.",
    };
  }

  // Ensure user exists before FK constraint
  ensureUser(userId);

  // 2. Determine XP amount
  const xpAmount = amount && amount > 0 ? parseInt(amount, 10) : (DEFAULT_ACTION_XP[action.toLowerCase()] || 15);
  const reason = `Social Media XP (${platform.toUpperCase()}: ${action}) - ${details || eventId}`;

  let xpResult = null;

  const transaction = db.transaction(() => {
    // Record social event in DB
    db.prepare(`
      INSERT INTO social_events (event_id, platform, action, user_id, rewarded_xp)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventId, platform, action, userId, xpAmount);

    // Record webhook log
    db.prepare(`
      INSERT INTO webhook_events (event_id, source, payload)
      VALUES (?, ?, ?)
    `).run(eventId, `social_${platform}`, JSON.stringify(payload));

    // Award XP
    xpResult = awardXP(userId, xpAmount, reason, `social_${eventId}`);
  });

  try {
    transaction();
    console.log(`[SocialService] Processed social event ${eventId}: awarded ${xpAmount} XP to ${userId} (${platform}/${action})`);
    return {
      success: true,
      status: 200,
      eventId,
      userId,
      rewardedXp: xpAmount,
      xpResult,
    };
  } catch (err) {
    console.error(`[SocialService] Error processing social event ${eventId}:`, err.message);
    return {
      success: false,
      status: 500,
      reason: err.message,
    };
  }
}

/**
 * Query social media events for a user
 */
function getUserSocialEvents(userId) {
  return db.prepare("SELECT * FROM social_events WHERE user_id = ? ORDER BY processed_at DESC").all(userId);
}

module.exports = {
  processSocialEvent,
  getUserSocialEvents,
};
