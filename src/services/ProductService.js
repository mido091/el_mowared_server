/**
 * @file ProductService.js
 * @description Service for managing Product lifecycles.
 * Handles creation (→PENDING), updates (re-PENDING if APPROVED), review flow, and notifications.
 */

import ProductRepository from '../repositories/ProductRepository.js';
import NotificationService from './NotificationService.js';
import ProductMetricsService from './ProductMetricsService.js';
import MetricsCacheService from './MetricsCacheService.js';
import UploadService from './UploadService.js';
import slugify from 'slugify';
import pool from '../config/db.js';
import { AppError } from '../middlewares/errorHandler.js';

class ProductService {
  _normalizeQuantityAvailable(productData = {}) {
    const rawValue = productData.quantityAvailable ?? productData.quantity_available ?? 0;

    if (rawValue === '' || rawValue === null || rawValue === undefined) {
      return 0;
    }

    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new AppError('Quantity available must be a non-negative integer.', 400);
    }

    return parsed;
  }

  _effectiveStatus(product) {
    return product?.status || product?.lifecycle_status || 'PENDING';
  }

  _normalizeSpecs(specs) {
    if (!specs) return [];
    if (Array.isArray(specs)) return specs.filter(Boolean);
    if (typeof specs === 'string') {
      try {
        const parsed = JSON.parse(specs);
        return Array.isArray(parsed) ? parsed : Object.entries(parsed || {}).map(([key, value]) => ({ key, value }));
      } catch {
        return [];
      }
    }
    if (typeof specs === 'object') return Object.entries(specs).map(([key, value]) => ({ key, value }));
    return [];
  }

  _computeQualityScore(product) {
    const imagesCount = Array.isArray(product.images) ? product.images.length : (product.main_image ? 1 : 0);
    const specsCount = this._normalizeSpecs(product.specs).length;
    const descriptionLength = `${product.description_ar || ''} ${product.description_en || ''}`.trim().length;

    let score = 0;
    score += Math.min(imagesCount, 5) * 12;
    score += Math.min(specsCount, 6) * 6;
    score += descriptionLength >= 240 ? 24 : descriptionLength >= 120 ? 16 : descriptionLength >= 60 ? 8 : 0;
    if (product.name_ar && product.name_en) score += 10;
    if (product.price && product.min_order_quantity) score += 6;

    return Math.min(score, 100);
  }

  _decorateProduct(product) {
    if (!product) return product;
    const qualityScore = this._computeQualityScore(product);
    const effectiveStatus = this._effectiveStatus(product);
    const basePrice = Number(product.price ?? product.price_min ?? 0);
    const secondaryPrice = Number(product.discount_price ?? product.price_max ?? 0);
    const hasSecondaryPrice = Number.isFinite(secondaryPrice) && secondaryPrice > 0;
    const priceMin = hasSecondaryPrice ? Math.min(basePrice, secondaryPrice) : basePrice;
    const priceMax = hasSecondaryPrice ? Math.max(basePrice, secondaryPrice) : basePrice;

    return {
      ...product,
      status: effectiveStatus,
      price_min: priceMin,
      price_max: priceMax,
      price_range_type: hasSecondaryPrice && secondaryPrice > basePrice ? 'range' : hasSecondaryPrice && secondaryPrice < basePrice ? 'discount' : 'single',
      quantity_available: Number.isFinite(Number(product.quantity_available))
        ? Number(product.quantity_available)
        : Number.isFinite(Number(product.quantityAvailable))
          ? Number(product.quantityAvailable)
          : 0,
      is_visible: typeof product.is_visible === 'number'
        ? product.is_visible
        : effectiveStatus === 'APPROVED' ? 1 : 0,
      quality_score: qualityScore,
      visibility_boost: effectiveStatus === 'APPROVED' ? Math.max(0, Math.round(qualityScore / 10)) : 0
    };
  }

  _decorateProductCollection(products = []) {
    return products.map((product) => this._decorateProduct(product));
  }

  /**
   * Registers a new product as PENDING for admin moderation.
   */
  async createProduct(productData, files) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const slug = await this.generateUniqueSlug(productData.name_en);
      const quantityAvailable = this._normalizeQuantityAvailable(productData);
      const product = await ProductRepository.create({ ...productData, slug, quantityAvailable }, connection);

      if (files && files.length > 0) {
        const uploadPromises = files.map(f => UploadService.uploadImage(f.buffer, 'elmowared/products'));
        const results = await Promise.all(uploadPromises);
        const images = results.map((r, i) => ({ imageUrl: r.url, publicId: r.publicId, isMain: i === 0 }));
        await ProductRepository.addImages(product.id, images, connection);
      }

      await connection.commit();

      // Log status creation
      await ProductRepository.logStatusChange({
        productId: product.id,
        oldStatus: null,
        newStatus: 'PENDING',
        changedBy: productData.vendorId,
        note: 'Product submitted for review'
      });

      // Notify admins/owner that a new product is pending review
      await NotificationService.notifyAdminsProductSubmitted(product.id, productData.name_en || productData.name_ar);

      return this._decorateProduct(await ProductRepository.findById(product.id));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Updates an existing product.
   * If it was APPROVED: sets lifecycle_status → PENDING, logs the change, notifies admins.
   */
  async updateProduct(id, vendorId, productData, files) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const product = await ProductRepository.findById(id);
      if (!product || product.vendor_id !== vendorId) {
        throw new AppError('Product not found or unauthorized', 404);
      }

      const previousLifecycleStatus = product.lifecycle_status;
      const previousStatus = this._effectiveStatus(product);
      const slug = productData.name_en ? await this.generateUniqueSlug(productData.name_en) : product.slug;
      const quantityAvailable = this._normalizeQuantityAvailable(productData);

      const updatedProduct = await ProductRepository.update(id, {
        ...product,
        ...productData,
        slug,
        quantityAvailable,
        currentLifecycleStatus: previousLifecycleStatus,
        currentStatus: previousStatus
      }, connection);

      if (files && files.length > 0) {
        const oldImages = await ProductRepository.deleteImages(id, connection);
        for (const img of oldImages) {
          if (img.public_id) await UploadService.deleteImage(img.public_id);
        }
        const uploadPromises = files.map(f => UploadService.uploadImage(f.buffer, 'elmowared/products'));
        const results = await Promise.all(uploadPromises);
        const images = results.map((r, i) => ({ imageUrl: r.url, publicId: r.publicId, isMain: i === 0 }));
        await ProductRepository.addImages(id, images, connection);
      }

      await connection.commit();

      // If was APPROVED, log re-pending and notify admin
      if (previousStatus === 'APPROVED') {
        await ProductRepository.logStatusChange({
          productId: id,
          oldStatus: 'APPROVED',
          newStatus: 'UPDATE_PENDING',
          changedBy: vendorId,
          note: 'Product edited by vendor — back to review'
        });
        await NotificationService.notifyAdminsProductEdited(id, productData.name_en || product.name_en);
      } else if (['PENDING', 'REJECTED', 'UPDATE_PENDING'].includes(previousStatus)) {
        await ProductRepository.logStatusChange({
          productId: id,
          oldStatus: previousStatus,
          newStatus: 'PENDING',
          changedBy: vendorId,
          note: 'Product edited by vendor and returned to moderation queue'
        });
      }

      return this._decorateProduct(updatedProduct);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Admin/Owner: Approve or Reject a product.
   * Notifies the vendor of the outcome.
   */
  async reviewProduct({ productId, action, reason, reviewerId, reviewerName }) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const product = await ProductRepository.findById(productId);
      if (!product) throw new AppError('Product not found', 404);

      if (!['APPROVE', 'REJECT'].includes(action)) {
        throw new AppError('Invalid review action. Must be APPROVE or REJECT.', 400);
      }

      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const previousStatus = this._effectiveStatus(product);

      await ProductRepository.reviewProduct({
        id: productId,
        status: newStatus,
        lifecycleStatus: newStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        rejectionReason: action === 'REJECT' ? reason : null,
        reviewerId
      }, connection);

      await ProductRepository.logStatusChange({
        productId,
        oldStatus: previousStatus,
        newStatus,
        changedBy: reviewerId,
        note: action === 'REJECT'
          ? `Rejected by ${reviewerName || 'moderator'}: ${reason}`
          : `Approved by ${reviewerName || 'moderator'}`
      }, connection);

      await connection.commit();

      const vendorUserId = await this.getVendorUserId(product.vendor_id);
      if (action === 'APPROVE') {
        await NotificationService.notifyVendorProductApproved(vendorUserId, product.name_en || product.name_ar);
      } else {
        await NotificationService.notifyVendorProductRejected(vendorUserId, product.name_en || product.name_ar, reason);
      }

      return this._decorateProduct(await ProductRepository.findById(productId));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get vendor's user_id from vendor_id.
   */
  async getVendorUserId(vendorId) {
    const [rows] = await pool.execute('SELECT user_id FROM vendor_profiles WHERE id = :id LIMIT 1', { id: vendorId });
    return rows[0]?.user_id || null;
  }

  /**
   * Retrieves product status timeline.
   */
  async getStatusHistory(productId) {
    return ProductRepository.findStatusHistory(productId);
  }

  /**
   * Admin: Paginated list for moderation dashboard.
   */
  async getPendingProducts(filters) {
    const result = await ProductRepository.findPendingForAdmin(filters);
    return { ...result, products: this._decorateProductCollection(result.products) };
  }

  /**
   * Returns similar products (same category).
   */
  async getSimilarProducts(categoryId, excludeId, limit = 4) {
    return this._decorateProductCollection(await ProductRepository.findSimilar(categoryId, excludeId, limit));
  }

  /**
   * Universal slug generator.
   */
  async generateUniqueSlug(title) {
    const base = slugify(title, { lower: true, strict: true });
    let slug = base;
    let counter = 1;
    while (true) {
      const [rows] = await pool.execute('SELECT id FROM products WHERE slug = :slug LIMIT 1', { slug });
      if (rows.length === 0) break;
      slug = `${base}-${counter++}`;
    }
    return slug;
  }

  // ─── Basic CRUD Wrappers ─────────────────────────────────────────────────────

  async getAllProducts(filters) {
    const result = await ProductRepository.findAll(filters);
    return { ...result, products: this._decorateProductCollection(result.products) };
  }

  async getPublicMarketplaceSummary() {
    return MetricsCacheService.withCache(
      'public:marketplace-summary',
      () => ProductRepository.getPublicMarketplaceSummary(),
      5 * 60 * 1000
    );
  }

  async getProductById(id) {
    const product = await ProductRepository.findById(id);
    if (!product) throw new AppError('Product not found', 404);
    return this._decorateProduct(product);
  }

  async recordProductView(productId, viewContext = {}) {
    try {
      await ProductRepository.logView(productId, viewContext);
      ProductMetricsService.invalidateProduct(productId);
    } catch (error) {
      if (error?.code === 'ER_NO_SUCH_TABLE') return;
      throw error;
    }
  }

  async compareProducts(ids) {
    if (!ids || ids.length === 0) return [];
    return this._decorateProductCollection(await ProductRepository.findManyByIds(ids));
  }

  async deleteProduct(id, vendorId) {
    const product = await ProductRepository.findById(id);
    if (!product || product.vendor_id !== vendorId) {
      throw new AppError('Product not found or unauthorized', 404);
    }
    // Log deletion before soft-delete
    await ProductRepository.logStatusChange({
      productId: id,
      oldStatus: this._effectiveStatus(product),
      newStatus: 'DELETED',
      changedBy: vendorId,
      note: 'Soft deleted by vendor'
    });
    return ProductRepository.softDelete(id);
  }

  async bulkDeleteProducts(ids, vendorId) {
    if (!ids || ids.length === 0) return;
    return ProductRepository.bulkSoftDelete(ids, vendorId);
  }
}

export default new ProductService();
