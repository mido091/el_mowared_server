import pool from '../config/db.js';

class RfqRepository {
  /**
   * Crates a new RFQ request.
   */
  async createRfq(rfqData, connection = pool) {
    const {
      user_id, category_id, title, description, quantity, target_price,
      privacy_type, lead_priority, lead_source, expiration_time, max_responders, specs, image_url
    } = rfqData;

    const [result] = await connection.execute(
      `INSERT INTO rfq_requests (
        user_id, category_id, title, description, quantity, target_price, 
        privacy_type, lead_priority, lead_source, expiration_time, max_responders, specs, image_url, status
      ) VALUES (
        :user_id, :category_id, :title, :description, :quantity, :target_price,
        :privacy_type, :lead_priority, :lead_source, :expiration_time, :max_responders, :specs, :image_url, 'DRAFT'
      )`,
      { 
        user_id,
        category_id,
        title,
        description: description || null,
        quantity,
        target_price: target_price ?? null,
        privacy_type: privacy_type || 'PUBLIC',
        lead_priority: lead_priority || 'MEDIUM',
        lead_source: lead_source || 'USER',
        expiration_time: expiration_time || null,
        max_responders: max_responders ?? 5,
        specs: specs ? JSON.stringify(specs) : null,
        image_url: image_url || null
      }
    );
    return result.insertId;
  }

  /**
   * Finds an RFQ by ID.
   */
  async findById(id, connection = pool) {
    const [rows] = await connection.execute(`SELECT * FROM rfq_requests WHERE id = :id`, { id });
    return rows[0] || null;
  }

  async getByIdForAdmin(id, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT r.*,
              c.name_ar AS category_name_ar,
              c.name_en AS category_name_en,
              CONCAT_WS(' ', u.first_name, u.last_name) AS user_name,
              u.profile_image_url AS user_avatar
       FROM rfq_requests r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = :id
       LIMIT 1`,
      { id }
    );

    return rows[0] || null;
  }

  async getByIdForUser(id, userId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT r.*,
              c.name_ar AS category_name_ar,
              c.name_en AS category_name_en,
              CONCAT_WS(' ', u.first_name, u.last_name) AS user_name,
              u.profile_image_url AS user_avatar
       FROM rfq_requests r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = :id AND r.user_id = :userId
       LIMIT 1`,
      { id, userId }
    );

    return rows[0] || null;
  }

  async getByIdForVendor(id, vendorId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT r.*,
              c.name_ar AS category_name_ar,
              c.name_en AS category_name_en,
              CONCAT_WS(' ', u.first_name, u.last_name) AS user_name,
              u.profile_image_url AS user_avatar
       FROM rfq_requests r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN vendor_category_junction vcj
         ON vcj.vendor_id = :vendorId AND vcj.category_id = r.category_id
       LEFT JOIN rfq_private_vendors pv
         ON pv.rfq_id = r.id AND pv.vendor_id = :vendorId
       LEFT JOIN rfq_offers ro
         ON ro.rfq_id = r.id AND ro.vendor_id = :vendorId
       WHERE r.id = :id
         AND r.status IN ('BROADCASTED', 'OPEN', 'NEGOTIATING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELED', 'COMPLETED')
         AND (
           (r.privacy_type = 'PUBLIC' AND vcj.vendor_id IS NOT NULL)
           OR (r.privacy_type = 'PRIVATE' AND pv.vendor_id IS NOT NULL)
           OR ro.id IS NOT NULL
         )
       LIMIT 1`,
      { id, vendorId }
    );

    return rows[0] || null;
  }

  async getOffersForRfq(rfqId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT o.*,
              COALESCE(vp.company_name_en, vp.company_name_ar) AS vendor_company_name,
              vp.company_name_ar AS vendor_company_name_ar,
              vp.company_name_en AS vendor_company_name_en,
              vp.logo AS vendor_logo_url,
              vp.verification_status AS vendor_verification_status,
              u.id AS vendor_user_id
       FROM rfq_offers o
       LEFT JOIN vendor_profiles vp ON vp.id = o.vendor_id
       LEFT JOIN users u ON u.id = vp.user_id
       WHERE o.rfq_id = :rfqId
       ORDER BY o.created_at DESC`,
      { rfqId }
    );

    return rows;
  }

  /**
   * Updates RFQ Status and records it in history.
   */
  async updateStatus(rfqId, oldStatus, newStatus, changedByUserId, notes = null, connection = pool) {
    await connection.execute(`UPDATE rfq_requests SET status = :newStatus WHERE id = :rfqId`, { newStatus, rfqId });
    await connection.execute(
      `INSERT INTO rfq_status_history (rfq_id, old_status, new_status, changed_by, notes)
       VALUES (:rfqId, :oldStatus, :newStatus, :changedByUserId, :notes)`,
      { rfqId, oldStatus, newStatus, changedByUserId, notes }
    );
  }

  /**
   * Identifies matching vendors for a specific category id.
   */
  async getMatchingVendors(categoryId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT v.id, v.user_id, u.email 
       FROM vendor_profiles v
       JOIN vendor_category_junction vcj ON v.id = vcj.vendor_id
       JOIN users u ON v.user_id = u.id
       WHERE vcj.category_id = :categoryId
         AND v.deleted_at IS NULL
         AND u.deleted_at IS NULL
         AND u.is_active = 1
         AND v.verification_status = 'APPROVED'`,
      { categoryId }
    );
    return rows;
  }

  /**
   * Thread-safe increment of responders. Throws error if full to avoid race conditions.
   */
  async incrementResponder(rfqId, connection = pool) {
    const [result] = await connection.execute(
      `UPDATE rfq_requests 
       SET current_responders = current_responders + 1 
       WHERE id = :rfqId AND current_responders < max_responders`,
      { rfqId }
    );
    return result.affectedRows > 0;
  }

  /**
   * Logs a vendor action (VIEWED, RESPONDED, DECLINED).
   */
  async logVendorAction(rfqId, vendorId, action, connection = pool) {
    await connection.execute(
      `INSERT INTO rfq_assignment_logs (rfq_id, vendor_id, action) 
       VALUES (:rfqId, :vendorId, :action)`,
      { rfqId, vendorId, action }
    );
  }

  async hasVendorAction(rfqId, vendorId, action, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT 1
       FROM rfq_assignment_logs
       WHERE rfq_id = :rfqId
         AND vendor_id = :vendorId
         AND action = :action
       LIMIT 1`,
      { rfqId, vendorId, action }
    );

    return rows.length > 0;
  }

  /**
   * Returns all active RFQs for vendors to browse (considering public/private status).
   */
  async getFeedForVendor(vendorId, categoryIds, filters = {}, connection = pool) {
    if (!categoryIds || categoryIds.length === 0) return [];

    const { search = '', category = '' } = filters;

      let sql = `
        SELECT r.*,
               c.name_ar AS category_name_ar,
               c.name_en AS category_name_en,
               CONCAT_WS(' ', u.first_name, u.last_name) AS user_name,
               u.profile_image_url AS user_avatar,
               EXISTS(
                 SELECT 1
                 FROM rfq_offers ro
                 WHERE ro.rfq_id = r.id
                   AND ro.vendor_id = ?
               ) AS vendor_has_offer,
               EXISTS(
                 SELECT 1
                 FROM conversations conv
                 WHERE conv.related_rfq_id = r.id
                   AND conv.vendor_id = ?
                   AND COALESCE(conv.status, 'active') NOT IN ('closed', 'archived')
               ) AS vendor_has_chat,
               EXISTS(
                 SELECT 1
                 FROM rfq_assignment_logs logs
                 WHERE logs.rfq_id = r.id
                   AND logs.vendor_id = ?
                   AND logs.action = 'DECLINED'
               ) AS vendor_has_declined
       FROM rfq_requests r
       LEFT JOIN rfq_private_vendors pv ON r.id = pv.rfq_id AND pv.vendor_id = ?
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.status IN ('BROADCASTED', 'OPEN', 'NEGOTIATING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELED', 'COMPLETED')
      AND (
          (r.privacy_type = 'PUBLIC' AND r.category_id IN (?))
          OR
          (r.privacy_type = 'PRIVATE' AND pv.vendor_id IS NOT NULL)
      )
    `;

    const params = [vendorId, vendorId, vendorId, vendorId, categoryIds];

    if (category) {
      sql += ' AND r.category_id = ?';
      params.push(Number(category));
    }

    if (search) {
      sql += ' AND (r.title LIKE ? OR r.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY r.created_at DESC';

    const [rows] = await connection.query(sql, params);
    return rows;
  }

  /**
   * Returns all RFQs with user and category info for admin moderation.
   */
  async getAllAdmin(connection = pool) {
    const [rows] = await connection.execute(
      `SELECT r.*,
              CONCAT_WS(' ', u.first_name, u.last_name) as user_name,
              u.profile_image_url AS user_avatar,
              c.name_ar as category_name_ar,
              c.name_en as category_name_en,
              COALESCE(c.name_en, c.name_ar) as category_name
       FROM rfq_requests r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN categories c ON r.category_id = c.id
       ORDER BY r.created_at DESC`
    );
    return rows;
  }

  async getByUserId(userId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT r.*,
              c.name_ar AS category_name_ar,
              c.name_en AS category_name_en,
              COUNT(o.id) AS offers_count,
              (
                SELECT ro.vendor_id
                FROM rfq_offers ro
                WHERE ro.rfq_id = r.id
                ORDER BY ro.created_at DESC, ro.id DESC
                LIMIT 1
              ) AS latest_offer_vendor_id,
              (
                SELECT ro.offered_price
                FROM rfq_offers ro
                WHERE ro.rfq_id = r.id
                ORDER BY ro.created_at DESC, ro.id DESC
                LIMIT 1
              ) AS latest_offer_price,
              (
                SELECT ro.delivery_time
                FROM rfq_offers ro
                WHERE ro.rfq_id = r.id
                ORDER BY ro.created_at DESC, ro.id DESC
                LIMIT 1
              ) AS latest_offer_delivery_time,
              (
                SELECT COALESCE(vp.company_name_en, vp.company_name_ar)
                FROM rfq_offers ro
                JOIN vendor_profiles vp ON vp.id = ro.vendor_id
                WHERE ro.rfq_id = r.id
                ORDER BY ro.created_at DESC, ro.id DESC
                LIMIT 1
              ) AS latest_offer_vendor_name
       FROM rfq_requests r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN rfq_offers o ON o.rfq_id = r.id
       WHERE r.user_id = :userId
       GROUP BY r.id, c.name_ar, c.name_en
       ORDER BY r.created_at DESC`,
      { userId }
    );
    return rows;
  }

  async getDeleteCandidateForUser(rfqId, userId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT r.*,
              (SELECT COUNT(*) FROM rfq_offers o WHERE o.rfq_id = r.id) AS offers_count,
              (SELECT COUNT(*) FROM conversations c WHERE c.related_rfq_id = r.id) AS conversations_count
       FROM rfq_requests r
       WHERE r.id = :rfqId AND r.user_id = :userId
       LIMIT 1`,
      { rfqId, userId }
    );

    return rows[0] || null;
  }

  async deleteForUser(rfqId, userId, connection = pool) {
    await connection.execute(`DELETE FROM rfq_status_history WHERE rfq_id = :rfqId`, { rfqId });
    await connection.execute(`DELETE FROM rfq_assignment_logs WHERE rfq_id = :rfqId`, { rfqId });
    await connection.execute(`DELETE FROM rfq_private_vendors WHERE rfq_id = :rfqId`, { rfqId });
    const [result] = await connection.execute(
      `DELETE FROM rfq_requests WHERE id = :rfqId AND user_id = :userId`,
      { rfqId, userId }
    );

    return result.affectedRows > 0;
  }
}

export default new RfqRepository();
