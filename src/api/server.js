const express = require("express");
const config = require("../config");
const { processNodeVerification } = require("../services/nodeService");
const { processSocialEvent } = require("../services/socialService");

function createApiServer() {
  const app = express();

  // Middleware: JSON parser
  app.use(express.json());

  // Middleware: Simple rate limiting map (IP -> timestamps)
  const ipHits = new Map();
  const RATE_LIMIT_MAX = 30; // max 30 requests per minute
  const RATE_LIMIT_WINDOW = 60 * 1000;

  app.use((req, res, next) => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
    const now = Date.now();
    const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW);
    hits.push(now);
    ipHits.set(ip, hits);

    if (hits.length > RATE_LIMIT_MAX) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }
    next();
  });

  // Authentication Middleware
  const authenticateSecret = (req, res, next) => {
    const authHeader = req.headers["authorization"] || "";
    const secretQuery = req.query.secret || "";
    const bodySecret = req.body.secret || "";

    const providedSecret = authHeader.replace(/^Bearer\s+/i, "") || secretQuery || bodySecret;

    if (!config.webhookSecret) {
      console.warn("[API] WEBHOOK_SECRET is not configured in env! Requests will fail for safety.");
      return res.status(500).json({ error: "Server authentication misconfigured." });
    }

    if (providedSecret !== config.webhookSecret) {
      return res.status(401).json({ error: "Unauthorized. Invalid authentication secret." });
    }

    next();
  };

  // Health check
  app.get("/health", (req, res) => {
    res.json({ status: "ok", bot: "Hope Network XP Bot API", timestamp: new Date().toISOString() });
  });

  /**
   * POST /api/node-verified
   * Hope Node verification webhook endpoint
   * Payload:
   * {
   *   "userId": "1234567890",
   *   "status": "verified",
   *   "secret": "your_webhook_secret"
   * }
   */
  app.post("/api/node-verified", authenticateSecret, (req, res) => {
    const { userId, discordUserId, status } = req.body;
    const targetUserId = userId || discordUserId;

    if (!targetUserId) {
      return res.status(400).json({ error: "Missing required field: userId or discordUserId." });
    }

    const result = processNodeVerification(targetUserId, { status, rawBody: req.body });

    if (!result.success) {
      if (result.alreadyRewarded) {
        return res.status(200).json({
          status: "already_rewarded",
          message: result.message,
          inviterId: result.inviterId,
        });
      }
      return res.status(400).json({ error: result.reason || "Failed to process node verification." });
    }

    return res.status(200).json({
      status: "success",
      rewarded: result.rewarded,
      inviterId: result.inviterId || null,
      rewardedXp: result.rewardedXp || 0,
    });
  });

  /**
   * POST /api/social-event
   * Social media event webhook endpoint (IFTTT / custom integration)
   * Payload:
   * {
   *   "eventId": "tweet_12345",
   *   "platform": "twitter",
   *   "action": "repost",
   *   "userId": "1234567890",
   *   "amount": 20,
   *   "secret": "your_webhook_secret"
   * }
   */
  app.post("/api/social-event", authenticateSecret, (req, res) => {
    const result = processSocialEvent(req.body);
    return res.status(result.status || 200).json(result);
  });

  return app;
}

module.exports = { createApiServer };
