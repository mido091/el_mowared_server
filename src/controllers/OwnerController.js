/**
 * @file OwnerController.js
 * @description Controller for specialized platform ownership operations.
 * Handles sensitive global user mutations and high-privilege identity rotations.
 */

import UserRepository from '../repositories/UserRepository.js';
import VendorRepository from '../repositories/VendorRepository.js';
import pool from '../config/db.js';
import { AppError } from '../middlewares/errorHandler.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import AuthService from '../services/AuthService.js';
import logger from '../utils/logger.js';
import MetricsCacheService from '../services/MetricsCacheService.js';

class OwnerController {
  /**
   * Manual User Creation (Owner Exclusive).
   * Allows the OWNER to directly onboard any role (USER, MOWARED, ADMIN).
   * 
   * @async
   */
  async createUser(req, res, next) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      const data = z.object({
        firstName: z.string().trim().optional().nullable(),
        lastName: z.string().trim().optional().nullable(),
        email: z.string().email().toLowerCase().trim(),
        phone: z.string().trim().optional().nullable(),
        password: z.string().min(6),
        role: z.enum(['OWNER', 'ADMIN', 'MOWARED', 'USER']).default('USER'),
        profileImageUrl: z.string().optional().nullable()
      }).parse(req.body);

      // 1. Conflict Check
      const existingUser = await UserRepository.findByEmail(data.email, connection);
      if (existingUser) {
        throw new AppError('Email already in use', 400);
      }

      // 2. Hash Password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(data.password, salt);

      // 3. Create Identity
      const user = await UserRepository.create({
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.email,
        phone: data.phone || '',
        password: hashedPassword,
        role: data.role,
        is_active: true
      }, connection);

      if (data.profileImageUrl) {
        await UserRepository.updateProfileImage(user.id, data.profileImageUrl, 'manual_creation', connection);
      }

      // 4. Vendor Initialization: Create profile shell for merchants
      if (data.role === 'MOWARED') {
        const companyName = `${data.firstName || ''} ${data.lastName || ''} Company`.trim() || 'New Merchant';
        await VendorRepository.create({
          userId: user.id,
          companyNameAr: companyName,
          companyNameEn: companyName
        }, connection);
      }

      await connection.commit();
      MetricsCacheService.invalidate('public:marketplace-summary');
      if (data.role === 'MOWARED') {
        MetricsCacheService.invalidate('public:vendors');
      }

      res.status(201).json({
        status: 'success',
        message: 'Account created successfully',
        data: { userId: user.id }
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Universal User Update (Master Override).
   * Allows the OWNER to force-update any user attribute, including roles and passwords.
   * Implements a "Root Guard" to preserve system stability.
   * 
   * @async
   * @param {Object} req - Request params contain target 'id'.
   * @throws {AppError} 403 - If trying to demote the last system OWNER.
   */
  async updateUserUniversal(req, res, next) {
    try {
      const { id } = req.params;
      const data = z.object({
        firstName: z.string().trim().optional(),
        lastName: z.string().trim().optional(),
        email: z.string().email().toLowerCase().trim().optional(),
        phone: z.string().trim().optional(),
        password: z.string().min(6).optional(),
        role: z.enum(['OWNER', 'ADMIN', 'MOWARED', 'USER']).optional(),
        isActive: z.preprocess((val) => {
          if (val === 1 || val === '1') return true;
          if (val === 0 || val === '0') return false;
          return val;
        }, z.boolean()).optional(),
        profileImageUrl: z.string().optional().nullable()
      }).parse(req.body);

      const targetUser = await UserRepository.findById(id);
      if (!targetUser) {
        throw new AppError('User not found', 404);
      }

      // 1. System Stability & Self-Guard
      if (id === req.user.id.toString()) {
        if (data.isActive === false) throw new AppError('You cannot deactivate your own account', 400);
        if (data.role && data.role !== req.user.role) throw new AppError('You cannot change your own role from this interface. Profile settings must be used for identity rotations.', 400);
      }

      // Root Guard: Prevents accidental system lockouts by ensuring at least one OWNER remains.
      if (targetUser.role === 'OWNER' && data.role && data.role !== 'OWNER') {
        const ownerCount = await UserRepository.countOwners();
        if (ownerCount <= 1) {
          throw new AppError('Cannot demote the last remaining OWNER', 403);
        }
      }

      // 2. Security Transformation: Re-hash passwords if an override is requested.
      if (data.password) {
        data.password = await bcrypt.hash(data.password, 10);
      }

      // 3. Conflict Check: Ensure the new email isn't claimed by another identity.
      if (data.email) {
        const existingUser = await UserRepository.findByEmail(data.email);
        logger.debug('OwnerController email conflict check', {
          targetId: id, 
          existingUserId: existingUser?.id, 
          existingEmail: existingUser?.email 
        });
        if (existingUser && existingUser.id.toString() !== id.toString()) {
          throw new AppError(`Email '${data.email}' is already in use by another account`, 400);
        }
      }

      try {
        await UserRepository.updateFullInfo(id, data);
      } catch (dbError) {
        logger.error('OwnerController updateUserUniversal database update failed', {
          code: dbError.code,
          message: dbError.message,
          targetUserId: id
        });
        // Specialized handling for unique constraint violations
        if (dbError.code === 'ER_DUP_ENTRY') {
          throw new AppError('The provided email is already claimed by another account. Please use a unique identity.', 409);
        }
        throw new AppError({
          en: 'A data integrity error occurred while updating this account.',
          ar: 'حدث خطأ في سلامة البيانات أثناء تحديث هذا الحساب.'
        }, 500, 'DATA_INTEGRITY_ERROR');
      }

      res.status(200).json({
        status: 'success',
        message: 'User updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Specialized Self-Update for the platform owner.
   * Handles sensitive identity changes (email, password) and issues a fresh JWT.
   * 
   * @async
   */
  async updateMe(req, res, next) {
    try {
      const data = z.object({
        firstName: z.string().trim().optional(),
        lastName: z.string().trim().optional(),
        email: z.string().email().toLowerCase().trim().optional(),
        phone: z.string().trim().optional(),
        password: z.string().min(6).optional()
      }).parse(req.body);

      // 1. Conflict Check: Ensure the new email isn't claimed by another identity.
      if (data.email) {
        const existingUser = await UserRepository.findByEmail(data.email);
        if (existingUser && existingUser.id !== req.user.id) {
          throw new AppError('Email already in use', 400);
        }
      }

      if (data.password) {
        const salt = await bcrypt.genSalt(10);
        data.password = await bcrypt.hash(data.password, salt);
      }

      // 2. Persistence: Commit changes to the core identity record.
      await UserRepository.updateFullInfo(req.user.id, data);

      // 3. Session Refresh: Issue a new JWT reflecting the updated identity.
      const updatedUser = await UserRepository.findById(req.user.id);
      const token = AuthService.generateToken(updatedUser);

      delete updatedUser.password;
      res.status(200).json({
        status: 'success',
        data: {
          user: updatedUser,
          token
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new OwnerController();
