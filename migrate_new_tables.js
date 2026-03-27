import pool from './src/config/db.js';

(async () => {
  try {
    console.log("Applying Phase 12 Backend Safe Extensions (Missing Tables)...");

    // Support Tickets
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        vendor_id INT NULL,
        subject VARCHAR(255) NOT NULL,
        status ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') DEFAULT 'OPEN',
        priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') DEFAULT 'MEDIUM',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ `support_tickets` table created/verified.");

    // Chat Sessions (Architecture placeholder for future normalization)
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uuid VARCHAR(36) NOT NULL UNIQUE,
        type ENUM('DIRECT', 'GROUP', 'SUPPORT', 'ORDER', 'RFQ') DEFAULT 'DIRECT',
        status ENUM('ACTIVE', 'CLOSED', 'ARCHIVED') DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ `chat_sessions` table created/verified.");

    // Chat Participants
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS chat_participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id INT NOT NULL,
        user_id INT NOT NULL,
        role ENUM('USER', 'VENDOR', 'ADMIN', 'OWNER') DEFAULT 'USER',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_read_at DATETIME NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ `chat_participants` table created/verified.");

    // Message Attachments (Architecture placeholder for detached media)
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_id INT NOT NULL,
        file_url VARCHAR(500) NOT NULL,
        file_type VARCHAR(50) NOT NULL,
        file_size INT NOT NULL DEFAULT 0,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ `message_attachments` table created/verified.");

  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    process.exit(0);
  }
})();
