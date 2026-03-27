import pool from './src/config/db.js';

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    [columnName]
  );
  return rows.length > 0;
}

async function safeAlter(connection, sql, label) {
  try {
    await connection.execute(sql);
    console.log(`OK ${label}`);
  } catch (error) {
    if (
      ['ER_DUP_FIELDNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_DUP_KEYNAME'].includes(error.code) ||
      /Duplicate column name|already exists/i.test(error.message || '')
    ) {
      console.log(`SKIP ${label}`);
      return;
    }
    throw error;
  }
}

async function run() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        email VARCHAR(191) NOT NULL,
        phone VARCHAR(50) NULL,
        message TEXT NOT NULL,
        status ENUM('new','converted','closed') DEFAULT 'new',
        conversation_id INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_contact_messages_status (status),
        INDEX idx_contact_messages_created_at (created_at)
      )
    `);

    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN queue_position INT NULL AFTER status`,
      'conversations.queue_position'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN support_requested_at DATETIME NULL AFTER queue_position`,
      'conversations.support_requested_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN assigned_at DATETIME NULL AFTER support_requested_at`,
      'conversations.assigned_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN resolved_at DATETIME NULL AFTER assigned_at`,
      'conversations.resolved_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN first_response_at DATETIME NULL AFTER resolved_at`,
      'conversations.first_response_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN first_response_seconds INT NULL AFTER first_response_at`,
      'conversations.first_response_seconds'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN resolution_seconds INT NULL AFTER first_response_seconds`,
      'conversations.resolution_seconds'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN estimated_response_minutes INT NULL AFTER resolution_seconds`,
      'conversations.estimated_response_minutes'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN source VARCHAR(50) NULL AFTER estimated_response_minutes`,
      'conversations.source'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN contact_message_id INT NULL AFTER source`,
      'conversations.contact_message_id'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN retention_category VARCHAR(50) NULL AFTER contact_message_id`,
      'conversations.retention_category'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN preserve_messages TINYINT(1) DEFAULT 0 AFTER retention_category`,
      'conversations.preserve_messages'
    );

    if (await columnExists(connection, 'conversations', 'contact_message_id')) {
      try {
        await connection.execute(`
          ALTER TABLE conversations
          ADD CONSTRAINT fk_conversations_contact_message
          FOREIGN KEY (contact_message_id) REFERENCES contact_messages(id) ON DELETE SET NULL
        `);
      } catch (error) {
        if (!/Duplicate|already exists/i.test(error.message || '')) throw error;
      }
    }

    await safeAlter(
      connection,
      `ALTER TABLE messages ADD COLUMN metadata JSON NULL AFTER product_snapshot`,
      'messages.metadata'
    );

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS support_agent_rotations (
        user_id INT PRIMARY KEY,
        last_assigned_at DATETIME NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_support_agent_rotations_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS quick_replies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'general',
        title VARCHAR(191) NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_quick_replies_user (user_id),
        CONSTRAINT fk_quick_replies_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await connection.execute(`
      UPDATE conversations
      SET support_requested_at = COALESCE(support_requested_at, created_at),
          assigned_at = CASE
            WHEN admin_id IS NOT NULL THEN COALESCE(assigned_at, updated_at, created_at)
            ELSE assigned_at
          END,
          source = COALESCE(source, CASE
            WHEN type = 'SUPPORT' THEN 'support_widget'
            WHEN related_rfq_id IS NOT NULL THEN 'rfq'
            WHEN product_id IS NOT NULL THEN 'product'
            WHEN type = 'INTERNAL' THEN 'admin_vendor'
            ELSE 'chat'
          END),
          retention_category = COALESCE(retention_category, CASE
            WHEN related_rfq_id IS NOT NULL THEN 'rfq'
            WHEN related_order_id IS NOT NULL THEN 'order'
            WHEN type = 'INTERNAL' THEN 'internal'
            WHEN type = 'SUPPORT' THEN 'support'
            ELSE 'standard'
          END),
          preserve_messages = CASE
            WHEN preserve_messages = 1 THEN 1
            WHEN related_rfq_id IS NOT NULL OR related_order_id IS NOT NULL OR type = 'INTERNAL' THEN 1
            ELSE 0
          END
    `);

    await connection.execute(`
      UPDATE conversations
      SET estimated_response_minutes = CASE
        WHEN type = 'SUPPORT' AND estimated_response_minutes IS NULL THEN 5
        ELSE estimated_response_minutes
      END,
      expires_at = CASE
        WHEN preserve_messages = 1 THEN NULL
        WHEN expires_at IS NULL AND COALESCE(chat_status, 'ACTIVE') = 'ARCHIVED' THEN DATE_ADD(NOW(), INTERVAL 60 DAY)
        ELSE expires_at
      END
    `);

    await connection.commit();
    console.log('Smart Chat v3 migration completed successfully.');
  } catch (error) {
    await connection.rollback();
    console.error('Smart Chat v3 migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

run();
