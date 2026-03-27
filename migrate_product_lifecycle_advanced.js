import pool from './src/config/db.js';

async function safeAlter(connection, sql, label, duplicateCodes = ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME']) {
  try {
    await connection.execute(sql);
    console.log(`[ProductLifecycleMigration] OK: ${label}`);
  } catch (error) {
    if (duplicateCodes.includes(error.code) || error.message.includes('Duplicate')) {
      console.log(`[ProductLifecycleMigration] Skip: ${label}`);
      return;
    }
    throw error;
  }
}

async function main() {
  const connection = await pool.getConnection();

  try {
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN status ENUM('DRAFT','PENDING','APPROVED','REJECTED','UPDATE_PENDING') DEFAULT 'PENDING' AFTER is_active`,
      'products.status'
    );
    await safeAlter(
      connection,
      `ALTER TABLE products MODIFY COLUMN status ENUM('DRAFT','PENDING','APPROVED','REJECTED','UPDATE_PENDING') DEFAULT 'PENDING'`,
      'products.status enum expansion',
      ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_BAD_FIELD_ERROR']
    );
    await safeAlter(
      connection,
      `ALTER TABLE products ADD COLUMN rejection_reason TEXT NULL AFTER status`,
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
      `ALTER TABLE products ADD COLUMN is_visible TINYINT(1) DEFAULT 0 AFTER is_edited`,
      'products.is_visible'
    );

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS product_status_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        old_status VARCHAR(50) NULL,
        new_status VARCHAR(50) NOT NULL,
        changed_by INT NULL,
        note TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_status_logs_product (product_id),
        INDEX idx_product_status_logs_changed_by (changed_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS product_view_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        viewer_id INT NULL,
        viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_product_view_logs_product (product_id),
        INDEX idx_product_view_logs_viewer (viewer_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.execute(`
      UPDATE products
      SET status = CASE
        WHEN lifecycle_status = 'APPROVED' THEN 'APPROVED'
        WHEN lifecycle_status = 'REJECTED' THEN 'REJECTED'
        WHEN lifecycle_status IS NOT NULL THEN lifecycle_status
        ELSE status
      END
      WHERE status IS NULL OR status = 'PENDING'
    `);

    await connection.execute(`
      UPDATE products
      SET is_visible = CASE
        WHEN COALESCE(status, lifecycle_status) = 'APPROVED' AND deleted_at IS NULL THEN 1
        ELSE 0
      END
      WHERE is_visible IS NULL OR is_visible NOT IN (0, 1)
    `);

    console.log('[ProductLifecycleMigration] Completed successfully.');
  } catch (error) {
    console.error('[ProductLifecycleMigration] Failed:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
