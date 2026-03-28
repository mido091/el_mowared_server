/**
 * @file VendorRepository.js
 * @description Repository for Vendor Profiles.
 * Utilizes the 'vendor_stats' database view to retrieve aggregate performance metrics efficiently.
 */

import pool from '../config/db.js';

class VendorRepository {
  /**
   * Finds a vendor profile specifically by the primary owner's User ID.
   * 
   * @async
   * @param {number} userId 
   * @returns {Promise<Object|null>} Raw vendor profile record.
   */
  async findByUserId(userId) {
    // Select strictly based on user_id to identify which profile belongs to an authenticated user.
    const [rows] = await pool.execute(
      'SELECT * FROM vendor_profiles WHERE user_id = :userId AND deleted_at IS NULL',
      { userId }
    );
    return rows[0];
  }

  /**
   * Retrieves summary statistics for all vendors.
   * 
   * @async
   * @returns {Promise<Array>} List of vendor statistics from the specialized DB view.
   */
  async findAll(options = {}) {
    const search = `${options.search || ''}`.trim();
    const limit = Number(options.limit || 0);
    const params = {};
    let sql = `
      SELECT
        vp.id,
        vs.vendor_id,
        vp.user_id,
        vp.verification_status,
        vp.company_name_ar,
        vp.company_name_en,
        vp.bio_ar,
        vp.bio_en,
        vp.location,
        COALESCE(vp.avg_rating, 0) AS avg_rating,
        COALESCE(vp.review_count, 0) AS review_count,
        COALESCE(vs.total_sales, 0) AS total_sales,
        COALESCE(vs.total_orders, 0) AS total_orders,
        COALESCE(vs.response_rate, 0) AS response_rate,
        COALESCE(vs.is_verified, CASE WHEN vp.verification_status = 'APPROVED' THEN TRUE ELSE FALSE END) AS is_verified,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        u.profile_image_url
      FROM vendor_stats vs
      JOIN vendor_profiles vp ON vs.vendor_id = vp.id
      JOIN users u ON vp.user_id = u.id AND u.deleted_at IS NULL
      WHERE vp.deleted_at IS NULL
    `;

    if (search) {
      sql += `
        AND (
          vp.company_name_ar LIKE :search
          OR vp.company_name_en LIKE :search
          OR vp.location LIKE :search
        )
      `;
      params.search = `%${search}%`;
    }

    sql += ' ORDER BY COALESCE(vp.review_count, 0) DESC, vp.created_at DESC';
    if (limit > 0) {
      sql += ` LIMIT ${Math.min(limit, 50)}`;
    }

    // Select from vendor_stats view, joined with users for identity data.
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  async findAllForAdmin(options = {}, connection = pool) {
    const status = `${options.status || ''}`.trim().toUpperCase();
    const params = {};
    let sql = `
      SELECT
        vp.id,
        vp.user_id,
        vp.verification_status,
        vp.company_name_ar,
        vp.company_name_en,
        vp.bio_ar,
        vp.bio_en,
        vp.location,
        vp.logo,
        vp.logo_public_id,
        vp.created_at,
        vp.updated_at,
        vp.deleted_at,
        COALESCE(vp.avg_rating, 0) AS avg_rating,
        COALESCE(vp.review_count, 0) AS review_count,
        COALESCE(vs.total_sales, 0) AS total_sales,
        COALESCE(vs.total_orders, 0) AS total_orders,
        COALESCE(vs.response_rate, 0) AS response_rate,
        COALESCE(vs.is_verified, CASE WHEN vp.verification_status = 'APPROVED' THEN TRUE ELSE FALSE END) AS is_verified,
        u.email,
        u.phone,
        u.is_active,
        u.deleted_at AS user_deleted_at,
        u.profile_image_url,
        (
          SELECT c.slug
          FROM categories c
          JOIN vendor_category_junction vcj ON c.id = vcj.category_id
          WHERE vcj.vendor_id = vp.id
          ORDER BY vcj.category_id ASC
          LIMIT 1
        ) AS category,
        CASE
          WHEN vp.deleted_at IS NOT NULL OR u.deleted_at IS NOT NULL THEN 'DELETED'
          WHEN u.is_active = 0 THEN 'INACTIVE'
          WHEN vp.verification_status = 'APPROVED' THEN 'APPROVED'
          WHEN vp.verification_status = 'REJECTED' THEN 'REJECTED'
          ELSE 'PENDING'
        END AS record_state
      FROM vendor_profiles vp
      LEFT JOIN vendor_stats vs ON vp.id = vs.vendor_id
      LEFT JOIN users u ON vp.user_id = u.id
      WHERE 1 = 1
    `;

    if (status && status !== 'ALL') {
      sql += ' AND vp.verification_status = :status';
      params.status = status;
    }

    sql += ' ORDER BY vp.created_at DESC, vp.id DESC';
    const [rows] = await connection.execute(sql, params);
    return rows;
  }

  /**
   * Retrieves a full vendor profile by its ID, including assigned business categories.
   * 
   * @async
   * @param {number} id - Vendor ID.
   * @returns {Promise<Object|null>} Enriched vendor object with categories.
   */
  async findById(id, options = {}) {
    const { includeDeleted = false, connection = pool } = options;

    // 1. Fetch aggregate metrics and user details for the specific vendor.
    const [rows] = await connection.execute(`
      SELECT
        vp.id,
        COALESCE(vs.vendor_id, vp.id) AS vendor_id,
        vp.user_id,
        vp.verification_status,
        vp.company_name_ar,
        vp.company_name_en,
        vp.bio_ar,
        vp.bio_en,
        vp.location,
        vp.logo,
        vp.logo_public_id,
        vp.created_at,
        vp.deleted_at,
        u.deleted_at AS user_deleted_at,
        COALESCE(vp.avg_rating, 0) AS avg_rating,
        COALESCE(vp.review_count, 0) AS review_count,
        COALESCE(vs.total_sales, 0) AS total_sales,
        COALESCE(vs.total_orders, 0) AS total_orders,
        COALESCE(vs.response_rate, 0) AS response_rate,
        COALESCE(vs.is_verified, CASE WHEN vp.verification_status = 'APPROVED' THEN TRUE ELSE FALSE END) AS is_verified,
        u.first_name,
        u.last_name,
        u.email,
        u.phone,
        u.profile_image_url
      FROM vendor_profiles vp
      LEFT JOIN vendor_stats vs ON vs.vendor_id = vp.id
      LEFT JOIN users u ON vp.user_id = u.id
      WHERE vp.id = :id
        ${includeDeleted ? '' : 'AND vp.deleted_at IS NULL AND u.deleted_at IS NULL'}
      LIMIT 1
    `, { id });
    const vendor = rows[0];
    if (vendor) {
      // 2. Multi-table Join: Retrieves categories linked to the vendor through the junction table.
      const [categories] = await connection.execute(`
        SELECT c.* 
        FROM categories c
        JOIN vendor_category_junction vcj ON c.id = vcj.category_id
        WHERE vcj.vendor_id = :id
          AND c.deleted_at IS NULL
      `, { id });
      vendor.categories = categories;
    }
    return vendor;
  }

  /**
   * Registers a new vendor profile.
   * 
   * @async
   * @param {Object} data - Profile attributes including localized multilingual bio.
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   * @returns {Promise<Object>} Created vendor ID and owner association.
   */
  async create(data, connection = pool) {
    const {
      userId,
      companyNameAr,
      companyNameEn,
      bioAr,
      bioEn,
      location,
      logo,
      logoPublicId,
    } = data;
    // Insert new profile with localization support and Cloudinary media references.
    const sql = `
      INSERT INTO vendor_profiles (user_id, company_name_ar, company_name_en, bio_ar, bio_en, location, logo, logo_public_id, verification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW(), NOW())
    `;
    const [result] = await connection.execute(sql, [
      userId, 
      companyNameAr, 
      companyNameEn, 
      bioAr || null, 
      bioEn || null, 
      location || null,
      logo || null, 
      logoPublicId || null 
    ]);
    return { id: result.insertId, userId };
  }

  /**
   * Updates core vendor profile attributes.
   * 
   * @async
   * @param {number} id - Vendor ID.
   * @param {Object} data - Updateable fields (company_name_ar/en, bio_ar/en, location).
   * @param {Object} [connection] - Transaction connection support.
   */
  async update(id, data, connection = pool) {
    const { companyNameAr, companyNameEn, bioAr, bioEn, location } = data;
    const sql = `
      UPDATE vendor_profiles 
      SET company_name_ar = :companyNameAr, 
          company_name_en = :companyNameEn, 
          bio_ar = :bioAr, 
          bio_en = :bioEn, 
          location = :location,
          updated_at = NOW()
      WHERE id = :id AND deleted_at IS NULL
    `;
    await connection.execute(sql, { id, companyNameAr, companyNameEn, bioAr, bioEn, location });
  }

  /**
   * Synchronizes vendor associations with business categories.
   * Performs a clean-slate update (Delete then Bulk Insert).
   * 
   * @async
   * @param {number} vendorId 
   * @param {Array<number>} categoryIds 
   * @param {Object} [connection]
   */
  async setCategories(vendorId, categoryIds, connection = pool) {
    // 1. Flush existing associations to ensure strict synchronization.
    await connection.execute('DELETE FROM vendor_category_junction WHERE vendor_id = ?', [vendorId]);
    
    // 2. Short-circuit if no new categories are assigned.
    if (!categoryIds || categoryIds.length === 0) return;

    // 3. Bulk Persistence: Rebuild the link table.
    const values = categoryIds.map(catId => [vendorId, catId]);
    await connection.query(
      'INSERT INTO vendor_category_junction (vendor_id, category_id) VALUES ?',
      [values]
    );
  }

  /**
   * Associates a vendor with multiple business categories.
   * 
   * @async
   * @param {number} vendorId 
   * @param {Array<number>} categoryIds 
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async addCategories(vendorId, categoryIds, connection = pool) {
    if (!categoryIds || categoryIds.length === 0) return;
    const values = categoryIds.map(catId => [vendorId, catId]);
    // Bulk Insert: Efficiently handles multiple junction entries at once.
    await connection.query(
      'INSERT INTO vendor_category_junction (vendor_id, category_id) VALUES ?',
      [values]
    );
  }

  /**
   * Performs a soft delete on a vendor profile.
   * 
   * @async
   * @param {number} id 
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async softDelete(id, connection = pool) {
    await connection.execute(
      'UPDATE vendor_profiles SET deleted_at = NOW() WHERE id = :id',
      { id }
    );
  }

  async hardDelete(id, connection = pool) {
    await connection.execute(
      'DELETE FROM vendor_profiles WHERE id = :id',
      { id }
    );
  }
}

export default new VendorRepository();
