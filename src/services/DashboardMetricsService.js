import pool from '../config/db.js';
import MetricsCacheService from './MetricsCacheService.js';
import VendorMetricsService from './VendorMetricsService.js';

class DashboardMetricsService {
  _normalizeCurrency(value) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  async getVendorDashboardStats(userId, options = {}) {
    const [[vendor]] = await pool.execute(
      'SELECT id, user_id FROM vendor_profiles WHERE user_id = :userId AND deleted_at IS NULL LIMIT 1',
      { userId }
    );

    if (!vendor) {
      return {
        active_products: 0,
        new_rfqs: 0,
        unread_messages: 0,
        pending_orders: 0,
        completed_orders: 0,
        total_orders: 0,
        total_revenue: 0,
        response_rate: 0,
        average_response_time_seconds: 0,
        average_response_time_label: 'No data yet',
        review_count: 0,
        rating: 0,
        trust_score: 0,
        trust_badges: []
      };
    }

    const metrics = await VendorMetricsService.getVendorMetrics(vendor.id, options);

    return {
      ...metrics,
      completed_orders: metrics.completed_deals
    };
  }

  async getAdminDashboardStats(options = {}) {
    const cacheKey = 'admin-dashboard-stats';
    if (!options.force) {
      const cached = MetricsCacheService.get(cacheKey);
      if (cached) return cached;
    }

    const [
      [platformRows],
      [rfqRows],
      [reviewRows],
      [vendorPerformanceRows],
      [leaderboardRows]
    ] = await Promise.all([
      pool.execute(
        `
        SELECT
          COALESCE((SELECT SUM(total_price) FROM orders WHERE status = 'COMPLETED'), 0) AS total_revenue,
          COALESCE((SELECT SUM(deposit_amount) FROM orders WHERE admin_approval_status = 'VERIFIED' AND status != 'COMPLETED'), 0) AS total_escrow,
          (SELECT COUNT(*) FROM vendor_profiles WHERE deleted_at IS NULL) AS vendors_count,
          (SELECT COUNT(*) FROM orders) AS orders_count,
          (SELECT COUNT(*) FROM users WHERE is_active = 1 AND deleted_at IS NULL) AS users_count,
          (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL AND lifecycle_status = 'APPROVED') AS active_products,
          (SELECT COUNT(*) FROM order_payments WHERE admin_status = 'PENDING') AS pending_payments
        `
      ),
      pool.execute(
        `
        SELECT
          COUNT(*) AS rfq_volume,
          COUNT(CASE WHEN status IN ('BROADCASTED', 'OPEN', 'NEGOTIATING', 'OFFERED', 'ACCEPTED') THEN 1 END) AS active_leads,
          COUNT(CASE WHEN status = 'EXPIRED' THEN 1 END) AS lost_to_expiry,
          COUNT(CASE WHEN status IN ('BROADCASTED', 'OPEN', 'NEGOTIATING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELED', 'COMPLETED') THEN 1 END) AS broadcast_stage,
          (SELECT COUNT(DISTINCT rfq_id) FROM rfq_offers) AS offer_stage,
          COUNT(CASE WHEN status IN ('ACCEPTED', 'COMPLETED') THEN 1 END) AS converted_stage,
          COUNT(CASE WHEN status IN ('OPEN', 'NEGOTIATING', 'OFFERED') THEN 1 END) AS open_rfqs
        FROM rfq_requests
        `
      ),
      pool.execute(
        `
        SELECT
          (SELECT COUNT(*) FROM product_reviews) + (SELECT COUNT(*) FROM vendor_reviews) AS total_reviews,
          (SELECT COUNT(*) FROM product_reviews WHERE status = 'PENDING') + (SELECT COUNT(*) FROM vendor_reviews WHERE status = 'PENDING') AS pending_reviews,
          (SELECT COUNT(*) FROM product_reviews WHERE profanity_flag = 1) + (SELECT COUNT(*) FROM vendor_reviews WHERE profanity_flag = 1) AS flagged_reviews
        `
      ),
      pool.execute(
        `
        SELECT
          ROUND(COALESCE(AVG(NULLIF(vs.response_speed_avg, 0)), 0), 0) AS avg_response_time_seconds,
          ROUND(COALESCE(AVG(vs.conversion_rate), 0), 1) AS avg_acceptance_rate,
          ROUND(
            CASE
              WHEN COUNT(vs.vendor_id) = 0 THEN 0
              ELSE AVG(GREATEST(0, 100 - COALESCE(vs.response_rate, 0)))
            END,
            1
          ) AS avg_ghosting_ratio
        FROM vendor_scores vs
        `
      ),
      pool.execute(
        `
        SELECT
          vp.id,
          COALESCE(vp.company_name_ar, vp.company_name_en) AS vendor_name,
          COALESCE(vs.completed_deals, 0) AS total_deals,
          COALESCE(vs.response_rate, 0) AS win_rate,
          COALESCE(vs.total_score, 0) AS overall_score
        FROM vendor_profiles vp
        LEFT JOIN vendor_scores vs ON vs.vendor_id = vp.id
        WHERE vp.deleted_at IS NULL
        ORDER BY overall_score DESC, total_deals DESC, win_rate DESC
        LIMIT 5
        `
      )
    ]);

    const platform = platformRows[0] || {};
    const rfq = rfqRows[0] || {};
    const reviews = reviewRows[0] || {};
    const performance = vendorPerformanceRows[0] || {};

    const created = Number(rfq.rfq_volume || 0);
    const broadcasted = Number(rfq.broadcast_stage || 0);
    const offered = Number(rfq.offer_stage || 0);
    const converted = Number(rfq.converted_stage || 0);

    const payload = {
      total_revenue: this._normalizeCurrency(platform.total_revenue),
      total_escrow: this._normalizeCurrency(platform.total_escrow),
      vendors_count: Number(platform.vendors_count || 0),
      orders_count: Number(platform.orders_count || 0),
      users_count: Number(platform.users_count || 0),
      active_products: Number(platform.active_products || 0),
      pending_payments: Number(platform.pending_payments || 0),
      rfq_volume: created,
      active_leads: Number(rfq.active_leads || 0),
      lost_to_expiry: Number(rfq.lost_to_expiry || 0),
      open_rfqs: Number(rfq.open_rfqs || 0),
      total_reviews: Number(reviews.total_reviews || 0),
      pending_reviews: Number(reviews.pending_reviews || 0),
      flagged_reviews: Number(reviews.flagged_reviews || 0),
      funnel: {
        created,
        broadcasted,
        offered,
        converted
      },
      vendor_performance: {
        avg_response_time_seconds: Number(performance.avg_response_time_seconds || 0),
        avg_acceptance_rate: Number(performance.avg_acceptance_rate || 0),
        avg_ghosting_ratio: Number(performance.avg_ghosting_ratio || 0)
      },
      leaderboard: (leaderboardRows || []).map((row) => ({
        id: row.id,
        name: row.vendor_name,
        deals: Number(row.total_deals || 0),
        winRate: Number(row.win_rate || 0),
        score: Number(row.overall_score || 0)
      }))
    };

    MetricsCacheService.set(cacheKey, payload);
    return payload;
  }

  invalidateAdminDashboard() {
    MetricsCacheService.invalidate('admin-dashboard-stats');
  }
}

export default new DashboardMetricsService();
