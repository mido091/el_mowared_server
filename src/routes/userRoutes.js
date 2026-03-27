import express from 'express';
import UserController from '../controllers/UserController.js';
import { protect } from '../middlewares/auth.js';
import { upload, verifyUploadedImages, uploadErrorHandler } from '../utils/upload.js';
import { uploadLimiter } from '../middlewares/rateLimiters.js';

import OrderController from '../controllers/OrderController.js';

const router = express.Router();

router.use(protect);
router.get('/me', UserController.getProfile);
router.get('/stats', UserController.getStats);
router.get('/orders', OrderController.getMyOrders);
router.put('/profile', UserController.updateProfile);
router.put('/profile/image', uploadLimiter, upload.single('image'), uploadErrorHandler, verifyUploadedImages, UserController.updateProfileImage);

export default router;
