import pool from './src/config/db.js';

(async () => {
  try {
    const vendorId = 1;
    const limit = 5;
    const [rows] = await pool.execute(`
      SELECT o.*, u.first_name, u.last_name, u.email as buyer_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.vendor_id = :vendorId
      ORDER BY o.created_at DESC
      LIMIT :limit
    `, { vendorId, limit });
    console.log("ROWS:", rows);
  } catch (err) {
    console.error("SQL ERROR:", err.message);
  } finally {
    process.exit(0);
  }
})();
