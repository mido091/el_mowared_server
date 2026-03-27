/**
 * @file CartController.js
 * @description Controller for managing the user's ephemeral shopping cart.
 * Interfaces with the CartService to maintain product reservations and quantities.
 */

import CartService from '../services/CartService.js';
import ChatService from '../services/ChatService.js';
import pool from '../config/db.js';
import { AppError } from '../middlewares/errorHandler.js';
import { z } from 'zod';

class CartController {
  /**
   * Retrieves the current user's localized shopping cart.
   * 
   * @async
   */
  async getCart(req, res, next) {
    try {
      const items = await CartService.getCart(req.user.id);
      res.status(200).json({
        success: true,
        data: res.formatLocalization(items),
        message: '',
        error: null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Adds a product to the cart with quantity validation.
   * 
   * @async
   */
  async addToCart(req, res, next) {
    try {
      // 1. Validation Logic: Constrain inputs to valid product IDs and positive counts.
      const { productId, quantity } = z.object({
        productId: z.number(),
        quantity: z.number().min(1)
      }).parse(req.body);

      // 2. Integration: Update the user's persistent cart record.
      await CartService.addToCart(req.user.id, productId, quantity);
      
      // 3. Sync: Return the updated cart for immediate UI feedback.
      const items = await CartService.getCart(req.user.id);
      res.status(201).json({
        success: true,
        data: res.formatLocalization(items),
        message: 'Product added to cart',
        error: null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Adjusts the quantity for an existing cart item.
   * 
   * @async
   */
  async updateItem(req, res, next) {
    try {
      const { quantity } = z.object({
        quantity: z.number().min(0)
      }).parse(req.body);

      await CartService.updateCartItem(req.params.id, req.user.id, quantity);
      
      // Sync: Return updated cart
      const items = await CartService.getCart(req.user.id);
      res.status(200).json({
        success: true,
        data: res.formatLocalization(items),
        message: 'Cart updated',
        error: null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Removes a specific branch from the cart.
   * 
   * @async
   */
  async removeItem(req, res, next) {
    try {
      await CartService.removeFromCart(req.params.id, req.user.id);
      
      // Sync: Return updated cart
      const items = await CartService.getCart(req.user.id);
      res.status(200).json({
        success: true,
        data: res.formatLocalization(items),
        message: 'Item removed',
        error: null
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Destructive cleanup of the entire cart.
   * 
   * @async
   */
  async clear(req, res, next) {
    try {
      await CartService.clearCart(req.user.id);
      res.status(204).json({
        success: true,
        data: null,
        message: 'Cart cleared'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Transforms cart items into Vendor Quotation Requests and automatically
   * spins up separate conversations for each vendor atomically.
   */
  async checkoutSplit(req, res, next) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const items = await CartService.getCart(req.user.id, connection);
      if (!items || items.length === 0) {
        throw new AppError('Cart is empty', 400);
      }

      // 1. Group items by vendor_id
      const vendorGroups = items.reduce((acc, item) => {
        if (!acc[item.vendor_id]) acc[item.vendor_id] = [];
        acc[item.vendor_id].push(item);
        return acc;
      }, {});

      // 2. Process each vendor's cart independently inside the transaction
      for (const vendorId of Object.keys(vendorGroups)) {
        const groupItems = vendorGroups[vendorId];
        
        let messageText = 'I would like to request a quotation for the following items:\\n';
        for (const item of groupItems) {
           messageText += `- ${item.quantity}x ${item.name_en || item.name_ar}\\n`;
           // Insert individual quotation logic
           await connection.execute(
             `INSERT INTO quotation_requests (user_id, product_id, vendor_id, requested_quantity, target_price) 
              VALUES (:userId, :productId, :vendorId, :quantity, :price)`,
             { 
               userId: req.user.id, 
               productId: item.product_id, 
               vendorId, 
               quantity: item.quantity, 
               price: item.price
             }
           );
        }

        // 3. Auto-generate the contextual chat thread
        await ChatService.startInquiry(req.user.id, {
          vendorId: parseInt(vendorId),
          productId: groupItems[0].product_id, // snapshot the first item
          messageText,
          type: 'INQUIRY',
          requestedQuantity: groupItems.reduce((sum, i) => sum + i.quantity, 0)
        }, connection);
      }

      // 4. Clear the cart
      await CartService.clearCart(req.user.id, connection);
      
      await connection.commit();

      res.status(200).json({
        success: true,
        message: 'Cart split successfully. Inquiries dispatched.',
        data: null
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }
}

export default new CartController();
