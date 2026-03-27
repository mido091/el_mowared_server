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
    const sql = `
      SELECT * FROM notifications 
      WHERE user_id = :userId 
      ORDER BY created_at DESC 
      LIMIT :limit OFFSET :offset
    `;
    const [rows] = await pool.execute(sql, { userId, limit, offset });
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
