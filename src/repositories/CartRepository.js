/**
 * @file CartRepository.js
 * @description Repository for managing user shopping carts.
 * Handles item persistence, merging, and lazy-loading of product metadata.
 */

import pool from '../config/db.js';

class CartRepository {
  /**
   * Retrieves all items in a user's cart including product summaries and main images.
   * 
   * @async
   * @param {number} userId 
   * @returns {Promise<Array>} List of cart items with product snapshots.
   */
  async findByUserId(userId, connection = pool) {
    // Join and Subquery: Links cart items with products and fetches the main image URL 
    // using a correlated subquery for each product in the cart.
    const sql = `
      SELECT ci.*, p.name_ar, p.name_en, p.slug, p.price, p.vendor_id,
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_main = 1 LIMIT 1) as main_image
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = :userId
    `;
    const [rows] = await connection.execute(sql, { userId });
    return rows;
  }

  /**
   * Checks if a specific product already exists in a user's cart.
   * 
   * @async
   * @param {number} userId 
   * @param {number} productId 
   * @returns {Promise<Object|null>} Cart item record.
   */
  async findItem(userId, productId) {
    const sql = 'SELECT * FROM cart_items WHERE user_id = :userId AND product_id = :productId';
    const [rows] = await pool.execute(sql, { userId, productId });
    return rows[0];
  }

  /**
   * Adds a product to the cart or increments its quantity if already present.
   * Utilizes MySQL 'ON DUPLICATE KEY UPDATE' for atomic increment.
   * 
   * @async
   * @param {number} userId 
   * @param {number} productId 
   * @param {number} quantity 
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async addItem(userId, productId, quantity, connection = pool) {
    const sql = `
      INSERT INTO cart_items (user_id, product_id, quantity)
      VALUES (:userId, :productId, :quantity)
      ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
    `;
    await connection.execute(sql, { userId, productId, quantity });
  }

  /**
   * Updates the exact quantity of an existing cart item.
   * 
   * @async
   * @param {number} id 
   * @param {number} userId - Security: Ensures only the owner can update.
   * @param {number} quantity 
   */
  async updateQuantity(id, userId, quantity) {
    const sql = 'UPDATE cart_items SET quantity = :quantity WHERE id = :id AND user_id = :userId';
    await pool.execute(sql, { id, userId, quantity });
  }

  /**
   * Permanently removes an item from the cart.
   * 
   * @async
   * @param {number} id 
   * @param {number} userId - Security: Ensures only the owner can remove.
   */
  async removeItem(id, userId) {
    const sql = 'DELETE FROM cart_items WHERE id = :id AND user_id = :userId';
    await pool.execute(sql, { id, userId });
  }

  /**
   * Clears all items for a specific user. Usually called after a successful checkout.
   * 
   * @async
   * @param {number} userId 
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   */
  async clearCart(userId, connection = pool) {
    const sql = 'DELETE FROM cart_items WHERE user_id = :userId';
    await connection.execute(sql, { userId });
  }
}

export default new CartRepository();
