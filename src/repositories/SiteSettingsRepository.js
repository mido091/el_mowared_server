/**
 * @file SiteSettingsRepository.js
 * @description Repository for managing global platform configurations.
 * Handles key-value storage for parameters like platform fees or contact info.
 */

import pool from '../config/db.js';

class SiteSettingsRepository {
  /**
   * Retrieves all system settings and reduces them into a lean object.
   * 
   * @async
   * @returns {Promise<Object>} Map of setting_key => setting_value.
   */
  async getSettings() {
    const [rows] = await pool.execute('SELECT setting_key, setting_value FROM site_settings');
    return rows.reduce((acc, row) => {
      acc[row.setting_key] = row.setting_value;
      return acc;
    }, {});
  }

  /**
   * Updates or inserts a platform configuration parameter.
   * 
   * @async
   * @param {string} key 
   * @param {string} value 
   */
  async updateSetting(key, value) {
    // Upsert logic: Ensures the key is either created or its value refreshed.
    const sql = `
      INSERT INTO site_settings (setting_key, setting_value, updated_at)
      VALUES (:key, :value, NOW())
      ON DUPLICATE KEY UPDATE setting_value = :value, updated_at = NOW()
    `;
    await pool.execute(sql, { key, value });
  }

  /**
   * Retrieves a single configuration value by key.
   * 
   * @async
   * @param {string} key 
   * @returns {Promise<string|undefined>} The stored setting value.
   */
  async getSettingByKey(key) {
    const [rows] = await pool.execute('SELECT setting_value FROM site_settings WHERE setting_key = :key', { key });
    return rows[0]?.setting_value;
  }
}

export default new SiteSettingsRepository();
