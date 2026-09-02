const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const config = require("../config");
const { slashCommands, handleSlashCommand } = require("./commands/xpCommands");
const { cacheGuildInvites, handleMemberJoin } = require("../services/inviteService");
const { processDisboardMessage } = require("../services/disboardService");

function createBotClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildInvites,
    ],
  });

  // Ready event
  client.once("ready", async () => {
    console.log(`🤖 Hope Network Bot logged in as ${client.user.tag}`);

    // Register slash commands
    try {
      if (config.token) {
        const rest = new REST({ version: "10" }).setToken(config.token);
        await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        console.log(`✅ Registered ${slashCommands.length} slash commands globally.`);
      }
    } catch (err) {
      console.error("❌ Failed to register slash commands:", err.message);
    }

    // Cache initial invites for all guilds
    client.guilds.cache.forEach((guild) => {
      cacheGuildInvites(guild);
    });
  });

  // Guild member join event (Invite tracking)
  client.on("guildMemberAdd", async (member) => {
    try {
      await handleMemberJoin(member);
    } catch (err) {
      console.error("[Bot] Error on guildMemberAdd:", err.message);
    }
  });

  // Message event (DISBOARD bump detection)
  client.on("messageCreate", async (message) => {
    if (!message.guild) return;

    try {
      // Process DISBOARD bump if message from DISBOARD bot
      if (message.author.id === config.disboardBotId) {
        processDisboardMessage(message);
      }
    } catch (err) {
      console.error("[Bot] Error on messageCreate DISBOARD check:", err.message);
    }
  });

  // Interaction event (Slash commands)
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      await handleSlashCommand(interaction);
    } catch (err) {
      console.error("[Bot] Error handling slash command:", err.message);
      const replyFn = interaction.replied || interaction.deferred ? "followUp" : "reply";
      await interaction[replyFn]({
        content: "An error occurred while executing this command.",
        ephemeral: true,
      }).catch(() => {});
    }
  });

  return client;
}

module.exports = { createBotClient };
