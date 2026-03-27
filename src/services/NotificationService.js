/**
 * @file NotificationService.js
 * @description Service for managing platform-generated alerts.
 * Includes product lifecycle notification helpers.
 */

import NotificationRepository from '../repositories/NotificationRepository.js';
import pool from '../config/db.js';

class NotificationService {
  async getUserNotifications(userId, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    return NotificationRepository.findByUserId(userId, limit, offset);
  }

  async markAsRead(id, userId) {
    return NotificationRepository.markAsRead(id, userId);
  }

  async getUnreadCount(userId) {
    return NotificationRepository.getUnreadCount(userId);
  }

  async createSystemNotification(userId, titleAr, titleEn, contentAr, contentEn) {
    return NotificationRepository.create({ userId, type: 'SYSTEM', titleAr, titleEn, contentAr, contentEn });
  }

  // ─── Product Lifecycle Notifications ─────────────────────────────────────────

  /**
   * Notify all ADMIN/OWNER users that a new product is awaiting review.
   */
  async notifyAdminsProductSubmitted(productId, productName) {
    const admins = await this._getAdminUserIds();
    const sends = admins.map(userId =>
      NotificationRepository.create({
        userId,
        type: 'PRODUCT_STATUS',
        titleAr: 'منتج جديد بانتظار المراجعة',
        titleEn: 'New Product Pending Review',
        contentAr: `تم إرسال منتج جديد "${productName}" ويحتاج إلى مراجعتك.`,
        contentEn: `A new product "${productName}" has been submitted and awaits your review.`
      })
    );
    await Promise.allSettled(sends);
  }

  /**
   * Notify vendor that their product was approved.
   */
  async notifyVendorProductApproved(vendorUserId, productName) {
    if (!vendorUserId) return;
    await NotificationRepository.create({
      userId: vendorUserId,
      type: 'PRODUCT_STATUS',
      titleAr: 'تمت الموافقة على منتجك',
      titleEn: 'Product Approved',
      contentAr: `تمت الموافقة على منتجك "${productName}" وهو متاح الآن في السوق.`,
      contentEn: `Your product "${productName}" has been approved and is now live on the marketplace.`
    });
  }

  /**
   * Notify vendor that their product was rejected with a reason.
   */
  async notifyVendorProductRejected(vendorUserId, productName, reason) {
    if (!vendorUserId) return;
    await NotificationRepository.create({
      userId: vendorUserId,
      type: 'PRODUCT_STATUS',
      titleAr: 'تم رفض منتجك',
      titleEn: 'Product Rejected',
      contentAr: `تم رفض منتجك "${productName}". السبب: ${reason || 'لا يوجد سبب محدد'}. يرجى تعديله وإعادة الإرسال.`,
      contentEn: `Your product "${productName}" was rejected. Reason: ${reason || 'No reason provided'}. Please edit and resubmit.`
    });
  }

  /**
   * Notify admins that a vendor edited an approved product (back to PENDING).
   */
  async notifyAdminsProductEdited(productId, productName) {
    const admins = await this._getAdminUserIds();
    const sends = admins.map(userId =>
      NotificationRepository.create({
        userId,
        type: 'PRODUCT_STATUS',
        titleAr: 'منتج معتمد تم تعديله',
        titleEn: 'Approved Product Edited',
        contentAr: `قام المورد بتعديل المنتج "${productName}" وهو الآن بانتظار مراجعتك مجددًا.`,
        contentEn: `Vendor edited "${productName}" — it is back in the review queue.`
      })
    );
    await Promise.allSettled(sends);
  }

  /**
   * Fetches all admin/owner user IDs from the database.
   */
  async _getAdminUserIds() {
    const [rows] = await pool.execute(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'OWNER') AND is_active = 1 LIMIT 20`
    );
    return rows.map(r => r.id);
  }
}

export default new NotificationService();
