import pool from '../config/db.js';
import CategoryRepository from './CategoryRepository.js';
import { buildLegacyDescription, buildRfqTitle, hydrateRfqRecord, hydrateRfqRecords, normalizeRfqItems } from '../utils/rfqItems.js';

class RfqRepository {
  _schemaReady = false;
  _schemaPromise = null;

  async initializeRuntimeSchema(connection = pool) {
    if (this._schemaReady) return;
    if (this._schemaPromise) return this._schemaPromise;

    this._schemaPromise = (async () => {
      const [rows] = await connection.query('SHOW COLUMNS FROM rfq_requests');
      const currentColumns = new Set(rows.map((row) => row.Field));

      if (!currentColumns.has('rfq_items')) {
        await connection.query('ALTER TABLE rfq_requests ADD COLUMN rfq_items JSON NULL AFTER description');
      }

      this._schemaReady = true;
    })().catch((error) => {
      this._schemaPromise = null;
      throw error;
    });

    return this._schemaPromise;
  }

  /**
   * Crates a new RFQ request.
   */
  async createRfq(rfqData, connection = pool) {
    await this.initializeRuntimeSchema(connection);

    const {
      user_id, category_id, items, quantity, target_price,
      privacy_type, lead_priority, lead_source, expiration_time, max_responders, specs, image_url
    } = rfqData;
    const normalizedItems = normalizeRfqItems(items);
    const title = buildRfqTitle(normalizedItems);
    const description = buildLegacyDescription(normalizedItems);

    const [result] = await connection.execute(
      `INSERT INTO rfq_requests (
        user_id, category_id, title, description, rfq_items, quantity, target_price, 
        privacy_type, lead_priority, lead_source, expiration_time, max_responders, specs, image_url, status
      ) VALUES (
        :user_id, :category_id, :title, :description, :rfq_items, :quantity, :target_price,
        :privacy_type, :lead_priority, :lead_source, :expiration_time, :max_responders, :specs, :image_url, 'DRAFT'
      )`,
      { 
        user_id,
        category_id,
        title,
        description: description || null,
        rfq_items: normalizedItems.length ? JSON.stringify(normalizedItems) : null,
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
    await this.initializeRuntimeSchema(connection);
    const [rows] = await connection.execute(`SELECT * FROM rfq_requests WHERE id = :id`, { id });
    return hydrateRfqRecord(rows[0] || null);
  }

  async getByIdForAdmin(id, connection = pool) {
    await this.initializeRuntimeSchema(connection);
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

    return hydrateRfqRecord(rows[0] || null);
  }

  async getByIdForUser(id, userId, connection = pool) {
    await this.initializeRuntimeSchema(connection);
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

    return hydrateRfqRecord(rows[0] || null);
  }

  async getByIdForVendor(id, vendorId, connection = pool) {
    await this.initializeRuntimeSchema(connection);
    const [vendorCategoryRows] = await connection.execute(
      'SELECT category_id FROM vendor_category_junction WHERE vendor_id = :vendorId',
      { vendorId }
    );
    const accessibleCategoryIds = await CategoryRepository.expandIds(
      vendorCategoryRows.map((row) => row.category_id),
      { includeAncestors: true },
      connection
    );

    const publicCategoryCondition = accessibleCategoryIds.length
      ? `(r.privacy_type = 'PUBLIC' AND r.category_id IN (${accessibleCategoryIds.map((_, index) => `:accessibleCategoryId_${index}`).join(', ')}))`
      : '0 = 1';
    const categoryParams = accessibleCategoryIds.reduce((acc, categoryId, index) => {
      acc[`accessibleCategoryId_${index}`] = categoryId;
      return acc;
    }, {});

    const [rows] = await connection.execute(
      `SELECT r.*,
              c.name_ar AS category_name_ar,
              c.name_en AS category_name_en,
              CONCAT_WS(' ', u.first_name, u.last_name) AS user_name,
              u.profile_image_url AS user_avatar
       FROM rfq_requests r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN rfq_private_vendors pv
         ON pv.rfq_id = r.id AND pv.vendor_id = :vendorId
       LEFT JOIN rfq_offers ro
         ON ro.rfq_id = r.id AND ro.vendor_id = :vendorId
       WHERE r.id = :id
         AND r.status IN ('BROADCASTED', 'OPEN', 'NEGOTIATING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELED', 'COMPLETED')
         AND (
           ${publicCategoryCondition}
           OR (r.privacy_type = 'PRIVATE' AND pv.vendor_id IS NOT NULL)
           OR ro.id IS NOT NULL
         )
       LIMIT 1`,
      { id, vendorId, ...categoryParams }
    );

    return hydrateRfqRecord(rows[0] || null);
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
    await this.initializeRuntimeSchema(connection);
    const categoryIds = await CategoryRepository.expandIds([categoryId], { includeDescendants: true }, connection);
    if (!categoryIds.length) return [];

    const [rows] = await connection.execute(
      `SELECT v.id, v.user_id, u.email 
       FROM vendor_profiles v
       JOIN vendor_category_junction vcj ON v.id = vcj.vendor_id
       JOIN users u ON v.user_id = u.id
       WHERE vcj.category_id IN (${categoryIds.map((_, index) => `:categoryId_${index}`).join(', ')})
         AND v.deleted_at IS NULL
         AND u.deleted_at IS NULL
         AND u.is_active = 1
         AND v.verification_status = 'APPROVED'`,
      categoryIds.reduce((acc, id, index) => {
        acc[`categoryId_${index}`] = id;
        return acc;
      }, {})
    );
    return rows.filter((row, index, array) => array.findIndex((item) => item.id === row.id) === index);
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
    await this.initializeRuntimeSchema(connection);
    if (!categoryIds || categoryIds.length === 0) return [];

    const { search = '', category = '' } = filters;
    const accessibleCategoryIds = await CategoryRepository.expandIds(categoryIds, { includeAncestors: true }, connection);
    if (!accessibleCategoryIds.length) return [];

    const publicCategoryPlaceholders = accessibleCategoryIds.map((_, index) => `:publicCategoryId_${index}`).join(', ');

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
          (r.privacy_type = 'PUBLIC' AND r.category_id IN (${publicCategoryPlaceholders}))
          OR
          (r.privacy_type = 'PRIVATE' AND pv.vendor_id IS NOT NULL)
      )
    `;

    const params = {
      vendorId_0: vendorId,
      vendorId_1: vendorId,
      vendorId_2: vendorId,
      vendorId_3: vendorId
    };
    accessibleCategoryIds.forEach((id, index) => {
      params[`publicCategoryId_${index}`] = id;
    });

    if (category) {
      const filteredCategoryIds = await CategoryRepository.expandIds([Number(category)], { includeDescendants: true }, connection);
      if (filteredCategoryIds.length) {
        const filterPlaceholders = filteredCategoryIds.map((_, index) => `:filterCategoryId_${index}`).join(', ');
        sql += ` AND r.category_id IN (${filterPlaceholders})`;
        filteredCategoryIds.forEach((id, index) => {
          params[`filterCategoryId_${index}`] = id;
        });
      }
    }

    if (search) {
      sql += ' AND (r.title LIKE :searchTerm OR r.description LIKE :searchTerm OR CAST(r.rfq_items AS CHAR) LIKE :searchTerm)';
      params.searchTerm = `%${search}%`;
    }

    sql += ' ORDER BY r.created_at DESC';

    sql = sql
      .replace('ro.vendor_id = ?', 'ro.vendor_id = :vendorId_0')
      .replace('conv.vendor_id = ?', 'conv.vendor_id = :vendorId_1')
      .replace('logs.vendor_id = ?', 'logs.vendor_id = :vendorId_2')
      .replace('pv.vendor_id = ?', 'pv.vendor_id = :vendorId_3');

    const [rows] = await connection.execute(sql, params);
    return hydrateRfqRecords(rows);
  }

  /**
   * Returns all RFQs with user and category info for admin moderation.
   */
  async getAllAdmin(connection = pool) {
    await this.initializeRuntimeSchema(connection);
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
    return hydrateRfqRecords(rows);
  }

  async getByUserId(userId, connection = pool) {
    await this.initializeRuntimeSchema(connection);
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
    return hydrateRfqRecords(rows);
  }

  async getDeleteCandidateForUser(rfqId, userId, connection = pool) {
    await this.initializeRuntimeSchema(connection);
    const [rows] = await connection.execute(
      `SELECT r.*,
              (SELECT COUNT(*) FROM rfq_offers o WHERE o.rfq_id = r.id) AS offers_count,
              (SELECT COUNT(*) FROM conversations c WHERE c.related_rfq_id = r.id) AS conversations_count
       FROM rfq_requests r
       WHERE r.id = :rfqId AND r.user_id = :userId
       LIMIT 1`,
      { rfqId, userId }
    );

    return hydrateRfqRecord(rows[0] || null);
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
