/**
 * Migration: Create verification_codes table for OTP system
 * Run: node migrate_otp.js
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const sql = `
CREATE TABLE IF NOT EXISTS verification_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  type ENUM('REGISTRATION', 'PASSWORD_RESET') NOT NULL,
  expires_at DATETIME NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_type (email, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

(async () => {
  const pool = mysql.createPool({
    host:     process.env.DB_HOST,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port:     parseInt(process.env.DB_PORT || '3306'),
    ssl:      { rejectUnauthorized: false }
  });

  try {
    await pool.execute(sql);
    console.log('✅  verification_codes table created successfully.');
  } catch (e) {
    console.error('❌  Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
