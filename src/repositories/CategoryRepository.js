/**
 * @file CategoryRepository.js
 * @description Repository for managing business categories.
 * Handles the storage of multilingual category labels and their visual identifiers (icons).
 */

import pool from '../config/db.js';

class CategoryRepository {
  /**
   * Retrieves all active categories.
   * 
   * @async
   * @returns {Promise<Array>} List of category records including names in AR/EN.
   */
  async findAll() {
    const [rows] = await pool.execute('SELECT * FROM categories WHERE deleted_at IS NULL');
    return rows;
  }

  /**
   * Retrieves a specific category by ID.
   * 
   * @async
   * @param {number} id 
   * @returns {Promise<Object|null>} Category record.
   */
  async findById(id) {
    const [rows] = await pool.execute(
      'SELECT * FROM categories WHERE id = :id AND deleted_at IS NULL',
      { id }
    );
    return rows[0];
  }

  /**
   * Creates a new business category.
   * 
   * @async
   * @param {Object} categoryData - Multi-language labels and SEO slug.
   * @returns {Promise<Object>} Created category summary.
   */
  async create(categoryData) {
    const { nameAr, nameEn, slug, icon, parentId } = categoryData;
    const sql = `
      INSERT INTO categories (name_ar, name_en, slug, icon, parent_id, created_at, updated_at)
      VALUES (:nameAr, :nameEn, :slug, :icon, :parentId, NOW(), NOW())
    `;
    const [result] = await pool.execute(sql, { nameAr, nameEn, slug, icon, parentId });
    return { id: result.insertId, nameAr, nameEn, slug };
  }

  /**
   * Updates an existing category's metadata.
   * 
   * @async
   * @param {number} id 
   * @param {Object} categoryData 
   * @returns {Promise<Object>} Updated category record.
   */
  async update(id, categoryData) {
    const { nameAr, nameEn, slug, icon, parentId } = categoryData;
    const sql = `
      UPDATE categories 
      SET name_ar = :nameAr, name_en = :nameEn, slug = :slug, icon = :icon, parent_id = :parentId, updated_at = NOW()
      WHERE id = :id AND deleted_at IS NULL
    `;
    await pool.execute(sql, { id, nameAr, nameEn, slug, icon, parentId });
    return this.findById(id);
  }

  /**
   * Performs a soft delete on a category to preserve historical associations.
   * 
   * @async
   * @param {number} id 
   */
  async softDelete(id) {
    const sql = 'UPDATE categories SET deleted_at = NOW() WHERE id = :id';
    await pool.execute(sql, { id });
  }
}

export default new CategoryRepository();

