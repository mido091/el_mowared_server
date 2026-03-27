/**
 * @file OtpService.js
 * @description Business logic for OTP generation, validation, and rate-limiting.
 *
 * Security model:
 *  - OTPs are 6-digit random numbers.
 *  - They are bcrypt-hashed before storage (same library already in use).
 *  - A 60-second rate limit prevents brute-force send requests.
 *  - Codes expire after 10 minutes (enforced at DB level).
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import logger from '../utils/logger.js';
import OtpRepository from '../repositories/OtpRepository.js';
import { sendOtpEmail } from './emailService.js';
import { AppError } from '../middlewares/errorHandler.js';

const RATE_LIMIT_SECONDS = 60;
const OTP_DIGITS = 6;

class OtpService {
  /**
   * Generates a cryptographically random 6-digit OTP.
   * Uses crypto.randomInt to avoid modulo bias.
   * @returns {string} Zero-padded 6-digit string, e.g. "042817"
   */
  _generate() {
    const n = crypto.randomInt(0, 1_000_000);
    return String(n).padStart(OTP_DIGITS, '0');
  }

  /**
   * Enforces rate limiting: max 1 OTP request per 60 seconds per email+type.
   * @param {string} email
   * @param {string} type
   * @throws {AppError} 429 if rate limit exceeded
   */
  async _checkRateLimit(email, type) {
    const last = await OtpRepository.getLastSent(email, type);
    if (last) {
      const secondsElapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
      if (secondsElapsed < RATE_LIMIT_SECONDS) {
        const remaining = Math.ceil(RATE_LIMIT_SECONDS - secondsElapsed);
        throw new AppError(
          `Please wait ${remaining} seconds before requesting a new code.`,
          429
        );
      }
    }
  }

  /**
   * Rate-limits, generates, hashes, stores, and emails an OTP.
   *
   * @param {string} email - Recipient email address
   * @param {string} type  - 'REGISTRATION' | 'PASSWORD_RESET'
   * @param {string} [lang='en'] - Email language: 'ar' | 'en'
   * @param {string} [name='']   - Optional name for email greeting
   * @returns {Promise<void>}
   */
  async generateAndSend(email, type, lang = 'en', name = '') {
    await this._checkRateLimit(email, type);

    const otp = this._generate();
    logger.debug(`🔑 [OTP:Generate] Generated code for ${email}: [${otp}]`);
    
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);

    await OtpRepository.create(email, otpHash, type);
    await sendOtpEmail({ to: email, otp, type, lang, name });
  }

  /**
   * Verifies a submitted OTP against the stored hash.
   *
   * @param {string} email
   * @param {string} otp   - Plain-text 6-digit code submitted by user
   * @param {string} type  - 'REGISTRATION' | 'PASSWORD_RESET'
   * @param {import('mysql2/promise').Connection} [connection]
   * @returns {Promise<boolean>} true if verified, false if invalid/expired
   * @throws {AppError} 400 if no valid record found (expired or already used)
   */
  async verify(email, otp, type, connection) {
    logger.debug(`🔍 [OTP:Verify] Start for ${email} (${type}) with code: [${otp}]`);
    
    const record = await OtpRepository.findValid(email, type, connection);
    if (!record) {
      logger.debug(`⚠️ [OTP:Verify] No valid record found for ${email}`);
      throw new AppError('Verification code has expired or is invalid. Please request a new one.', 400);
    }

    if (record.failed_attempts >= 5) {
      logger.debug(`⚠️ [OTP:Verify] Too many failed attempts for ${email}`);
      throw new AppError('Too many failed attempts. Code invalidated. Please request a new one.', 400);
    }

    const isMatch = await bcrypt.compare(otp, record.otp_hash);
    logger.debug(`🔍 [OTP:Verify] Comparison result for ${email}: ${isMatch}`);
    
    if (!isMatch) {
      logger.debug(`❌ [OTP:Verify] Incorrect code for ${email}. Sub: [${otp}] StoredHash: [${record.otp_hash}]`);
      await OtpRepository.incrementFailedAttempts(record.id, connection);
      throw new AppError('Incorrect verification code. Please try again.', 400);
    }

    logger.debug(`✅ [OTP:Verify] Success for ${email}`);
    await OtpRepository.markVerified(record.id, connection);
    return true;
  }
}

export default new OtpService();
