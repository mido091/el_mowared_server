import express from 'express';
import ProductReviewController from '../controllers/ProductReviewController.js';
import VendorReviewController from '../controllers/VendorReviewController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { reviewWriteLimiter } from '../middlewares/rateLimiters.js';
import { validate } from '../middlewares/validate.js';
import { reviewSchemas } from '../validators/schemas.js';

const router = express.Router();

router.get('/products/:productId', validate({ params: reviewSchemas.productParams }), ProductReviewController.getProductReviews);
router.get('/vendors/:vendorId', validate({ params: reviewSchemas.vendorParams }), VendorReviewController.getVendorReviews);

router.get('/products/:productId/me', protect, authorize('USER'), validate({ params: reviewSchemas.productParams }), ProductReviewController.getMyReviewState);
router.get('/vendors/:vendorId/me', protect, authorize('USER'), validate({ params: reviewSchemas.vendorParams }), VendorReviewController.getMyReviewState);

router.post('/products/:productId', protect, authorize('USER'), validate({ params: reviewSchemas.productParams, body: reviewSchemas.write }), reviewWriteLimiter, ProductReviewController.createReview);
router.patch('/products/:productId', protect, authorize('USER'), validate({ params: reviewSchemas.productParams, body: reviewSchemas.write }), reviewWriteLimiter, ProductReviewController.updateReview);

router.post('/vendors/:vendorId', protect, authorize('USER'), validate({ params: reviewSchemas.vendorParams, body: reviewSchemas.write }), reviewWriteLimiter, VendorReviewController.createReview);
router.patch('/vendors/:vendorId', protect, authorize('USER'), validate({ params: reviewSchemas.vendorParams, body: reviewSchemas.write }), reviewWriteLimiter, VendorReviewController.updateReview);

export default router;
