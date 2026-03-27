import express from 'express';
import CartController from '../controllers/CartController.js';
import { protect } from '../middlewares/auth.js';

const router = express.Router();

router.use(protect);

router.get('/', CartController.getCart);
router.post('/', CartController.addToCart);
router.put('/:id', CartController.updateItem);
router.delete('/:id', CartController.removeItem);
router.delete('/', CartController.clear);
router.post('/checkout', CartController.checkoutSplit);

export default router;
