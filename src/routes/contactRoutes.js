import express from 'express';
import ContactController from '../controllers/ContactController.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

// Public route
router.post('/', ContactController.submitMessage);

// Admin / Owner restricted routes
router.use(protect);
router.use(authorize('ADMIN', 'OWNER'));

router.get('/', ContactController.getMessages);
router.patch('/:id/status', ContactController.updateStatus);
router.post('/:id/convert-to-chat', ContactController.convertToChat);

export default router;
