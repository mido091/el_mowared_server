/**
 * @file NotificationService.js
 * @description Service for managing platform-generated alerts.
 * Includes product lifecycle notification helpers.
 */

import NotificationRepository from '../repositories/NotificationRepository.js';
import pool from '../config/db.js';
import RealtimeService from './RealtimeService.js';

class NotificationService {
  async getUserNotifications(userId, page = 1, limit = 20) {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const offset = (normalizedPage - 1) * normalizedLimit;
    return NotificationRepository.findByUserId(userId, normalizedLimit, offset);
  }

  async markAsRead(id, userId) {
    return NotificationRepository.markAsRead(id, userId);
  }

  async markAllAsRead(userId) {
    return NotificationRepository.markAllAsRead(userId);
  }

  async getUnreadCount(userId) {
    return NotificationRepository.getUnreadCount(userId);
  }

  async createSystemNotification(userId, titleAr, titleEn, contentAr, contentEn) {
    return NotificationRepository.create({ userId, type: 'SYSTEM', titleAr, titleEn, contentAr, contentEn });
  }

  async emitUserEvent(userId, eventName, payload = {}) {
    if (!userId || !eventName) return null;
    await RealtimeService.emitToUser(userId, eventName, payload);
    return null;
  }

  async createRealtimeNotification(notifData, options = {}) {
    const notification = await NotificationRepository.create(notifData);

    const {
      link = '',
      toastType = 'info',
      eventName = null,
      eventPayload = {},
      additionalEvents = [],
    } = options;

    const basePayload = {
      id: notification.id,
      notificationType: notifData.type,
      titleAr: notifData.titleAr,
      titleEn: notifData.titleEn,
      contentAr: notifData.contentAr,
      contentEn: notifData.contentEn,
      messageAr: notifData.contentAr || notifData.titleAr,
      messageEn: notifData.contentEn || notifData.titleEn,
      message: notifData.contentEn || notifData.contentAr || notifData.titleEn || notifData.titleAr,
      type: toastType,
      link,
      created_at: new Date().toISOString(),
      is_read: false,
    };

    await this.emitUserEvent(notifData.userId, 'notification', basePayload);
    await this.emitUserEvent(notifData.userId, 'notification.created', basePayload);

    if (eventName) {
      await this.emitUserEvent(notifData.userId, eventName, {
        ...eventPayload,
        link,
      });
    }

    if (Array.isArray(additionalEvents)) {
      for (const extra of additionalEvents) {
        if (!extra?.name) continue;
        await this.emitUserEvent(notifData.userId, extra.name, {
          ...(extra.payload || {}),
          link: extra.link ?? link,
        });
      }
    }

    return notification;
  }

  async notifyAdminsProductSubmitted(productId, productName) {
    const admins = await this._getAdminUserIds();
    const sends = admins.map((userId) =>
      this.createRealtimeNotification(
        {
          userId,
          type: 'PRODUCT_STATUS',
          titleAr: 'تم إرسال منتج جديد للمراجعة',
          titleEn: 'New Product Pending Review',
          contentAr: `تم إرسال منتج جديد "${productName}" ويحتاج إلى مراجعتك.`,
          contentEn: `A new product "${productName}" has been submitted and awaits your review.`,
        },
        {
          link: '/dashboard/admin/product-moderation',
          toastType: 'info',
          eventName: 'product_moderation_updated',
          eventPayload: {
            productId,
            lifecycleStatus: 'PENDING',
          },
        }
      )
    );

    await Promise.allSettled(sends);
  }

  async notifyVendorProductApproved(vendorUserId, productName) {
    if (!vendorUserId) return;

    await this.createRealtimeNotification(
      {
        userId: vendorUserId,
        type: 'PRODUCT_STATUS',
        titleAr: 'تمت الموافقة على منتجك',
        titleEn: 'Product Approved',
        contentAr: `تمت الموافقة على منتجك "${productName}" وهو متاح الآن في السوق.`,
        contentEn: `Your product "${productName}" has been approved and is now live on the marketplace.`,
      },
      {
        link: '/dashboard/vendor/products',
        toastType: 'success',
        eventName: 'product_status_changed',
        eventPayload: {
          lifecycleStatus: 'APPROVED',
        },
      }
    );
  }

  async notifyVendorProductRejected(vendorUserId, productName, reason) {
    if (!vendorUserId) return;

    await this.createRealtimeNotification(
      {
        userId: vendorUserId,
        type: 'PRODUCT_STATUS',
        titleAr: 'تم رفض منتجك',
        titleEn: 'Product Rejected',
        contentAr: `تم رفض منتجك "${productName}". السبب: ${reason || 'لا يوجد سبب محدد'}. يرجى تعديله وإعادة الإرسال.`,
        contentEn: `Your product "${productName}" was rejected. Reason: ${reason || 'No reason provided'}. Please edit and resubmit.`,
      },
      {
        link: '/dashboard/vendor/products',
        toastType: 'error',
        eventName: 'product_status_changed',
        eventPayload: {
          lifecycleStatus: 'REJECTED',
        },
      }
    );
  }

  async notifyAdminsProductEdited(productId, productName) {
    const admins = await this._getAdminUserIds();
    const sends = admins.map((userId) =>
      this.createRealtimeNotification(
        {
          userId,
          type: 'PRODUCT_STATUS',
          titleAr: 'تم تعديل منتج ويحتاج مراجعة جديدة',
          titleEn: 'Approved Product Edited',
          contentAr: `قام المورد بتعديل المنتج "${productName}" وهو الآن بانتظار مراجعتك مجددًا.`,
          contentEn: `Vendor edited "${productName}" and it is back in the review queue.`,
        },
        {
          link: '/dashboard/admin/product-moderation',
          toastType: 'info',
          eventName: 'product_moderation_updated',
          eventPayload: {
            productId,
            lifecycleStatus: 'UPDATE_PENDING',
          },
        }
      )
    );

    await Promise.allSettled(sends);
  }

  async _getAdminUserIds() {
    const [rows] = await pool.execute(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'OWNER') AND is_active = 1 LIMIT 20`
    );
    return rows.map((row) => row.id);
  }
}

export default new NotificationService();
