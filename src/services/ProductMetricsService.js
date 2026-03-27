import pool from '../config/db.js';
import MetricsCacheService from './MetricsCacheService.js';
import { AppError } from '../middlewares/errorHandler.js';

class ProductMetricsService {
  async getProductMetrics(productId, options = {}) {
    const safeProductId = Number(productId);
    if (!safeProductId) {
      throw new AppError('Product not found.', 404);
    }

    const cacheKey = `product-metrics:${safeProductId}`;
    if (!options.force) {
      const cached = MetricsCacheService.get(cacheKey);
      if (cached) return cached;
    }

    const [[product]] = await pool.execute(
      `
      SELECT
        p.id,
        COALESCE(p.avg_rating, 0) AS rating,
        COALESCE(p.review_count, 0) AS review_count,
        COALESCE((
          SELECT COUNT(*)
          FROM product_view_logs pvl
          WHERE pvl.product_id = p.id
        ), 0) AS views_count,
        COALESCE((
          SELECT COUNT(*)
          FROM conversations c
          WHERE c.product_id = p.id
        ), 0) AS inquiries_count
      FROM products p
      WHERE p.id = :productId
        AND p.deleted_at IS NULL
      LIMIT 1
      `,
      { productId: safeProductId }
    );

    if (!product) {
      throw new AppError('Product not found.', 404);
    }

    const payload = {
      product_id: safeProductId,
      rating: Number(product.rating || 0),
      review_count: Number(product.review_count || 0),
      views_count: Number(product.views_count || 0),
      inquiries_count: Number(product.inquiries_count || 0)
    };

    MetricsCacheService.set(cacheKey, payload);
    return payload;
  }

  invalidateProduct(productId) {
    MetricsCacheService.invalidate(`product-metrics:${Number(productId)}`);
  }
}

export default new ProductMetricsService();
