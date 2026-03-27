/**
 * @file UserRepository.js
 * @description Repository for User identity management.
 * Handles authentication data, role assignments, and profile meta-data.
 */

import pool from '../config/db.js';

class UserRepository {
  /**
   * Locates an active user by their email address.
   * 
   * @async
   * @param {string} email 
   * @returns {Promise<Object|null>} Full user record for authentication.
   */
  async findByEmail(email, connection = pool, includeDeleted = false) {
    try {
      // Use positional placeholder (?) for maximum compatibility across connection types
      const sql = `SELECT * FROM users WHERE email = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`;
      const [rows] = await connection.execute(sql, [email]);
      return rows[0];
    } catch (error) {
      console.error('UserRepository.findByEmail Error:', error.message);
      throw error;
    }
  }

  /**
   * Retrieves user identity by primary key.
   * 
   * @async
   * @param {number} id 
   * @returns {Promise<Object|null>} Basic user identity.
   */
  async findById(id, connection = pool) {
    const [rows] = await connection.execute(
      'SELECT * FROM users WHERE id = :id AND deleted_at IS NULL',
      { id }
    );
    return rows[0];
  }

  /**
   * Persists a new user identity.
   * 
   * @async
   * @param {Object} userData - Identity attributes.
   * @param {Object} [connection] - Optional MySQL connection for transaction support.
   * @returns {Promise<Object>} Created user summary.
   */
  async create(userData, connection = pool) {
    const { firstName, lastName, email, phone, password, role, is_active } = userData;
    // Insert with status to enable/disable immediate login based on role onboarding.
    const sql = `
      INSERT INTO users (first_name, last_name, email, phone, password, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    const [result] = await connection.execute(sql, [
      firstName || '',
      lastName || '',
      email,
      phone || '',
      password,
      role || 'USER',
      is_active === undefined ? true : !!is_active
    ]);
    return { 
      id: result.insertId, 
      first_name: firstName, 
      last_name: lastName, 
      email, 
      phone, 
      role: role || 'USER',
      is_active: is_active === undefined ? true : !!is_active 
    };
  }

  /**
   * Updates basic contact information.
   * 
   * @async
   * @param {number} id 
   * @param {Object} info - New contact attributes.
   * @returns {Promise<boolean>} Success indication.
   */
  async updateBasicInfo(id, { firstName, lastName, phone }, connection = pool) {
    // Conditional Updates: Uses COALESCE to preserve existing data if new values are not provided.
    const [result] = await connection.execute(
      `UPDATE users 
       SET first_name = COALESCE(:firstName, first_name), 
           last_name = COALESCE(:lastName, last_name), 
           phone = COALESCE(:phone, phone),
           updated_at = NOW()
       WHERE id = :id AND deleted_at IS NULL`,
      { id, firstName, lastName, phone }
    );
    return result.affectedRows > 0;
  }

  /**
   * Syncs a user's profile image reference.
   * 
   * @async
   * @param {number} id 
   * @param {string} url - Cloudinary asset URL.
   * @param {string} publicId - Cloudinary asset ID for future cleanup.
   */
  async updateProfileImage(id, url, publicId, connection = pool) {
    await connection.execute(
      'UPDATE users SET profile_image_url = :url, profile_image_public_id = :publicId WHERE id = :id',
      { id, url, publicId }
    );
  }

  /**
   * Administrative role assignment.
   * 
   * @async
   * @param {number} id 
   * @param {string} role - New role assignment.
   */
  async updateRole(id, role, connection = pool) {
    await connection.execute('UPDATE users SET role = :role, updated_at = NOW() WHERE id = :id', { id, role });
  }

  /**
   * Toggles account activation status.
   * 
   * @async
   * @param {number} id 
   * @param {boolean} isActive 
   */
  async updateStatus(id, isActive, connection = pool) {
    await connection.execute('UPDATE users SET is_active = :isActive, updated_at = NOW() WHERE id = :id', { id, isActive });
  }

  /**
   * Counts users with 'OWNER' privileges.
   * Used for safety checks to prevent orphan system states.
   * 
   * @async
   * @returns {Promise<number>} Count of system owners.
   */
  async countOwners() {
    const [rows] = await pool.execute("SELECT COUNT(*) as count FROM users WHERE role = 'OWNER' AND deleted_at IS NULL");
    return rows[0].count;
  }

  /**
   * Universal information update used by system administrators.
   * 
   * @async
   * @param {number} id 
   * @param {Object} data 
   * @returns {Promise<boolean>} Success indication.
   */
  async updateFullInfo(id, data, connection = pool) {
    const { firstName, lastName, email, phone, password, role, isActive, profileImageUrl } = data;
    // Multi-column COALESCE update: Comprehensive update restricted by administrative guards.
    const sql = `
      UPDATE users 
      SET first_name = COALESCE(:firstName, first_name),
          last_name = COALESCE(:lastName, last_name),
          email = COALESCE(:email, email),
          phone = COALESCE(:phone, phone),
          password = COALESCE(:password, password),
          role = COALESCE(:role, role),
          is_active = COALESCE(:isActive, is_active),
          profile_image_url = COALESCE(:profileImageUrl, profile_image_url),
          updated_at = NOW()
      WHERE id = :id AND deleted_at IS NULL
    `;
    const [result] = await connection.execute(sql, { 
      id, 
      firstName: firstName || null, 
      lastName: lastName || null, 
      email: email || null, 
      phone: phone || null, 
      password: password || null, 
      role: role || null,
      isActive: isActive !== undefined ? isActive : null,
      profileImageUrl: profileImageUrl || null
    });
    return result.affectedRows > 0;
  }

  /**
   * Retrieves all non-deleted users for administrative review.
   * 
   * @async
   * @returns {Promise<Array>} List of all users.
   */
  async findAll() {
    const [rows] = await pool.execute(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.profile_image_url, u.is_active, u.created_at, 
              v.id as vendor_profile_id 
       FROM users u 
       LEFT JOIN vendor_profiles v ON u.id = v.user_id 
       WHERE u.deleted_at IS NULL 
       ORDER BY u.created_at DESC`
    );
    return rows;
  }

  /**
   * Soft-deletes a user identity.
   * 
   * @async
   * @param {number} id 
   * @param {Object} [connection] 
   */
  async delete(id, connection = pool) {
    await connection.execute('UPDATE users SET deleted_at = NOW() WHERE id = :id', { id });
  }

  /**
   * Finds the least active admin or owner to assign a support chat
   */
  async findLeastActiveAdmin(connection = pool) {
    const sql = `
      SELECT u.id, COUNT(c.id) as active_chats 
      FROM users u
      LEFT JOIN conversations c ON c.admin_id = u.id AND c.status IN ('active', 'assigned')
      WHERE u.role IN ('ADMIN', 'OWNER') AND u.is_active = 1 AND u.deleted_at IS NULL
      GROUP BY u.id
      ORDER BY active_chats ASC
      LIMIT 1
    `;
    const [rows] = await connection.execute(sql);
    return rows[0] || null;
  }

  async findAdminPool(connection = pool) {
    const [rows] = await connection.execute(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.role
      FROM users u
      WHERE u.role IN ('ADMIN', 'OWNER')
        AND u.is_active = 1
        AND u.deleted_at IS NULL
      ORDER BY FIELD(u.role, 'ADMIN', 'OWNER'), u.id ASC
    `);
    return rows;
  }

  async findLeastActiveAvailableAdmin(availableUserIds = [], connection = pool) {
    if (!availableUserIds.length) return null;

    const placeholders = availableUserIds.map(() => '?').join(', ');
    const sql = `
      SELECT u.id, COUNT(c.id) as active_chats
      FROM users u
      LEFT JOIN conversations c
        ON c.admin_id = u.id
       AND c.status IN ('active', 'assigned', 'waiting')
       AND c.type = 'SUPPORT'
      WHERE u.role IN ('ADMIN', 'OWNER')
        AND u.is_active = 1
        AND u.deleted_at IS NULL
        AND u.id IN (${placeholders})
      GROUP BY u.id
      ORDER BY FIELD(u.role, 'ADMIN', 'OWNER') ASC, active_chats ASC, u.id ASC
      LIMIT 1
    `;
    const [rows] = await connection.execute(sql, availableUserIds);
    return rows[0] || null;
  }
}

export default new UserRepository();
