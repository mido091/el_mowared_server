/**
 * @file migrate_lifecycle.js
 * @description Safe migration to add lifecycle columns to products,
 * create product_status_logs table, and fix the vendor_stats view.
 * Run with: node src/config/migrate_lifecycle.js
 */

import pool from './db.js';

async function migrate() {
  const connection = await pool.getConnection();
  console.log('🚀 Starting lifecycle migration...');

  const tryExec = async (label, sql) => {
    try {
      await connection.query(sql);
      console.log(`  ✅ ${label}`);
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log(`  ⏭  ${label} — already exists, skipping`);
      } else {
        console.error(`  ❌ ${label} FAILED:`, e.message);
      }
    }
  };

  // 1. Add lifecycle columns to products table
  await tryExec(
    'Add lifecycle_status to products',
    `ALTER TABLE products ADD COLUMN lifecycle_status ENUM('DRAFT','PENDING','APPROVED','REJECTED') DEFAULT 'PENDING'`
  );
  await tryExec(
    'Add rejection_reason to products',
    `ALTER TABLE products ADD COLUMN rejection_reason TEXT`
  );
  await tryExec(
    'Add last_reviewed_by to products',
    `ALTER TABLE products ADD COLUMN last_reviewed_by INT DEFAULT NULL`
  );
  await tryExec(
    'Add last_reviewed_at to products',
    `ALTER TABLE products ADD COLUMN last_reviewed_at DATETIME DEFAULT NULL`
  );
  await tryExec(
    'Add is_edited to products',
    `ALTER TABLE products ADD COLUMN is_edited BOOLEAN DEFAULT FALSE`
  );

  // 2. Create product_status_logs table
  await tryExec(
    'Create product_status_logs table',
    `CREATE TABLE IF NOT EXISTS product_status_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      old_status VARCHAR(50),
      new_status VARCHAR(50) NOT NULL,
      changed_by INT DEFAULT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // 3. Fix vendor_stats view — add response_rate and is_verified columns
  await tryExec(
    'Recreate vendor_stats view with response_rate and is_verified',
    `CREATE OR REPLACE VIEW vendor_stats AS
    SELECT
      v.id as vendor_id,
      v.company_name_ar,
      v.company_name_en,
      v.bio_ar,
      v.bio_en,
      v.location,
      v.verification_status,
      CASE WHEN v.verification_status = 'APPROVED' THEN TRUE ELSE FALSE END as is_verified,
      COALESCE(v.avg_rating, 0) as avg_rating,
      COALESCE(v.review_count, 0) as review_count,
      IFNULL(SUM(o.total_price), 0) as total_sales,
      COUNT(DISTINCT o.id) as total_orders,
      IFNULL(vs.response_rate, 0) as response_rate
    FROM vendor_profiles v
    LEFT JOIN orders o ON v.id = o.vendor_id AND o.status = 'COMPLETED'
    LEFT JOIN vendor_scores vs ON v.id = vs.vendor_id
    WHERE v.deleted_at IS NULL
    GROUP BY v.id, vs.response_rate`
  );

  // 4. Set existing products to PENDING if lifecycle_status is NULL
  await tryExec(
    'Set lifecycle_status = PENDING for existing products with NULL status',
    `UPDATE products SET lifecycle_status = 'PENDING' WHERE lifecycle_status IS NULL`
  );

  connection.release();
  console.log('\n🎉 Migration complete!');
  process.exit(0);
}

migrate().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
