const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "../../data");

module.exports = {
  // Discord Config
  token: process.env.DISCORD_TOKEN || "",

  // API & Webhook Security
  port: parseInt(process.env.PORT || "8080", 10),
  webhookSecret: process.env.WEBHOOK_SECRET || "",

  // Paths
  dataDir: DATA_DIR,
  dbPath: process.env.DB_PATH || path.join(DATA_DIR, "hope_network.sqlite"),

  // XP Reward Amounts
  disboardBumpXp: parseInt(process.env.DISBOARD_BUMP_XP || "30", 10),
  nodeOperatorInviteXp: parseInt(process.env.NODE_OPERATOR_INVITE_XP || "100", 10),

  // Channel & Role Configuration (legacy / existing server config)
  channels: {
    twitter: process.env.TWITTER_CHANNEL_ID || "1435292609512996866",
    welcome: process.env.WELCOME_CHANNEL_ID || "1343345592675336194",
    roles: process.env.ROLES_CHANNEL_ID || "1435607673176461413",
    ticket: process.env.TICKET_CHANNEL_ID || "1437368945198895155",
    log: process.env.LOG_CHANNEL_ID || "1458122793769107456",
    ticketCategory: process.env.TICKET_CATEGORY_ID || "1457266525013676043",
    townstar: process.env.TOWNSTAR_CHANNEL_ID || "1435297840648949801",
  },
  roles: {
    nftRole: process.env.NFT_ROLE_DISCORD_ID || "1486257857635680326",
  },

  // DISBOARD Bot ID
  disboardBotId: process.env.DISBOARD_BOT_ID || "302050872383242240",
};
