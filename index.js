const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  AuditLogEvent,
  REST,
  Routes,
  SlashCommandBuilder,
  ApplicationCommandOptionType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");
const http = require("http");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
});

const TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || "";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN env var missing. Set it in Render's Environment settings.");
  process.exit(1);
}

// Channel/Role IDs — now read from env vars so the bot can be reconfigured
// per-server without touching code. Falls back to the original hardcoded
// values if the env var isn't set.
const TWITTER_CHANNEL_ID = process.env.TWITTER_CHANNEL_ID || "1435292609512996866";
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || "1343345592675336194";
const ROLES_CHANNEL_ID = process.env.ROLES_CHANNEL_ID || "1435607673176461413";
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID || "1437368945198895155";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1458122793769107456";
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || "1457266525013676043";
const NFT_ROLE_DISCORD_ID = process.env.NFT_ROLE_DISCORD_ID || "1486257857635680326";
const TOWNSTAR_CHANNEL_ID = process.env.TOWNSTAR_CHANNEL_ID || "1435297840648949801";

const TWITTER_USERNAME = process.env.TWITTER_USERNAME || "Hamelio01";
const ETH_CONTRACT = process.env.ETH_CONTRACT || "0x8F73eB92C5010b4d26A4891f1bfdCB9B682B8E78";
const SOL_COLLECTION = process.env.SOL_COLLECTION || "zcY9JrrtwCh4WEiWNqwbgWa1jTFbA4H2qvk7s5e2Rxv";
const ETH_RPC = process.env.ETH_RPC || "https://ethereum-rpc.publicnode.com";
const SOL_RPC = process.env.SOL_RPC || "https://api.mainnet-beta.solana.com";

// ─── PERSISTENT DATA DIR ───────────────────────────────────────────────────────
// On Render, mount a Persistent Disk at this path (e.g. /data) so economy
// balances and mute state survive restarts/redeploys. Defaults to a local
// ./data folder for local/dev use.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── ROLE DEFINITIONS ─────────────────────────────────────────────────────────
const ROLE_DEFINITIONS = [
  { id: "offtopic", label: "Offtopic Discussion", emoji: "🦜" },
  { id: "events", label: "Community Events", emoji: "🎉" },
  { id: "poker", label: "Poker", emoji: "♠️" },
  { id: "memes", label: "Memes, Art, Pets", emoji: "🎭" },
  { id: "nftowner", label: "NFT Owner", emoji: "🖼️" },
];
const guildRoleMap = {};

// ─── AUTO-MOD CONFIG ──────────────────────────────────────────────────────────
const SPAM_THRESHOLD = 5; // messages in SPAM_WINDOW ms = spam
const SPAM_WINDOW = 5000;
const userMessageLog = new Map();
const warnedUsers = new Set();
const mutedUsers = new Set();
const memberWarnCount = new Map();
const MUTE_DURATION_MS = 5 * 60 * 1000;
const MUTE_STATE_FILE = path.join(DATA_DIR, "mutes.json");

function loadMuteState() {
  try { return JSON.parse(fs.readFileSync(MUTE_STATE_FILE, "utf8")); } catch { return {}; }
}
function saveMuteState(state) {
  try { fs.writeFileSync(MUTE_STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}
function recordMute(guildId, userId, expiresAt) {
  const state = loadMuteState();
  if (!state[guildId]) state[guildId] = {};
  state[guildId][userId] = expiresAt;
  saveMuteState(state);
}
function clearMuteRecord(guildId, userId) {
  const state = loadMuteState();
  if (state[guildId]) delete state[guildId][userId];
  saveMuteState(state);
}

const BLOCKED_WORDS = ["nigger", "nigga", "slur", "f@ggot"];
const LINK_WHITELIST = [
  "discord.gg",
  "x.com",
  "twitter.com",
  "youtube.com",
  "lionheartlabs.io",
];
const LINK_REGEX = /https?:\/\/[^\s]+/gi;

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function sendLog(guild, embed) {
  try {
    if (!guild.channels.cache.has(LOG_CHANNEL_ID)) return;
    const ch = await client.channels.fetch(LOG_CHANNEL_ID);
    if (ch) await ch.send({ embeds: [embed] });
  } catch (_) {}
}

async function ensureRoles(guild) {
  if (!guildRoleMap[guild.id]) guildRoleMap[guild.id] = {};
  for (const def of ROLE_DEFINITIONS) {
    if (def.id === "nftowner") {
      guildRoleMap[guild.id]["nftowner"] = NFT_ROLE_DISCORD_ID;
      continue;
    }
    let role = guild.roles.cache.find((r) => r.name === def.label);
    if (!role) {
      try {
        role = await guild.roles.create({
          name: def.label,
          reason: "HL Bot role picker",
        });
        console.log(`✅ [${guild.name}] Created role: ${def.label}`);
      } catch (err) {
        console.error(`❌ Create role error: ${err.message}`);
        continue;
      }
    }
    guildRoleMap[guild.id][def.id] = role.id;
  }
}

async function postRolePicker(guild) {
  try {
    if (!guild.channels.cache.has(ROLES_CHANNEL_ID)) return;
    const channel = await client.channels.fetch(ROLES_CHANNEL_ID);
    if (!channel) return;
    const messages = await channel.messages.fetch({ limit: 20 });
    const existing = messages.find(
      (m) => m.author.id === client.user.id && m.components.length > 0,
    );
    if (existing) {
      const hasNFT = existing.components.some((r) =>
        r.components.some((c) => c.customId === "verify_nft"),
      );
      if (hasNFT) return;
      await existing.delete();
    }
    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("🎭 What interests you?")
      .setDescription(
        "Pick your roles below. Click again to remove.\n**🖼️ NFT Owner** needs wallet verification.",
      );
    const rows = [];
    let row = new ActionRowBuilder();
    const regular = ROLE_DEFINITIONS.filter((d) => d.id !== "nftowner");
    for (let i = 0; i < regular.length; i++) {
      const def = regular[i];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`role_${def.id}`)
          .setLabel(def.label)
          .setEmoji(def.emoji)
          .setStyle(ButtonStyle.Secondary),
      );
      if ((i + 1) % 3 === 0 || i === regular.length - 1) {
        rows.push(row);
        row = new ActionRowBuilder();
      }
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("verify_nft")
          .setLabel("NFT Owner — Verify Wallet")
          .setEmoji("🖼️")
          .setStyle(ButtonStyle.Primary),
      ),
    );
    await channel.send({ embeds: [embed], components: rows });
    console.log(`✅ [${guild.name}] Role picker posted.`);
  } catch (err) {
    console.error("Role picker error:", err.message);
  }
}

async function postTicketPanel(guild) {
  try {
    if (!guild.channels.cache.has(TICKET_CHANNEL_ID)) return;
    const channel = await client.channels.fetch(TICKET_CHANNEL_ID);
    if (!channel) return;
    const messages = await channel.messages.fetch({ limit: 20 });
    const existing = messages.find(
      (m) =>
        m.author.id === client.user.id &&
        m.components.length > 0 &&
        m.components[0].components.some((c) => c.customId === "open_ticket"),
    );
    if (existing) await existing.delete().catch(() => {});

    // Delete any previous video message from the bot
    const prevVideo = messages.find(
      (m) => m.author.id === client.user.id && m.attachments.size > 0 && !m.components.length
    );
    if (prevVideo) await prevVideo.delete().catch(() => {});

    const gifPath = path.join(__dirname, "attached_assets", "support.gif");
    const hasGif = fs.existsSync(gifPath);
    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("🎫 Support Ticket")
      .setDescription("Choose the best button for your issue and a ticket will be opened for you.")
      .setFooter({ text: "Hamileo Support System" });
    if (hasGif) embed.setImage("attachment://support.gif");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_ticket")
        .setLabel("Open Ticket")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("report_suspicious")
        .setLabel("Report Activity")
        .setEmoji("⚠️")
        .setStyle(ButtonStyle.Danger),
    );
    await channel.send({
      embeds: [embed],
      components: [row],
      files: hasGif ? [{ attachment: gifPath, name: "support.gif" }] : [],
    });
    console.log(`✅ [${guild.name}] Ticket panel posted.`);
  } catch (err) {
    console.error("Ticket panel error:", err.message);
  }
}

async function reapplyMutes(guild) {
  // Re-applies leftover mutes after a restart (Render can restart the
  // process at any time) so a muted user isn't stuck muted forever, and
  // isn't silently un-muted early either.
  const state = loadMuteState();
  const guildMutes = state[guild.id];
  if (!guildMutes) return;
  const muteRole = guild.roles.cache.find((r) => r.name === "Muted");
  for (const [userId, expiresAt] of Object.entries(guildMutes)) {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      clearMuteRecord(guild.id, userId);
      if (muteRole) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.remove(muteRole).catch(() => {});
      }
      continue;
    }
    mutedUsers.add(userId);
    setTimeout(async () => {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && muteRole) await member.roles.remove(muteRole);
        mutedUsers.delete(userId);
        clearMuteRecord(guild.id, userId);
      } catch (_) {}
    }, remaining);
  }
}

async function setupGuild(guild) {
  await guild.members.fetch().catch(() => {});
  await ensureRoles(guild);
  await postRolePicker(guild);
  await postTicketPanel(guild);
  await reapplyMutes(guild);
}

// ─── NFT VERIFICATION ─────────────────────────────────────────────────────────
async function checkEthNFT(walletAddress) {
  try {
    const padded = walletAddress.replace("0x", "").padStart(64, "0");
    const res721 = await axios.post(
      ETH_RPC,
      {
        jsonrpc: "2.0",
        method: "eth_call",
        params: [{ to: ETH_CONTRACT, data: "0x70a08231" + padded }, "latest"],
        id: 1,
      },
      { timeout: 10000 },
    );
    if (
      res721.data?.result &&
      res721.data.result !== "0x" &&
      !res721.data.error &&
      parseInt(res721.data.result, 16) > 0
    )
      return true;

    // ERC-1155: scan recent blocks for TransferSingle TO this wallet
    const blockRes = await axios.post(
      ETH_RPC,
      { jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 0 },
      { timeout: 8000 },
    );
    const latest = parseInt(blockRes.data.result, 16);
    const transferSingleTopic =
      "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
    const paddedTo =
      "0x000000000000000000000000" +
      walletAddress.replace("0x", "").toLowerCase();

    for (
      let toBlock = latest;
      toBlock > Math.max(0, latest - 500000);
      toBlock -= 49999
    ) {
      const fromBlock = Math.max(0, toBlock - 49999);
      const logRes = await axios.post(
        ETH_RPC,
        {
          jsonrpc: "2.0",
          method: "eth_getLogs",
          params: [
            {
              address: ETH_CONTRACT,
              topics: [transferSingleTopic, null, null, paddedTo],
              fromBlock: "0x" + fromBlock.toString(16),
              toBlock: "0x" + toBlock.toString(16),
            },
          ],
          id: 2,
        },
        { timeout: 15000 },
      );
      const logs = logRes.data?.result || [];
      if (logRes.data?.error) break;
      if (logs.length > 0) {
        for (const log of logs) {
          const tokenIdHex = log.data.slice(2, 66);
          const balRes = await axios.post(
            ETH_RPC,
            {
              jsonrpc: "2.0",
              method: "eth_call",
              params: [
                { to: ETH_CONTRACT, data: "0x00fdd58e" + padded + tokenIdHex },
                "latest",
              ],
              id: 3,
            },
            { timeout: 8000 },
          );
          const bal = parseInt(balRes.data?.result || "0x0", 16);
          if (bal > 0) return true;
        }
      }
      if (fromBlock <= 0) break;
    }
    return false;
  } catch (err) {
    console.error("ETH NFT check error:", err.message);
    return false;
  }
}

async function checkSolNFT(walletAddress) {
  try {
    const res = await axios.post(
      SOL_RPC,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          walletAddress,
          { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
          { encoding: "jsonParsed" },
        ],
      },
      { timeout: 12000 },
    );
    const accounts = res.data?.result?.value || [];
    for (const acc of accounts) {
      const info = acc.account?.data?.parsed?.info;
      if (!info || parseInt(info.tokenAmount?.amount || "0") !== 1) continue;
      const mintInfo = (
        await axios.post(
          SOL_RPC,
          {
            jsonrpc: "2.0",
            id: 2,
            method: "getAccountInfo",
            params: [info.mint, { encoding: "jsonParsed" }],
          },
          { timeout: 8000 },
        )
      ).data?.result?.value?.data?.parsed?.info;
      if (!mintInfo || parseInt(mintInfo.supply || "0") !== 1) continue;
      return true;
    }
    return false;
  } catch (err) {
    console.error("SOL NFT check error:", err.message);
    return false;
  }
}

async function verifyAndGrantNFTRole(member, walletAddress) {
  const isEth = /^0x[0-9a-fA-F]{40}$/.test(walletAddress);
  const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress) && !isEth;
  if (!isEth && !isSol)
    return {
      success: false,
      reason:
        "That doesn't look like a valid Ethereum or Solana wallet address.",
    };
  const hasNFT = isEth
    ? await checkEthNFT(walletAddress)
    : await checkSolNFT(walletAddress);
  if (!hasNFT)
    return {
      success: false,
      reason:
        "No NFT or node from the required collection was found in that wallet. If you believe this is an error, please contact an admin.",
    };
  try {
    await member.roles.add(NFT_ROLE_DISCORD_ID);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      reason:
        "NFT found! But I couldn't assign the role — please contact an admin.",
    };
  }
}

// ─── AUTO-MOD ─────────────────────────────────────────────────────────────────
function isSpam(userId) {
  const now = Date.now();
  const times = (userMessageLog.get(userId) || []).filter(
    (t) => now - t < SPAM_WINDOW,
  );
  times.push(now);
  userMessageLog.set(userId, times);
  return times.length >= SPAM_THRESHOLD;
}

const LEET_MAP = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

function normalizeForFilter(content) {
  let s = content.toLowerCase();
  s = s.replace(/[013457@$]/g, (ch) => LEET_MAP[ch] || ch);
  s = s.replace(/[\s._\-*]+/g, ""); // collapse spaces/separators people insert to dodge filters
  s = s.replace(/(.)\1{2,}/g, "$1"); // collapse repeated letters (e.g. "sluuur" -> "slur")
  return s;
}

function hasBlockedWord(content) {
  const normalized = normalizeForFilter(content);
  const rawLower = content.toLowerCase();
  return BLOCKED_WORDS.some((w) => rawLower.includes(w) || normalized.includes(w));
}

function hasUnwhitelistedLink(content) {
  const links = content.match(LINK_REGEX) || [];
  return links.some((link) => !LINK_WHITELIST.some((w) => link.includes(w)));
}

async function muteUser(member, guild, reason) {
  try {
    let muteRole = guild.roles.cache.find((r) => r.name === "Muted");
    if (!muteRole) {
      muteRole = await guild.roles.create({
        name: "Muted",
        color: "#808080",
        reason: "HL Bot auto-mod mute role",
      });
      guild.channels.cache.forEach(async (ch) => {
        if (ch.isTextBased()) {
          await ch.permissionOverwrites
            .create(muteRole, { SendMessages: false })
            .catch(() => {});
        }
      });
    }
    await member.roles.add(muteRole);
    mutedUsers.add(member.id);
    const expiresAt = Date.now() + MUTE_DURATION_MS;
    recordMute(guild.id, member.id, expiresAt);
    setTimeout(
      async () => {
        try {
          await member.roles.remove(muteRole);
          mutedUsers.delete(member.id);
          clearMuteRecord(guild.id, member.id);
        } catch (_) {}
      },
      MUTE_DURATION_MS,
    );
    const log = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("🔇 Auto-Mod: Member Muted")
      .addFields(
        { name: "User", value: `${member.user.tag} (${member.id})` },
        { name: "Reason", value: reason },
      )
      .setTimestamp();
    await sendLog(guild, log);
  } catch (err) {
    console.error("Mute error:", err.message);
  }
}

// ─── AI COOLDOWN (per user, 7 seconds) ───────────────────────────────────────
const aiCooldown = new Map(); // userId -> timestamp
const AI_COOLDOWN_MS = 7000;

function isOnCooldown(userId) {
  const last = aiCooldown.get(userId);
  if (!last) return false;
  return Date.now() - last < AI_COOLDOWN_MS;
}
function setCooldown(userId) {
  aiCooldown.set(userId, Date.now());
}

// ─── MESSAGE HISTORY (context memory per guild) ───────────────────────────────
const guildMessageHistory = new Map(); // guildId -> array of {author, isStaff, content, channel, time}
const MAX_HISTORY = 60;

function addToHistory(guildId, entry) {
  if (!guildMessageHistory.has(guildId)) guildMessageHistory.set(guildId, []);
  const history = guildMessageHistory.get(guildId);
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
}

function getContextString(guildId) {
  const history = guildMessageHistory.get(guildId) || [];
  if (history.length === 0) return "No recent messages.";
  return history
    .map((h) => {
      const role = h.isStaff ? "[Admin/Mod]" : "[Member]";
      return `${role} ${h.author} in #${h.channel}: ${h.content}`;
    })
    .join("\n");
}

// ─── AI REPLY ─────────────────────────────────────────────────────────────────
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
];

async function callGemini(model, prompt) {
  const config = { maxOutputTokens: 500, temperature: 1 };
  if (model.includes("2.5")) config.thinkingConfig = { thinkingBudget: 0 };
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: config,
    },
    { timeout: 20000 },
  );
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function getAIReply(userMessage, username, guildId) {
  if (!GEMINI_API_KEY) return null;
  const context = getContextString(guildId);
  const prompt = `You are a friendly community member in the Hamileo Discord server. Reply ONLY to what is asked. Do NOT volunteer information from the server context unless the user's question is directly related to it. Keep reply to 80-100 words max. Use 1-2 emojis. Sound natural and human. Never say you are an AI or bot.

Server context (use ONLY if directly relevant to the question):
${context}

${username}: ${userMessage}
Reply:`;

  for (const model of GEMINI_MODELS) {
    try {
      console.log(`[AI] Trying model: ${model}`);
      const result = await callGemini(model, prompt);
      if (result) {
        console.log(`[AI] Success with model: ${model}`);
        return result;
      }
    } catch (err) {
      const status = err?.response?.status;
      const errMsg = err?.response?.data?.error?.message || err.message;
      console.error(
        `[AI] ${model} failed - status: ${status}, error: ${errMsg}`,
      );
      if (status === 429 || status === 503) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      if (status === 404 || status === 400) continue;
    }
  }
  return "RATE_LIMITED";
}

// ─── SHOP SYSTEM (definitions only — economy helpers are defined below) ──────
const SHOP_ITEMS = [
  { id: "vip", name: "VIP Badge", emoji: "🎖️", price: 5000, description: "তোমার নামের পাশে VIP badge" },
  { id: "colorrole", name: "Custom Color Role", emoji: "🎨", price: 3000, description: "একটা কাস্টম রঙের রোল" },
  { id: "shoutout", name: "Server Shoutout", emoji: "📢", price: 1500, description: "Announcement চ্যানেলে shoutout" },
  { id: "luckybox", name: "Lucky Box", emoji: "🎁", price: 800, description: "র‍্যান্ডম coin reward (200-2000)" },
];

// ─── SLASH COMMANDS DEFINITION ────────────────────────────────────────────────
const SLASH_COMMANDS = [
  new SlashCommandBuilder().setName("balance").setDescription("তোমার wallet ও bank balance দেখো"),
  new SlashCommandBuilder().setName("work").setDescription("কাজ করো এবং 🪙 কামাও (1 ঘণ্টা cooldown)"),
  new SlashCommandBuilder().setName("daily").setDescription("প্রতিদিনের free 🪙 200-500 নাও"),
  new SlashCommandBuilder().setName("rich").setDescription("Server-এর top 10 ধনী member দেখো"),
  new SlashCommandBuilder().setName("economy").setDescription("সব economy command এর তালিকা"),
  new SlashCommandBuilder().setName("deposit")
    .setDescription("Bank-এ coins রাখো")
    .addStringOption(o => o.setName("amount").setDescription("কত রাখবে? (number বা 'all')").setRequired(true)),
  new SlashCommandBuilder().setName("withdraw")
    .setDescription("Bank থেকে coins তুলো")
    .addStringOption(o => o.setName("amount").setDescription("কত তুলবে? (number বা 'all')").setRequired(true)),
  new SlashCommandBuilder().setName("pay")
    .setDescription("অন্য member কে coins দাও")
    .addUserOption(o => o.setName("user").setDescription("কাকে দেবে?").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("কত দেবে?").setMinValue(1).setRequired(true)),
  new SlashCommandBuilder().setName("ticket").setDescription("Support ticket খোলো"),
  new SlashCommandBuilder().setName("report").setDescription("Suspicious activity report করো"),
  new SlashCommandBuilder().setName("translate")
    .setDescription("যেকোনো ভাষায় অনুবাদ করো")
    .addStringOption(o => o.setName("language")
      .setDescription("কোন ভাষায় অনুবাদ করবে?")
      .setRequired(true)
      .addChoices(
        { name: "🇧🇩 বাংলা", value: "bn" },
        { name: "🇬🇧 English", value: "en" },
        { name: "🇸🇦 Arabic", value: "ar" },
        { name: "🇮🇳 Hindi", value: "hi" },
        { name: "🇫🇷 French", value: "fr" },
        { name: "🇪🇸 Spanish", value: "es" },
        { name: "🇩🇪 German", value: "de" },
        { name: "🇯🇵 Japanese", value: "ja" },
        { name: "🇰🇷 Korean", value: "ko" },
        { name: "🇨🇳 Chinese", value: "zh" },
        { name: "🇹🇷 Turkish", value: "tr" },
        { name: "🇷🇺 Russian", value: "ru" },
      ))
    .addStringOption(o => o.setName("text").setDescription("কী অনুবাদ করবে?").setRequired(true)),

  // ── Manual moderation commands (staff only) ──
  new SlashCommandBuilder().setName("mute")
    .setDescription("একজন member কে mute করো (staff only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("কাকে mute করবে?").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("কত মিনিট? (default 5)").setMinValue(1).setMaxValue(35000))
    .addStringOption(o => o.setName("reason").setDescription("কারণ")),
  new SlashCommandBuilder().setName("unmute")
    .setDescription("একজন member কে unmute করো (staff only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("কাকে unmute করবে?").setRequired(true)),
  new SlashCommandBuilder().setName("warn")
    .setDescription("একজন member কে warning দাও (staff only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("কাকে warn করবে?").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("কারণ").setRequired(true)),
  new SlashCommandBuilder().setName("kick")
    .setDescription("একজন member কে kick করো (staff only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("user").setDescription("কাকে kick করবে?").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("কারণ")),
  new SlashCommandBuilder().setName("ban")
    .setDescription("একজন member কে ban করো (staff only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("কাকে ban করবে?").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("কারণ")),

  // ── Shop system ──
  new SlashCommandBuilder().setName("shop").setDescription("Coin shop-এ কী কী আছে দেখো"),
  new SlashCommandBuilder().setName("buy")
    .setDescription("Shop থেকে একটা item কেনো")
    .addStringOption(o => o.setName("item")
      .setDescription("কোন item?")
      .setRequired(true)
      .addChoices(...SHOP_ITEMS.map(it => ({ name: `${it.emoji} ${it.name} — ${it.price}`, value: it.id })))),
  new SlashCommandBuilder().setName("inventory").setDescription("তোমার কেনা items দেখো"),
].map(cmd => cmd.toJSON());

// ─── ECONOMY SYSTEM ───────────────────────────────────────────────────────────
const ECONOMY_FILE = path.join(DATA_DIR, "economy.json");
// One-time migration: if an old economy.json sits next to the code (from
// before persistent storage was added) and there's nothing in DATA_DIR yet,
// copy it over so existing balances aren't lost.
const LEGACY_ECONOMY_FILE = path.join(__dirname, "economy.json");
if (!fs.existsSync(ECONOMY_FILE) && fs.existsSync(LEGACY_ECONOMY_FILE)) {
  try { fs.copyFileSync(LEGACY_ECONOMY_FILE, ECONOMY_FILE); } catch (_) {}
}
let HL_EMOJI = "HL";
const BOOST_REWARD = 1000;
const WORK_COOLDOWN = 60 * 60 * 1000;      // 1 hour
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours

const WORK_JOBS = [
  "You worked in the cafeteria and earned", "You delivered packages across town and earned",
  "You mined crypto all night and earned", "You sold NFT artwork and earned",
  "You streamed games for hours and earned", "You drove a taxi and earned",
  "You fixed computers and earned", "You worked at a coffee shop and earned",
  "You ran a food stall and earned", "You coded a website and earned",
  "You taught online classes and earned", "You farmed virtual crops and earned",
];

function loadEconomy() {
  try { return JSON.parse(fs.readFileSync(ECONOMY_FILE, "utf8")); } catch { return {}; }
}
function saveEconomy(data) {
  fs.writeFileSync(ECONOMY_FILE, JSON.stringify(data, null, 2));
}
function getUser(data, userId) {
  if (!data[userId]) data[userId] = { wallet: 0, bank: 0, lastWork: 0, lastDaily: 0, items: [], warnings: [] };
  if (!data[userId].items) data[userId].items = [];
  if (!data[userId].warnings) data[userId].warnings = [];
  return data[userId];
}

async function translateText(text, targetLang) {
  const CHUNK = 480;
  const sentences = text.match(/[^।\.!\?]+[।\.!\?]*/g) || [text];
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > CHUNK) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (!chunks.length) chunks.push(text.slice(0, CHUNK));

  const parts = [];
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=autodetect|${targetLang}`;
    const res = await axios.get(url, { timeout: 10000 });
    if (res.data?.responseStatus !== 200 && !res.data?.responseData?.translatedText)
      throw new Error("Translation API error");
    parts.push(res.data.responseData.translatedText);
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 300));
  }
  return parts.join(" ");
}

function econEmbed(title, desc, color = "#f0c419") {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
}

function formatCoins(n) { return `${HL_EMOJI} **${Number(n).toLocaleString()}**`; }

// ─── GIF MAKER ────────────────────────────────────────────────────────────────
const gifCooldown = new Map();
const GIF_COOLDOWN_MS = 30000;

async function makeAnimatedGif(imageUrl) {
  const tmpId = Date.now();
  const inputPath = `/tmp/gif_in_${tmpId}`;
  const outputPath = `/tmp/gif_out_${tmpId}.gif`;

  try {
    // Download image
    const res = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
    fs.writeFileSync(inputPath, Buffer.from(res.data));

    // Run ffmpeg: Ken Burns zoom-in then zoom-out loop
    // Uses the ffmpeg-static npm package (bundles a prebuilt ffmpeg binary)
    // so this works on Render's default Node environment without a Dockerfile
    // or apt buildpack.
    const ffmpegPath = require("ffmpeg-static");
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, [
        "-loop", "1",
        "-i", inputPath,
        "-filter_complex",
        "[0:v]scale=1920:-1:flags=lanczos,zoompan=z='if(lte(on,60),1+on*0.005,1.3-((on-60)*0.005))':d=120:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=480x480:fps=15,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse[out]",
        "-map", "[out]",
        "-t", "8",
        "-y", outputPath
      ], { timeout: 60000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return outputPath;
  } finally {
    if (fs.existsSync(inputPath)) {
      try { fs.unlinkSync(inputPath); } catch (_) {}
    }
  }
}

// ─── TICKET SYSTEM ────────────────────────────────────────────────────────────
async function createTicket(interaction, type) {
  const guild = interaction.guild;
  const user = interaction.user;
  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ flags: 64 });
    } catch {
      return;
    }
  }
  const safeUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, "");
  const existing = guild.channels.cache.find(
    (c) =>
      c.name === `ticket-${safeUsername}-${type}` ||
      c.name === `ticket-${user.id}-${type}`,
  );
  if (existing) {
    await interaction.editReply({
      content: `You already have an open ticket: ${existing}`,
    });
    return;
  }
  try {
    const ticketChannel = await guild.channels.create({
      name: `ticket-${safeUsername}-${type}`,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
    });

    const label =
      type === "support"
        ? "🎫 Support Ticket"
        : "⚠️ Suspicious Activity Report";
    const description =
      type === "support"
        ? `Hello ${user}, welcome to your support ticket!\n\nPlease describe your issue and a staff member will assist you shortly.`
        : `Hello ${user}, thank you for your report.\n\nPlease describe the suspicious activity and a staff member will review it shortly.`;

    const embed = new EmbedBuilder()
      .setColor(type === "support" ? "#5865F2" : "#ed4245")
      .setTitle(label)
      .setDescription(description)
      .setFooter({ text: "React with 🔒 or click Close Ticket to close." })
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("🔒 Close Ticket")
        .setStyle(ButtonStyle.Danger),
    );

    await ticketChannel.send({
      content: `${user}`,
      embeds: [embed],
      components: [closeRow],
    });
    await interaction.editReply({
      content: `✅ Your ticket has been created: ${ticketChannel}`,
    });

    const log = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("🎫 Ticket Opened")
      .addFields(
        { name: "User", value: `${user.tag} (${user.id})` },
        { name: "Type", value: label },
        { name: "Channel", value: ticketChannel.toString() },
      )
      .setTimestamp();
    await sendLog(guild, log);
  } catch (err) {
    console.error("Create ticket error:", err.message);
    await interaction
      .editReply({
        content:
          "Failed to create ticket. Make sure I have permission to create channels in that category.",
      })
      .catch(() => {});
  }
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
client.on("guildCreate", async (guild) => {
  console.log(`➕ Joined: ${guild.name}`);
  await setupGuild(guild);
});

client.on("guildMemberAdd", async (member) => {
  try {
    if (!member.guild.channels.cache.has(WELCOME_CHANNEL_ID)) return;
    const ch = await client.channels.fetch(WELCOME_CHANNEL_ID);
    if (!ch) return;
    await ch.send(`${member} joined **${member.guild.name}**! 👋`);
  } catch (err) {
    console.error("Welcome error:", err.message);
  }
});

client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;
  try {
    const embed = new EmbedBuilder()
      .setColor("#ff6b6b")
      .setTitle("🗑️ Message Deleted")
      .addFields(
        {
          name: "Author",
          value: `${message.author?.tag || "Unknown"} (${message.author?.id || "?"})`,
        },
        { name: "Channel", value: `${message.channel}` },
        {
          name: "Content",
          value: message.content?.substring(0, 1024) || "*No text content*",
        },
      )
      .setTimestamp();
    await sendLog(message.guild, embed);
  } catch (_) {}
});

client.on("messageUpdate", async (oldMsg, newMsg) => {
  if (!oldMsg.guild || oldMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  try {
    const embed = new EmbedBuilder()
      .setColor("#ffa500")
      .setTitle("✏️ Message Edited")
      .addFields(
        {
          name: "Author",
          value: `${oldMsg.author?.tag || "Unknown"} (${oldMsg.author?.id || "?"})`,
        },
        { name: "Channel", value: `${oldMsg.channel}` },
        {
          name: "Before",
          value: oldMsg.content?.substring(0, 512) || "*empty*",
        },
        {
          name: "After",
          value: newMsg.content?.substring(0, 512) || "*empty*",
        },
      )
      .setTimestamp();
    await sendLog(oldMsg.guild, embed);
  } catch (_) {}
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  // ── Auto Translate button in announcement channels ──
  if (message.channel.type === ChannelType.GuildAnnouncement ||
      message.channel.isThread?.() && message.channel.parent?.type === ChannelType.GuildAnnouncement) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`translate_msg_${message.id}`)
        .setLabel("Translate")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("🌐")
    );
    await message.reply({ components: [row] }).catch(() => {});
  }

  const member = message.member;
  if (!member) return;

  // ── !gif command — convert image to animated GIF ──
  if (message.content.toLowerCase().startsWith("!gif")) {
    const attachment = message.attachments.first();
    const isImage = attachment && (attachment.contentType?.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(attachment.name));
    if (!isImage) {
      await message.reply("🖼️ একটা image attach করে `!gif` লিখো — আমি animated GIF বানিয়ে দেবো!").catch(() => {});
      return;
    }
    const lastUsed = gifCooldown.get(message.author.id) || 0;
    if (Date.now() - lastUsed < GIF_COOLDOWN_MS) {
      const remaining = Math.ceil((GIF_COOLDOWN_MS - (Date.now() - lastUsed)) / 1000);
      await message.reply(`⏳ ${remaining} সেকেন্ড পরে আবার চেষ্টা করো!`).catch(() => {});
      return;
    }
    gifCooldown.set(message.author.id, Date.now());
    const statusMsg = await message.reply("⚙️ GIF বানানো হচ্ছে... একটু অপেক্ষা করো! (৫-১৫ সেকেন্ড)").catch(() => null);
    let gifPath;
    try {
      await message.channel.sendTyping();
      gifPath = await makeAnimatedGif(attachment.url);
      await message.reply({ files: [{ attachment: gifPath, name: "animated.gif" }] });
      if (statusMsg) await statusMsg.delete().catch(() => {});
    } catch (err) {
      console.error("[GIF] Error:", err.message);
      if (statusMsg) await statusMsg.edit("❌ GIF বানাতে সমস্যা হয়েছে, আবার চেষ্টা করো!").catch(() => {});
    } finally {
      if (gifPath && fs.existsSync(gifPath)) {
        try { fs.unlinkSync(gifPath); } catch (_) {}
      }
    }
    return;
  }

  // ── Economy commands ──
  const args = message.content.trim().split(/\s+/);
  const cmd = args[0].toLowerCase();

  if (["!balance", "!bal", "!wallet"].includes(cmd)) {
    const eco = loadEconomy();
    const u = getUser(eco, message.author.id);
    const embed = econEmbed(
      `💰 ${message.author.username}'s Balance`,
      `👛 **Wallet:** ${formatCoins(u.wallet)}\n🏦 **Bank:** ${formatCoins(u.bank)}\n📊 **Total:** ${formatCoins(u.wallet + u.bank)}`
    ).setThumbnail(message.author.displayAvatarURL());
    await message.reply({ embeds: [embed] }); return;
  }

  if (cmd === "!work") {
    const eco = loadEconomy();
    const u = getUser(eco, message.author.id);
    const now = Date.now();
    const diff = now - (u.lastWork || 0);
    if (diff < WORK_COOLDOWN) {
      const left = Math.ceil((WORK_COOLDOWN - diff) / 60000);
      await message.reply({ embeds: [econEmbed("⏳ Too Soon!", `আরো **${left} মিনিট** পরে কাজ করতে পারবে!`, "#ff6b6b")] }); return;
    }
    const earned = Math.floor(Math.random() * 46) + 5;
    const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
    u.wallet += earned; u.lastWork = now;
    saveEconomy(eco);
    await message.reply({ embeds: [econEmbed("💼 Work Complete!", `${job} ${formatCoins(earned)}!\n\n👛 Wallet: ${formatCoins(u.wallet)}`, "#00c851")] }); return;
  }

  if (cmd === "!daily") {
    const eco = loadEconomy();
    const u = getUser(eco, message.author.id);
    const now = Date.now();
    const diff = now - (u.lastDaily || 0);
    if (diff < DAILY_COOLDOWN) {
      const left = Math.ceil((DAILY_COOLDOWN - diff) / 3600000);
      await message.reply({ embeds: [econEmbed("⏳ Already Claimed!", `**${left} ঘণ্টা** পরে আবার daily নাও!`, "#ff6b6b")] }); return;
    }
    const reward = Math.floor(Math.random() * 301) + 200;
    u.wallet += reward; u.lastDaily = now;
    saveEconomy(eco);
    await message.reply({ embeds: [econEmbed("🎁 Daily Reward!", `তুমি ${formatCoins(reward)} পেয়েছো!\n\n👛 Wallet: ${formatCoins(u.wallet)}`, "#5865F2")] }); return;
  }

  if (cmd === "!deposit" || cmd === "!dep") {
    const eco = loadEconomy();
    const u = getUser(eco, message.author.id);
    const amt = args[1]?.toLowerCase() === "all" ? u.wallet : parseInt(args[1]);
    if (!amt || isNaN(amt) || amt <= 0) { await message.reply({ embeds: [econEmbed("❌ Error", "`!deposit <amount>` বা `!deposit all`", "#ff6b6b")] }); return; }
    if (amt > u.wallet) { await message.reply({ embeds: [econEmbed("❌ Insufficient!", `Wallet-এ শুধু ${formatCoins(u.wallet)} আছে!`, "#ff6b6b")] }); return; }
    u.wallet -= amt; u.bank += amt;
    saveEconomy(eco);
    await message.reply({ embeds: [econEmbed("🏦 Deposited!", `✅ ${formatCoins(amt)} bank-এ রাখা হলো!\n\n👛 Wallet: ${formatCoins(u.wallet)} | 🏦 Bank: ${formatCoins(u.bank)}`)] }); return;
  }

  if (cmd === "!withdraw" || cmd === "!with") {
    const eco = loadEconomy();
    const u = getUser(eco, message.author.id);
    const amt = args[1]?.toLowerCase() === "all" ? u.bank : parseInt(args[1]);
    if (!amt || isNaN(amt) || amt <= 0) { await message.reply({ embeds: [econEmbed("❌ Error", "`!withdraw <amount>` বা `!withdraw all`", "#ff6b6b")] }); return; }
    if (amt > u.bank) { await message.reply({ embeds: [econEmbed("❌ Insufficient!", `Bank-এ শুধু ${formatCoins(u.bank)} আছে!`, "#ff6b6b")] }); return; }
    u.bank -= amt; u.wallet += amt;
    saveEconomy(eco);
    await message.reply({ embeds: [econEmbed("💸 Withdrawn!", `✅ ${formatCoins(amt)} wallet-এ আনা হলো!\n\n👛 Wallet: ${formatCoins(u.wallet)} | 🏦 Bank: ${formatCoins(u.bank)}`)] }); return;
  }

  if (cmd === "!pay" || cmd === "!give") {
    const target = message.mentions.users.first();
    const amt = parseInt(args[2]);
    if (!target || !amt || isNaN(amt) || amt <= 0) { await message.reply({ embeds: [econEmbed("❌ Error", "`!pay @user <amount>`", "#ff6b6b")] }); return; }
    if (target.id === message.author.id) { await message.reply({ embeds: [econEmbed("❌ Error", "নিজেকে coins দেওয়া যাবে না!", "#ff6b6b")] }); return; }
    const eco = loadEconomy();
    const sender = getUser(eco, message.author.id);
    const receiver = getUser(eco, target.id);
    if (amt > sender.wallet) { await message.reply({ embeds: [econEmbed("❌ Insufficient!", `Wallet-এ শুধু ${formatCoins(sender.wallet)} আছে!`, "#ff6b6b")] }); return; }
    sender.wallet -= amt; receiver.wallet += amt;
    saveEconomy(eco);
    await message.reply({ embeds: [econEmbed("💸 Payment Sent!", `✅ ${formatCoins(amt)} → **${target.username}**\n\n👛 তোমার Wallet: ${formatCoins(sender.wallet)}`, "#00c851")] }); return;
  }

  if (["!rich", "!leaderboard", "!lb", "!top"].includes(cmd)) {
    const eco = loadEconomy();
    const sorted = Object.entries(eco)
      .map(([id, d]) => ({ id, total: (d.wallet || 0) + (d.bank || 0) }))
      .sort((a, b) => b.total - a.total).slice(0, 10);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = sorted.map((e, i) => {
      const user = client.users.cache.get(e.id);
      const name = user ? user.username : `User ${e.id.slice(-4)}`;
      return `${medals[i] || `**${i + 1}.**`} **${name}** — ${formatCoins(e.total)}`;
    }).join("\n");
    await message.reply({ embeds: [econEmbed("🏆 Richest Members", lines || "No data yet!", "#f0c419")] }); return;
  }

  if (cmd === "!econ" || cmd === "!economy" || cmd === "!help") {
    const embed = econEmbed("📖 Economy Commands",
      `\`!balance\` — তোমার coins দেখো\n\`!work\` — কাজ করো, coins কামাও (1h cooldown)\n\`!daily\` — প্রতিদিন free coins নাও\n\`!deposit <amount/all>\` — bank-এ রাখো\n\`!withdraw <amount/all>\` — wallet-এ আনো\n\`!pay @user <amount>\` — কাউকে দাও\n\`!rich\` — top 10 ধনী member`
    );
    await message.reply({ embeds: [embed] }); return;
  }

  // ── Store message in history for context ──
  const isTicketChannel = message.channel.name?.startsWith("ticket-");
  if (!isTicketChannel && message.content?.trim().length > 0) {
    const isStaff =
      member.permissions.has(PermissionFlagsBits.ManageMessages) ||
      member.permissions.has(PermissionFlagsBits.Administrator);
    addToHistory(message.guild.id, {
      author: message.author.username,
      isStaff,
      content: message.content.substring(0, 300),
      channel: message.channel.name,
    });
  }

  // ── AI reply when bot is mentioned ──
  if (message.mentions.has(client.user.id)) {
    const text = message.content.replace(/<@!?[0-9]+>/g, "").trim();
    if (text.length > 0) {
      if (isOnCooldown(message.author.id)) {
        await message
          .reply("⏳ একটু অপেক্ষা করো, আবার জিজ্ঞেস করো!")
          .catch(() => {});
        return;
      }
      await message.channel.sendTyping();
      const reply = await getAIReply(
        text,
        message.author.username,
        message.guild.id,
      );
      if (reply === "RATE_LIMITED") {
        await message.reply("⏳ একটু পরে আবার চেষ্টা করো!");
      } else if (reply) {
        setCooldown(message.author.id);
        await message.reply(reply);
      } else {
        await message.reply("😅 একটু সমস্যা হচ্ছে, একটু পরে আবার চেষ্টা করো!");
      }
      return;
    }
  }

  // ── @everyone / @here block for non-staff ──
  const isStaffMember =
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.Administrator);

  if (!isStaffMember && (message.mentions.everyone || /@everyone|@here/.test(message.content))) {
    await message.delete().catch(() => {});
    await message.channel
      .send({ content: `${message.author} ⚠️ শুধুমাত্র Admin/Mod @everyone বা @here ব্যবহার করতে পারবে!` })
      .catch(() => {});
    const warnCount = (memberWarnCount.get(message.author.id) || 0) + 1;
    memberWarnCount.set(message.author.id, warnCount);
    const alert = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("🚨 @everyone Mention Blocked")
      .addFields(
        { name: "User", value: `${message.author.tag} (${message.author.id})` },
        { name: "Channel", value: `${message.channel}` },
        { name: "Message", value: message.content.substring(0, 500) },
        { name: "Total Warnings", value: `${warnCount}` },
      )
      .setTimestamp();
    await sendLog(message.guild, alert);
    return;
  }

  if (isStaffMember) return;

  // Blocked words
  if (hasBlockedWord(message.content)) {
    await message.delete().catch(() => {});
    await message.channel
      .send({
        content: `${message.author} ❌ Your message was removed for containing prohibited language.`,
      })
      .catch(() => {});
    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle("🤬 Auto-Mod: Blocked Word")
      .addFields(
        { name: "User", value: `${message.author.tag} (${message.author.id})` },
        { name: "Channel", value: `${message.channel}` },
        { name: "Content", value: message.content.substring(0, 500) },
      )
      .setTimestamp();
    await sendLog(message.guild, embed);
    return;
  }

  // Unwhitelisted links
  if (hasUnwhitelistedLink(message.content)) {
    await message.delete().catch(() => {});
    await message.channel
      .send({
        content: `${message.author} ❌ Links from that domain are not allowed here.`,
      })
      .catch(() => {});
    const embed = new EmbedBuilder()
      .setColor("#ff8800")
      .setTitle("🔗 Auto-Mod: Link Blocked")
      .addFields(
        { name: "User", value: `${message.author.tag} (${message.author.id})` },
        { name: "Channel", value: `${message.channel}` },
        { name: "Content", value: message.content.substring(0, 500) },
      )
      .setTimestamp();
    await sendLog(message.guild, embed);
    return;
  }

  // Spam detection
  if (isSpam(message.author.id)) {
    await message.delete().catch(() => {});
    if (!mutedUsers.has(message.author.id)) {
      if (warnedUsers.has(message.author.id)) {
        await muteUser(member, message.guild, "Repeated spam detected");
        await message.channel
          .send({
            content: `${message.author} 🔇 You have been muted for 5 minutes due to spamming.`,
          })
          .catch(() => {});
      } else {
        warnedUsers.add(message.author.id);
        setTimeout(() => warnedUsers.delete(message.author.id), 60000);
        await message.channel
          .send({
            content: `${message.author} ⚠️ Please slow down — this is your warning. Further spamming will result in a mute.`,
          })
          .catch(() => {});
      }
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  // ── SLASH COMMANDS ──
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    const ephemeralCmds = ["translate", "ticket", "report", "mute", "unmute", "warn", "kick", "ban", "buy", "inventory"];

    await interaction.deferReply(ephemeralCmds.includes(commandName) ? { flags: 64 } : {}).catch(() => {});

    const eco = loadEconomy();
    const u = getUser(eco, interaction.user.id);
    const now = Date.now();
    const c = (n) => `**HL ${Number(n).toLocaleString()}**`;

    if (commandName === "balance") {
      await interaction.editReply(
        `**${interaction.user.username}**'s balance\n` +
        `👛 Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}**\n` +
        `🏦 Bank:   ${HL_EMOJI} **${u.bank.toLocaleString()}**\n` +
        `📊 Net Worth: ${HL_EMOJI} **${(u.wallet + u.bank).toLocaleString()}**`
      ); return;
    }

    if (commandName === "work") {
      const diff = now - (u.lastWork || 0);
      if (diff < WORK_COOLDOWN) {
        const left = Math.ceil((WORK_COOLDOWN - diff) / 60000);
        await interaction.editReply(`⏳ You already worked! Come back in **${left} minute(s)**.`); return;
      }
      const earned = Math.floor(Math.random() * 46) + 5;
      const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];
      u.wallet += earned; u.lastWork = now; saveEconomy(eco);
      await interaction.editReply(`${job} ${HL_EMOJI} **${earned}**\n\n👛 Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}**`); return;
    }

    if (commandName === "daily") {
      const diff = now - (u.lastDaily || 0);
      if (diff < DAILY_COOLDOWN) {
        const left = Math.ceil((DAILY_COOLDOWN - diff) / 3600000);
        await interaction.editReply(`⏳ You already claimed your daily! Come back in **${left} hour(s)**.`); return;
      }
      const reward = Math.floor(Math.random() * 301) + 200;
      u.wallet += reward; u.lastDaily = now; saveEconomy(eco);
      await interaction.editReply(`🎁 You claimed your daily reward of ${HL_EMOJI} **${reward}**!\n\n👛 Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}**`); return;
    }

    if (commandName === "deposit") {
      const raw = interaction.options.getString("amount");
      const amt = raw?.toLowerCase() === "all" ? u.wallet : parseInt(raw);
      if (!amt || isNaN(amt) || amt <= 0) { await interaction.editReply(`❌ Please enter a valid amount or \`all\`.`); return; }
      if (amt > u.wallet) { await interaction.editReply(`❌ You only have ${HL_EMOJI} **${u.wallet.toLocaleString()}** in your wallet.`); return; }
      u.wallet -= amt; u.bank += amt; saveEconomy(eco);
      await interaction.editReply(`🏦 Deposited ${HL_EMOJI} **${amt.toLocaleString()}** into your bank.\n\n👛 Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}** | 🏦 Bank: ${HL_EMOJI} **${u.bank.toLocaleString()}**`); return;
    }

    if (commandName === "withdraw") {
      const raw = interaction.options.getString("amount");
      const amt = raw?.toLowerCase() === "all" ? u.bank : parseInt(raw);
      if (!amt || isNaN(amt) || amt <= 0) { await interaction.editReply(`❌ Please enter a valid amount or \`all\`.`); return; }
      if (amt > u.bank) { await interaction.editReply(`❌ You only have ${HL_EMOJI} **${u.bank.toLocaleString()}** in your bank.`); return; }
      u.bank -= amt; u.wallet += amt; saveEconomy(eco);
      await interaction.editReply(`💸 Withdrew ${HL_EMOJI} **${amt.toLocaleString()}** from your bank.\n\n👛 Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}** | 🏦 Bank: ${HL_EMOJI} **${u.bank.toLocaleString()}**`); return;
    }

    if (commandName === "pay") {
      const target = interaction.options.getUser("user");
      const amt = interaction.options.getInteger("amount");
      if (target.id === interaction.user.id) { await interaction.editReply(`❌ You cannot pay yourself.`); return; }
      if (target.bot) { await interaction.editReply(`❌ You cannot pay a bot.`); return; }
      if (amt > u.wallet) { await interaction.editReply(`❌ You only have ${HL_EMOJI} **${u.wallet.toLocaleString()}** in your wallet.`); return; }
      const receiver = getUser(eco, target.id);
      u.wallet -= amt; receiver.wallet += amt; saveEconomy(eco);
      await interaction.editReply(`✅ You paid **${target.username}** ${HL_EMOJI} **${amt.toLocaleString()}**.\n\n👛 Your Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}**`); return;
    }

    if (commandName === "rich") {
      const allEco = loadEconomy();
      const sorted = Object.entries(allEco)
        .map(([id, d]) => ({ id, total: (d.wallet || 0) + (d.bank || 0) }))
        .sort((a, b) => b.total - a.total).slice(0, 10);
      const medals = ["🥇", "🥈", "🥉"];
      const lines = sorted.map((e, i) => {
        const usr = client.users.cache.get(e.id);
        const name = usr ? usr.username : `User ${e.id.slice(-4)}`;
        return `${medals[i] || `**${i + 1}.**`} **${name}** — ${HL_EMOJI} ${e.total.toLocaleString()}`;
      }).join("\n");
      await interaction.editReply(`🏆 **Richest Members**\n\n${lines || "No data yet!"}`); return;
    }

    if (commandName === "economy") {
      await interaction.editReply(
        `📖 **Economy Commands**\n\n` +
        `\`/balance\` — See your wallet & bank\n` +
        `\`/work\` — Work for coins (1h cooldown)\n` +
        `\`/daily\` — Claim free daily coins\n` +
        `\`/deposit <amount/all>\` — Deposit to bank\n` +
        `\`/withdraw <amount/all>\` — Withdraw from bank\n` +
        `\`/pay @user <amount>\` — Send coins to someone\n` +
        `\`/rich\` — Top 10 richest members`
      ); return;
    }

    if (commandName === "ticket") {
      await createTicket(interaction, "support"); return;
    }

    if (commandName === "report") {
      await createTicket(interaction, "report"); return;
    }

    if (commandName === "translate") {
      const targetLang = interaction.options.getString("language");
      const text = interaction.options.getString("text");
      const langNames = {
        bn: "বাংলা 🇧🇩", en: "English 🇬🇧", ar: "Arabic 🇸🇦",
        hi: "Hindi 🇮🇳", fr: "French 🇫🇷", es: "Spanish 🇪🇸",
        de: "German 🇩🇪", ja: "Japanese 🇯🇵", ko: "Korean 🇰🇷",
        zh: "Chinese 🇨🇳", tr: "Turkish 🇹🇷", ru: "Russian 🇷🇺",
      };
      try {
        const translated = await translateText(text, targetLang);
        const preview = text.length > 300 ? text.slice(0, 300) + "…" : text;
        const result = translated.length > 1500 ? translated.slice(0, 1500) + "…" : translated;
        await interaction.editReply(
          `🌐 **Translation → ${langNames[targetLang] || targetLang}**\n\n` +
          `📝 **Original:**\n${preview}\n\n` +
          `✅ **Translated:**\n${result}`
        );
      } catch (err) {
        await interaction.editReply(`❌ অনুবাদ করা যায়নি। আবার চেষ্টা করো।`);
      }
      return;
    }

    // ── Manual moderation ──
    if (commandName === "mute") {
      const target = interaction.options.getUser("user");
      const minutes = interaction.options.getInteger("minutes") || 5;
      const reason = interaction.options.getString("reason") || "No reason given";
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!targetMember) { await interaction.editReply("❌ Member খুঁজে পাওয়া যায়নি।"); return; }
      try {
        let muteRole = interaction.guild.roles.cache.find((r) => r.name === "Muted");
        if (!muteRole) {
          muteRole = await interaction.guild.roles.create({ name: "Muted", color: "#808080", reason: "Manual mute setup" });
          interaction.guild.channels.cache.forEach(async (ch) => {
            if (ch.isTextBased()) await ch.permissionOverwrites.create(muteRole, { SendMessages: false }).catch(() => {});
          });
        }
        await targetMember.roles.add(muteRole);
        mutedUsers.add(target.id);
        const expiresAt = Date.now() + minutes * 60 * 1000;
        recordMute(interaction.guild.id, target.id, expiresAt);
        setTimeout(async () => {
          try {
            await targetMember.roles.remove(muteRole);
            mutedUsers.delete(target.id);
            clearMuteRecord(interaction.guild.id, target.id);
          } catch (_) {}
        }, minutes * 60 * 1000);
        await interaction.editReply(`🔇 **${target.username}** কে **${minutes} মিনিট**-এর জন্য mute করা হলো।\nকারণ: ${reason}`);
        await sendLog(interaction.guild, new EmbedBuilder().setColor("#ff0000").setTitle("🔇 Manual Mute")
          .addFields(
            { name: "User", value: `${target.tag} (${target.id})` },
            { name: "By", value: `${interaction.user.tag}` },
            { name: "Duration", value: `${minutes} min` },
            { name: "Reason", value: reason },
          ).setTimestamp());
      } catch (err) {
        await interaction.editReply("❌ Mute করা যায়নি। Bot-এর Manage Roles permission আছে কিনা দেখো।");
      }
      return;
    }

    if (commandName === "unmute") {
      const target = interaction.options.getUser("user");
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      const muteRole = interaction.guild.roles.cache.find((r) => r.name === "Muted");
      if (targetMember && muteRole) await targetMember.roles.remove(muteRole).catch(() => {});
      mutedUsers.delete(target.id);
      clearMuteRecord(interaction.guild.id, target.id);
      await interaction.editReply(`🔊 **${target.username}** কে unmute করা হলো।`);
      return;
    }

    if (commandName === "warn") {
      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");
      const targetEco = getUser(eco, target.id);
      targetEco.warnings.push({ reason, by: interaction.user.id, time: now });
      saveEconomy(eco);
      await interaction.editReply(`⚠️ **${target.username}** কে warn করা হলো (মোট warnings: ${targetEco.warnings.length})।\nকারণ: ${reason}`);
      await sendLog(interaction.guild, new EmbedBuilder().setColor("#ffa500").setTitle("⚠️ Manual Warning")
        .addFields(
          { name: "User", value: `${target.tag} (${target.id})` },
          { name: "By", value: `${interaction.user.tag}` },
          { name: "Reason", value: reason },
          { name: "Total warnings", value: `${targetEco.warnings.length}` },
        ).setTimestamp());
      return;
    }

    if (commandName === "kick") {
      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason given";
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!targetMember) { await interaction.editReply("❌ Member খুঁজে পাওয়া যায়নি।"); return; }
      try {
        await targetMember.kick(reason);
        await interaction.editReply(`👢 **${target.username}** কে kick করা হলো।\nকারণ: ${reason}`);
        await sendLog(interaction.guild, new EmbedBuilder().setColor("#ff8800").setTitle("👢 Member Kicked")
          .addFields({ name: "User", value: `${target.tag} (${target.id})` }, { name: "By", value: `${interaction.user.tag}` }, { name: "Reason", value: reason }).setTimestamp());
      } catch (err) {
        await interaction.editReply("❌ Kick করা যায়নি। Bot-এর permission ও role hierarchy চেক করো।");
      }
      return;
    }

    if (commandName === "ban") {
      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason given";
      try {
        await interaction.guild.members.ban(target.id, { reason });
        await interaction.editReply(`🔨 **${target.username}** কে ban করা হলো।\nকারণ: ${reason}`);
        await sendLog(interaction.guild, new EmbedBuilder().setColor("#8b0000").setTitle("🔨 Member Banned")
          .addFields({ name: "User", value: `${target.tag} (${target.id})` }, { name: "By", value: `${interaction.user.tag}` }, { name: "Reason", value: reason }).setTimestamp());
      } catch (err) {
        await interaction.editReply("❌ Ban করা যায়নি। Bot-এর permission ও role hierarchy চেক করো।");
      }
      return;
    }

    // ── Shop system ──
    if (commandName === "shop") {
      const lines = SHOP_ITEMS.map(it => `${it.emoji} **${it.name}** — ${HL_EMOJI} ${it.price.toLocaleString()}\n　${it.description}`).join("\n\n");
      await interaction.editReply(`🛒 **HL Shop**\n\n${lines}\n\n\`/buy\` দিয়ে কেনো।`);
      return;
    }

    if (commandName === "buy") {
      const itemId = interaction.options.getString("item");
      const item = SHOP_ITEMS.find(it => it.id === itemId);
      if (!item) { await interaction.editReply("❌ Item খুঁজে পাওয়া যায়নি।"); return; }
      if (u.wallet < item.price) { await interaction.editReply(`❌ Wallet-এ যথেষ্ট coin নেই। দরকার ${HL_EMOJI} **${item.price.toLocaleString()}**।`); return; }
      u.wallet -= item.price;
      if (item.id === "luckybox") {
        const reward = Math.floor(Math.random() * 1801) + 200;
        u.wallet += reward;
        saveEconomy(eco);
        await interaction.editReply(`🎁 Lucky Box খুললে! তুমি পেয়েছো ${HL_EMOJI} **${reward.toLocaleString()}**!\n\n👛 Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}**`);
        return;
      }
      u.items.push({ id: item.id, name: item.name, boughtAt: now });
      saveEconomy(eco);
      await interaction.editReply(`✅ কেনা হলো: ${item.emoji} **${item.name}**!\n\n👛 Wallet: ${HL_EMOJI} **${u.wallet.toLocaleString()}**\n\n_(Staff-কে জানাও, তোমাকে manually এটা দেওয়া হবে।)_`);
      return;
    }

    if (commandName === "inventory") {
      if (!u.items.length) { await interaction.editReply("🎒 তোমার inventory খালি। `/shop` দেখো!"); return; }
      const lines = u.items.map(it => `• ${it.name}`).join("\n");
      await interaction.editReply(`🎒 **${interaction.user.username}**'s Inventory\n\n${lines}`);
      return;
    }

    return;
  }

  // ── BUTTONS ──
  if (interaction.isButton()) {
    const id = interaction.customId;

    // ── Translate button (announcement channel) ──
    if (id.startsWith("translate_msg_")) {
      const msgId = id.replace("translate_msg_", "");
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`translate_select_${msgId}`)
        .setPlaceholder("Select a language")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("বাংলা").setValue("bn").setEmoji("🇧🇩"),
          new StringSelectMenuOptionBuilder().setLabel("English").setValue("en").setEmoji("🇬🇧"),
          new StringSelectMenuOptionBuilder().setLabel("Arabic").setValue("ar").setEmoji("🇸🇦"),
          new StringSelectMenuOptionBuilder().setLabel("Hindi").setValue("hi").setEmoji("🇮🇳"),
          new StringSelectMenuOptionBuilder().setLabel("French").setValue("fr").setEmoji("🇫🇷"),
          new StringSelectMenuOptionBuilder().setLabel("Portuguese").setValue("pt").setEmoji("🇵🇹"),
          new StringSelectMenuOptionBuilder().setLabel("Spanish").setValue("es").setEmoji("🇪🇸"),
          new StringSelectMenuOptionBuilder().setLabel("German").setValue("de").setEmoji("🇩🇪"),
          new StringSelectMenuOptionBuilder().setLabel("Italian").setValue("it").setEmoji("🇮🇹"),
          new StringSelectMenuOptionBuilder().setLabel("Turkish").setValue("tr").setEmoji("🇹🇷"),
          new StringSelectMenuOptionBuilder().setLabel("Filipino").setValue("tl").setEmoji("🇵🇭"),
          new StringSelectMenuOptionBuilder().setLabel("Thai").setValue("th").setEmoji("🇹🇭"),
          new StringSelectMenuOptionBuilder().setLabel("Korean").setValue("ko").setEmoji("🇰🇷"),
          new StringSelectMenuOptionBuilder().setLabel("Chinese").setValue("zh").setEmoji("🇨🇳"),
          new StringSelectMenuOptionBuilder().setLabel("Japanese").setValue("ja").setEmoji("🇯🇵"),
          new StringSelectMenuOptionBuilder().setLabel("Russian").setValue("ru").setEmoji("🇷🇺"),
        );
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({
        content: "Please select the language you would like to translate the message to:",
        components: [row],
        flags: 64,
      });
      return;
    }

    if (id === "open_ticket") {
      await createTicket(interaction, "support");
      return;
    }
    if (id === "report_suspicious") {
      await createTicket(interaction, "report");
      return;
    }

    if (id === "close_ticket") {
      const ch = interaction.channel;
      await interaction.reply({ content: "🔒 Closing ticket..." });
      const log = new EmbedBuilder()
        .setColor("#888888")
        .setTitle("🔒 Ticket Closed")
        .addFields(
          { name: "Closed by", value: `${interaction.user.tag}` },
          { name: "Channel", value: ch.name },
        )
        .setTimestamp();
      await sendLog(interaction.guild, log);
      setTimeout(() => ch.delete().catch(() => {}), 1000);
      return;
    }

    if (id === "verify_nft") {
      const modal = new ModalBuilder()
        .setCustomId("nft_verify_modal")
        .setTitle("NFT Wallet Verification");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("wallet_address")
            .setLabel("Your Ethereum or Solana wallet address")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("0x... or Solana address")
            .setRequired(true)
            .setMinLength(32)
            .setMaxLength(100),
        ),
      );
      await interaction.showModal(modal);
      return;
    }

    if (id.startsWith("role_")) {
      const key = id.replace("role_", "");
      const guildId = interaction.guildId;
      if (!guildRoleMap[guildId]) await ensureRoles(interaction.guild);
      const roleId = guildRoleMap[guildId]?.[key];
      if (!roleId) {
        await interaction.reply({ content: "Role not found.", flags: 64 });
        return;
      }
      try {
        const member = interaction.member;
        const def = ROLE_DEFINITIONS.find((d) => d.id === key);
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
          await interaction.reply({
            content: `${def.emoji} Removed **${def.label}**.`,
            flags: 64,
          });
        } else {
          await member.roles.add(roleId);
          await interaction.reply({
            content: `${def.emoji} You now have **${def.label}**!`,
            flags: 64,
          });
        }
      } catch (err) {
        await interaction
          .reply({
            content:
              "Error assigning role. Make sure I have Manage Roles permission.",
            flags: 64,
          })
          .catch(() => {});
      }
      return;
    }
  }

  // ── SELECT MENUS ──
  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId;

    if (id.startsWith("translate_select_")) {
      await interaction.deferReply({ flags: 64 }).catch(() => {});
      const msgId = id.replace("translate_select_", "");
      const targetLang = interaction.values[0];
      const langNames = {
        bn: "বাংলা 🇧🇩", en: "English 🇬🇧", ar: "Arabic 🇸🇦",
        hi: "Hindi 🇮🇳", fr: "French 🇫🇷", pt: "Portuguese 🇵🇹",
        es: "Spanish 🇪🇸", de: "German 🇩🇪", it: "Italian 🇮🇹",
        tr: "Turkish 🇹🇷", tl: "Filipino 🇵🇭", th: "Thai 🇹🇭",
        ko: "Korean 🇰🇷", zh: "Chinese 🇨🇳", ja: "Japanese 🇯🇵",
        ru: "Russian 🇷🇺",
      };
      const originalMsg = await interaction.channel.messages.fetch(msgId).catch(() => null);
      const text = originalMsg?.content || "";
      if (!text.trim()) {
        await interaction.editReply("❌ এই message-এ অনুবাদ করার মতো কোনো text নেই।"); return;
      }
      try {
        const translated = await translateText(text, targetLang);
        const result = translated.length > 1900 ? translated.slice(0, 1900) + "…" : translated;
        await interaction.editReply(
          `🌐 **${langNames[targetLang] || targetLang}:**\n\n${result}`
        );
      } catch {
        await interaction.editReply("❌ অনুবাদ করা যায়নি। আবার চেষ্টা করো।");
      }
      return;
    }
  }

  // ── MODALS ──
  if (
    interaction.isModalSubmit() &&
    interaction.customId === "nft_verify_modal"
  ) {
    await interaction.deferReply({ flags: 64 });
    const wallet = interaction.fields
      .getTextInputValue("wallet_address")
      .trim();
    const member = interaction.member;
    if (member.roles.cache.has(NFT_ROLE_DISCORD_ID)) {
      await interaction.editReply({
        content: "✅ You already have the **NFT Owner** role!",
      });
      return;
    }
    await interaction.editReply({
      content: "🔍 Checking your wallet on-chain, please wait...",
    });
    const result = await verifyAndGrantNFTRole(member, wallet);
    if (result.success) {
      await interaction.editReply({
        content: "🎉 Verified! You've been granted the **NFT Owner** role.",
      });
    } else {
      await interaction.editReply({ content: `❌ ${result.reason}` });
    }
    return;
  }
});

// ─── TWITTER / IFTTT WEBHOOK ──────────────────────────────────────────────────
let postedTweetUrls = new Set();

async function postTweetToDiscord(text, tweetUrl, author) {
  try {
    if (postedTweetUrls.has(tweetUrl)) return false;
    const channel = await client.channels.fetch(TWITTER_CHANNEL_ID);
    if (!channel) return false;
    const displayAuthor = author || TWITTER_USERNAME;
    const embed = new EmbedBuilder()
      .setColor("#1DA1F2")
      .setAuthor({
        name: `@${displayAuthor}`,
        url: `https://x.com/${displayAuthor}`,
      })
      .setDescription(text)
      .setURL(tweetUrl)
      .setFooter({ text: "Twitter / X" })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    postedTweetUrls.add(tweetUrl);
    if (postedTweetUrls.size > 500)
      postedTweetUrls.delete([...postedTweetUrls][0]);
    return true;
  } catch (err) {
    console.error("Tweet post error:", err.message);
    return false;
  }
}

// ─── TOWN STAR NFT TRACKER ────────────────────────────────────────────────────
let lastTownStarSaleTime = Math.floor(Date.now() / 1000);
let lastTownStarListingTime = Math.floor(Date.now() / 1000);

async function pollTownStarNFT() {
  try {
    const channel = await client.channels.fetch(TOWNSTAR_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const headers = OPENSEA_API_KEY ? { "X-API-KEY": OPENSEA_API_KEY } : {};

    // ── Fetch recent SALES ──
    const salesRes = await axios.get(
      "https://api.reservoir.tools/sales/v5?collection=town-star&limit=5&sortBy=time",
      { headers: { "x-api-key": "demo-api-key" }, timeout: 10000 }
    ).catch(() => null);

    if (salesRes?.data?.sales) {
      for (const sale of salesRes.data.sales.reverse()) {
        const saleTime = new Date(sale.timestamp).getTime() / 1000;
        if (saleTime <= lastTownStarSaleTime) continue;
        lastTownStarSaleTime = saleTime;

        const token = sale.token || {};
        const price = sale.price?.amount?.decimal || "?";
        const currency = sale.price?.currency?.symbol || "ETH";
        const image = token.image || null;
        const name = token.name || `Token #${token.tokenId}`;
        const tokenId = token.tokenId || "?";
        const seller = sale.from || "Unknown";
        const buyer = sale.to || "Unknown";
        const marketplace = sale.orderSource || "OpenSea";

        const embed = new EmbedBuilder()
          .setColor("#00c851")
          .setTitle(`✅ Town Star NFT Sold!`)
          .setDescription(`**[${name}](https://opensea.io/assets/ethereum/${token.contract}/${tokenId})**`)
          .addFields(
            { name: "💰 Price", value: `${price} ${currency}`, inline: true },
            { name: "🏪 Marketplace", value: marketplace, inline: true },
            { name: "📦 Token ID", value: `#${tokenId}`, inline: true },
            { name: "📤 Seller", value: `\`${seller.substring(0, 10)}...\``, inline: true },
            { name: "📥 Buyer", value: `\`${buyer.substring(0, 10)}...\``, inline: true },
            { name: "🔗 Contract", value: `\`${token.contract || "N/A"}\``, inline: false },
          )
          .setTimestamp(new Date(sale.timestamp));
        if (image) embed.setThumbnail(image);
        await channel.send({ embeds: [embed] }).catch(() => {});
      }
    }

    // ── Fetch recent LISTINGS ──
    const listRes = await axios.get(
      "https://api.reservoir.tools/orders/asks/v5?collection=town-star&status=active&sortBy=createdAt&limit=5",
      { headers: { "x-api-key": "demo-api-key" }, timeout: 10000 }
    ).catch(() => null);

    if (listRes?.data?.orders) {
      for (const order of listRes.data.orders.reverse()) {
        const createdAt = new Date(order.createdAt).getTime() / 1000;
        if (createdAt <= lastTownStarListingTime) continue;
        lastTownStarListingTime = createdAt;

        const token = order.criteria?.data?.token || {};
        const price = order.price?.amount?.decimal || "?";
        const currency = order.price?.currency?.symbol || "ETH";
        const image = token.image || null;
        const name = token.name || `Token #${token.tokenId}`;
        const tokenId = token.tokenId || "?";
        const contract = order.contract || token.contract || "";
        const source = order.source?.name || "OpenSea";

        const embed = new EmbedBuilder()
          .setColor("#1DA1F2")
          .setTitle(`🏷️ Town Star NFT Listed!`)
          .setDescription(`**[${name}](https://opensea.io/assets/ethereum/${contract}/${tokenId})**`)
          .addFields(
            { name: "💰 List Price", value: `${price} ${currency}`, inline: true },
            { name: "🏪 Marketplace", value: source, inline: true },
            { name: "📦 Token ID", value: `#${tokenId}`, inline: true },
            { name: "🔗 Contract", value: `\`${contract || "N/A"}\``, inline: false },
          )
          .setTimestamp(new Date(order.createdAt));
        if (image) embed.setThumbnail(image);
        await channel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[TownStar] Poll error:", err.message);
  }
}

// ─── WEBHOOK RATE LIMITING ──────────────────────────────────────────────────
// Basic per-IP rate limit so the public /webhook endpoint can't be hammered
// or used to spam the Discord channel, even with a leaked/guessed secret.
const webhookHits = new Map(); // ip -> [timestamps]
const WEBHOOK_RATE_LIMIT = 10; // max requests
const WEBHOOK_RATE_WINDOW_MS = 60 * 1000; // per 1 minute

function isRateLimited(ip) {
  const now = Date.now();
  const hits = (webhookHits.get(ip) || []).filter((t) => now - t < WEBHOOK_RATE_WINDOW_MS);
  hits.push(now);
  webhookHits.set(ip, hits);
  return hits.length > WEBHOOK_RATE_LIMIT;
}

// ─── MEMORY LEAK CLEANUP ──────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [userId, times] of userMessageLog.entries()) {
    const valid = times.filter((t) => now - t < SPAM_WINDOW);
    if (valid.length === 0) userMessageLog.delete(userId);
    else userMessageLog.set(userId, valid);
  }
  for (const [ip, hits] of webhookHits.entries()) {
    const valid = hits.filter((t) => now - t < WEBHOOK_RATE_WINDOW_MS);
    if (valid.length === 0) webhookHits.delete(ip);
    else webhookHits.set(ip, valid);
  }
  for (const [userId, last] of aiCooldown.entries()) {
    if (now - last >= AI_COOLDOWN_MS) aiCooldown.delete(userId);
  }
}, 60 * 1000);

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (
    req.method === "GET" &&
    (req.url === "/" || req.url === "" || !req.url.startsWith("/webhook"))
  ) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>HL Bot</title><style>body{background:#23272a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column}h1{font-size:2rem;margin-bottom:8px}p{color:#aaa}</style></head><body><h1>🤖 HL Bot is Online</h1><p>Discord bot is running and active.</p></body></html>`,
    );
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/webhook")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("HL Bot webhook is active and ready.");
    return;
  }
  if (req.method === "POST" && req.url.startsWith("/webhook")) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    if (isRateLimited(ip)) {
      res.writeHead(429);
      res.end("Too many requests");
      return;
    }
    const secret = new URL(req.url, "http://localhost").searchParams.get(
      "secret",
    );
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c.toString();
      if (body.length > 50000) {
        req.destroy();
      }
    });
    req.on("end", async () => {
      try {
        const p = JSON.parse(body);
        const text = p.text || p.value1 || "";
        const tweetUrl = p.url || p.value2 || "";
        const author = p.author || p.value3 || TWITTER_USERNAME;
        if (!text) {
          res.writeHead(400);
          res.end("Missing tweet text");
          return;
        }
        const ok = await postTweetToDiscord(text, tweetUrl, author);
        res.writeHead(ok ? 200 : 500);
        res.end(ok ? "OK" : "Failed");
      } catch (err) {
        res.writeHead(400);
        res.end("Bad request");
      }
    });
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// ─── BOOST REWARD ─────────────────────────────────────────────────────────────
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const wasBosting = oldMember.premiumSince;
    const isBosting = newMember.premiumSince;
    if (!wasBosting && isBosting) {
      const eco = loadEconomy();
      const u = getUser(eco, newMember.id);
      u.wallet += BOOST_REWARD;
      saveEconomy(eco);
      const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (logCh) {
        const embed = new EmbedBuilder()
          .setColor("#ff73fa")
          .setTitle("🚀 Server Boost Reward!")
          .setDescription(`${newMember} server boost করেছে এবং ${formatCoins(BOOST_REWARD)} পেয়েছে!`)
          .setThumbnail(newMember.user.displayAvatarURL())
          .setTimestamp();
        await logCh.send({ embeds: [embed] });
      }
      try {
        await newMember.send({
          embeds: [new EmbedBuilder()
            .setColor("#ff73fa")
            .setTitle("🚀 Boost Reward!")
            .setDescription(`**Hamileo** server boost করার জন্য ধন্যবাদ!\nতুমি ${formatCoins(BOOST_REWARD)} পেয়েছো 🎉\n\n\`!balance\` দিয়ে দেখো!`)
            .setTimestamp()]
        });
      } catch (_) {}
    }
  } catch (err) {
    console.error("[Boost] Error:", err.message);
  }
});

// ─── HL COIN LOGO GENERATOR ───────────────────────────────────────────────────
async function createHLCoinBuffer() {
  const Jimp = require("jimp");
  const SIZE = 128;
  const img = new Jimp(SIZE, SIZE, 0x00000000);

  // Draw gold filled circle
  const cx = SIZE / 2, cy = SIZE / 2, r = SIZE / 2 - 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        const edge = dist / r;
        // Gold gradient: bright center → dark edge
        const bright = Math.round(255 - edge * 60);
        const g = Math.round(196 - edge * 40);
        const b = Math.round(25);
        img.setPixelColor(Jimp.rgbaToInt(bright, g, b, 255), x, y);
      }
    }
  }

  // Dark border ring
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r - 2 && d <= r) {
        img.setPixelColor(Jimp.rgbaToInt(120, 80, 0, 255), x, y);
      }
    }
  }

  // Print "HL" text
  const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
  img.print(font, 0, 44, { text: "HL", alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, SIZE, SIZE);

  return img.getBufferAsync(Jimp.MIME_PNG);
}

async function setupHLEmoji(guild) {
  try {
    const existing = guild.emojis.cache.find(e => e.name === "hlcoin");
    if (existing) {
      HL_EMOJI = `<:hlcoin:${existing.id}>`;
      console.log(`✅ HL coin emoji found: ${HL_EMOJI}`);
      return;
    }
    const buffer = await createHLCoinBuffer();
    const emoji = await guild.emojis.create({ attachment: buffer, name: "hlcoin" });
    HL_EMOJI = `<:hlcoin:${emoji.id}>`;
    console.log(`✅ HL coin emoji created: ${HL_EMOJI}`);
  } catch (err) {
    console.error("❌ HL emoji setup failed:", err.message);
    HL_EMOJI = "💰";
  }
}

// ─── READY ────────────────────────────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ ${client.user.tag} is online in ${client.guilds.cache.size} server(s)`);
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=1374389534838&scope=bot%20applications.commands`;
  console.log(`\n🔗 Invite link:\n${inviteUrl}\n`);
  for (const guild of client.guilds.cache.values()) await setupGuild(guild);

  // Setup HL coin emoji (first guild)
  const mainGuild = client.guilds.cache.first();
  if (mainGuild) await setupHLEmoji(mainGuild);

  // Register slash commands globally
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: SLASH_COMMANDS });
    console.log(`✅ Slash commands registered (${SLASH_COMMANDS.length} commands)`);
  } catch (err) {
    console.error("❌ Slash command registration failed:", err.message);
  }

  // Start Town Star NFT tracker — poll every 3 minutes
  console.log("🎮 Town Star NFT tracker started (polling every 3 min)");
  setInterval(pollTownStarNFT, 3 * 60 * 1000);
});

async function reportErrorToDiscord(title, message) {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;
    await sendLog(guild, new EmbedBuilder()
      .setColor("#8b0000")
      .setTitle(`🚨 ${title}`)
      .setDescription(`\`\`\`${String(message).substring(0, 1900)}\`\`\``)
      .setTimestamp());
  } catch (_) {}
}

client.on("error", (err) => {
  console.error("Discord client error:", err.message);
  reportErrorToDiscord("Discord Client Error", err.message);
});
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err?.message || err);
  reportErrorToDiscord("Unhandled Rejection", err?.message || err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err.message);
  reportErrorToDiscord("Uncaught Exception", err.message);
});

client.login(TOKEN);
