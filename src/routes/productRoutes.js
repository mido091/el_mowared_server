import express from 'express';
import ProductController from '../controllers/ProductController.js';
import CategoryController from '../controllers/CategoryController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { isApprovedVendor } from '../middlewares/vendorGuard.js';
import { upload, verifyUploadedImages, uploadErrorHandler } from '../utils/upload.js';
import { validate } from '../middlewares/validate.js';
import { productSchemas } from '../validators/schemas.js';
import { uploadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

// ── Public Discovery Endpoints ───────────────────────────────────────────────
// Only returns APPROVED products (publicOnly flag set in controller)
router.get('/', ProductController.getAll);
router.get('/summary/public', ProductController.getPublicSummary);
router.get('/compare', validate({ query: productSchemas.compareQuery }), ProductController.compare);
router.get('/categories', CategoryController.getAll);
router.get('/vendor/:vendorId', validate({ params: productSchemas.vendorIdParam }), ProductController.getByVendor);
router.get('/:id/metrics', validate({ params: productSchemas.metricsParam }), ProductController.getMetrics);
router.post('/:id/view', validate({ params: productSchemas.metricsParam }), ProductController.registerView);
router.get('/:id/similar', validate({ params: productSchemas.idParam }), ProductController.getSimilar);
router.get('/:id', validate({ params: productSchemas.idParam }), ProductController.getOne);

// ── Protected Routes (require auth) ──────────────────────────────────────────
// IMPORTANT: All static named paths MUST come BEFORE the /:id wildcard
router.use(protect);

// Vendor: Own catalog (all lifecycle statuses — pending/rejected visible to vendor)
router.get('/vendor/catalog/mine', authorize('MOWARED', 'ADMIN', 'OWNER'), isApprovedVendor, ProductController.getVendorCatalog);

// Admin/Owner: Product moderation list
router.get('/admin/moderation', authorize('ADMIN', 'OWNER'), ProductController.getModerationList);

// Admin/Owner: Review (APPROVE or REJECT) a product
router.patch('/:id/review', validate({ params: productSchemas.idParam }), authorize('ADMIN', 'OWNER'), ProductController.review);
router.put('/:id/review', validate({ params: productSchemas.idParam }), authorize('ADMIN', 'OWNER'), ProductController.review);

// Vendor/Admin: Status history for a product
router.get('/:id/history', validate({ params: productSchemas.idParam }), authorize('MOWARED', 'ADMIN', 'OWNER'), ProductController.getStatusHistory);

// ── Product Sub-Routes (last because /:id is a wildcard) ─────────────────────
// Vendor CRUD (requires approved vendor status)
router.use(authorize('MOWARED', 'ADMIN', 'OWNER'), isApprovedVendor);
router.post('/', uploadLimiter, upload.array('images', 5), uploadErrorHandler, verifyUploadedImages, validate({ body: productSchemas.create }), ProductController.create);
router.post('/bulk-delete', validate({ body: productSchemas.bulkDelete }), ProductController.bulkDelete);
router.put('/:id', validate({ params: productSchemas.idParam }), uploadLimiter, upload.array('images', 5), uploadErrorHandler, verifyUploadedImages, validate({ body: productSchemas.update }), ProductController.update);
router.delete('/:id', validate({ params: productSchemas.idParam }), ProductController.delete);

export default router;
