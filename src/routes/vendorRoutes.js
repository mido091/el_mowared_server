import express from 'express';
import VendorController from '../controllers/VendorController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { vendorSchemas } from '../validators/schemas.js';

const router = express.Router();

// ── Vendor Self-Management (MUST come BEFORE /:id wildcard) ─────────────────
router.get('/me', protect, authorize('MOWARED'), VendorController.getMyProfile);
router.patch('/me', protect, authorize('MOWARED'), validate({ body: vendorSchemas.updateProfile }), VendorController.updateMyProfile);
router.get('/stats', protect, authorize('MOWARED'), VendorController.getMyStats);
router.get('/orders', protect, authorize('MOWARED'), VendorController.getMyOrders);
router.get('/wallet', protect, authorize('MOWARED'), VendorController.getMyWallet);
router.get('/sales-review', protect, authorize('MOWARED'), VendorController.getSalesReview);
router.post('/sales-review', protect, authorize('MOWARED'), VendorController.createSalesReviewEntry);
router.patch('/sales-review/:id', protect, authorize('MOWARED'), VendorController.updateSalesReviewEntry);
router.delete('/sales-review/:id', protect, authorize('MOWARED'), VendorController.deleteSalesReviewEntry);

// ── Public directory ─────────────────────────────────────────────────────────
router.get('/', VendorController.getVendors);
router.get('/:id/metrics', validate({ params: vendorSchemas.idParam }), VendorController.getVendorMetrics);
router.get('/:id', validate({ params: vendorSchemas.idParam }), VendorController.getVendorById);

// ── Admin/Owner only ─────────────────────────────────────────────────────────
router.patch('/:id/verify', protect, authorize('OWNER', 'ADMIN'), validate({ params: vendorSchemas.idParam, body: vendorSchemas.verify }), VendorController.verifyVendor);

export default router;
