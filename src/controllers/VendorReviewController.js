import { z } from 'zod';
import ReviewService, { REVIEW_TYPES } from '../services/ReviewService.js';

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1200).optional().nullable()
});

class VendorReviewController {
  async createReview(req, res, next) {
    try {
      const payload = reviewSchema.parse({
        rating: Number(req.body.rating),
        comment: req.body.comment ?? null
      });

      const review = await ReviewService.createReview(
        REVIEW_TYPES.VENDOR,
        req.user.id,
        Number(req.params.vendorId),
        payload
      );

      res.status(201).json({
        success: true,
        data: review,
        message: 'Vendor review submitted for moderation.'
      });
    } catch (error) {
      next(error);
    }
  }

  async updateReview(req, res, next) {
    try {
      const payload = reviewSchema.parse({
        rating: Number(req.body.rating),
        comment: req.body.comment ?? null
      });

      const review = await ReviewService.updateReview(
        REVIEW_TYPES.VENDOR,
        req.user.id,
        Number(req.params.vendorId),
        payload
      );

      res.status(200).json({
        success: true,
        data: review,
        message: 'Vendor review updated and sent for moderation.'
      });
    } catch (error) {
      next(error);
    }
  }

  async getVendorReviews(req, res, next) {
    try {
      const sortBy = req.query.sort === 'highest' ? 'highest' : 'newest';
      const data = await ReviewService.getTargetPublicReviews(
        REVIEW_TYPES.VENDOR,
        Number(req.params.vendorId),
        sortBy
      );

      res.status(200).json({
        success: true,
        data,
        message: 'Vendor reviews fetched successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyReviewState(req, res, next) {
    try {
      const data = await ReviewService.getMyReviewState(
        REVIEW_TYPES.VENDOR,
        req.user.id,
        Number(req.params.vendorId)
      );

      res.status(200).json({
        success: true,
        data,
        message: 'Your review state fetched successfully.'
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new VendorReviewController();
