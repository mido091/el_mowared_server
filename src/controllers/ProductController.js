/**
 * @file ProductController.js
 * @description Controller for Product management with full lifecycle support.
 */

import ProductService from '../services/ProductService.js';
import ProductMetricsService from '../services/ProductMetricsService.js';
import { z } from 'zod';
import { paginate, formatPaginatedResponse } from '../utils/pagination.js';
import crypto from 'crypto';
import { AppError } from '../middlewares/errorHandler.js';

const productSchema = z.object({
  categoryId: z.preprocess((val) => Number(val), z.number()),
  name_ar: z.string().min(3),
  name_en: z.string().min(3),
  description_ar: z.string().min(10),
  description_en: z.string().min(10),
  price: z.preprocess((val) => Number(val), z.number().nonnegative()).optional(),
  discountPrice: z.preprocess((val) => Number(val), z.number().nonnegative()).optional(),
  minOrderQuantity: z.preprocess((val) => Number(val), z.number().int().positive()).optional(),
  quantityAvailable: z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return undefined;
    return Number(val);
  }, z.number().int().nonnegative()).optional(),
  quantity_available: z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return undefined;
    return Number(val);
  }, z.number().int().nonnegative()).optional(),
  location: z.string().optional(),
  specs: z.union([z.string(), z.array(z.any())]).optional()
});

const productReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']).optional(),
  status: z.enum(['approved', 'rejected', 'pending', 'update_pending', 'APPROVED', 'REJECTED', 'PENDING', 'UPDATE_PENDING']).optional(),
  reason: z.preprocess((value) => value === null ? undefined : value, z.string().trim().optional()),
  rejection_reason: z.preprocess((value) => value === null ? undefined : value, z.string().trim().optional())
}).refine((value) => value.action || value.status, {
  message: 'action or status is required'
});

class ProductController {
  constructor() {
    this.getPending = this.getPending.bind(this);
    this.getAdminOne = this.getAdminOne.bind(this);
    this.getAll = this.getAll.bind(this);
    this.getVendorCatalog = this.getVendorCatalog.bind(this);
    this.getByVendor = this.getByVendor.bind(this);
    this.getOne = this.getOne.bind(this);
    this.getMetrics = this.getMetrics.bind(this);
    this.registerView = this.registerView.bind(this);
    this.getPublicSummary = this.getPublicSummary.bind(this);
    this.getSimilar = this.getSimilar.bind(this);
    this.getStatusHistory = this.getStatusHistory.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.review = this.review.bind(this);
    this.getModerationList = this.getModerationList.bind(this);
    this.compare = this.compare.bind(this);
    this.delete = this.delete.bind(this);
    this.bulkDelete = this.bulkDelete.bind(this);
  }

  _buildViewContext(req) {
    const forwarded = `${req.headers['x-forwarded-for'] || ''}`.split(',')[0].trim();
    const ipSource = forwarded || req.ip || req.socket?.remoteAddress || '';
    const userAgent = `${req.headers['user-agent'] || ''}`.trim();
    const sessionSeed = `${ipSource}|${userAgent}|${req.headers['accept-language'] || ''}`;

    return {
      viewerId: req.user?.id || null,
      sessionKey: crypto.createHash('sha1').update(sessionSeed).digest('hex'),
      ipHash: ipSource ? crypto.createHash('sha1').update(ipSource).digest('hex') : null,
      userAgentHash: userAgent ? crypto.createHash('sha1').update(userAgent).digest('hex') : null
    };
  }

  async getPending(req, res, next) {
    try {
      const { page, limit } = req.query;
      const { limit: l, offset, page: p } = paginate(page, limit);
      const { products } = await ProductService.getPendingProducts({
        lifecycleStatus: undefined,
        limit: l,
        offset
      });
      const pendingProducts = products.filter((product) => ['PENDING', 'UPDATE_PENDING'].includes((product.lifecycle_status || product.status || '').toUpperCase()));
      res.status(200).json({
        status: 'success',
        data: formatPaginatedResponse(res.formatLocalization(pendingProducts), pendingProducts.length, p, l)
      });
    } catch (error) {
      next(error);
    }
  }

  updateStatus = async (req, res, next) => {
    return this.review(req, res, next);
  }

  async getAdminOne(req, res, next) {
    try {
      const product = await ProductService.getProductById(req.params.id);
      res.status(200).json({ status: 'success', data: res.formatLocalization(product) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Public marketplace — only APPROVED products.
   */
  async getAll(req, res, next) {
    try {
      const { category, vendor, search, page, limit, minPrice, maxPrice, moq, location, sortBy, filter } = req.query;
      const { limit: l, offset, page: p } = paginate(page, limit);
      const discounted = filter === 'discounted';

      const { products, total } = await ProductService.getAllProducts({
        categoryId: category,
        vendorId: vendor,
        searchTerm: search,
        minPrice, maxPrice, moq, location, sortBy, discounted,
        limit: l, offset,
        publicOnly: true  // Only APPROVED products for public
      });

      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({
        status: 'success',
        data: formatPaginatedResponse(res.formatLocalization(products), total, p, l)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Vendor catalog (own products — all statuses visible to vendor).
   */
  async getVendorCatalog(req, res, next) {
    try {
      const { page, limit, search, lifecycleStatus } = req.query;
      const { limit: l, offset, page: p } = paginate(page, limit);
      const vendorId = req.user.vendorProfile?.id;

      if (!vendorId) {
        throw new AppError({
          en: 'Vendor profile not found.',
          ar: 'ملف المورد غير موجود.'
        }, 403, 'VENDOR_PROFILE_NOT_FOUND');
      }

      const { products, total } = await ProductService.getAllProducts({
        vendorId,
        searchTerm: search,
        lifecycleStatus: lifecycleStatus || undefined,
        limit: l,
        offset
      });

      console.dir({
         event: 'VENDOR_CATALOG_DEBUG',
         reqUserVendorId: vendorId,
         queryLimit: l, offset,
         totalFound: total,
         productsLength: products.length
      });

      res.status(200).json({
        status: 'success',
        data: formatPaginatedResponse(res.formatLocalization(products), total, p, l)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Vendor storefront (public — only APPROVED).
   */
  async getByVendor(req, res, next) {
    try {
      const { vendorId } = req.params;
      const { page, limit, search } = req.query;
      const { limit: l, offset, page: p } = paginate(page, limit);

      const { products, total } = await ProductService.getAllProducts({
        vendorId: parseInt(vendorId),
        searchTerm: search,
        limit: l, offset,
        publicOnly: true
      });

      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({
        status: 'success',
        data: formatPaginatedResponse(res.formatLocalization(products), total, p, l)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Single product detail.
   */
  async getOne(req, res, next) {
    try {
      const product = await ProductService.getProductById(req.params.id);
      const effectiveStatus = product.status || product.lifecycle_status;
      if (effectiveStatus !== 'APPROVED' || Number(product.is_visible) === 0) {
        throw new AppError({
          en: 'Product not found.',
          ar: 'المنتج المطلوب غير موجود.'
        }, 404, 'NOT_FOUND');
      }
      await ProductService.recordProductView(product.id, this._buildViewContext(req));
      res.status(200).json({ status: 'success', data: res.formatLocalization(product) });
    } catch (error) {
      next(error);
    }
  }

  async getMetrics(req, res, next) {
    try {
      const metrics = await ProductMetricsService.getProductMetrics(req.params.id);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({
        status: 'success',
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  async registerView(req, res, next) {
    try {
      await ProductService.recordProductView(req.params.id, this._buildViewContext(req));
      const metrics = await ProductMetricsService.getProductMetrics(req.params.id, { force: true });
      res.status(200).json({
        status: 'success',
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  async getPublicSummary(req, res, next) {
    try {
      const summary = await ProductService.getPublicMarketplaceSummary();
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      res.status(200).json({
        status: 'success',
        data: summary
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get similar products (same category).
   */
  async getSimilar(req, res, next) {
    try {
      const product = await ProductService.getProductById(req.params.id);
      const similar = await ProductService.getSimilarProducts(product.category_id, req.params.id, 4);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({ status: 'success', data: res.formatLocalization(similar) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get product status history (vendor/admin).
   */
  async getStatusHistory(req, res, next) {
    try {
      const history = await ProductService.getStatusHistory(req.params.id);
      res.status(200).json({ status: 'success', data: history });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create product → PENDING status.
   */
  async create(req, res, next) {
    try {
      const body = { ...req.body };
      const productData = productSchema.parse(body);

      if (!req.user.vendorProfile) {
        throw new AppError({
          en: 'Vendor profile not found.',
          ar: 'ملف المورد غير موجود.'
        }, 403, 'VENDOR_PROFILE_NOT_FOUND');
      }

      const product = await ProductService.createProduct({
        ...productData,
        vendorId: req.user.vendorProfile.id
      }, req.files);

      res.status(201).json({ status: 'success', data: product });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update product — may re-trigger PENDING if was APPROVED.
   */
  async update(req, res, next) {
    try {
      const productData = productSchema.partial().parse(req.body);

      if (!req.user.vendorProfile) {
        throw new AppError({
          en: 'Vendor profile not found.',
          ar: 'ملف المورد غير موجود.'
        }, 403, 'VENDOR_PROFILE_NOT_FOUND');
      }

      const product = await ProductService.updateProduct(
        req.params.id,
        req.user.vendorProfile.id,
        productData,
        req.files
      );

      res.status(200).json({ status: 'success', data: product });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin/Owner: Review (APPROVE or REJECT) a product.
   * Body: { action: 'APPROVE'|'REJECT', reason?: string }
   */
  async review(req, res, next) {
    try {
      const { action, status, reason, rejection_reason } = productReviewSchema.parse(req.body);
      const normalizedStatus = (status || '').toUpperCase();
      const normalizedAction = action || (normalizedStatus === 'APPROVED' ? 'APPROVE' : normalizedStatus === 'REJECTED' ? 'REJECT' : null);

      if (!normalizedAction) {
        throw new AppError({
          en: 'The review action is invalid. Please choose approve or reject.',
          ar: 'إجراء المراجعة غير صالح. يرجى اختيار قبول أو رفض.'
        }, 400, 'INVALID_REVIEW_ACTION');
      }

      const product = await ProductService.reviewProduct({
        productId: req.params.id,
        action: normalizedAction,
        reason: rejection_reason || reason,
        reviewerId: req.user.id,
        reviewerName: [req.user.first_name, req.user.last_name].filter(Boolean).join(' ').trim() || req.user.email || req.user.role
      });

      res.status(200).json({ status: 'success', data: product });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Admin: Moderation queue — products pending review.
   */
  async getModerationList(req, res, next) {
    try {
      const { lifecycleStatus, page, limit } = req.query;
      const { limit: l, offset, page: p } = paginate(page, limit);
      const { products, total } = await ProductService.getPendingProducts({
        lifecycleStatus: lifecycleStatus || undefined,
        limit: l,
        offset
      });
      res.status(200).json({
        status: 'success',
        data: formatPaginatedResponse(res.formatLocalization(products), total, p, l)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Compare products by ID.
   */
  async compare(req, res, next) {
    try {
      const { ids } = req.query;
      if (!ids) {
        throw new AppError({
          en: 'Please provide at least one product ID.',
          ar: 'يرجى إرسال معرف منتج واحد على الأقل.'
        }, 400, 'PRODUCT_IDS_REQUIRED');
      }
      const idList = ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      const products = await ProductService.compareProducts(idList);
      res.status(200).json({ status: 'success', data: res.formatLocalization(products) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Vendor soft-delete.
   */
  async delete(req, res, next) {
    try {
      await ProductService.deleteProduct(req.params.id, req.user.vendorProfile.id);
      res.status(204).json({ status: 'success', data: null });
    } catch (error) {
      next(error);
    }
  }

  async bulkDelete(req, res, next) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new AppError({
          en: 'Please provide at least one product ID.',
          ar: 'يرجى إرسال معرف منتج واحد على الأقل.'
        }, 400, 'PRODUCT_IDS_REQUIRED');
      }
      await ProductService.bulkDeleteProducts(ids, req.user.vendorProfile.id);
      res.status(200).json({ status: 'success', message: 'Products deleted successfully' });
    } catch (error) {
      next(error);
    }
  }
}

export default new ProductController();
