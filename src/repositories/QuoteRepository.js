/**
 * @file QuoteRepository.js
 * @description Repository for managing Quotation Requests (RFQ).
 */

import { pool } from '../config/db.js';

class QuoteRepository {
  /**
   * Creates a new RFQ.
   */
  async create(data, connection = pool) {
    const { userId, productId, vendorId, requestedQuantity, targetPrice, notes } = data;
    const sql = `
      INSERT INTO quotation_requests 
      (user_id, product_id, vendor_id, requested_quantity, target_price, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
    `;
    const [result] = await connection.execute(sql, [userId, productId, vendorId, requestedQuantity, targetPrice, notes]);
    return result.insertId;
  }

  async findById(id, connection = pool) {
    const [rows] = await connection.execute('SELECT * FROM quotation_requests WHERE id = ?', [id]);
    if (!rows[0]) return null;
    
    const quote = rows[0];
    const [[product]] = await connection.execute('SELECT name_ar, name_en, price FROM products WHERE id = ?', [quote.product_id]);
    const [[vendor]] = await connection.execute('SELECT company_name_ar, company_name_en FROM vendor_profiles WHERE id = ?', [quote.vendor_id]);
    
    return { 
      ...quote, 
      product_title_ar: product?.name_ar, 
      product_title_en: product?.name_en,
      price: product?.price,
      company_name_ar: vendor?.company_name_ar,
      company_name_en: vendor?.company_name_en
    };
  }

  async updateStatus(id, status, notes = null, connection = pool) {
    const sql = 'UPDATE quotation_requests SET status = ?, notes = COALESCE(?, notes), updated_at = NOW() WHERE id = ?';
    const [result] = await connection.execute(sql, [status, notes, id]);
    return result.affectedRows > 0;
  }

  async findByUserId(userId) {
    const sql = `
      SELECT q.*, p.name_ar, p.name_en, v.company_name_ar, v.company_name_en
      FROM quotation_requests q
      JOIN products p ON q.product_id = p.id
      JOIN vendor_profiles v ON q.vendor_id = v.id
      WHERE q.user_id = ?
      ORDER BY q.created_at DESC
    `;
    const [rows] = await pool.execute(sql, [userId]);
    return rows;
  }

  async findByVendorId(vendorId) {
    const sql = `
      SELECT q.*, p.name_ar, p.name_en, u.first_name, u.last_name
      FROM quotation_requests q
      JOIN products p ON q.product_id = p.id
      JOIN users u ON q.user_id = u.id
      WHERE q.vendor_id = ?
      ORDER BY q.created_at DESC
    `;
    const [rows] = await pool.execute(sql, [vendorId]);
    return rows;
  }
}

export default new QuoteRepository();
