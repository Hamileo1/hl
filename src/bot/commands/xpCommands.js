const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { getUser, getXPHistory, getLeaderboard, awardXP, deductXP } = require("../../services/xpService");

const slashCommands = [
  // 1. /xp user
  new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Show member's current XP and stats")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The member to check (defaults to you)").setRequired(false)
    ),

  // 2. /addxp user amount reason (Admin)
  new SlashCommandBuilder()
    .setName("addxp")
    .setDescription("Manually add XP to a member (Admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) => opt.setName("user").setDescription("The member").setRequired(true))
    .addIntegerOption((opt) => opt.setName("amount").setDescription("XP amount to add").setMinValue(1).setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for adding XP").setRequired(true)),

  // 3. /removexp user amount reason (Admin)
  new SlashCommandBuilder()
    .setName("removexp")
    .setDescription("Manually remove XP from a member (Admin)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) => opt.setName("user").setDescription("The member").setRequired(true))
    .addIntegerOption((opt) => opt.setName("amount").setDescription("XP amount to remove").setMinValue(1).setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for removing XP").setRequired(true)),

  // 4. /xp-history user
  new SlashCommandBuilder()
    .setName("xp-history")
    .setDescription("Show recent XP reward history for a member")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The member to check (defaults to you)").setRequired(false)
    ),

  // 5. /leaderboard
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show top members with highest XP"),
].map((cmd) => cmd.toJSON());

/**
 * Handle slash command execution
 */
async function handleSlashCommand(interaction) {
  const { commandName } = interaction;

  // Helper embed
  const createEmbed = (title, description, color = "#5865F2") => {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
  };

  // /xp command
  if (commandName === "xp") {
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const userDb = getUser(targetUser.id);
    const xp = userDb ? userDb.xp : 0;
    const inviterInfo = userDb && userDb.inviter_id ? `<@${userDb.inviter_id}>` : "None";

    const embed = createEmbed(
      `⭐ XP Profile: ${targetUser.username}`,
      `👤 **Member:** ${targetUser}\n✨ **Current XP:** \`${xp.toLocaleString()}\` XP\n🤝 **Inviter:** ${inviterInfo}\n📅 **Joined:** ${userDb && userDb.join_date ? new Date(userDb.join_date).toLocaleDateString() : "Unknown"}`
    );

    const avatarUrl = typeof targetUser.displayAvatarURL === "function" ? targetUser.displayAvatarURL() : null;
    if (avatarUrl) {
      embed.setThumbnail(avatarUrl);
    }

    return interaction.reply({ embeds: [embed] });
  }

  // /addxp command (Admin)
  if (commandName === "addxp") {
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const reason = interaction.options.getString("reason");

    const res = awardXP(targetUser.id, amount, `Admin award by ${interaction.user.tag}: ${reason}`);
    const embed = createEmbed(
      "✅ XP Added",
      `Successfully added **${amount.toLocaleString()} XP** to ${targetUser}.\n\nReason: *${reason}*\nNew XP Balance: **${res.newXp.toLocaleString()} XP**`,
      "#00c851"
    );

    return interaction.reply({ embeds: [embed] });
  }

  // /removexp command (Admin)
  if (commandName === "removexp") {
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const reason = interaction.options.getString("reason");

    const res = deductXP(targetUser.id, amount, `Admin deduction by ${interaction.user.tag}: ${reason}`);
    const embed = createEmbed(
      "🔻 XP Removed",
      `Successfully removed **${amount.toLocaleString()} XP** from ${targetUser}.\n\nReason: *${reason}*\nNew XP Balance: **${res.newXp.toLocaleString()} XP**`,
      "#ff4444"
    );

    return interaction.reply({ embeds: [embed] });
  }

  // /xp-history command
  if (commandName === "xp-history") {
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const history = getXPHistory(targetUser.id, 10);

    if (!history || history.length === 0) {
      return interaction.reply({
        embeds: [createEmbed("📜 XP History", `No XP history found for ${targetUser}.`)],
      });
    }

    const lines = history.map((item, idx) => {
      const sign = item.amount >= 0 ? "+" : "";
      const dateStr = new Date(item.created_at).toLocaleDateString();
      return `**${idx + 1}.** \`${sign}${item.amount} XP\` — *${item.reason}* (${dateStr})`;
    }).join("\n");

    const embed = createEmbed(`📜 XP History: ${targetUser.username}`, lines);
    return interaction.reply({ embeds: [embed] });
  }

  // /leaderboard command
  if (commandName === "leaderboard") {
    const topList = getLeaderboard(10);
    const medals = ["🥇", "🥈", "🥉"];

    if (!topList || topList.length === 0) {
      return interaction.reply({
        embeds: [createEmbed("🏆 XP Leaderboard", "No XP data available yet.")],
      });
    }

    const lines = topList.map((entry, idx) => {
      const medal = medals[idx] || `**${idx + 1}.**`;
      return `${medal} <@${entry.user_id}> — **${entry.xp.toLocaleString()} XP**`;
    }).join("\n");

    const embed = createEmbed("🏆 Hope Network XP Leaderboard", lines, "#ffbb33");
    return interaction.reply({ embeds: [embed] });
  }
}

module.exports = {
  slashCommands,
  handleSlashCommand,
};
