import ReviewService, { REVIEW_TYPES } from '../services/ReviewService.js';
import { AppError } from '../middlewares/errorHandler.js';

class AdminReviewController {
  normalizeType = (type) => {
    const normalized = String(type || '').toUpperCase();
    if (![REVIEW_TYPES.PRODUCT, REVIEW_TYPES.VENDOR].includes(normalized)) {
      throw new AppError('Unsupported review type.', 400);
    }
    return normalized;
  }

  getAllReviews = async (req, res, next) => {
    try {
      const data = await ReviewService.getAdminReviews(req.query);
      res.status(200).json({
        success: true,
        data,
        message: 'Admin reviews fetched successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  approveReview = async (req, res, next) => {
    try {
      const reviewType = this.normalizeType(req.params.type);
      const data = await ReviewService.approveReview(reviewType, Number(req.params.id), req.user.id);
      res.status(200).json({
        success: true,
        data,
        message: 'Review approved successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  rejectReview = async (req, res, next) => {
    try {
      const reviewType = this.normalizeType(req.params.type);
      const data = await ReviewService.rejectReview(reviewType, Number(req.params.id), req.user.id);
      res.status(200).json({
        success: true,
        data,
        message: 'Review rejected successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  deleteReview = async (req, res, next) => {
    try {
      const reviewType = this.normalizeType(req.params.type);
      const data = await ReviewService.deleteReview(reviewType, Number(req.params.id));
      res.status(200).json({
        success: true,
        data,
        message: 'Review deleted successfully.'
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new AdminReviewController();
