import express from 'express';
import CategoryController from '../controllers/CategoryController.js';
import { protect, authorize } from '../middlewares/auth.js';

const router = express.Router();

router.get('/', CategoryController.getAll);

router.use(protect, authorize('ADMIN', 'OWNER'));

router.post('/', CategoryController.create);
router.put('/:id', CategoryController.update);
router.delete('/:id', CategoryController.delete);

export default router;
