const db = require("../database/db");
const config = require("../config");
const { awardXP } = require("./xpService");
const { getInviter } = require("./inviteService");

/**
 * Process a verified Hope Node Operator event.
 * When Member B becomes a verified Node Operator, check if Member A invited Member B.
 * If so, award Member A the NODE_OPERATOR_INVITE_XP reward if not already rewarded.
 *
 * @param {string} userId - Discord user ID of the verified Node Operator (invitee)
 * @param {object} verificationData - Additional details (e.g., node_id, status)
 * @returns {object} Result of the operation
 */
function processNodeVerification(userId, verificationData = {}) {
  if (!userId) {
    return { success: false, reason: "Missing userId" };
  }

  // 1. Check if this invitee has already been verified and rewarded
  const existingReward = db.prepare("SELECT * FROM node_invite_rewards WHERE invitee_id = ?").get(userId);
  if (existingReward) {
    console.log(`[NodeService] Member ${userId} was already rewarded previously (Inviter: ${existingReward.inviter_id}).`);
    return {
      success: false,
      alreadyRewarded: true,
      inviterId: existingReward.inviter_id,
      message: "Node Operator invite reward was already processed previously.",
    };
  }

  // 2. Find who invited this user
  const inviterId = getInviter(userId);
  if (!inviterId) {
    console.log(`[NodeService] Member ${userId} became a verified Node Operator, but no inviter was found in DB.`);
    return {
      success: true,
      rewarded: false,
      reason: "No inviter found for this user.",
    };
  }

  // 3. Prevent self-invite abuse
  if (inviterId === userId) {
    console.log(`[NodeService] Self-invite attempt detected for user ${userId}. Reward skipped.`);
    return {
      success: false,
      reason: "Self-invite reward disabled.",
    };
  }

  const rewardAmount = config.nodeOperatorInviteXp;
  const reason = `Invited member ${userId} became a verified Hope Node Operator`;
  const eventId = `node_verify_${userId}`;

  let xpResult = null;

  const transaction = db.transaction(() => {
    // Record reward in node_invite_rewards table
    db.prepare(`
      INSERT INTO node_invite_rewards (invitee_id, inviter_id, rewarded_xp)
      VALUES (?, ?, ?)
    `).run(userId, inviterId, rewardAmount);

    // Award XP to the inviter
    xpResult = awardXP(inviterId, rewardAmount, reason, eventId);
  });

  try {
    transaction();
    console.log(`[NodeService] Awarded ${rewardAmount} XP to inviter ${inviterId} for verified node operator ${userId}`);
    return {
      success: true,
      rewarded: true,
      inviterId,
      rewardedXp: rewardAmount,
      xpResult,
    };
  } catch (err) {
    console.error(`[NodeService] Error processing node verification reward for ${userId}:`, err.message);
    return {
      success: false,
      reason: err.message,
    };
  }
}

/**
 * Check node reward status for a user
 */
function getNodeRewardStatus(userId) {
  return db.prepare("SELECT * FROM node_invite_rewards WHERE invitee_id = ?").get(userId) || null;
}

module.exports = {
  processNodeVerification,
  getNodeRewardStatus,
};
