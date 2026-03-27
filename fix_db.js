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
    failed_attempts INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_type (email, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'elmowared',
    port: parseInt(process.env.DB_PORT || '3306'),
    namedPlaceholders: true
  });

  try {
    console.log('⏳ Creating verification_codes table...');
    await pool.execute(sql);
    console.log('✅ Table created successfully.');
  } catch (err) {
    console.error('❌ Error creating table:', err.message);
  } finally {
    await pool.end();
  }
})();
