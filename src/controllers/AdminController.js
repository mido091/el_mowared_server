/**
 * @file AdminController.js
 * @description Controller for high-level user governance and system administration.
 * Restricted to OWNER/ADMIN roles for sensitive identity operations.
 */

import UserRepository from '../repositories/UserRepository.js';
import pool from '../config/db.js';
import { AppError } from '../middlewares/errorHandler.js';
import UploadService from '../services/UploadService.js';
import MetricsCacheService from '../services/MetricsCacheService.js';

class AdminController {
  /**
   * Updates a user's role (e.g., promoting a USER to MOWARED).
   * Implements a safety guard to prevent self-demotion or promotion.
   * 
   * @async
   * @param {Object} req - Request params contain 'id' and body contains 'role'.
   * @throws {AppError} 400 - If trying to modify own role.
   */
  async updateUserRole(req, res, next) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const { id } = req.params;
      const { role } = req.body;

      // 1. Self-Modification Guard: Admins cannot change their own privileges.
      if (id === req.user.id.toString()) {
        throw new AppError('You cannot change your own role', 400);
      }

      const targetUser = await UserRepository.findById(id, connection, true);
      if (!targetUser) {
        throw new AppError('User not found', 404);
      }

      // 2. Persistence: Commit the role change in a transaction.
      await UserRepository.updateRole(id, role, connection);

      // 3. Audit Logging: Record the administrative action for accountability.
      await connection.execute(
        'INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES (:admin_id, :action, :target_id, :details)',
        { 
          admin_id: req.user.id, 
          action: 'CHANGE_ROLE', 
          target_id: id, 
          details: `Changed role from ${targetUser.role} to ${role}` 
        }
      );

      await connection.commit();
      MetricsCacheService.invalidate('public:marketplace-summary');
      MetricsCacheService.invalidate('public:vendors');

      res.status(200).json({
        status: 'success',
        message: `User role updated to ${role}`
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Toggles a user's active status.
   * Used for blocking/suspending accounts due to policy violations.
   * 
   * @async
   */
  async toggleUserStatus(req, res, next) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (id === req.user.id.toString()) {
        throw new AppError('You cannot change your own status', 400);
      }

      await UserRepository.updateStatus(id, isActive, connection);

      // Audit Logging: Track the suspension/activation event.
      await connection.execute(
        'INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES (:admin_id, :action, :target_id, :details)',
        {
          admin_id: req.user.id,
          action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
          target_id: id,
          details: `Set isActive to ${isActive}`
        }
      );

      await connection.commit();

      res.status(200).json({
        status: 'success',
        message: `User status updated to ${isActive ? 'Active' : 'Banned'}`
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Permanently (soft) deletes a user from the system.
   * Restricted to OWNER/ADMIN.
   * 
   * @async
   */
  async deleteUser(req, res, next) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const { id } = req.params;

      if (id === req.user.id.toString()) {
        throw new AppError('You cannot delete your own account from here', 400);
      }

      const targetUser = await UserRepository.findById(id, connection, true);
      if (!targetUser) {
        throw new AppError('User not found', 404);
      }

      const [[vendorProfile]] = await connection.execute(
        `SELECT id, logo_public_id, verification_docs_public_id
         FROM vendor_profiles
         WHERE user_id = :id
         LIMIT 1`,
        { id }
      );

      let vendorAssets = [];
      if (vendorProfile?.id) {
        const [imageRows] = await connection.execute(
          `
          SELECT pi.public_id
          FROM product_images pi
          JOIN products p ON p.id = pi.product_id
          WHERE p.vendor_id = :vendorId
          `,
          { vendorId: vendorProfile.id }
        );
        vendorAssets = imageRows.map((row) => row.public_id).filter(Boolean);
      }

      const assetPublicIds = [
        targetUser.profile_image_public_id,
        vendorProfile?.logo_public_id,
        vendorProfile?.verification_docs_public_id,
        ...vendorAssets
      ].filter(Boolean);

      // 1. Persistence: Hard delete to activate DB-level cascade cleanup.
      await UserRepository.delete(id, connection);

      // 2. Audit Logging
      await connection.execute(
        'INSERT INTO admin_logs (admin_id, action, target_id, details) VALUES (:admin_id, :action, :target_id, :details)',
        {
          admin_id: req.user.id,
        action: targetUser.deleted_at ? 'PURGE_USER' : 'DELETE_USER',
        target_id: id,
        details: `${targetUser.deleted_at ? 'Purged' : 'Deleted'} user ${targetUser.email}`
      }
      );

      await connection.commit();

      await Promise.allSettled(
        assetPublicIds.map((publicId) => UploadService.deleteImage(publicId))
      );
      MetricsCacheService.invalidate('public:marketplace-summary');
      MetricsCacheService.invalidate('public:vendors');
      MetricsCacheService.invalidate('public:categories');

      res.status(200).json({
        status: 'success',
        message: targetUser.deleted_at ? 'Deleted user permanently purged' : 'User account permanently deleted'
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Admin Utility: Upload an image to Cloudinary and return the URL.
   * Useful for administrative overrides of profile images or other assets.
   * 
   * @async
   */
  async uploadImage(req, res, next) {
    try {
      if (!req.file) {
        throw new AppError('No image provided', 400);
      }
      const { url } = await UploadService.uploadImage(req.file.buffer, 'elmowared/admin_uploads');
      res.status(200).json({ status: 'success', url });
    } catch (error) {
      next(error);
    }
  }
}

export default new AdminController();
