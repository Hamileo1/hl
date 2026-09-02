const path = require("path");
const fs = require("fs");
const assert = require("assert");

// Use temporary test database
const TEST_DATA_DIR = path.join(__dirname, "test_data");
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DB_PATH = path.join(TEST_DATA_DIR, "test_hope.sqlite");
process.env.WEBHOOK_SECRET = "test_suite_secret_99";
process.env.DISBOARD_BUMP_XP = "30";
process.env.NODE_OPERATOR_INVITE_XP = "100";

const db = require("./src/database/db");
const xpService = require("./src/services/xpService");
const inviteService = require("./src/services/inviteService");
const nodeService = require("./src/services/nodeService");
const disboardService = require("./src/services/disboardService");
const socialService = require("./src/services/socialService");
const { createApiServer } = require("./src/api/server");
const { slashCommands, handleSlashCommand } = require("./src/bot/commands/xpCommands");

async function runTestSuite() {
  console.log("=========================================");
  console.log("🧪 Running Hope Network XP Bot Test Suite");
  console.log("=========================================\n");

  // TEST 1: Database Initialization
  console.log("1. Testing Database Initialization & Schema...");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  assert(tables.includes("users"), "Table 'users' missing");
  assert(tables.includes("xp_history"), "Table 'xp_history' missing");
  assert(tables.includes("invites"), "Table 'invites' missing");
  assert(tables.includes("node_invite_rewards"), "Table 'node_invite_rewards' missing");
  assert(tables.includes("social_events"), "Table 'social_events' missing");
  assert(tables.includes("disboard_bumps"), "Table 'disboard_bumps' missing");
  console.log("   ✅ Database tables verified successfully.\n");

  // TEST 2: XP Service Core
  console.log("2. Testing XP Service (Award, Deduct, Idempotency, Leaderboard)...");
  const userA = "user_A_100";
  const awardRes1 = xpService.awardXP(userA, 50, "Activity reward", "evt_xp_1");
  assert.strictEqual(awardRes1.success, true, "awardXP failed");
  assert.strictEqual(awardRes1.newXp, 50, "XP calculation incorrect");

  // Duplicate award test
  const awardResDup = xpService.awardXP(userA, 50, "Activity reward", "evt_xp_1");
  assert.strictEqual(awardResDup.duplicate, true, "Duplicate award check failed");
  assert.strictEqual(awardResDup.newXp, 50, "XP increased on duplicate event");

  // Deduct test
  const deductRes = xpService.deductXP(userA, 20, "Penalty");
  assert.strictEqual(deductRes.newXp, 30, "deductXP calculation incorrect");

  // Leaderboard test
  const lb = xpService.getLeaderboard(5);
  assert(lb.length > 0 && lb[0].user_id === userA, "Leaderboard sorting failed");
  console.log("   ✅ XP Service core verified successfully.\n");

  // TEST 3: Invite & Node Operator Service
  console.log("3. Testing Invite Tracking & Hope Node Operator Rewards...");
  const inviter = "inviter_user_1";
  const invitee = "node_operator_user_1";

  // Record invite relationship
  inviteService.recordInvite(invitee, inviter, "INVITE_CODE_77");
  assert.strictEqual(inviteService.getInviter(invitee), inviter, "Inviter recording failed");

  // Verify Node Operator status
  const nodeRes1 = nodeService.processNodeVerification(invitee, { status: "verified" });
  assert.strictEqual(nodeRes1.success, true, "Node verification failed");
  assert.strictEqual(nodeRes1.rewarded, true, "Node verification reward not given");
  assert.strictEqual(nodeRes1.rewardedXp, 100, "Node reward amount incorrect");

  // Verify inviter received 100 XP
  const inviterXp = xpService.getUser(inviter);
  assert.strictEqual(inviterXp.xp, 100, "Inviter XP balance incorrect");

  // Verify duplicate node reward prevention
  const nodeResDup = nodeService.processNodeVerification(invitee, { status: "re-verified" });
  assert.strictEqual(nodeResDup.alreadyRewarded, true, "Duplicate node reward allowed!");
  console.log("   ✅ Invite & Hope Node Operator rewards verified successfully.\n");

  // TEST 4: DISBOARD Bump Service
  console.log("4. Testing DISBOARD Bump Service...");
  const bumperUser = "bumper_user_88";
  const fakeDisboardMsg = {
    id: "disboard_msg_777",
    author: { id: "302050872383242240" }, // Official DISBOARD bot ID
    embeds: [{ description: `<@${bumperUser}>, Bump done! 👍` }],
  };

  const disbRes1 = disboardService.processDisboardMessage(fakeDisboardMsg);
  assert.strictEqual(disbRes1.rewarded, true, "DISBOARD bump reward failed");
  assert.strictEqual(disbRes1.rewardedXp, 30, "DISBOARD bump XP amount incorrect");

  const bumperXp = xpService.getUser(bumperUser);
  assert.strictEqual(bumperXp.xp, 30, "Bumper user XP balance incorrect");

  // Duplicate bump test
  const disbResDup = disboardService.processDisboardMessage(fakeDisboardMsg);
  assert.strictEqual(disbResDup.duplicate, true, "Duplicate DISBOARD bump allowed");
  console.log("   ✅ DISBOARD Bump Service verified successfully.\n");

  // TEST 5: Social Media Service
  console.log("5. Testing Social Media Webhook Service...");
  const socialUser = "social_user_99";
  const socialPayload = {
    eventId: "tweet_repost_001",
    platform: "twitter",
    action: "repost",
    userId: socialUser,
    details: "Shared Hope Network announcement",
  };

  const socRes1 = socialService.processSocialEvent(socialPayload);
  assert.strictEqual(socRes1.success, true, "Social event reward failed");
  assert.strictEqual(socRes1.rewardedXp, 20, "Social event XP amount incorrect");

  const socResDup = socialService.processSocialEvent(socialPayload);
  assert.strictEqual(socResDup.duplicate, true, "Duplicate social event allowed");
  console.log("   ✅ Social Media Webhook Service verified successfully.\n");

  // TEST 6: Express API Endpoints
  console.log("6. Testing API Webhook Endpoints (/api/node-verified & /api/social-event)...");
  const app = createApiServer();
  const server = app.listen(8099);
  const axios = require("axios");

  try {
    // Health check
    const health = await axios.get("http://localhost:8099/health");
    assert.strictEqual(health.data.status, "ok", "Health endpoint failed");

    // Test Unauthorized request
    try {
      await axios.post("http://localhost:8099/api/node-verified", { userId: "some_user" });
      assert.fail("Should have rejected unauthorized request");
    } catch (err) {
      assert.strictEqual(err.response.status, 401, "Expected 401 Unauthorized");
    }

    // Test Authorized Node Verified API
    const nodeApiInviter = "inviter_api_1";
    const nodeApiInvitee = "invitee_api_1";
    inviteService.recordInvite(nodeApiInvitee, nodeApiInviter, "CODE_API");

    const apiNodeRes = await axios.post("http://localhost:8099/api/node-verified", {
      userId: nodeApiInvitee,
      secret: "test_suite_secret_99",
    });
    assert.strictEqual(apiNodeRes.data.status, "success", "Node API call failed");
    assert.strictEqual(apiNodeRes.data.rewardedXp, 100, "Node API rewarded XP incorrect");

    // Test Authorized Social API
    const apiSocialRes = await axios.post("http://localhost:8099/api/social-event", {
      eventId: "yt_comment_555",
      platform: "youtube",
      action: "comment",
      userId: "yt_user_1",
      secret: "test_suite_secret_99",
    });
    assert.strictEqual(apiSocialRes.data.success, true, "Social API call failed");
    assert.strictEqual(apiSocialRes.data.rewardedXp, 10, "Social API rewarded XP incorrect");

    console.log("   ✅ API Webhook Endpoints verified successfully.\n");
  } finally {
    server.close();
  }

  // TEST 7: Slash Commands
  console.log("7. Testing Admin Slash Commands...");
  assert.strictEqual(slashCommands.length, 5, "Incorrect slash command count");
  console.log("   ✅ Slash Commands verified successfully.\n");

  console.log("=========================================");
  console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! (100%)");
  console.log("=========================================");

  // Cleanup test files
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
}

runTestSuite().catch((err) => {
  console.error("❌ TEST SUITE FAILED:", err);
  process.exit(1);
});
