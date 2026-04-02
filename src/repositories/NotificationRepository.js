/**
 * @file NotificationRepository.js
 * @description Repository for system-wide in-app notifications.
 * Handles the persistence of multilingual alerts and read/unread status management.
 */

import pool from '../config/db.js';

class NotificationRepository {
  /**
   * Persists a new notification for a specific user.
   * 
   * @async
   * @param {Object} notifData - Multi-language title and content.
   * @param {Object} [connection] - MySQL connection for transactions.
   * @returns {Promise<Object>} Created notification record summary.
   */
  async create(notifData, connection = pool) {
    const { userId, type, titleAr, titleEn, contentAr, contentEn } = notifData;
    const sql = `
      INSERT INTO notifications (user_id, type, title_ar, title_en, content_ar, content_en, created_at)
      VALUES (:userId, :type, :titleAr, :titleEn, :contentAr, :contentEn, NOW())
    `;
    const [result] = await connection.execute(sql, { userId, type, titleAr, titleEn, contentAr, contentEn });
    return { id: result.insertId, ...notifData };
  }

  /**
   * Retrieves a paginated list of notifications for a user.
   * 
   * @async
   * @param {number} userId 
   * @param {number} [limit=20] 
   * @param {number} [offset=0] 
   * @returns {Promise<Array>} List of chronological notifications.
   */
  async findByUserId(userId, limit = 20, offset = 0) {
    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const normalizedOffset = Math.max(0, Number(offset) || 0);
    const sql = `
      SELECT * FROM notifications 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ${normalizedLimit} OFFSET ${normalizedOffset}
    `;
    const [rows] = await pool.execute(sql, [userId]);
    return rows;
  }

  /**
   * Updates the read status of a notification.
   * 
   * @async
   * @param {number} id 
   * @param {number} userId - Security: Ensures only the owner can modify.
   */
  async markAsRead(id, userId) {
    const sql = 'UPDATE notifications SET is_read = TRUE WHERE id = :id AND user_id = :userId';
    await pool.execute(sql, { id, userId });
  }

  async markAllAsRead(userId) {
    const sql = 'UPDATE notifications SET is_read = TRUE WHERE user_id = :userId AND is_read = FALSE';
    await pool.execute(sql, { userId });
  }

  async deleteById(id, userId) {
    const sql = 'DELETE FROM notifications WHERE id = :id AND user_id = :userId';
    const [result] = await pool.execute(sql, { id, userId });
    return result.affectedRows > 0;
  }

  async deleteAllByUserId(userId) {
    const sql = 'DELETE FROM notifications WHERE user_id = :userId';
    const [result] = await pool.execute(sql, { userId });
    return result.affectedRows;
  }

  /**
   * Counts total unread notifications for a user badge count.
   * 
   * @async
   * @param {number} userId 
   * @returns {Promise<number>} Unread count.
   */
  async getUnreadCount(userId) {
    const sql = 'SELECT COUNT(*) as count FROM notifications WHERE user_id = :userId AND is_read = FALSE';
    const [[{ count }]] = await pool.execute(sql, { userId });
    return count;
  }
}

export default new NotificationRepository();
