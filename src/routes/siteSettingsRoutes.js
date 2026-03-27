import express from 'express';
import SiteSettingsController from '../controllers/SiteSettingsController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { upload, verifyUploadedImages, uploadErrorHandler } from '../utils/upload.js';
import { uploadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.get('/', SiteSettingsController.getSettings);
router.get('/public', SiteSettingsController.getPublicSettings);
router.patch('/', protect, authorize('OWNER'), uploadLimiter, upload.single('file'), uploadErrorHandler, verifyUploadedImages, SiteSettingsController.updateSetting);

export default router;
