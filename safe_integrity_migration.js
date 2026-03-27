import pool from './src/config/db.js';

async function safeAlter(connection, sql, label, duplicateCodes = ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME']) {
  try {
    await connection.execute(sql);
    console.log(`[SafeMigration] OK: ${label}`);
  } catch (error) {
    if (duplicateCodes.includes(error.code) || error.message.includes('Duplicate')) {
      console.log(`[SafeMigration] Skip: ${label}`);
      return;
    }
    throw error;
  }
}

async function main() {
  const connection = await pool.getConnection();

  try {
    console.log('[SafeMigration] Ensuring missing B2B support structures...');

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS site_settings (
        setting_key VARCHAR(191) PRIMARY KEY,
        setting_value LONGTEXT NULL,
        description TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS pending_registrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        registration_role ENUM('USER', 'MOWARED') NOT NULL,
        payload_json LONGTEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_pending_registrations_role (registration_role),
        INDEX idx_pending_registrations_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN discount_price DECIMAL(10,2) NULL AFTER price`,
      'products.discount_price'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN quantity_available INT NOT NULL DEFAULT 0 AFTER min_order_quantity`,
      'products.quantity_available'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN lifecycle_status ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING' AFTER specs`,
      'products.lifecycle_status'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products MODIFY COLUMN lifecycle_status ENUM('PENDING','APPROVED','REJECTED','UPDATE_PENDING') DEFAULT 'PENDING'`,
      'products.lifecycle_status enum expansion',
      ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_PARSE_ERROR']
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN status ENUM('PENDING','APPROVED','REJECTED','UPDATE_PENDING') DEFAULT 'PENDING' AFTER lifecycle_status`,
      'products.status'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN is_visible BOOLEAN DEFAULT FALSE AFTER status`,
      'products.is_visible'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN rejection_reason TEXT NULL AFTER lifecycle_status`,
      'products.rejection_reason'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN last_reviewed_by INT NULL AFTER rejection_reason`,
      'products.last_reviewed_by'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN last_reviewed_at DATETIME NULL AFTER last_reviewed_by`,
      'products.last_reviewed_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN is_edited BOOLEAN DEFAULT FALSE AFTER last_reviewed_at`,
      'products.is_edited'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN deleted_at DATETIME NULL AFTER is_active`,
      'products.deleted_at'
    );

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS product_status_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        old_status VARCHAR(50) NULL,
        new_status VARCHAR(50) NOT NULL,
        changed_by INT NULL,
        note TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_status_logs_product (product_id),
        INDEX idx_product_status_logs_changed_by (changed_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN admin_id INT NULL AFTER vendor_id`,
      'conversations.admin_id'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN status ENUM('waiting', 'assigned', 'active', 'idle', 'closed', 'archived') DEFAULT 'active' AFTER type`,
      'conversations.status'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN chat_status ENUM('ACTIVE', 'CLOSED', 'ARCHIVED') DEFAULT 'ACTIVE' AFTER status`,
      'conversations.chat_status'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN last_activity_at DATETIME NULL AFTER updated_at`,
      'conversations.last_activity_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN closed_at DATETIME NULL`,
      'conversations.closed_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN archived_at DATETIME NULL`,
      'conversations.archived_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations ADD COLUMN expires_at DATETIME NULL`,
      'conversations.expires_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE messages ADD COLUMN deleted_at DATETIME NULL`,
      'messages.deleted_at'
    );
    await safeAlter(
      connection,
      `ALTER TABLE conversations MODIFY COLUMN type ENUM('INQUIRY','SUPPORT','INTERNAL') DEFAULT 'INQUIRY'`,
      'conversations.type normalization',
      ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_PARSE_ERROR']
    );

    await connection.execute(`
      UPDATE conversations
      SET last_activity_at = COALESCE(last_activity_at, updated_at, created_at, NOW())
      WHERE last_activity_at IS NULL
    `);

    await connection.execute(`
      UPDATE products
      SET
        quantity_available = COALESCE(quantity_available, 0),
        status = COALESCE(status, lifecycle_status, 'PENDING'),
        is_visible = COALESCE(
          is_visible,
          CASE WHEN COALESCE(status, lifecycle_status) = 'APPROVED' THEN 1 ELSE 0 END
        )
    `);

    await connection.execute(`
      CREATE OR REPLACE VIEW vendor_stats AS
      SELECT
        v.id AS vendor_id,
        v.user_id,
        v.company_name_ar,
        v.company_name_en,
        v.bio_ar,
        v.bio_en,
        v.location,
        v.verification_status,
        (v.verification_status = 'APPROVED') AS is_verified,
        IFNULL(AVG(r.rating), 0) AS avg_rating,
        COUNT(DISTINCT r.id) AS review_count,
        IFNULL(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.total_price ELSE 0 END), 0) AS total_sales,
        COUNT(DISTINCT CASE WHEN o.status = 'COMPLETED' THEN o.id END) AS total_orders,
        IFNULL(vs.response_rate, 0) AS response_rate
      FROM vendor_profiles v
      LEFT JOIN vendor_reviews r ON r.vendor_id = v.id
      LEFT JOIN orders o ON o.vendor_id = v.id
      LEFT JOIN vendor_scores vs ON vs.vendor_id = v.id
      WHERE v.deleted_at IS NULL
      GROUP BY v.id, v.user_id, v.company_name_ar, v.company_name_en, v.bio_ar, v.bio_en, v.location, v.verification_status, vs.response_rate
    `);

    console.log('[SafeMigration] Completed successfully.');
  } catch (error) {
    console.error('[SafeMigration] Failed:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
