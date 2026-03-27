/**
 * @file CartService.js
 * @description Service for managing transient shopping cart state.
 * Implements ephemeral product reservations and quantity constraints.
 */

import CartRepository from '../repositories/CartRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import { AppError } from '../middlewares/errorHandler.js';

class CartService {
  /**
   * Retrieves the current items for a user's cart.
   * 
   * @async
   */
  async getCart(userId, connection = null) {
    return CartRepository.findByUserId(userId, connection || undefined);
  }

  /**
   * Adds a product to the cart with existence validation.
   * 
   * @async
   * @param {number} userId 
   * @param {number} productId 
   * @param {number} quantity 
   * @throws {AppError} 404 - If the product no longer exists.
   */
  async addToCart(userId, productId, quantity) {
    // Integrity Check: Prevent adding ghost products to the cart.
    const product = await ProductRepository.findById(productId);
    if (!product) throw new AppError('Product not found', 404);
    
    return CartRepository.addItem(userId, productId, quantity);
  }

  /**
   * Adjusts quantity or removes item if count reaches zero.
   * 
   * @async
   */
  async updateCartItem(id, userId, quantity) {
    if (quantity <= 0) {
      return CartRepository.removeItem(id, userId);
    }
    return CartRepository.updateQuantity(id, userId, quantity);
  }

  /**
   * Unit removal from cart.
   * 
   * @async
   */
  async removeFromCart(id, userId) {
    return CartRepository.removeItem(id, userId);
  }

  /**
   * Batch cleanup after checkout or manual reset.
   * 
   * @async
   */
  async clearCart(userId, connection = null) {
    return CartRepository.clearCart(userId, connection || undefined);
  }
}

export default new CartService();
