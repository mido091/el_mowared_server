/**
 * @file UserController.js
 * @description Controller for managing individual user profiles and image assets.
 * Handles sensitive identity updates and media interactions for active accounts.
 */

import UserRepository from '../repositories/UserRepository.js';
import UserService from '../services/UserService.js';
import { AppError } from '../middlewares/errorHandler.js';
import { z } from 'zod';
import pool from '../config/db.js';

class UserController {
  /**
   * Orchestrates profile image updates.
   * Acts as a boundary between multi-part file uploads and the core domain service.
   * 
   * @async
   * @param {Object} req - Request object (file buffer expected via Multer).
   * @param {Object} res 
   * @param {Function} next 
   */
  async updateProfileImage(req, res, next) {
    try {
      // 1. Guard Requirement: Ensure the system actually received binary data.
      if (!req.file) {
        throw new AppError('No image provided', 400);
      }

      // 2. Integration logic: Rotate asset and update user record.
      const { url } = await UserService.updateProfileImage(req.user.id, req.file.buffer);

      res.status(200).json({
        status: 'success',
        data: {
          profile_image_url: url,
          avatar: url
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Updates basic identity fields for the authenticated user.
   * Implements granular field validation to prevent record corruption.
   * 
   * @async
   */
  async updateProfile(req, res, next) {
    try {
      const normalizedBody = {
        firstName: req.body.firstName ?? req.body.first_name,
        lastName: req.body.lastName ?? req.body.last_name,
        phone: req.body.phone
      };

      // 1. Validation Logic: Define allowed profile mutations.
      const { firstName, lastName, phone } = z.object({
        firstName: z.string().min(2).optional(),
        lastName: z.string().min(2).optional(),
        phone: z.string().min(10).optional()
      }).parse(normalizedBody);

      // 2. Persistence Transition: Delegate to direct identity repository.
      await UserRepository.updateBasicInfo(req.user.id, { firstName, lastName, phone });
      const updatedUser = await UserRepository.findById(req.user.id);
      delete updatedUser.password;

      res.status(200).json({
        status: 'success',
        message: 'Profile updated successfully',
        data: { user: updatedUser }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Aggregates personal statistics for the user dashboard.
   * Provides counts for orders, RFQs, and unread messages.
   * 
   * @async
   */
  async getStats(req, res, next) {
    try {
      const userId = req.user.id;
      
      const [orders] = await pool.execute('SELECT COUNT(*) as count FROM orders WHERE user_id = :userId', { userId });
      const [rfqs] = await pool.execute('SELECT COUNT(*) as count FROM rfq_requests WHERE user_id = :userId', { userId });
      const [unread] = await pool.execute(
        `SELECT COUNT(*) as count
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN vendor_profiles vp ON vp.id = c.vendor_id
         WHERE m.is_read = 0
           AND m.sender_id != :userId
           AND (
             c.user_id = :userId
             OR vp.user_id = :userId
           )`,
        { userId }
      );
      
      res.status(200).json({
        status: 'success',
        data: {
          orders_count: orders[0].count,
          rfqs_count: rfqs[0].count,
          unread_messages: unread[0].count
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves the authenticated user's profile.
   * Centralizes identity logic for all roles (USER, MOWARED, ADMIN, OWNER).
   * 
   * @async
   */
  async getProfile(req, res, next) {
    try {
      // req.user is already populated by the 'protect' middleware.
      // We sanitise it for safety before sending.
      const user = { ...req.user };
      delete user.password;
      delete user.deleted_at;

      res.status(200).json({
        status: 'success',
        data: { user }
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new UserController();
