import pool from './src/config/db.js';

(async () => {
  try {
    console.log("Applying Phase 10 Chat Architecture Migrations...");

    // 1. Drop existing Foreign Keys on `conversations` to allow modifying `vendor_id` and enum additions safely if needed.
    // However, it's safer to just run ALTER TABLE commands explicitly.
    
    // Modify conversations
    await pool.execute(`
      ALTER TABLE conversations
      MODIFY COLUMN vendor_id INT NULL,
      ADD COLUMN type ENUM('INQUIRY', 'SUPPORT', 'INTERNAL') DEFAULT 'INQUIRY' AFTER vendor_id,
      ADD COLUMN related_rfq_id INT NULL AFTER product_id,
      ADD COLUMN related_order_id INT NULL AFTER related_rfq_id,
      ADD CONSTRAINT fk_conversations_rfq FOREIGN KEY (related_rfq_id) REFERENCES rfq_requests(id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_conversations_order FOREIGN KEY (related_order_id) REFERENCES orders(id) ON DELETE SET NULL
    `);
    console.log("✅ `conversations` table updated successfully.");

    // Modify messages
    await pool.execute(`
      ALTER TABLE messages
      MODIFY COLUMN type ENUM('TEXT', 'INQUIRY', 'ATTACHMENT', 'SYSTEM', 'IMAGE', 'FILE') DEFAULT 'TEXT',
      ADD COLUMN read_at DATETIME NULL AFTER is_read
    `);
    console.log("✅ `messages` table updated successfully.");

  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    process.exit(0);
  }
})();
