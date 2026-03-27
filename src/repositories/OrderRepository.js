/**
 * @file OrderRepository.js
 * @description Repository for managing Orders, Payments, and Purchase Snapshots.
 * Handles the logic for splitting orders and locking pricing details at the time of purchase.
 */

import pool from '../config/db.js';

class OrderRepository {
  /**
   * Records a new order and its financial commitment (escrow).
   * 
   * @async
   * @param {Object} orderData - Core order attributes.
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   * @returns {Promise<number>} ID of the newly created order.
   */
  async createOrder(orderData, connection = pool) {
    const { userId, vendorId, totalPrice, depositAmount, depositPercentage, paymentMethod, referredByMarketerId } = orderData;
    // Insert initial order record with a 'PENDING' status.
    const sql = `
      INSERT INTO orders (user_id, vendor_id, total_price, deposit_amount, deposit_percentage, payment_method, referred_by_marketer_id, status)
      VALUES (:userId, :vendorId, :totalPrice, :depositAmount, :depositPercentage, :paymentMethod, :referredByMarketerId, 'PENDING')
    `;
    const [result] = await connection.execute(sql, { 
      userId, vendorId, totalPrice, 
      depositAmount: depositAmount || 0, 
      depositPercentage: depositPercentage || 0,
      paymentMethod,
      referredByMarketerId: referredByMarketerId || null
    });
    return result.insertId;
  }

  /**
   * Bulk inserts snapshots of products involved in an order.
   * Standardizes the 'price_at_purchase' to ensure future product price changes don't affect old orders.
   * 
   * @async
   * @param {number} orderId 
   * @param {Array<Object>} items - List of items with price snapshots.
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async createOrderItems(orderId, items, connection = pool) {
    const values = items.map(item => [
      orderId,
      item.productId,
      item.priceAtPurchase,
      item.quantity
    ]);

    // Positional bulk insert: Efficiently records multiple items in a single query.
    const sql = 'INSERT INTO order_items (order_id, product_id, price_at_purchase, quantity) VALUES ?';
    await connection.query(sql, [values]);
  }

  /**
   * Updates an order payment record with a localized receipt.
   * 
   * @async
   * @param {number} orderId 
   * @param {Object} receipt - Image metadata (url and public_id).
   */
  async uploadPaymentReceipt(orderId, { transactionImage, transactionImagePublicId }) {
    // Update payment record to PENDING status upon receipt upload.
    const sql = `
      UPDATE order_payments 
      SET transaction_image = :transactionImage, 
          transaction_image_public_id = :transactionImagePublicId,
          verification_status = 'PENDING'
      WHERE order_id = :orderId
    `;
    await pool.execute(sql, { orderId, transactionImage, transactionImagePublicId });
  }

  /**
   * Fetches full order details including localized merchant names.
   * 
   * @async
   * @param {number} id 
   * @returns {Promise<Object|null>} Order record with customer and merchant info.
   */
  async findById(id) {
    // Join logic: Links order with user for buyer info and vendor_profiles for company names.
    const sql = `
      SELECT o.*, u.first_name, u.last_name, v.company_name_ar, v.company_name_en, v.user_id as vendor_user_id
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN vendor_profiles v ON o.vendor_id = v.id
      WHERE o.id = :id
    `;
    const [rows] = await pool.execute(sql, { id });
    return rows[0];
  }

  /**
   * Retrieves snapshots of all products in an order.
   * 
   * @async
   * @param {number} orderId 
   * @returns {Promise<Array>} List of order items with current product titles.
   */
  async findOrderItems(orderId) {
    // Join logic: Links order_items snapshot with current product titles for identification.
    const sql = `
      SELECT oi.*, p.name_ar, p.name_en
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = :orderId
    `;
    const [rows] = await pool.execute(sql, { orderId });
    return rows;
  }

  /**
   * Updates the lifecycle status of an order.
   * 
   * @async
   * @param {number} id 
   * @param {string} status - New order status (e.g., 'PROCESSING', 'SHIPPED').
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async updateStatus(id, status, connection = pool) {
    const sql = 'UPDATE orders SET status = :status, updated_at = NOW() WHERE id = :id';
    await connection.execute(sql, { id, status });
  }

  /**
   * Records administrative verification of a payment.
   * 
   * @async
   * @param {number} orderId 
   * @param {string} status - 'VERIFIED' or 'REJECTED'.
   * @param {string} [note] - Administrative feedback.
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async verifyPayment(orderId, status, note = null, connection = pool) {
    const sql = `
      UPDATE order_payments 
      SET verification_status = :vStatus, 
          admin_status = :aStatus,
          admin_note = :note,
          verified_at = NOW() 
      WHERE order_id = :orderId
    `;
    await connection.execute(sql, { orderId, vStatus: status, aStatus: status, note: note || null });
  }

  /**
   * Fetches all orders belonging to a specific user.
   * 
   * @async
   * @param {number} userId 
   * @returns {Promise<Array>} List of customer orders.
   */
  async getUserOrders(userId) {
    const sql = `
      SELECT o.*,
             v.company_name_ar,
             v.company_name_en
      FROM orders o
      LEFT JOIN vendor_profiles v ON v.id = o.vendor_id
      WHERE o.user_id = :userId
      ORDER BY o.created_at DESC
    `;
    const [rows] = await pool.execute(sql, { userId });
    return rows.map(order => ({
      ...order,
      amount: order.total_price,
      vendor: {
        company_name: order.company_name_en || order.company_name_ar || 'Vendor',
        company_name_ar: order.company_name_ar,
        company_name_en: order.company_name_en
      }
    }));
  }

  /**
   * Fetches all orders directed to a specific vendor.
   * 
   * @async
   * @param {number} vendorId 
   * @returns {Promise<Array>} List of vendor-specific orders.
   */
  async getVendorOrders(vendorId) {
    const sql = 'SELECT * FROM orders WHERE vendor_id = :vendorId ORDER BY created_at DESC';
    const [rows] = await pool.execute(sql, { vendorId });
    return rows;
  }

  /**
   * Generates a comprehensive trust report for administrators.
   * Combines Customer, Merchant, Payment, and Item snapshots into a single JSON-rich summary.
   * 
   * @async
   * @param {number} orderId 
   * @returns {Promise<Object|null>} Full administrative audit report.
   */
  async getAdminOrderReport(orderId) {
    // Complex Join and Subquery:
    // Aggregates nested product information as a JSON array for specialized frontend reporting.
    const sql = `
      SELECT o.*, 
             u.first_name as customer_first_name, u.last_name as customer_last_name, 
             u.email as customer_email,
             v.company_name_ar, v.company_name_en, v.id as merchant_id,
             p.transaction_image, p.verification_status as payment_status,
             (SELECT JSON_ARRAYAGG(
                JSON_OBJECT(
                  'titleAr', pi.name_ar, 
                  'titleEn', pi.name_en, 
                  'quantity', oi.quantity, 
                  'price', oi.price_at_purchase
                )
              ) FROM order_items oi 
              JOIN products pi ON oi.product_id = pi.id 
              WHERE oi.order_id = o.id) as product_list
      FROM orders o
      JOIN users u ON o.user_id = u.id
      JOIN vendor_profiles v ON o.vendor_id = v.id
      LEFT JOIN order_payments p ON o.id = p.order_id
      WHERE o.id = :orderId
    `;
    const [rows] = await pool.execute(sql, { orderId });
    return rows[0];
  }

  /**
   * Updates administrative approval status for restricted orders.
   * 
   * @async
   * @param {number} id 
   * @param {string} status 
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async updateAdminApproval(id, status, connection = pool) {
    const sql = 'UPDATE orders SET admin_approval_status = :status WHERE id = :id';
    await connection.execute(sql, { id, status });
  }
}

export default new OrderRepository();
