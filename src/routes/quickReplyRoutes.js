import express from 'express';
import QuickReplyController from '../controllers/QuickReplyController.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

router.use(protect);
router.use(authorize('ADMIN', 'OWNER', 'MOWARED')); // Vendors and Admins

router.post('/', QuickReplyController.createReply);
router.get('/', QuickReplyController.getReplies);
router.delete('/:id', QuickReplyController.deleteReply);

export default router;
