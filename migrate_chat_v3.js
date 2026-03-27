import pool from './src/config/db.js';

(async () => {
  try {
    console.log("Applying Chat Architecture V3 Migrations...");

    // 1. Modify `conversations` table
    await pool.execute(`
      ALTER TABLE conversations
      MODIFY COLUMN type ENUM('INQUIRY', 'SUPPORT', 'INTERNAL', 'PRODUCT', 'RFQ', 'ADMIN_VENDOR') DEFAULT 'INQUIRY',
      ADD COLUMN admin_id INT NULL AFTER vendor_id,
      ADD COLUMN status ENUM('waiting', 'assigned', 'active', 'idle', 'closed', 'archived') DEFAULT 'active' AFTER type,
      ADD COLUMN closed_at DATETIME NULL,
      ADD COLUMN archived_at DATETIME NULL,
      ADD COLUMN expires_at DATETIME NULL
    `);
    console.log("✅ `conversations` table updated successfully.");

    // 2. Modify `messages` table
    // message type already has 'TEXT','INQUIRY','ATTACHMENT','SYSTEM','IMAGE','FILE'
    // sender_id is there. We might need a 'deleted_at' for soft deletes.
    try {
      await pool.execute(`
        ALTER TABLE messages
        ADD COLUMN deleted_at DATETIME NULL
      `);
      console.log("✅ `messages` table updated successfully.");
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') {
        console.log("⚠️ `messages` already has deleted_at column.");
      } else {
        throw e;
      }
    }

    // 3. Create `contact_messages` table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NULL,
        message TEXT NOT NULL,
        status ENUM('new', 'converted', 'closed') DEFAULT 'new',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ `contact_messages` table created successfully.");

    // 4. Create `quick_replies` table
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS quick_replies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        category VARCHAR(100) DEFAULT 'general',
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✅ `quick_replies` table created successfully.");

  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    process.exit(0);
  }
})();
