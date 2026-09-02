const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { initSchema } = require("./schema");

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

const db = new Database(config.dbPath);

// Enable WAL mode and foreign key constraints for production performance & safety
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Initialize schema
initSchema(db);

module.exports = db;
