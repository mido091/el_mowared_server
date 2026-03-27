/**
 * @file OtpRepository.js
 * @description Repository for OTP verification codes.
 * Handles creation, lookup, rate-limiting checks, and expiry management
 * for the verification_codes table.
 */

import pool from '../config/db.js';

class OtpRepository {
  /**
   * Creates a new OTP record, automatically expiring in 10 minutes.
   * Deletes any existing un-verified OTPs for this email/type pair
   * before inserting to keep the table clean.
   *
   * @param {string} email
   * @param {string} otpHash - bcrypt hash of the 6-digit OTP
   * @param {string} type    - 'REGISTRATION' | 'PASSWORD_RESET'
   * @param {import('mysql2/promise').Connection} [connection]
   * @returns {Promise<number>} Inserted record ID
   */
  async create(email, otpHash, type, connection = pool) {
    try {
      // Remove stale codes for this email/type before inserting
      await connection.execute(
        'DELETE FROM verification_codes WHERE email = ? AND type = ? AND is_verified = FALSE',
        [email, type]
      );

      const [result] = await connection.execute(
        `INSERT INTO verification_codes (email, otp_hash, type, expires_at)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [email, otpHash, type]
      );
      return result.insertId;
    } catch (error) {
      console.error('OtpRepository.create Error:', error.message);
      throw error;
    }
  }

  /**
   * Finds the most recent valid (non-expired, non-verified) OTP record
   * for the given email and type.
   *
   * @param {string} email
   * @param {string} type
   * @param {import('mysql2/promise').Connection} [connection]
   * @returns {Promise<Object|null>}
   */
  async findValid(email, type, connection = pool) {
    try {
      const [rows] = await connection.execute(
        `SELECT * FROM verification_codes
         WHERE email = ?
           AND type = ?
           AND is_verified = FALSE
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [email, type]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('OtpRepository.findValid Error:', error.message);
      throw error;
    }
  }

  /**
   * Marks an OTP record as verified.
   *
   * @param {number} id - The record primary key
   * @param {import('mysql2/promise').Connection} [connection]
   */
  async markVerified(id, connection = pool) {
    try {
      await connection.execute(
        'UPDATE verification_codes SET is_verified = TRUE WHERE id = ?',
        [id]
      );
    } catch (error) {
      console.error('OtpRepository.markVerified Error:', error.message);
      throw error;
    }
  }

  /**
   * Increments the failed attempts counter for an OTP record.
   *
   * @param {number} id - The record primary key
   * @param {import('mysql2/promise').Connection} [connection]
   */
  async incrementFailedAttempts(id, connection = pool) {
    try {
      await connection.execute(
        'UPDATE verification_codes SET failed_attempts = failed_attempts + 1 WHERE id = ?',
        [id]
      );
    } catch (error) {
      console.error('OtpRepository.incrementFailedAttempts Error:', error.message);
      throw error;
    }
  }

  /**
   * Returns the most recently created OTP for a given email/type,
   * used to enforce the 60-second rate limit between send requests.
   *
   * @param {string} email
   * @param {string} type
   * @param {import('mysql2/promise').Connection} [connection]
   * @returns {Promise<Object|null>}
   */
  async getLastSent(email, type, connection = pool) {
    try {
      const [rows] = await connection.execute(
        `SELECT created_at FROM verification_codes
         WHERE email = ? AND type = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [email, type]
      );
      return rows[0] || null;
    } catch (error) {
      console.error('OtpRepository.getLastSent Error:', error.message);
      throw error;
    }
  }
}

export default new OtpRepository();
