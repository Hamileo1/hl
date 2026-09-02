const db = require("../database/db");
const config = require("../config");
const { awardXP, ensureUser } = require("./xpService");

/**
 * Handle DISBOARD bump messages safely.
 * DISBOARD Bot ID: 302050872383242240
 */
function processDisboardMessage(message) {
  // Verify message author is official DISBOARD bot
  if (message.author.id !== config.disboardBotId) {
    return { isDisboard: false };
  }

  const messageId = message.id;

  // Extract member ID from embed
  let bumpedUserId = null;
  let isSuccessfulBump = false;

  if (message.embeds && message.embeds.length > 0) {
    const embed = message.embeds[0];
    const desc = embed.description || "";
    const title = embed.title || "";

    if (/bump done|bump success|DISBOARD/i.test(desc) || /bump done|bump success/i.test(title)) {
      isSuccessfulBump = true;

      // Extract user mention <@123456789> or <@!123456789> or <@username>
      const mentionMatch = desc.match(/<@!?([a-zA-Z0-9_]+)>/);
      if (mentionMatch) {
        bumpedUserId = mentionMatch[1];
      }
    }
  }

  // Fallback check on message content if no embed match
  if (!bumpedUserId && message.content) {
    if (/bump done|bump success/i.test(message.content)) {
      isSuccessfulBump = true;
      const mentionMatch = message.content.match(/<@!?([a-zA-Z0-9_]+)>/);
      if (mentionMatch) {
        bumpedUserId = mentionMatch[1];
      }
    }
  }

  // Check interaction user if available
  if (!bumpedUserId && message.interaction && message.interaction.user) {
    bumpedUserId = message.interaction.user.id;
    isSuccessfulBump = true;
  }

  if (!isSuccessfulBump) {
    return { isDisboard: true, isBump: false };
  }

  if (!bumpedUserId) {
    console.warn(`[DisboardService] Successful bump detected on message ${messageId}, but could not reliably identify member.`);
    return {
      isDisboard: true,
      isBump: true,
      rewarded: false,
      reason: "Could not reliably link bump to specific Discord member",
    };
  }

  // Check duplicate bump reward for this message ID
  const existingBump = db.prepare("SELECT * FROM disboard_bumps WHERE message_id = ?").get(messageId);
  if (existingBump) {
    return {
      isDisboard: true,
      isBump: true,
      rewarded: false,
      duplicate: true,
      message: "Bump already rewarded for this message",
    };
  }

  // Ensure user exists before inserting foreign key record
  ensureUser(bumpedUserId);

  const rewardAmount = config.disboardBumpXp;
  const reason = "DISBOARD Server Bump Reward";
  const eventId = `disboard_bump_${messageId}`;

  let xpResult = null;

  const transaction = db.transaction(() => {
    db.prepare(`
      INSERT INTO disboard_bumps (message_id, user_id, rewarded_xp)
      VALUES (?, ?, ?)
    `).run(messageId, bumpedUserId, rewardAmount);

    xpResult = awardXP(bumpedUserId, rewardAmount, reason, eventId);
  });

  try {
    transaction();
    console.log(`[DisboardService] Successfully rewarded ${rewardAmount} XP to ${bumpedUserId} for DISBOARD bump ${messageId}`);
    return {
      isDisboard: true,
      isBump: true,
      rewarded: true,
      userId: bumpedUserId,
      rewardedXp: rewardAmount,
      xpResult,
    };
  } catch (err) {
    console.error(`[DisboardService] Error awarding DISBOARD bump XP:`, err.message);
    return {
      isDisboard: true,
      isBump: true,
      rewarded: false,
      error: err.message,
    };
  }
}

module.exports = {
  processDisboardMessage,
};
