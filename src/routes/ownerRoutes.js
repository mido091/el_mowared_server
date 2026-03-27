import express from 'express';
import OwnerController from '../controllers/OwnerController.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

router.use(protect, authorize('OWNER'));

router.patch('/update-me', OwnerController.updateMe);
router.patch('/users/:id', OwnerController.updateUserUniversal);

export default router;
