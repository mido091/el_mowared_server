import express from 'express';
import AdminController from '../controllers/AdminController.js';
import OwnerController from '../controllers/OwnerController.js';
import StatsController from '../controllers/StatsController.js';
import AdminDashboardController from '../controllers/AdminDashboardController.js';
import AdminReviewController from '../controllers/AdminReviewController.js';
import ProductController from '../controllers/ProductController.js';
import ChatController from '../controllers/ChatController.js';
import VendorController from '../controllers/VendorController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { upload, verifyUploadedImages, uploadErrorHandler } from '../utils/upload.js';
import { validate } from '../middlewares/validate.js';
import { reviewSchemas, productSchemas, vendorSchemas } from '../validators/schemas.js';
import { uploadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.use(protect);

router.get('/stats', authorize('OWNER', 'ADMIN'), StatsController.getDashboardStats);
router.get('/users', authorize('OWNER'), AdminDashboardController.getUsers);
router.get('/logs', authorize('OWNER'), AdminDashboardController.getLogs);
router.get('/vendors', authorize('OWNER', 'ADMIN'), AdminDashboardController.getVendors);
router.get('/payments', authorize('OWNER'), AdminDashboardController.getPayments);
router.put('/vendors/:id/verify', authorize('OWNER', 'ADMIN'), AdminDashboardController.verifyVendorDirect);
router.put('/vendors/:id/reject', authorize('OWNER', 'ADMIN'), AdminDashboardController.rejectVendorDirect);
router.delete('/vendors/:id', authorize('OWNER', 'ADMIN'), validate({ params: vendorSchemas.idParam }), VendorController.deleteVendorAdmin);
router.get('/alerts', authorize('OWNER', 'ADMIN'), AdminDashboardController.getAlerts);
router.get('/support-conversations', authorize('OWNER'), ChatController.getOwnerSupportConversations);
router.get('/support-conversations/:id/messages', authorize('OWNER'), ChatController.getOwnerSupportConversationMessages);
router.get('/support-archives', authorize('OWNER'), ChatController.getOwnerSupportArchives);
router.patch('/support-archives/:id/archive', authorize('OWNER'), ChatController.archiveSupportConversation);
router.delete('/support-archives', authorize('OWNER'), ChatController.deleteOwnerSupportConversations);
router.delete('/support-archives/:id', authorize('OWNER'), ChatController.deleteSupportConversation);

// ── Product Moderation ──────────────────────────────────────────────────────
router.get('/products', authorize('OWNER', 'ADMIN'), ProductController.getModerationList);
router.get('/products/pending', authorize('OWNER', 'ADMIN'), ProductController.getPending);
router.get('/products/:id', authorize('OWNER', 'ADMIN'), validate({ params: productSchemas.idParam }), ProductController.getAdminOne);
router.patch('/products/:id/review', authorize('OWNER', 'ADMIN'), validate({ params: productSchemas.idParam }), ProductController.review);
router.put('/products/:id/review', authorize('OWNER', 'ADMIN'), validate({ params: productSchemas.idParam }), ProductController.review);
router.put('/products/:id/status', authorize('OWNER', 'ADMIN'), validate({ params: productSchemas.idParam }), ProductController.updateStatus);
router.delete('/products/:id', authorize('OWNER', 'ADMIN'), validate({ params: productSchemas.idParam }), ProductController.deleteAdmin);

router.get('/reviews', authorize('OWNER', 'ADMIN'), validate({ query: reviewSchemas.adminQuery }), AdminReviewController.getAllReviews);
router.patch('/reviews/:type/:id/approve', authorize('OWNER', 'ADMIN'), validate({ params: reviewSchemas.adminParams }), AdminReviewController.approveReview);
router.patch('/reviews/:type/:id/reject', authorize('OWNER', 'ADMIN'), validate({ params: reviewSchemas.adminParams }), AdminReviewController.rejectReview);
router.delete('/reviews/:type/:id', authorize('OWNER', 'ADMIN'), validate({ params: reviewSchemas.adminParams }), AdminReviewController.deleteReview);

router.patch('/users/:id/role', authorize('OWNER'), AdminController.updateUserRole);
router.patch('/users/:id/status', authorize('OWNER'), AdminController.toggleUserStatus);
router.post('/users', authorize('OWNER'), OwnerController.createUser);
router.patch('/users/:id', authorize('OWNER'), OwnerController.updateUserUniversal);
router.post('/upload', authorize('OWNER', 'ADMIN'), uploadLimiter, upload.single('image'), uploadErrorHandler, verifyUploadedImages, AdminController.uploadImage);
router.delete('/users/:id', authorize('OWNER'), AdminController.deleteUser);

export default router;
