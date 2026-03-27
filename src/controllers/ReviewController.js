/**
 * @file ReviewController.js
 * @description Controller for managing Merchant feedback and platform reputation.
 * Restricts review capability to customers with verified completions.
 */

import ReviewService from '../services/ReviewService.js';
import { z } from 'zod';

class ReviewController {
  /**
   * Adds a new rating/review for a vendor.
   * Implements strict rating boundaries (1-5) and links review to the generating order.
   * 
   * @async
   */
  async addReview(req, res, next) {
    try {
      // 1. Schema Guard: Enforce numerical rating ranges and required comment structure.
      const reviewData = z.object({
        orderId: z.number(),
        rating: z.number().min(1).max(5),
        comment: z.string().optional()
      }).parse(req.body);

      // 2. Service Execution: Persist the feedback entry.
      const review = await ReviewService.addReview(req.user.id, reviewData);
      res.status(201).json({
        status: 'success',
        data: review
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves paginated reviews for a specific Merchant.
   * 
   * @async
   */
  async getVendorReviews(req, res, next) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      
      const result = await ReviewService.getVendorReviews(req.params.vendorId, page, limit);
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new ReviewController();
