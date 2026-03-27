/**
 * @file migrate_products_lifecycle.js
 * @description Safe migration: adds lifecycle columns to products table
 *              and creates product_status_logs table.
 * Uses separate statements to handle IF NOT EXISTS workaround for MySQL < 8.
 */

import pool from './src/config/db.js';

async function safeAlter(connection, sql, label) {
  try {
    await connection.execute(sql);
    console.log(`[Migration] ✅ ${label}`);
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log(`[Migration] ⏭️  ${label} (already exists, skipping)`);
    } else {
      throw err;
    }
  }
}

async function migrate() {
  const connection = await pool.getConnection();
  console.log('[Migration] Connected to DB...');

  try {
    // 1. lifecycle_status column  
    await safeAlter(connection, `
      ALTER TABLE products 
      ADD COLUMN lifecycle_status 
        ENUM('DRAFT','PENDING','APPROVED','REJECTED') 
        NOT NULL DEFAULT 'PENDING'
    `, 'lifecycle_status column');

    // 2. rejection_reason
    await safeAlter(connection, `
      ALTER TABLE products 
      ADD COLUMN rejection_reason TEXT NULL
    `, 'rejection_reason column');

    // 3. last_reviewed_by
    await safeAlter(connection, `
      ALTER TABLE products 
      ADD COLUMN last_reviewed_by INT NULL
    `, 'last_reviewed_by column');

    // 4. last_reviewed_at
    await safeAlter(connection, `
      ALTER TABLE products 
      ADD COLUMN last_reviewed_at DATETIME NULL
    `, 'last_reviewed_at column');

    // 5. is_edited
    await safeAlter(connection, `
      ALTER TABLE products 
      ADD COLUMN is_edited BOOLEAN NOT NULL DEFAULT FALSE
    `, 'is_edited column');

    // 6. product_status_logs
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS product_status_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        old_status VARCHAR(50),
        new_status VARCHAR(50),
        changed_by INT,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_psl_product_id (product_id),
        CONSTRAINT fk_psl_product FOREIGN KEY (product_id) 
          REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    console.log('[Migration] ✅ product_status_logs table');

    // 7. product_metadata on conversations
    await safeAlter(connection, `
      ALTER TABLE conversations 
      ADD COLUMN product_metadata JSON NULL
    `, 'product_metadata on conversations');

    // 8. Backfill: set existing non-deleted products to APPROVED (backward compat)
    const [result] = await connection.execute(`
      UPDATE products 
      SET lifecycle_status = 'APPROVED' 
      WHERE lifecycle_status = 'PENDING' 
        AND deleted_at IS NULL
    `);
    console.log(`[Migration] ✅ Backfilled ${result.affectedRows} existing products → APPROVED`);

    console.log('\n[Migration] 🎉 All migrations completed successfully!');
  } catch (error) {
    console.error('[Migration] ❌ Fatal Error:', error.message);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

migrate().catch(console.error);
