const db = require("../database/db");
const { ensureUser } = require("./xpService");

// In-memory cache for guild invites: guildId -> Collection(code, { uses, inviterId })
const guildInvitesCache = new Map();

/**
 * Cache current invites for a guild
 */
async function cacheGuildInvites(guild) {
  if (!guild || !guild.invites) return;
  try {
    const invites = await guild.invites.fetch();
    const codeMap = new Map();
    invites.forEach((inv) => {
      codeMap.set(inv.code, { uses: inv.uses || 0, inviterId: inv.inviter ? inv.inviter.id : null });
    });
    guildInvitesCache.set(guild.id, codeMap);
  } catch (err) {
    console.error(`[InviteService] Error caching invites for guild ${guild?.id}:`, err.message);
  }
}

/**
 * Record invite relationship permanently in DB
 */
function recordInvite(inviteeId, inviterId, inviteCode = null) {
  if (!inviteeId || !inviterId) return null;

  // Ensure users exist
  ensureUser(inviteeId, new Date().toISOString(), inviterId);
  ensureUser(inviterId);

  // Self-invite prevention check
  if (inviteeId === inviterId) {
    console.log(`[InviteService] Self-invite detected for user ${inviteeId}. Skipping inviter association.`);
    return null;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO invites (invitee_id, inviter_id, invite_code)
      VALUES (?, ?, ?)
      ON CONFLICT(invitee_id) DO UPDATE SET
        inviter_id = excluded.inviter_id,
        invite_code = excluded.invite_code
    `);
    stmt.run(inviteeId, inviterId, inviteCode || null);

    db.prepare("UPDATE users SET inviter_id = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND inviter_id IS NULL").run(inviterId, inviteeId);

    return { inviteeId, inviterId, inviteCode };
  } catch (err) {
    console.error(`[InviteService] Failed to record invite relationship (${inviteeId} -> ${inviterId}):`, err.message);
    return null;
  }
}

/**
 * Handle a member joining a guild to determine who invited them
 */
async function handleMemberJoin(member) {
  const guild = member.guild;
  const inviteeId = member.id;
  ensureUser(inviteeId, member.joinedAt ? member.joinedAt.toISOString() : new Date().toISOString());

  if (!guild || !guild.invites) return null;

  const cachedInvites = guildInvitesCache.get(guild.id);
  let usedInviterId = null;
  let usedCode = null;

  try {
    const currentInvites = await guild.invites.fetch();
    if (cachedInvites) {
      for (const [code, inv] of currentInvites) {
        const cached = cachedInvites.get(code);
        if (cached && inv.uses > cached.uses) {
          usedCode = code;
          usedInviterId = inv.inviter ? inv.inviter.id : cached.inviterId;
          break;
        }
      }
    }
    // Refresh cache
    await cacheGuildInvites(guild);
  } catch (err) {
    console.error(`[InviteService] Error tracking invite on member join:`, err.message);
  }

  if (usedInviterId && usedInviterId !== inviteeId) {
    console.log(`[InviteService] ${member.user.tag} (${inviteeId}) joined using invite ${usedCode} by ${usedInviterId}`);
    return recordInvite(inviteeId, usedInviterId, usedCode);
  }

  return null;
}

/**
 * Get inviter for a user
 */
function getInviter(inviteeId) {
  const rec = db.prepare("SELECT * FROM invites WHERE invitee_id = ?").get(inviteeId);
  if (rec) return rec.inviter_id;

  const userRec = db.prepare("SELECT inviter_id FROM users WHERE user_id = ?").get(inviteeId);
  return userRec ? userRec.inviter_id : null;
}

module.exports = {
  cacheGuildInvites,
  handleMemberJoin,
  recordInvite,
  getInviter,
};
