import pool from '../config/db.js';

const REVIEW_TYPES = {
  PRODUCT: {
    table: 'product_reviews',
    targetColumn: 'product_id',
    targetJoin: 'JOIN products p ON r.product_id = p.id',
    targetLabelAr: 'p.name_ar',
    targetLabelEn: 'p.name_en',
    ownerJoin: 'JOIN vendor_profiles vp ON p.vendor_id = vp.id',
    ownerUserId: 'vp.user_id'
  },
  VENDOR: {
    table: 'vendor_reviews',
    targetColumn: 'vendor_id',
    targetJoin: 'JOIN vendor_profiles vp ON r.vendor_id = vp.id',
    targetLabelAr: 'vp.company_name_ar',
    targetLabelEn: 'vp.company_name_en',
    ownerJoin: 'JOIN vendor_profiles vp2 ON r.vendor_id = vp2.id',
    ownerUserId: 'vp2.user_id'
  }
};

class ReviewRepository {
  async _hasProductColumn(columnName, connection = pool) {
    const [[result]] = await connection.execute(
      `
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = :columnName
      `,
      { columnName }
    );

    return Number(result?.count || 0) > 0;
  }

  getConfig(type) {
    const config = REVIEW_TYPES[String(type || '').toUpperCase()];
    if (!config) {
      throw new Error(`Unsupported review type: ${type}`);
    }
    return config;
  }

  async createReview(type, payload, connection = pool) {
    const config = this.getConfig(type);
    const sql = `
      INSERT INTO ${config.table} (
        ${config.targetColumn},
        user_id,
        rating,
        comment,
        status,
        is_verified_review,
        interaction_type,
        interaction_reference_id,
        profanity_flag,
        profanity_score,
        flag_reason,
        order_id,
        created_at,
        updated_at
      )
      VALUES (
        :targetId,
        :userId,
        :rating,
        :comment,
        :status,
        :isVerifiedReview,
        :interactionType,
        :interactionReferenceId,
        :profanityFlag,
        :profanityScore,
        :flagReason,
        :orderId,
        NOW(),
        NOW()
      )
    `;

    const [result] = await connection.execute(sql, {
      targetId: payload.targetId,
      userId: payload.userId,
      rating: payload.rating,
      comment: payload.comment || null,
      status: payload.status || 'PENDING',
      isVerifiedReview: payload.isVerifiedReview ? 1 : 0,
      interactionType: payload.interactionType || null,
      interactionReferenceId: payload.interactionReferenceId || null,
      profanityFlag: payload.profanityFlag ? 1 : 0,
      profanityScore: payload.profanityScore || 0,
      flagReason: payload.flagReason || null,
      orderId: payload.orderId || null
    });

    return result.insertId;
  }

  async updateReview(type, reviewId, payload, connection = pool) {
    const config = this.getConfig(type);
    const sql = `
      UPDATE ${config.table}
      SET rating = :rating,
          comment = :comment,
          status = :status,
          is_verified_review = :isVerifiedReview,
          interaction_type = :interactionType,
          interaction_reference_id = :interactionReferenceId,
          profanity_flag = :profanityFlag,
          profanity_score = :profanityScore,
          flag_reason = :flagReason,
          updated_at = NOW(),
          moderated_by = NULL,
          moderated_at = NULL
      WHERE id = :reviewId
        AND user_id = :userId
    `;

    const [result] = await connection.execute(sql, {
      reviewId,
      userId: payload.userId,
      rating: payload.rating,
      comment: payload.comment || null,
      status: payload.status || 'PENDING',
      isVerifiedReview: payload.isVerifiedReview ? 1 : 0,
      interactionType: payload.interactionType || null,
      interactionReferenceId: payload.interactionReferenceId || null,
      profanityFlag: payload.profanityFlag ? 1 : 0,
      profanityScore: payload.profanityScore || 0,
      flagReason: payload.flagReason || null
    });

    return result.affectedRows > 0;
  }

  async moderateReview(type, reviewId, { status, moderatedBy, flagReason = null }, connection = pool) {
    const config = this.getConfig(type);
    const sql = `
      UPDATE ${config.table}
      SET status = :status,
          moderated_by = :moderatedBy,
          moderated_at = NOW(),
          flag_reason = COALESCE(:flagReason, flag_reason),
          updated_at = NOW()
      WHERE id = :reviewId
    `;

    const [result] = await connection.execute(sql, {
      reviewId,
      status,
      moderatedBy,
      flagReason
    });

    return result.affectedRows > 0;
  }

  async deleteReview(type, reviewId, connection = pool) {
    const config = this.getConfig(type);
    const [result] = await connection.execute(
      `DELETE FROM ${config.table} WHERE id = :reviewId`,
      { reviewId }
    );
    return result.affectedRows > 0;
  }

  async getReviewById(type, reviewId, connection = pool) {
    const config = this.getConfig(type);
    const sql = `
      SELECT r.*
      FROM ${config.table} r
      WHERE r.id = :reviewId
      LIMIT 1
    `;
    const [rows] = await connection.execute(sql, { reviewId });
    return rows[0] || null;
  }

  async findUserReview(type, targetId, userId, connection = pool) {
    const config = this.getConfig(type);
    const sql = `
      SELECT r.*
      FROM ${config.table} r
      WHERE r.${config.targetColumn} = :targetId
        AND r.user_id = :userId
      LIMIT 1
    `;
    const [rows] = await connection.execute(sql, { targetId, userId });
    return rows[0] || null;
  }

  async getTargetReviews(type, targetId, sortBy = 'newest', connection = pool) {
    const config = this.getConfig(type);
    const orderBy = sortBy === 'highest'
      ? 'r.rating DESC, r.created_at DESC'
      : 'r.created_at DESC';
    const sql = `
      SELECT
        r.id,
        r.rating,
        r.comment,
        r.status,
        r.is_verified_review,
        r.profanity_flag,
        r.created_at,
        r.updated_at,
        CONCAT_WS(' ', u.first_name, u.last_name) AS reviewer_name,
        u.profile_image_url AS reviewer_avatar
      FROM ${config.table} r
      JOIN users u ON r.user_id = u.id
      WHERE r.${config.targetColumn} = :targetId
        AND r.status = 'APPROVED'
      ORDER BY ${orderBy}
    `;

    const [rows] = await connection.execute(sql, { targetId });
    return rows;
  }

  async getTargetSummary(type, targetId, connection = pool) {
    const config = this.getConfig(type);
    const sql = `
      SELECT
        ROUND(COALESCE(AVG(CASE WHEN status = 'APPROVED' THEN rating END), 0), 1) AS averageRating,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) AS totalReviews,
        COUNT(CASE WHEN status = 'PENDING' THEN 1 END) AS pendingReviews,
        COUNT(CASE WHEN status = 'APPROVED' AND is_verified_review = 1 THEN 1 END) AS verifiedReviews
      FROM ${config.table}
      WHERE ${config.targetColumn} = :targetId
    `;

    const [[summary]] = await connection.execute(sql, { targetId });
    return summary || { averageRating: 0, totalReviews: 0, pendingReviews: 0, verifiedReviews: 0 };
  }

  async userHasOrderWithVendor(userId, vendorId, connection = pool) {
    const [[row]] = await connection.execute(
      `
      SELECT id
      FROM orders
      WHERE user_id = :userId
        AND vendor_id = :vendorId
      ORDER BY created_at DESC
      LIMIT 1
      `,
      { userId, vendorId }
    );
    return row || null;
  }

  async userHasConversationWithVendor(userId, vendorId, connection = pool) {
    const [[row]] = await connection.execute(
      `
      SELECT id
      FROM conversations
      WHERE user_id = :userId
        AND vendor_id = :vendorId
      ORDER BY created_at DESC
      LIMIT 1
      `,
      { userId, vendorId }
    );
    return row || null;
  }

  async userHasRfqInteractionWithVendor(userId, vendorId, connection = pool) {
    const [[row]] = await connection.execute(
      `
      SELECT ro.id, ro.rfq_id
      FROM rfq_offers ro
      JOIN rfq_requests rr ON rr.id = ro.rfq_id
      WHERE rr.user_id = :userId
        AND ro.vendor_id = :vendorId
      ORDER BY ro.created_at DESC
      LIMIT 1
      `,
      { userId, vendorId }
    );
    return row || null;
  }

  async userHasOrderWithProduct(userId, productId, connection = pool) {
    const [[row]] = await connection.execute(
      `
      SELECT oi.order_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.user_id = :userId
        AND oi.product_id = :productId
      ORDER BY oi.created_at DESC
      LIMIT 1
      `,
      { userId, productId }
    );
    return row || null;
  }

  async userHasConversationWithProduct(userId, productId, connection = pool) {
    const [[row]] = await connection.execute(
      `
      SELECT id
      FROM conversations
      WHERE user_id = :userId
        AND product_id = :productId
      ORDER BY created_at DESC
      LIMIT 1
      `,
      { userId, productId }
    );
    return row || null;
  }

  async userHasQuoteWithProduct(userId, productId, connection = pool) {
    const [[row]] = await connection.execute(
      `
      SELECT id
      FROM quotation_requests
      WHERE user_id = :userId
        AND product_id = :productId
      ORDER BY created_at DESC
      LIMIT 1
      `,
      { userId, productId }
    );
    return row || null;
  }

  async getVendorOwnerUserId(vendorId, connection = pool) {
    const [[row]] = await connection.execute(
      'SELECT user_id FROM vendor_profiles WHERE id = :vendorId LIMIT 1',
      { vendorId }
    );
    return row?.user_id || null;
  }

  async getProductOwnerContext(productId, connection = pool) {
    const [[row]] = await connection.execute(
      `
      SELECT p.id AS product_id, p.vendor_id, vp.user_id AS vendor_user_id, p.name_ar, p.name_en
      FROM products p
      JOIN vendor_profiles vp ON vp.id = p.vendor_id
      WHERE p.id = :productId
      LIMIT 1
      `,
      { productId }
    );
    return row || null;
  }

  async recalculateVendorAggregate(vendorId, connection = pool) {
    const [[stats]] = await connection.execute(
      `
      SELECT
        ROUND(COALESCE(AVG(CASE WHEN status = 'APPROVED' THEN rating END), 0), 1) AS averageRating,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) AS totalReviews
      FROM vendor_reviews
      WHERE vendor_id = :vendorId
      `,
      { vendorId }
    );

    await connection.execute(
      `
      UPDATE vendor_profiles
      SET avg_rating = :averageRating,
          review_count = :totalReviews,
          updated_at = NOW()
      WHERE id = :vendorId
      `,
      {
        vendorId,
        averageRating: stats?.averageRating || 0,
        totalReviews: stats?.totalReviews || 0
      }
    );

    return stats;
  }

  async recalculateProductAggregate(productId, connection = pool) {
    const [[stats]] = await connection.execute(
      `
      SELECT
        ROUND(COALESCE(AVG(CASE WHEN status = 'APPROVED' THEN rating END), 0), 1) AS averageRating,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) AS totalReviews
      FROM product_reviews
      WHERE product_id = :productId
      `,
      { productId }
    );

    await connection.execute(
      `
      UPDATE products
      SET avg_rating = :averageRating,
          review_count = :totalReviews,
          updated_at = NOW()
      WHERE id = :productId
      `,
      {
        productId,
        averageRating: stats?.averageRating || 0,
        totalReviews: stats?.totalReviews || 0
      }
    );

    return stats;
  }

  async recalculateVendorProductAggregate(vendorId, connection = pool) {
    const hasLifecycleStatus = await this._hasProductColumn('lifecycle_status', connection);
    const hasStatus = await this._hasProductColumn('status', connection);
    const hasVisible = await this._hasProductColumn('is_visible', connection);
    const productStatusExpr = hasLifecycleStatus && hasStatus
      ? 'COALESCE(p.lifecycle_status, p.status)'
      : hasLifecycleStatus
        ? 'p.lifecycle_status'
        : hasStatus
          ? 'p.status'
          : "'APPROVED'";
    const publicApprovedProductWhere = hasVisible
      ? `p.deleted_at IS NULL AND ${productStatusExpr} = 'APPROVED' AND COALESCE(p.is_visible, 1) = 1`
      : `p.deleted_at IS NULL AND ${productStatusExpr} = 'APPROVED'`;

    const [[stats]] = await connection.execute(
      `
      SELECT
        ROUND(COALESCE(AVG(CASE WHEN pr.status = 'APPROVED' THEN pr.rating END), 0), 1) AS averageRating,
        COUNT(CASE WHEN pr.status = 'APPROVED' THEN 1 END) AS totalReviews
      FROM products p
      LEFT JOIN product_reviews pr ON pr.product_id = p.id
      WHERE p.vendor_id = :vendorId
        AND ${publicApprovedProductWhere}
      `,
      { vendorId }
    );

    await connection.execute(
      `
      UPDATE vendor_profiles
      SET avg_rating = :averageRating,
          review_count = :totalReviews,
          updated_at = NOW()
      WHERE id = :vendorId
      `,
      {
        vendorId,
        averageRating: stats?.averageRating || 0,
        totalReviews: stats?.totalReviews || 0
      }
    );

    return stats;
  }

  async getAdminReviews(filters = {}, connection = pool) {
    const params = {
      status: filters.status || null,
      minRating: filters.minRating || null,
      maxRating: filters.maxRating || null,
      search: filters.search ? `%${filters.search}%` : null,
      flaggedOnly: filters.flaggedOnly ? 1 : 0,
      dateFrom: filters.dateFrom || null,
      dateTo: filters.dateTo || null
    };

    const buildWhere = (alias, targetAr, targetEn) => `
      WHERE (:status IS NULL OR ${alias}.status = :status)
        AND (:minRating IS NULL OR ${alias}.rating >= :minRating)
        AND (:maxRating IS NULL OR ${alias}.rating <= :maxRating)
        AND (:flaggedOnly = 0 OR ${alias}.profanity_flag = 1)
        AND (:dateFrom IS NULL OR DATE(${alias}.created_at) >= :dateFrom)
        AND (:dateTo IS NULL OR DATE(${alias}.created_at) <= :dateTo)
        AND (
          :search IS NULL
          OR CONCAT_WS(' ', u.first_name, u.last_name) LIKE :search
          OR ${targetAr} LIKE :search
          OR ${targetEn} LIKE :search
          OR ${alias}.comment LIKE :search
        )
    `;

    const sql = `
      SELECT *
      FROM (
        SELECT
          'PRODUCT' AS review_type,
          pr.id,
          pr.product_id AS target_id,
          NULL AS vendor_id,
          pr.user_id,
          pr.rating,
          pr.comment,
          pr.status,
          pr.is_verified_review,
          pr.profanity_flag,
          pr.profanity_score,
          pr.flag_reason,
          pr.created_at,
          pr.updated_at,
          pr.moderated_at,
          CONCAT_WS(' ', u.first_name, u.last_name) AS user_name,
          p.name_ar AS target_name_ar,
          p.name_en AS target_name_en,
          CONCAT_WS(' ', mu.first_name, mu.last_name) AS moderated_by_name
        FROM product_reviews pr
        JOIN users u ON u.id = pr.user_id
        JOIN products p ON p.id = pr.product_id
        LEFT JOIN users mu ON mu.id = pr.moderated_by
        ${buildWhere('pr', 'p.name_ar', 'p.name_en')}

        UNION ALL

        SELECT
          'VENDOR' AS review_type,
          vr.id,
          NULL AS target_id,
          vr.vendor_id,
          vr.user_id,
          vr.rating,
          vr.comment,
          vr.status,
          vr.is_verified_review,
          vr.profanity_flag,
          vr.profanity_score,
          vr.flag_reason,
          vr.created_at,
          vr.updated_at,
          vr.moderated_at,
          CONCAT_WS(' ', u.first_name, u.last_name) AS user_name,
          vp.company_name_ar AS target_name_ar,
          vp.company_name_en AS target_name_en,
          CONCAT_WS(' ', mu.first_name, mu.last_name) AS moderated_by_name
        FROM vendor_reviews vr
        JOIN users u ON u.id = vr.user_id
        JOIN vendor_profiles vp ON vp.id = vr.vendor_id
        LEFT JOIN users mu ON mu.id = vr.moderated_by
        ${buildWhere('vr', 'vp.company_name_ar', 'vp.company_name_en')}
      ) combined
      ${filters.type ? 'WHERE combined.review_type = :type' : ''}
      ORDER BY combined.created_at DESC
    `;

    if (filters.type) {
      params.type = String(filters.type).toUpperCase();
    }

    const [rows] = await connection.execute(sql, params);
    return rows;
  }

  async getAdminReviewStats(connection = pool) {
    const [[stats]] = await connection.execute(`
      SELECT
        (SELECT COUNT(*) FROM product_reviews) + (SELECT COUNT(*) FROM vendor_reviews) AS totalReviews,
        (SELECT COUNT(*) FROM product_reviews WHERE status = 'PENDING') + (SELECT COUNT(*) FROM vendor_reviews WHERE status = 'PENDING') AS pendingReviews,
        (SELECT COUNT(*) FROM product_reviews WHERE status = 'APPROVED' AND DATE(moderated_at) = CURRENT_DATE) +
        (SELECT COUNT(*) FROM vendor_reviews WHERE status = 'APPROVED' AND DATE(moderated_at) = CURRENT_DATE) AS approvedToday,
        (SELECT COUNT(*) FROM product_reviews WHERE profanity_flag = 1) + (SELECT COUNT(*) FROM vendor_reviews WHERE profanity_flag = 1) AS flaggedReviews
    `);
    return stats || {
      totalReviews: 0,
      pendingReviews: 0,
      approvedToday: 0,
      flaggedReviews: 0
    };
  }

  async getTopVendors(connection = pool) {
    const [rows] = await connection.execute(`
      SELECT
        vp.id,
        vp.company_name_ar,
        vp.company_name_en,
        vp.avg_rating,
        vp.review_count,
        COALESCE(vs.response_rate, 0) AS response_rate
      FROM vendor_profiles vp
      LEFT JOIN vendor_scores vs ON vs.vendor_id = vp.id
      WHERE vp.deleted_at IS NULL
        AND COALESCE(vp.review_count, 0) > 0
      ORDER BY vp.avg_rating DESC, vp.review_count DESC, response_rate DESC
      LIMIT 5
    `);
    return rows;
  }

  async getCategoryReviewAverages(connection = pool) {
    const [rows] = await connection.execute(`
      SELECT
        c.id,
        c.name_ar,
        c.name_en,
        ROUND(AVG(pr.rating), 1) AS average_rating,
        COUNT(pr.id) AS total_reviews
      FROM product_reviews pr
      JOIN products p ON p.id = pr.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE pr.status = 'APPROVED'
      GROUP BY c.id, c.name_ar, c.name_en
      ORDER BY average_rating DESC, total_reviews DESC
      LIMIT 8
    `);
    return rows;
  }
}

export default new ReviewRepository();
