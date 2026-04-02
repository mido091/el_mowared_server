/**
 * @file AuthService.js
 * @description Authentication service handling User/Vendor registration, login, JWT generation,
 * and OTP-gated account activation and password reset flows.
 */

import UserRepository from '../repositories/UserRepository.js';
import VendorRepository from '../repositories/VendorRepository.js';
import PendingRegistrationRepository from '../repositories/PendingRegistrationRepository.js';
import pool from '../config/db.js';
import jwt from 'jsonwebtoken';
import { AppError } from '../middlewares/errorHandler.js';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import logger from '../utils/logger.js';

class AuthService {
  async _cleanupConflictingUser(email, connection) {
    const existingUser = await UserRepository.findByEmail(email, connection, true);

    if (!existingUser) return;

    if (!existingUser.is_active || existingUser.deleted_at) {
      await connection.execute('DELETE FROM users WHERE id = ?', [existingUser.id]);
      return;
    }

    if (existingUser.role === 'MOWARED') {
      const [rows] = await connection.execute(
        'SELECT verification_status FROM vendor_profiles WHERE user_id = ?',
        [existingUser.id]
      );

      if (rows[0]?.verification_status === 'REJECTED') {
        await connection.execute('DELETE FROM users WHERE id = ?', [existingUser.id]);
        return;
      }

      throw new AppError('Email already in use or account pending approval', 400);
    }

    throw new AppError('Email already in use', 400);
  }

  async _createPersistedRegistration(userData, isVendor = false, vendorData = {}, connection) {
    await this._cleanupConflictingUser(userData.email, connection);
    const hashedPassword = userData.passwordHash || await bcrypt.hash(userData.password, await bcrypt.genSalt(10));
    const isSelfActivatingRole = !isVendor;

    const user = await UserRepository.create({
      ...userData,
      password: hashedPassword,
      role: isVendor ? 'MOWARED' : 'USER',
      is_active: isSelfActivatingRole,
      profile_image_url: 'https://res.cloudinary.com/ddqlt5oqu/image/upload/v1764967019/default_pi1ur8.webp'
    }, connection);

    if (isVendor) {
      const vendor = await VendorRepository.create({
        userId: user.id,
        ...vendorData
      }, connection);

      if (vendorData.categoryIds) {
        await VendorRepository.addCategories(vendor.id, vendorData.categoryIds, connection);
      }
    }

    return user;
  }

  /**
   * Stores a pending registration until OTP verification succeeds.
   * No real account is created before email verification.
   */
  async register(userData, isVendor = false, vendorData = {}) {
    const connection = await pool.getConnection();

    try {
      await this._cleanupConflictingUser(userData.email, connection);
      const passwordHash = await bcrypt.hash(userData.password, await bcrypt.genSalt(10));

      await PendingRegistrationRepository.upsert({
        email: userData.email,
        registrationRole: isVendor ? 'MOWARED' : 'USER',
        payload: {
          userData: {
            ...userData,
            password: undefined,
            passwordHash
          },
          isVendor,
          vendorData
        },
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }, connection);

      return { email: userData.email };
    } catch (error) {
      logger.error('AuthService.register error', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Creates the real account only after OTP verification succeeds.
   * Regular users become active immediately after OTP verification.
   * Vendors remain inactive until admin approval.
   */
  async finalizeRegistration(email, connection) {
    const pending = await PendingRegistrationRepository.findByEmail(email, connection);
    if (!pending) {
      throw new AppError('Registration session expired. Please register again.', 400);
    }

    const { userData, isVendor, vendorData } = pending.payload || {};
    if (!userData?.email) {
      throw new AppError('Registration session is invalid. Please register again.', 400);
    }

    await this._createPersistedRegistration(userData, !!isVendor, vendorData || {}, connection);
    await PendingRegistrationRepository.deleteByEmail(email, connection);

    const user = await UserRepository.findByEmail(email, connection);
    const isSelfActivatingRole = ['USER', 'MARKETER', 'ADMIN', 'OWNER'].includes(user.role);
    const token = isSelfActivatingRole ? this.generateToken(user) : null;

    delete user.password;
    return { user, token };
  }

  /**
   * Legacy activation helper kept for backward compatibility.
   */
  async activateUser(email, connection) {
    const user = await UserRepository.findByEmail(email, connection);
    if (!user) throw new AppError('User not found', 404);

    const isSelfActivatingRole = ['USER', 'MARKETER', 'ADMIN', 'OWNER'].includes(user.role);

    if (isSelfActivatingRole) {
      await UserRepository.updateStatus(user.id, true, connection);
      user.is_active = true;
    }

    const token = isSelfActivatingRole ? this.generateToken(user) : null;
    delete user.password;
    return { user, token };
  }

  async login(email, password) {
    const user = await UserRepository.findByEmail(email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new AppError('Invalid email or password', 401);
    }

    if (!user.is_active) {
      if (user.role === 'MOWARED') {
        const [profile] = await pool.execute(
          'SELECT verification_status FROM vendor_profiles WHERE user_id = :id',
          { id: user.id }
        );
        const status = profile[0]?.verification_status;
        if (status === 'PENDING') throw new AppError('Your account is pending approval. Please wait 24 hours.', 403);
        if (status === 'REJECTED') throw new AppError('Your account application was rejected. You may register again with new details.', 403);
        throw new AppError('Your account is inactive. Please contact site administration to learn the reason for suspension.', 403, 'ACCOUNT_INACTIVE');
      }

      throw new AppError('Please verify your email address before logging in.', 403);
    }

    const token = this.generateToken(user);
    delete user.password;
    return { user, token };
  }

  async issueResetToken(email) {
    const user = await UserRepository.findByEmail(email);
    if (!user) throw new AppError('No account found with this email', 404);

    return jwt.sign(
      { id: user.id, email: user.email, purpose: 'PASSWORD_RESET' },
      env.jwtSecret,
      { expiresIn: '15m' }
    );
  }

  async resetPassword(resetToken, newPassword) {
    let payload;
    try {
      payload = jwt.verify(resetToken, env.jwtSecret);
    } catch {
      throw new AppError('Reset link has expired or is invalid. Please start over.', 401);
    }

    if (payload.purpose !== 'PASSWORD_RESET') {
      throw new AppError('Invalid reset token', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await pool.execute(
      'UPDATE users SET password = :password, updated_at = NOW() WHERE id = :id',
      { password: hashedPassword, id: payload.id }
    );
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = await UserRepository.findById(userId);
    if (!user) throw new AppError('User not found', 404);

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      throw new AppError('Current password is incorrect', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await pool.execute(
      'UPDATE users SET password = :password, updated_at = NOW() WHERE id = :id',
      { password: hashedPassword, id: userId }
    );
  }

  generateToken(user) {
    const firstName = user.first_name || user.firstName || '';
    const lastName = user.last_name || user.lastName || '';
    const name = `${firstName} ${lastName}`.trim() || 'User';

    return jwt.sign(
      { id: user.id, role: user.role, name },
      env.jwtSecret,
      { expiresIn: '12h' }
    );
  }
}

export default new AuthService();
