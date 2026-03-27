/**
 * @file TransactionRepository.js
 * @description Repository for tracking vendor financial records and ledger entries.
 * Manages confirmed deposits, order payouts, and system-wide ledger stability.
 */

import pool from '../config/db.js';

class TransactionRepository {
  /**
   * Persists a new financial transaction entry.
   * 
   * @async
   * @param {Object} data - Transaction attributes.
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   * @returns {Promise<number>} New transaction ID.
   */
  async create(data, connection = pool) {
    const { vendorId, orderId, amount, type, status, details } = data;
    // Insert into vendor_transactions: Atomic ledger recording.
    const sql = `
      INSERT INTO vendor_transactions (vendor_id, order_id, amount, type, status, details)
      VALUES (:vendorId, :orderId, :amount, :type, :status, :details)
    `;
    const [result] = await connection.execute(sql, { 
      vendorId, orderId, amount, type, status: status || 'PENDING', details 
    });
    return result.insertId;
  }

  /**
   * Retrieves the full financial ledger for a specific vendor.
   * 
   * @async
   * @param {number} vendorId 
   * @returns {Promise<Array>} List of historical transactions.
   */
  async findByVendor(vendorId) {
    const [rows] = await pool.execute(
      'SELECT * FROM vendor_transactions WHERE vendor_id = :vendorId ORDER BY created_at DESC', 
      { vendorId }
    );
    return rows;
  }

  /**
   * Updates a transaction's completion status.
   * 
   * @async
   * @param {number} id 
   * @param {string} status - 'COMPLETED', 'FAILED', or 'REFUNDED'.
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async updateStatus(id, status, connection = pool) {
    await connection.execute(
      'UPDATE vendor_transactions SET status = :status WHERE id = :id',
      { id, status }
    );
  }
  /**
   * Aggregates financial totals for a vendor.
   * 
   * @async
   * @param {number} vendorId 
   * @returns {Promise<Object>} { total_earned, pending_amount, paid_out }
   */
  async getSummary(vendorId) {
    const sql = `
      SELECT 
        IFNULL(SUM(CASE WHEN type = 'DEPOSIT' AND status = 'COMPLETED' THEN amount ELSE 0 END), 0) as total_earned,
        IFNULL(SUM(CASE WHEN type = 'DEPOSIT' AND status = 'PENDING' THEN amount ELSE 0 END), 0) as pending_amount,
        IFNULL(SUM(CASE WHEN type = 'WITHDRAWAL' AND status = 'COMPLETED' THEN ABS(amount) ELSE 0 END), 0) as paid_out
      FROM vendor_transactions 
      WHERE vendor_id = :vendorId
    `;
    const [rows] = await pool.execute(sql, { vendorId });
    return rows[0];
  }
}

export default new TransactionRepository();
