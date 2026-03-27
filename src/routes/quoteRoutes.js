import express from 'express';
import QuoteController from '../controllers/QuoteController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { inquiryLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect); // All quote routes require authentication

/**
 * @route GET /api/v1/quotes
 * @desc List quotes for user or vendor
 */
router.get('/', QuoteController.listQuotes);

/**
 * @route POST /api/v1/quotes/request
 * @desc Initialize an RFQ
 */
router.post('/request', authorize('USER', 'MOWARED', 'ADMIN', 'OWNER'), inquiryLimiter, QuoteController.requestQuote);

/**
 * @route POST /api/v1/quotes/:id/respond
 * @desc Vendor responds with a formal price offer
 */
router.post('/:id/respond', authorize('MOWARED', 'ADMIN', 'OWNER'), inquiryLimiter, QuoteController.respondToQuote);

export default router;
