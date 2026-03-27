import pool from './src/config/db.js';

async function ensureProductViewLogs() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_view_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      viewer_id INT NULL,
      session_key VARCHAR(191) NULL,
      ip_hash VARCHAR(128) NULL,
      user_agent_hash VARCHAR(128) NULL,
      viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_product_view_logs_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_view_logs_viewer FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_product_view_logs_product (product_id),
      INDEX idx_product_view_logs_viewer (viewer_id),
      INDEX idx_product_view_logs_viewed_at (viewed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [columns] = await pool.query('SHOW COLUMNS FROM product_view_logs');
  const current = new Set(columns.map((column) => column.Field));

  if (!current.has('session_key')) {
    await pool.query('ALTER TABLE product_view_logs ADD COLUMN session_key VARCHAR(191) NULL AFTER viewer_id');
  }

  if (!current.has('ip_hash')) {
    await pool.query('ALTER TABLE product_view_logs ADD COLUMN ip_hash VARCHAR(128) NULL AFTER session_key');
  }

  if (!current.has('user_agent_hash')) {
    await pool.query('ALTER TABLE product_view_logs ADD COLUMN user_agent_hash VARCHAR(128) NULL AFTER ip_hash');
  }

  if (!current.has('created_at')) {
    await pool.query('ALTER TABLE product_view_logs ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER viewed_at');
  }
}

async function run() {
  try {
    await ensureProductViewLogs();
    console.log('Metrics integrity migration completed successfully.');
  } catch (error) {
    console.error('Metrics integrity migration failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
