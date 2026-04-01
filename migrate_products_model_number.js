import pool from './src/config/db.js';

(async () => {
  try {
    console.log('Ensuring model_number column exists on products...');

    const [columns] = await pool.query('SHOW COLUMNS FROM products');
    const hasModelNumber = columns.some((column) => column.Field === 'model_number');

    if (!hasModelNumber) {
      await pool.query('ALTER TABLE products ADD COLUMN model_number VARCHAR(120) NULL AFTER name_en');
      console.log('model_number column added successfully.');
    } else {
      console.log('model_number column already exists.');
    }

    const [indexes] = await pool.query("SHOW INDEX FROM products WHERE Key_name = 'idx_products_model_number'");
    if (!indexes.length) {
      await pool.query('CREATE INDEX idx_products_model_number ON products (model_number)');
      console.log('idx_products_model_number index added successfully.');
    } else {
      console.log('idx_products_model_number index already exists.');
    }
  } catch (error) {
    console.error('Product model number migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
