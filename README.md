# Hope Network Discord Bot & Community XP System

An automated XP, Discord invite, DISBOARD bump, and social media reward Discord bot built for **Hope Network**.

---

## 1. Complete Project Structure

```
.
├── index.js                     # Main entrypoint (API server + Discord bot runner)
├── package.json                 # Package metadata and dependencies
├── .env.example                 # Example environment configuration
├── README.md                    # Project documentation & guides
└── src/
    ├── config/                  # Configuration reader from environment variables
    │   └── index.js
    ├── database/                # SQLite persistent database setup and schema
    │   ├── db.js
    │   └── schema.js
    ├── services/                # Modular domain logic services
    │   ├── xpService.js         # Central XP awarding, audit logging & leaderboard
    │   ├── inviteService.js     # Discord invite tracking & inviter resolution
    │   ├── nodeService.js       # Hope Node Operator verification & 100 XP inviter reward
    │   ├── disboardService.js   # DISBOARD bump detection & reward service
    │   └── socialService.js     # Secure webhook event validation & social XP rewards
    ├── api/                     # Express HTTP API server & webhooks
    │   └── server.js
    └── bot/                     # Discord bot client & interaction handlers
        ├── client.js
        └── commands/
            └── xpCommands.js    # Slash commands (/xp, /addxp, /removexp, /xp-history, /leaderboard)
```

---

## 2. Installation Instructions

1. **Clone repository & enter directory:**
   ```bash
   git clone <repository_url>
   cd hl-discord-bot
   ```

2. **Install node dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to include your `DISCORD_TOKEN` and `WEBHOOK_SECRET`.

4. **Start the Bot:**
   ```bash
   npm start
   ```

---

## 3. Required npm Packages

- `discord.js` (^14.x) — Discord API library.
- `better-sqlite3` (^11.x) — High-performance persistent SQLite database driver.
- `express` (^4.x) — Lightweight Web server for API endpoints and webhooks.

---

## 4. Complete `.env.example`

```env
DISCORD_TOKEN=your_discord_bot_token_here
WEBHOOK_SECRET=your_secure_webhook_secret_here
PORT=8080
DATA_DIR=./data
DISBOARD_BUMP_XP=30
NODE_OPERATOR_INVITE_XP=100
DISBOARD_BOT_ID=302050872383242240
```

---

## 5. Database Setup Instructions

The bot uses SQLite with `better-sqlite3`.
- No separate database server installation (like PostgreSQL/MySQL) is required.
- SQLite database files (`hope_network.sqlite`) are stored automatically in `DATA_DIR` (default: `./data`).
- Database WAL mode (`PRAGMA journal_mode = WAL`) is enabled for optimal concurrent reads and writes.
- Tables and indexes are auto-created at startup via `src/database/schema.js`.

---

## 6. Discord Developer Portal Setup Instructions

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) and create a New Application.
2. Under **Bot**:
   - Enable **Privileged Gateway Intents**:
     - `SERVER MEMBERS INTENT` (required to track members and invites)
     - `MESSAGE CONTENT INTENT` (required to detect DISBOARD bump responses)
3. Reset/Copy the **Bot Token** and set it as `DISCORD_TOKEN` in `.env`.
4. Go to **OAuth2 -> URL Generator**:
   - Select Scopes: `bot`, `applications.commands`
   - Select Bot Permissions: `Manage Server`, `Manage Roles`, `Send Messages`, `Read Message History`, `Use Slash Commands`.
   - Use the generated URL to invite the bot to your Hope Network Discord server.

---

## 7. How to Connect the Existing Node Verification System

The Hope Node verification system can notify this XP bot whenever a Discord member becomes a verified Hope Node Operator.

### Webhook Endpoint:
`POST /api/node-verified`

### Headers:
`Content-Type: application/json`

### Payload:
```json
{
  "userId": "123456789012345678",
  "status": "verified",
  "secret": "your_webhook_secret_here"
}
```

### Flow & Verification Rules:
1. When received, the bot checks if `123456789012345678` was invited by another Discord member (`Inviter`).
2. The bot checks `node_invite_rewards` to ensure `123456789012345678` has **not** been rewarded previously.
3. If valid, `100 XP` (`NODE_OPERATOR_INVITE_XP`) is automatically granted to `Inviter`.
4. Self-invite abuse is automatically prevented.
5. Removing and re-adding Node Operator roles will **not** grant duplicate rewards.

---

## 8. How to Configure IFTTT Webhooks

1. Create a Applet on IFTTT Pro (e.g. *If New Tweet by Hope Network -> Then Webhooks*).
2. Choose **Webhooks -> Make a web request**:
   - **URL**: `https://your-bot-domain.com/api/social-event`
   - **Method**: `POST`
   - **Content Type**: `application/json`
   - **Body**:
     ```json
     {
       "eventId": "twitter_repost_{{CreatedAt}}_{{TweetId}}",
       "platform": "twitter",
       "action": "repost",
       "userId": "DISCORD_MEMBER_ID",
       "secret": "your_webhook_secret_here"
     }
     ```

---

## 9. How to Test All Three XP Systems

Run the automated test suite:
```bash
node test_suite.js
```

### Manual Testing:
1. **DISBOARD Bump (30 XP):**
   - Execute `/bump` in a server channel where DISBOARD bot is present.
   - When DISBOARD responds with `<@your_user_id>, Bump done!`, check your balance with `/xp`.
2. **Node Operator Verification (100 XP):**
   - Send HTTP request:
     ```bash
     curl -X POST http://localhost:8080/api/node-verified \
       -H "Content-Type: application/json" \
       -d '{"userId": "YOUR_DISCORD_ID", "secret": "your_webhook_secret"}'
     ```
3. **Social Media XP:**
   - Send HTTP request:
     ```bash
     curl -X POST http://localhost:8080/api/social-event \
       -H "Content-Type: application/json" \
       -d '{"eventId": "test_evt_1", "platform": "twitter", "action": "repost", "userId": "YOUR_DISCORD_ID", "secret": "your_webhook_secret"}'
     ```

---

## 10. Limitations of DISBOARD & Social Media APIs

### DISBOARD Limitations:
- DISBOARD does not provide an official API for bumps.
- Detection relies on observing public response messages from DISBOARD Bot (`ID: 302050872383242240`).
- Fake user messages claiming bump success are strictly filtered out by enforcing that messages originate from DISBOARD's verified Bot ID.

### Social Media Limitations:
- Social platforms (X/Twitter, YouTube, Facebook, TikTok) do **not** directly map platform accounts to Discord User IDs in public webhooks without user account linking / OAuth.
- Therefore, incoming webhook payloads from integrations like IFTTT must provide the target Discord User ID (or a pre-linked handle mapping) alongside a unique `eventId` to reliably award XP and prevent duplicate claims.
