import express from 'express';
import OrderController from '../controllers/OrderController.js';
import AdminDashboardController from '../controllers/AdminDashboardController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { upload, verifyUploadedImages, uploadErrorHandler } from '../utils/upload.js';
import { validate } from '../middlewares/validate.js';
import { orderSchemas } from '../validators/schemas.js';
import { uploadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);

router.get('/', OrderController.getMyOrders);
router.post('/checkout', validate({ body: orderSchemas.checkout }), OrderController.checkout);
router.get('/:id', validate({ params: orderSchemas.idParam }), OrderController.getOrderDetails);
router.post('/:id/receipt', validate({ params: orderSchemas.idParam }), uploadLimiter, upload.single('receipt'), uploadErrorHandler, verifyUploadedImages, OrderController.uploadReceipt);

// Admin/Owner only
router.get('/:id/trust-report', authorize('OWNER', 'ADMIN'), validate({ params: orderSchemas.idParam }), AdminDashboardController.getTrustReport);
router.post('/:id/dispute', validate({ params: orderSchemas.idParam, body: orderSchemas.dispute }), OrderController.disputeOrder);
router.get('/:id/admin-report', authorize('OWNER', 'ADMIN'), validate({ params: orderSchemas.idParam }), OrderController.getAdminReport);
router.patch('/:id/confirm-payment', authorize('OWNER', 'ADMIN'), validate({ params: orderSchemas.idParam, body: orderSchemas.confirmPayment }), OrderController.confirmPayment);
router.patch('/:id/status', authorize('MOWARED', 'OWNER', 'ADMIN'), validate({ params: orderSchemas.idParam, body: orderSchemas.updateStatus }), OrderController.updateStatus);

export default router;
