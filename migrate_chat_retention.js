import pool from './src/config/db.js';

(async () => {
  try {
    console.log("Applying Phase 11 Chat Storage Retentions Migrations...");
    
    // Modify conversations
    await pool.execute(`
      ALTER TABLE conversations
      ADD COLUMN chat_status ENUM('ACTIVE', 'CLOSED', 'ARCHIVED') DEFAULT 'ACTIVE' AFTER type,
      ADD COLUMN last_activity_at DATETIME NULL AFTER updated_at
    `);
    console.log("✅ `conversations` table updated successfully with Soft Retention fields.");

    // Update existing rows
    await pool.execute(`
      UPDATE conversations SET last_activity_at = updated_at WHERE last_activity_at IS NULL
    `);
    console.log("✅ Data sync complete.");

  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    process.exit(0);
  }
})();
