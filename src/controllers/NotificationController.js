/**
 * @file NotificationController.js
 * @description Controller for managing system alerts and platform-wide notifications.
 * Handles inbox retrieval and read-status tracking for the authenticated user.
 */

import NotificationService from '../services/NotificationService.js';

class NotificationController {
  /**
   * Retrieves the user's notification stream with real-time unread counts.
   * 
   * @async
   */
  async getAll(req, res, next) {
    try {
      const { page, limit } = req.query;
      
      // 1. Concurrent Retrieval: Fetch both the notification list and aggregated unread count.
      const notifications = await NotificationService.getUserNotifications(req.user.id, page, limit);
      const unreadCount = await NotificationService.getUnreadCount(req.user.id);

      res.status(200).json({
        status: 'success',
        data: {
          notifications: res.formatLocalization(notifications),
          unreadCount
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Updates the read status of a specific alert.
   * 
   * @async
   */
  async markRead(req, res, next) {
    try {
      await NotificationService.markAsRead(req.params.id, req.user.id);
      res.status(200).json({
        status: 'success',
        message: 'Notification marked as read'
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new NotificationController();
