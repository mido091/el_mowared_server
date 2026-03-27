import validator from 'validator';
import ReviewRepository from '../repositories/ReviewRepository.js';
import NotificationService from './NotificationService.js';
import VendorMetricsService from './VendorMetricsService.js';
import ProductMetricsService from './ProductMetricsService.js';
import DashboardMetricsService from './DashboardMetricsService.js';
import pool from '../config/db.js';
import { AppError } from '../middlewares/errorHandler.js';

const REVIEW_TYPES = {
  PRODUCT: 'PRODUCT',
  VENDOR: 'VENDOR'
};

const PROFANITY_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'خول',
  'كلب',
  'حمار',
  'زبالة',
  'وسخ',
  'لعنة'
];

class ReviewService {
  sanitizeComment(comment) {
    if (!comment) return null;
    const stripped = String(comment)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!stripped) return null;
    return validator.escape(stripped.slice(0, 1200));
  }

  getProfanityMeta(comment) {
    if (!comment) {
      return { profanityFlag: false, profanityScore: 0, flagReason: null };
    }

    const normalized = String(comment).toLowerCase();
    const hits = PROFANITY_TERMS.filter((term) => normalized.includes(term.toLowerCase()));

    return {
      profanityFlag: hits.length > 0,
      profanityScore: hits.length,
      flagReason: hits.length ? `Potential profanity detected: ${hits.join(', ')}` : null
    };
  }

  async resolveVendorInteraction(userId, vendorId) {
    const order = await ReviewRepository.userHasOrderWithVendor(userId, vendorId);
    if (order) {
      return {
        isVerifiedReview: true,
        interactionType: 'ORDER',
        interactionReferenceId: order.id,
        orderId: order.id
      };
    }

    const rfq = await ReviewRepository.userHasRfqInteractionWithVendor(userId, vendorId);
    if (rfq) {
      return {
        isVerifiedReview: true,
        interactionType: 'RFQ',
        interactionReferenceId: rfq.rfq_id,
        orderId: null
      };
    }

    const conversation = await ReviewRepository.userHasConversationWithVendor(userId, vendorId);
    if (conversation) {
      return {
        isVerifiedReview: true,
        interactionType: 'CHAT',
        interactionReferenceId: conversation.id,
        orderId: null
      };
    }

    throw new AppError('You can review this supplier only after a real interaction.', 403);
  }

  async resolveProductInteraction(userId, productId) {
    const order = await ReviewRepository.userHasOrderWithProduct(userId, productId);
    if (order) {
      return {
        isVerifiedReview: true,
        interactionType: 'ORDER',
        interactionReferenceId: order.order_id,
        orderId: order.order_id
      };
    }

    const quote = await ReviewRepository.userHasQuoteWithProduct(userId, productId);
    if (quote) {
      return {
        isVerifiedReview: true,
        interactionType: 'QUOTE',
        interactionReferenceId: quote.id,
        orderId: null
      };
    }

    const conversation = await ReviewRepository.userHasConversationWithProduct(userId, productId);
    if (conversation) {
      return {
        isVerifiedReview: true,
        interactionType: 'CHAT',
        interactionReferenceId: conversation.id,
        orderId: null
      };
    }

    throw new AppError('You can review this product only after a real interaction.', 403);
  }

  async resolveEligibility(type, userId, targetId) {
    if (type === REVIEW_TYPES.VENDOR) {
      return this.resolveVendorInteraction(userId, targetId);
    }
    if (type === REVIEW_TYPES.PRODUCT) {
      return this.resolveProductInteraction(userId, targetId);
    }
    throw new AppError('Unsupported review type.', 400);
  }

  async refreshAggregate(type, targetId, connection = pool) {
    if (type === REVIEW_TYPES.VENDOR) {
      const result = await ReviewRepository.recalculateVendorAggregate(targetId, connection);
      VendorMetricsService.invalidateVendor(targetId);
      DashboardMetricsService.invalidateAdminDashboard();
      return result;
    }
    const result = await ReviewRepository.recalculateProductAggregate(targetId, connection);
    const productContext = await ReviewRepository.getProductOwnerContext(targetId, connection);
    if (productContext?.vendor_id) {
      await ReviewRepository.recalculateVendorProductAggregate(productContext.vendor_id, connection);
      VendorMetricsService.invalidateVendor(productContext.vendor_id);
    }
    ProductMetricsService.invalidateProduct(targetId);
    DashboardMetricsService.invalidateAdminDashboard();
    return result;
  }

  async notifyReviewTarget(type, targetId, payload) {
    if (type === REVIEW_TYPES.VENDOR) {
      const ownerUserId = await ReviewRepository.getVendorOwnerUserId(targetId);
      if (!ownerUserId) return;
      await NotificationService.createSystemNotification(
        ownerUserId,
        'لديك مراجعة جديدة بانتظار الاعتماد',
        'You received a new review pending moderation',
        `تم إرسال مراجعة جديدة بتقييم ${payload.rating}/5 لحساب المورد الخاص بك.`,
        `A new ${payload.rating}/5 supplier review has been submitted for your profile.`
      );
      return;
    }

    const productContext = await ReviewRepository.getProductOwnerContext(targetId);
    if (!productContext?.vendor_user_id) return;
    await NotificationService.createSystemNotification(
      productContext.vendor_user_id,
      'لديك مراجعة جديدة على أحد منتجاتك',
      'You received a new product review',
      `تم إرسال مراجعة جديدة بتقييم ${payload.rating}/5 على منتجك "${productContext.name_ar || productContext.name_en || 'Product'}".`,
      `A new ${payload.rating}/5 review was submitted for your product "${productContext.name_en || productContext.name_ar || 'Product'}".`
    );
  }

  async createReview(type, userId, targetId, reviewData) {
    const existingReview = await ReviewRepository.findUserReview(type, targetId, userId);
    if (existingReview) {
      throw new AppError('You already submitted a review for this item. Edit it instead.', 409);
    }

    const interaction = await this.resolveEligibility(type, userId, targetId);
    const cleanComment = this.sanitizeComment(reviewData.comment);
    const profanity = this.getProfanityMeta(cleanComment);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const reviewId = await ReviewRepository.createReview(type, {
        targetId,
        userId,
        rating: reviewData.rating,
        comment: cleanComment,
        status: 'PENDING',
        ...interaction,
        ...profanity
      }, connection);

      await this.notifyReviewTarget(type, targetId, {
        rating: reviewData.rating
      });

      await connection.commit();
      return ReviewRepository.getReviewById(type, reviewId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateReview(type, userId, targetId, reviewData) {
    const existingReview = await ReviewRepository.findUserReview(type, targetId, userId);
    if (!existingReview) {
      throw new AppError('Review not found for this target.', 404);
    }

    const interaction = await this.resolveEligibility(type, userId, targetId);
    const cleanComment = this.sanitizeComment(reviewData.comment);
    const profanity = this.getProfanityMeta(cleanComment);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await ReviewRepository.updateReview(type, existingReview.id, {
        userId,
        rating: reviewData.rating,
        comment: cleanComment,
        status: 'PENDING',
        ...interaction,
        ...profanity
      }, connection);

      await this.refreshAggregate(type, targetId, connection);
      await connection.commit();
      return ReviewRepository.getReviewById(type, existingReview.id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getTargetPublicReviews(type, targetId, sortBy = 'newest') {
    const [summary, reviews] = await Promise.all([
      ReviewRepository.getTargetSummary(type, targetId),
      ReviewRepository.getTargetReviews(type, targetId, sortBy)
    ]);

    return { summary, reviews };
  }

  async getMyReviewState(type, userId, targetId) {
    let eligibility = {
      canReview: false,
      isVerifiedInteraction: false,
      interactionType: null
    };

    try {
      const interaction = await this.resolveEligibility(type, userId, targetId);
      eligibility = {
        canReview: true,
        isVerifiedInteraction: Boolean(interaction.isVerifiedReview),
        interactionType: interaction.interactionType
      };
    } catch {
      eligibility = {
        canReview: false,
        isVerifiedInteraction: false,
        interactionType: null
      };
    }

    const review = await ReviewRepository.findUserReview(type, targetId, userId);

    return {
      eligibility,
      review
    };
  }

  async approveReview(type, reviewId, adminId) {
    const review = await ReviewRepository.getReviewById(type, reviewId);
    if (!review) {
      throw new AppError('Review not found.', 404);
    }

    const targetId = type === REVIEW_TYPES.VENDOR ? review.vendor_id : review.product_id;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await ReviewRepository.moderateReview(type, reviewId, {
        status: 'APPROVED',
        moderatedBy: adminId
      }, connection);
      await this.refreshAggregate(type, targetId, connection);
      await connection.commit();
      return { id: reviewId, status: 'APPROVED' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async rejectReview(type, reviewId, adminId) {
    const review = await ReviewRepository.getReviewById(type, reviewId);
    if (!review) {
      throw new AppError('Review not found.', 404);
    }

    const targetId = type === REVIEW_TYPES.VENDOR ? review.vendor_id : review.product_id;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await ReviewRepository.moderateReview(type, reviewId, {
        status: 'REJECTED',
        moderatedBy: adminId,
        flagReason: review.flag_reason
      }, connection);
      await this.refreshAggregate(type, targetId, connection);
      await connection.commit();
      return { id: reviewId, status: 'REJECTED' };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteReview(type, reviewId) {
    const review = await ReviewRepository.getReviewById(type, reviewId);
    if (!review) {
      throw new AppError('Review not found.', 404);
    }

    const targetId = type === REVIEW_TYPES.VENDOR ? review.vendor_id : review.product_id;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await ReviewRepository.deleteReview(type, reviewId, connection);
      await this.refreshAggregate(type, targetId, connection);
      await connection.commit();
      return { id: reviewId, deleted: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getAdminReviews(filters) {
    const normalizedFilters = {
      type: filters.type || null,
      status: filters.status || null,
      minRating: filters.rating ? Number(filters.rating) : null,
      maxRating: filters.rating ? Number(filters.rating) : null,
      search: filters.search || null,
      flaggedOnly: String(filters.flaggedOnly || '').toLowerCase() === 'true',
      dateFrom: filters.dateFrom || null,
      dateTo: filters.dateTo || null
    };

    const [items, stats, topVendors, categoryAverages] = await Promise.all([
      ReviewRepository.getAdminReviews(normalizedFilters),
      ReviewRepository.getAdminReviewStats(),
      ReviewRepository.getTopVendors(),
      ReviewRepository.getCategoryReviewAverages()
    ]);

    return { items, stats, topVendors, categoryAverages };
  }
}

export default new ReviewService();
export { REVIEW_TYPES };
