import express from 'express';
import NotificationController from '../controllers/NotificationController.js';
import { protect } from '../middlewares/auth.js';

const router = express.Router();

router.use(protect);

router.get('/', NotificationController.getAll);
router.patch('/read-all', NotificationController.markAllRead);
router.delete('/', NotificationController.deleteAll);
router.patch('/:id/read', NotificationController.markRead);
router.delete('/:id', NotificationController.deleteOne);

export default router;
