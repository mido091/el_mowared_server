import pool from '../config/db.js';

class PendingRegistrationRepository {
  constructor() {
    this._schemaReady = false;
    this._schemaReadyPromise = null;
  }

  async initializeSchema(connection = pool) {
    if (this._schemaReady) return;
    if (this._schemaReadyPromise) return this._schemaReadyPromise;

    this._schemaReadyPromise = connection.execute(`
      CREATE TABLE IF NOT EXISTS pending_registrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        registration_role ENUM('USER', 'MOWARED') NOT NULL,
        payload_json LONGTEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_pending_registrations_role (registration_role),
        INDEX idx_pending_registrations_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).then(() => {
      this._schemaReady = true;
    }).catch((error) => {
      this._schemaReadyPromise = null;
      throw error;
    });

    return this._schemaReadyPromise;
  }

  async upsert({ email, registrationRole, payload, expiresAt }, connection = pool) {
    await connection.execute(
      `
        INSERT INTO pending_registrations (email, registration_role, payload_json, expires_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          registration_role = VALUES(registration_role),
          payload_json = VALUES(payload_json),
          expires_at = VALUES(expires_at),
          updated_at = NOW()
      `,
      [email, registrationRole, JSON.stringify(payload), expiresAt]
    );
  }

  async findByEmail(email, connection = pool) {
    const [rows] = await connection.execute(
      `
        SELECT *
        FROM pending_registrations
        WHERE email = ?
          AND expires_at > NOW()
        LIMIT 1
      `,
      [email]
    );

    if (!rows[0]) return null;

    return {
      ...rows[0],
      payload: JSON.parse(rows[0].payload_json)
    };
  }

  async deleteByEmail(email, connection = pool) {
    await connection.execute('DELETE FROM pending_registrations WHERE email = ?', [email]);
  }
}

export default new PendingRegistrationRepository();
