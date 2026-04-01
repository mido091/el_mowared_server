import pool from './src/config/db.js';

(async () => {
  try {
    console.log('Ensuring rfq_items column exists on rfq_requests...');

    const [columns] = await pool.query('SHOW COLUMNS FROM rfq_requests');
    const hasRfqItems = columns.some((column) => column.Field === 'rfq_items');

    if (!hasRfqItems) {
      await pool.query('ALTER TABLE rfq_requests ADD COLUMN rfq_items JSON NULL AFTER description');
      console.log('rfq_items column added successfully.');
    } else {
      console.log('rfq_items column already exists.');
    }
  } catch (error) {
    console.error('RFQ items migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
})();
