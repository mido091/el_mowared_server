import pool from '../config/db.js';
import VendorRepository from '../repositories/VendorRepository.js';
import ScoringService from './ScoringService.js';
import MetricsCacheService from './MetricsCacheService.js';
import { AppError } from '../middlewares/errorHandler.js';

const ACTIVE_RFQ_STATUSES = [
  'BROADCASTED',
  'OPEN',
  'NEGOTIATING',
  'OFFERED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELED',
  'COMPLETED'
];

class VendorMetricsService {
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

  _normalizePercent(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Number(numeric.toFixed(1))));
  }

  _normalizeScore(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Number(numeric.toFixed(1))));
  }

  _formatResponseTime(seconds) {
    const numeric = Number(seconds || 0);
    if (!numeric || numeric < 1) return { seconds: 0, label: 'No data yet' };

    if (numeric < 60) {
      return { seconds: numeric, label: `${Math.round(numeric)} sec` };
    }

    if (numeric < 3600) {
      return { seconds: numeric, label: `${Math.round(numeric / 60)} min` };
    }

    if (numeric < 86400) {
      return { seconds: numeric, label: `${(numeric / 3600).toFixed(1)} hrs` };
    }

    return { seconds: numeric, label: `${(numeric / 86400).toFixed(1)} days` };
  }

  async _getBaseMetrics(vendorId, vendorUserId, connection = pool) {
    const statusesPlaceholder = ACTIVE_RFQ_STATUSES.map(() => '?').join(', ');
    const hasLifecycleStatus = await this._hasProductColumn('lifecycle_status', connection);
    const hasStatus = await this._hasProductColumn('status', connection);
    const hasVisible = await this._hasProductColumn('is_visible', connection);
    const productStatusExpr = hasLifecycleStatus && hasStatus
      ? 'COALESCE(lifecycle_status, status)'
      : hasLifecycleStatus
        ? 'lifecycle_status'
        : hasStatus
          ? 'status'
          : "'APPROVED'";
    const productStatusExprWithAlias = hasLifecycleStatus && hasStatus
      ? 'COALESCE(p.lifecycle_status, p.status)'
      : hasLifecycleStatus
        ? 'p.lifecycle_status'
        : hasStatus
          ? 'p.status'
          : "'APPROVED'";
    const activeProductsExpr = hasVisible
      ? `COUNT(CASE WHEN deleted_at IS NULL AND ${productStatusExpr} = 'APPROVED' AND COALESCE(is_visible, 1) = 1 THEN 1 END) AS active_products`
      : `COUNT(CASE WHEN deleted_at IS NULL AND ${productStatusExpr} = 'APPROVED' THEN 1 END) AS active_products`;
    const publicApprovedProductWhere = hasVisible
      ? `p.deleted_at IS NULL AND ${productStatusExprWithAlias} = 'APPROVED' AND COALESCE(p.is_visible, 1) = 1`
      : `p.deleted_at IS NULL AND ${productStatusExprWithAlias} = 'APPROVED'`;

    const [
      [reviewRows],
      [productRows],
      [orderRows],
      [messageRows],
      [rfqRows],
      [responseRows]
    ] = await Promise.all([
      connection.execute(
        `
        SELECT
          ROUND(COALESCE(AVG(CASE WHEN pr.status = 'APPROVED' THEN pr.rating END), 0), 1) AS rating,
          COUNT(CASE WHEN pr.status = 'APPROVED' THEN 1 END) AS review_count
        FROM products p
        LEFT JOIN product_reviews pr ON pr.product_id = p.id
        WHERE p.vendor_id = ?
          AND ${publicApprovedProductWhere}
        `,
        [vendorId]
      ),
      connection.execute(
        `
        SELECT
          COUNT(*) AS total_products,
          ${activeProductsExpr}
        FROM products
        WHERE vendor_id = ?
          AND deleted_at IS NULL
        `,
        [vendorId]
      ),
      connection.execute(
        `
        SELECT
          COUNT(*) AS total_orders,
          COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_deals,
          COUNT(CASE WHEN status IN ('PENDING', 'PROCESSING', 'SHIPPED') THEN 1 END) AS pending_orders,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_price END), 0) AS total_revenue
        FROM orders
        WHERE vendor_id = ?
        `,
        [vendorId]
      ),
      connection.execute(
        `
        SELECT COUNT(*) AS unread_messages
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE c.vendor_id = ?
          AND m.sender_id != ?
          AND m.is_read = 0
          AND m.deleted_at IS NULL
        `,
        [vendorId, vendorUserId]
      ),
      connection.query(
        `
        SELECT
          COUNT(*) AS total_received_rfqs,
          SUM(CASE WHEN feed.vendor_has_offer = 1 OR feed.vendor_has_chat = 1 THEN 1 ELSE 0 END) AS responded_rfqs,
          SUM(CASE WHEN feed.vendor_has_offer = 0 AND feed.vendor_has_chat = 0 AND feed.vendor_has_declined = 0 THEN 1 ELSE 0 END) AS new_rfqs
        FROM (
          SELECT
            r.id,
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
          LEFT JOIN rfq_private_vendors pv
            ON pv.rfq_id = r.id
           AND pv.vendor_id = ?
          WHERE r.status IN (${statusesPlaceholder})
            AND (
              (r.privacy_type = 'PUBLIC' AND EXISTS (
                SELECT 1
                FROM vendor_category_junction vcj
                WHERE vcj.vendor_id = ?
                  AND vcj.category_id = r.category_id
              ))
              OR
              (r.privacy_type = 'PRIVATE' AND pv.vendor_id IS NOT NULL)
            )
        ) feed
        `,
        [vendorId, vendorId, vendorId, vendorId, ...ACTIVE_RFQ_STATUSES, vendorId]
      ),
      connection.query(
        `
        SELECT
          AVG(TIMESTAMPDIFF(SECOND, responded.rfq_created_at, responded.first_response_at)) AS average_response_seconds
        FROM (
          SELECT
            r.id,
            r.created_at AS rfq_created_at,
            MIN(events.event_at) AS first_response_at
          FROM rfq_requests r
          JOIN (
            SELECT rfq_id, vendor_id, created_at AS event_at
            FROM rfq_offers
            UNION ALL
            SELECT related_rfq_id AS rfq_id, vendor_id, created_at AS event_at
            FROM conversations
            WHERE related_rfq_id IS NOT NULL
          ) events
            ON events.rfq_id = r.id
           AND events.vendor_id = ?
          LEFT JOIN rfq_private_vendors pv
            ON pv.rfq_id = r.id
           AND pv.vendor_id = ?
          WHERE r.status IN (${statusesPlaceholder})
            AND (
              (r.privacy_type = 'PUBLIC' AND EXISTS (
                SELECT 1
                FROM vendor_category_junction vcj
                WHERE vcj.vendor_id = ?
                  AND vcj.category_id = r.category_id
              ))
              OR
              (r.privacy_type = 'PRIVATE' AND pv.vendor_id IS NOT NULL)
            )
          GROUP BY r.id, r.created_at
        ) responded
        `,
        [vendorId, vendorId, ...ACTIVE_RFQ_STATUSES, vendorId]
      )
    ]);

    return {
      rating: Number(reviewRows[0]?.rating || 0),
      review_count: Number(reviewRows[0]?.review_count || 0),
      total_products: Number(productRows[0]?.total_products || 0),
      active_products: Number(productRows[0]?.active_products || 0),
      total_orders: Number(orderRows[0]?.total_orders || 0),
      completed_deals: Number(orderRows[0]?.completed_deals || 0),
      pending_orders: Number(orderRows[0]?.pending_orders || 0),
      total_revenue: Number(orderRows[0]?.total_revenue || 0),
      unread_messages: Number(messageRows[0]?.unread_messages || 0),
      total_received_rfqs: Number(rfqRows[0]?.total_received_rfqs || 0),
      responded_rfqs: Number(rfqRows[0]?.responded_rfqs || 0),
      new_rfqs: Number(rfqRows[0]?.new_rfqs || 0),
      average_response_seconds: Number(responseRows[0]?.average_response_seconds || 0)
    };
  }

  async _persistScore(vendorId, metrics, connection = pool) {
    const ratingScore = this._normalizeScore((Number(metrics.rating || 0) / 5) * 100);
    const responseRateScore = this._normalizeScore(metrics.response_rate);
    const completedDealsScore = this._normalizeScore(Math.min(Number(metrics.completed_deals || 0) * 10, 100));

    let responseSpeedScore = 0;
    const seconds = Number(metrics.average_response_seconds || 0);
    if (seconds > 0 && seconds <= 300) responseSpeedScore = 100;
    else if (seconds <= 3600) responseSpeedScore = 85;
    else if (seconds <= 21600) responseSpeedScore = 70;
    else if (seconds <= 86400) responseSpeedScore = 55;
    else if (seconds > 86400) responseSpeedScore = 35;

    const trustScore = this._normalizeScore(
      (ratingScore * 0.4) +
      (responseRateScore * 0.2) +
      (completedDealsScore * 0.2) +
      (responseSpeedScore * 0.2)
    );

    const badges = [];
    if (responseRateScore >= 80) badges.push('RESPONSIVE');
    if (completedDealsScore >= 60) badges.push('ACTIVE_DEALER');
    if (ratingScore >= 80 && metrics.review_count > 0) badges.push('TOP_RATED');
    if (responseSpeedScore >= 85) badges.push('FAST_RESPONSE');

    await connection.execute(
      `
      INSERT INTO vendor_scores (
        vendor_id,
        response_speed_avg,
        response_rate,
        conversion_rate,
        completed_deals,
        badges,
        total_score
      )
      VALUES (
        :vendorId,
        :responseSpeedAvg,
        :responseRate,
        0,
        :completedDeals,
        :badges,
        :totalScore
      )
      ON DUPLICATE KEY UPDATE
        response_speed_avg = VALUES(response_speed_avg),
        response_rate = VALUES(response_rate),
        completed_deals = VALUES(completed_deals),
        badges = VALUES(badges),
        total_score = VALUES(total_score),
        updated_at = NOW()
      `,
      {
        vendorId,
        responseSpeedAvg: Math.round(Number(metrics.average_response_seconds || 0)),
        responseRate: metrics.response_rate,
        completedDeals: metrics.completed_deals,
        badges: JSON.stringify(badges),
        totalScore: trustScore
      }
    );

    return {
      trustScore,
      badges,
      breakdown: {
        rating: ratingScore,
        response_rate: responseRateScore,
        completed_deals: completedDealsScore,
        response_speed: responseSpeedScore
      }
    };
  }

  async _syncVendorReviewAggregate(vendorId, metrics, connection = pool) {
    await connection.execute(
      `
      UPDATE vendor_profiles
      SET avg_rating = :rating,
          review_count = :reviewCount,
          updated_at = NOW()
      WHERE id = :vendorId
      `,
      {
        vendorId,
        rating: Number(metrics.rating || 0),
        reviewCount: Number(metrics.review_count || 0)
      }
    );
  }

  async getVendorMetrics(vendorId, options = {}) {
    const safeVendorId = Number(vendorId);
    if (!safeVendorId) {
      throw new AppError('Vendor not found.', 404);
    }

    const cacheKey = `vendor-metrics:${safeVendorId}`;
    const useCache = !options.force;

    if (useCache) {
      const cached = MetricsCacheService.get(cacheKey);
      if (cached) return cached;
    }

    const vendor = await VendorRepository.findById(safeVendorId);
    if (!vendor) {
      throw new AppError('Vendor not found.', 404);
    }

    const metrics = await this._getBaseMetrics(safeVendorId, vendor.user_id);
    metrics.response_rate = this._normalizePercent(
      metrics.total_received_rfqs > 0
        ? (metrics.responded_rfqs / metrics.total_received_rfqs) * 100
        : 0
    );

    await this._syncVendorReviewAggregate(safeVendorId, metrics);
    const scoreMeta = await this._persistScore(safeVendorId, metrics);
    const responseTime = this._formatResponseTime(metrics.average_response_seconds);

    const payload = {
      vendor_id: safeVendorId,
      rating: Number(metrics.rating || 0),
      review_count: metrics.review_count,
      response_rate: metrics.response_rate,
      average_response_time_seconds: responseTime.seconds,
      average_response_time_label: responseTime.label,
      completed_deals: metrics.completed_deals,
      total_orders: metrics.total_orders,
      active_products: metrics.active_products,
      total_products: metrics.total_products,
      unread_messages: metrics.unread_messages,
      new_rfqs: metrics.new_rfqs,
      total_received_rfqs: metrics.total_received_rfqs,
      responded_rfqs: metrics.responded_rfqs,
      total_revenue: metrics.total_revenue,
      trust_score: scoreMeta.trustScore,
      trust_badges: scoreMeta.badges,
      trust_breakdown: scoreMeta.breakdown
    };

    MetricsCacheService.set(cacheKey, payload);
    return payload;
  }

  invalidateVendor(vendorId) {
    MetricsCacheService.invalidate(`vendor-metrics:${Number(vendorId)}`);
  }
}

export default new VendorMetricsService();
