/**
 * @file AuthController.js
 * @description Controller for managing authentication and onboarding flows.
 * Implements strict request validation using Zod schemas for both Users and Merchants.
 * Enhanced with OTP-gated email verification and password reset flows.
 */

import AuthService from '../services/AuthService.js';
import OtpService from '../services/OtpService.js';
import PendingRegistrationRepository from '../repositories/PendingRegistrationRepository.js';
import pool from '../config/db.js';
import { z } from 'zod';

class AuthController {
  /**
   * Field normalization: Standardizes frontend snake_case to backend camelCase.
   * Also handles full_name split fallback.
   */
  _normalizeBody(body) {
    const normalized = { ...body };

    if (Object.prototype.hasOwnProperty.call(normalized, 'first_name') && !normalized.firstName) {
      normalized.firstName = normalized.first_name;
      delete normalized.first_name;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'last_name') && !normalized.lastName) {
      normalized.lastName = normalized.last_name;
      delete normalized.last_name;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, 'full_name') && !normalized.firstName) {
      const parts = normalized.full_name.trim().split(' ');
      normalized.firstName = parts[0] || normalized.full_name;
      normalized.lastName = parts.slice(1).join(' ') || parts[0];
      delete normalized.full_name;
    }

    return normalized;
  }

  // ─────────────────────────────────────────────
  // REGISTRATION FLOW
  // ─────────────────────────────────────────────

  /**
   * Universal customer registration handler.
   * Stores a pending registration and sends an OTP email.
   * The real account is only created after OTP verification.
   */
  registerUser = async (req, res, next) => {
    try {
      const body = this._normalizeBody(req.body);

      const userData = z.object({
        firstName: z.string().trim().min(2),
        lastName:  z.string().trim().min(1),
        email:     z.string().email().toLowerCase().trim(),
        phone:     z.string().trim().optional().or(z.literal('')),
        password:  z.string().min(6)
      }).parse(body);

      const lang = req.headers['accept-language']?.startsWith('ar') ? 'ar' : 'en';

      await AuthService.register(userData, false);

      await OtpService.generateAndSend(
        userData.email,
        'REGISTRATION',
        lang,
        `${userData.firstName} ${userData.lastName}`
      );

      res.status(200).json({
        status: 'success',
        message: 'Verification code sent to your email.',
        data: { email: userData.email }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verifies the registration OTP and activates the user account.
   * Returns a JWT for immediate login (regular users only).
   */
  verifyRegistrationOtp = async (req, res, next) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const { email, otp } = z.object({
        email: z.string().email().toLowerCase().trim(),
        otp:   z.string().length(6)
      }).parse(req.body);

      await OtpService.verify(email, otp, 'REGISTRATION', connection);
      const { user, token } = await AuthService.finalizeRegistration(email, connection);

      const normalizedUser = {
        ...user,
        full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        role: (user.role || 'USER').toLowerCase()
      };

      await connection.commit();

      res.status(200).json({
        status: 'success',
        message: 'Email verified successfully! Welcome to Elmowared.',
        data: { user: normalizedUser, token }
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Specialized Merchant (Mowared) registration handler.
   */
  registerMowared = async (req, res, next) => {
    try {
      const body = this._normalizeBody(req.body);

      if (Object.prototype.hasOwnProperty.call(body, 'company_name') && !body.companyNameEn) {
        body.companyNameEn = body.company_name;
        body.companyNameAr = body.company_name;
        delete body.company_name;
      }

      const mowaredRegisterSchema = z.object({
        firstName:           z.string().min(2),
        lastName:            z.string().min(1),
        email:               z.string().email().toLowerCase().trim(),
        phone:               z.string().min(8),
        password:            z.string().min(6),
        companyNameAr:       z.string().min(2),
        companyNameEn:       z.string().min(2),
        commercial_register: z.string().optional(),
        industry_category:   z.string().optional(),
        categoryIds:         z.array(z.number()).min(1, 'At least one category is required'),
        bio:                 z.string().optional(),
        address:             z.string().optional()
      });

      const validatedData = mowaredRegisterSchema.parse(body);
      const { companyNameAr, companyNameEn, categoryIds, commercial_register, industry_category, bio, address, ...userData } = validatedData;

      const lang = req.headers['accept-language']?.startsWith('ar') ? 'ar' : 'en';

      await AuthService.register(userData, true, {
        companyNameAr,
        companyNameEn,
        categoryIds,
        bioAr: bio,
        bioEn: bio,
        location: address
      });

      // Send OTP for vendor registration too
      await OtpService.generateAndSend(
        userData.email,
        'REGISTRATION',
        lang,
        `${userData.firstName} ${userData.lastName}`
      );

      res.status(200).json({
        status: 'success',
        message: 'Verification code sent. Please verify your email to complete registration.',
        data: { email: userData.email }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verifies the vendor registration OTP.
   * Vendor accounts remain inactive (require admin approval).
   * Shows the pending approval modal instead of issuing a token.
   */
  verifyVendorRegistrationOtp = async (req, res, next) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const { email, otp } = z.object({
        email: z.string().email().toLowerCase().trim(),
        otp:   z.string().length(6)
      }).parse(req.body);

      await OtpService.verify(email, otp, 'REGISTRATION', connection);
      const { user } = await AuthService.finalizeRegistration(email, connection);

      await connection.commit();

      res.status(200).json({
        status: 'success',
        message: 'Email verified. Your vendor application is pending admin review.',
        data: {
          user: { email: user.email, role: user.role },
          pendingApproval: true
        }
      });
    } catch (error) {
      await connection.rollback();
      next(error);
    } finally {
      connection.release();
    }
  }

  /**
   * Cancels a pending registration.
   * This handles the "Change Email" button on the OTP form.
   * Deletes the unverified user to keep the database clean and allow immediate re-registration.
   */
  cancelRegistration = async (req, res, next) => {
    try {
      const { email } = z.object({
        email: z.string().email().toLowerCase().trim()
      }).parse(req.body);

      await PendingRegistrationRepository.deleteByEmail(email);
      await pool.execute('DELETE FROM users WHERE email = :email AND is_active = FALSE', { email });

      res.status(200).json({
        status: 'success',
        message: 'Registration cancelled successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────
  // OTP RESEND
  // ─────────────────────────────────────────────

  /**
   * Resends an OTP for any flow (registration or password reset).
   * Rate-limited to 1 request per 60 seconds.
   */
  resendOtp = async (req, res, next) => {
    try {
      const { email, type } = z.object({
        email: z.string().email().toLowerCase().trim(),
        type:  z.enum(['REGISTRATION', 'PASSWORD_RESET'])
      }).parse(req.body);

      const lang = req.headers['accept-language']?.startsWith('ar') ? 'ar' : 'en';
      await OtpService.generateAndSend(email, type, lang);

      res.status(200).json({
        status: 'success',
        message: 'A new verification code has been sent.'
      });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────
  // FORGOT PASSWORD FLOW
  // ─────────────────────────────────────────────

  /**
   * Initiates the forgot-password flow.
   * Checks if user exists, then sends a PASSWORD_RESET OTP.
   * Always returns success (to avoid email enumeration attacks).
   */
  forgotPassword = async (req, res, next) => {
    try {
      const { email } = z.object({
        email: z.string().email().toLowerCase().trim()
      }).parse(req.body);

      const lang = req.headers['accept-language']?.startsWith('ar') ? 'ar' : 'en';

      // Silently attempt to send — if user doesn't exist we don't reveal that
      try {
        await OtpService.generateAndSend(email, 'PASSWORD_RESET', lang);
      } catch (inner) {
        // Only re-throw rate limit errors
        if (inner.statusCode === 429) throw inner;
        // Otherwise swallow (user not found etc.)
      }

      res.status(200).json({
        status: 'success',
        message: 'If this email is registered, a reset code has been sent.'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verifies the password-reset OTP and issues a short-lived reset JWT.
   */
  verifyResetOtp = async (req, res, next) => {
    try {
      const { email, otp } = z.object({
        email: z.string().email().toLowerCase().trim(),
        otp:   z.string().length(6)
      }).parse(req.body);

      await OtpService.verify(email, otp, 'PASSWORD_RESET');
      const resetToken = await AuthService.issueResetToken(email);

      res.status(200).json({
        status: 'success',
        message: 'OTP verified. You may now reset your password.',
        data: { resetToken }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resets the user's password using the verified reset token.
   */
  resetPassword = async (req, res, next) => {
    try {
      const { resetToken, newPassword } = z.object({
        resetToken:  z.string().min(10),
        newPassword: z.string().min(6)
      }).parse(req.body);

      await AuthService.resetPassword(resetToken, newPassword);

      res.status(200).json({
        status: 'success',
        message: 'Password updated successfully. You may now login.'
      });
    } catch (error) {
      next(error);
    }
  }

  changePassword = async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = z.object({
        currentPassword: z.string().min(6),
        newPassword: z.string().min(6)
      }).parse(req.body);

      await AuthService.changePassword(req.user.id, currentPassword, newPassword);

      res.status(200).json({
        status: 'success',
        message: 'Password updated successfully.'
      });
    } catch (error) {
      next(error);
    }
  }

  // ─────────────────────────────────────────────
  // LOGIN / ME
  // ─────────────────────────────────────────────

  /**
   * Primary Login handler.
   */
  login = async (req, res, next) => {
    try {
      const { email, password } = z.object({
        email:    z.string().email().toLowerCase().trim(),
        password: z.string()
      }).parse(req.body);

      const result = await AuthService.login(email, password);

      const u = result.user;
      const user = {
        ...u,
        full_name:    u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || undefined,
        company_name: u.company_name || undefined,
        role:         (u.role || 'user').toLowerCase()
      };

      res.status(200).json({
        status: 'success',
        data: { user, token: result.token }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Profile retrieval for currently authenticated session.
   */
  getMe = async (req, res) => {
    res.status(200).json({
      status: 'success',
      data: { user: req.user }
    });
  }
}

export default new AuthController();
