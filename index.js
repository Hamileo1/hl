const config = require("./src/config");
const db = require("./src/database/db");
const { createApiServer } = require("./src/api/server");
const { createBotClient } = require("./src/bot/client");

console.log("=========================================");
console.log("🌟 Starting Hope Network XP Bot");
console.log("=========================================");

// 1. Initialize API Server
const app = createApiServer();
const server = app.listen(config.port, () => {
  console.log(`🚀 API Server running on port ${config.port}`);
  console.log(`   - Node verification endpoint: POST http://localhost:${config.port}/api/node-verified`);
  console.log(`   - Social event webhook: POST http://localhost:${config.port}/api/social-event`);
});

// 2. Initialize Discord Bot Client
let client = null;
if (config.token) {
  client = createBotClient();
  client.login(config.token).catch((err) => {
    console.error("❌ Failed to log in to Discord:", err.message);
  });
} else {
  console.warn("⚠️ DISCORD_TOKEN is not set. Bot login skipped (API server active in standalone mode).");
}

// Graceful Shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down Hope Network Bot...");
  server.close(() => {
    console.log("  - API server closed.");
  });
  if (client) client.destroy();
  if (db && db.close) db.close();
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("🚨 Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("🚨 Uncaught Exception:", err.message);
});
