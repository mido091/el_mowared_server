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

  async findAllForAdmin(connection = pool) {
    const [rows] = await connection.execute(`
      SELECT
        c.*,
        CASE
          WHEN c.deleted_at IS NOT NULL THEN 'DELETED'
          ELSE 'ACTIVE'
        END AS record_state
      FROM categories c
      ORDER BY c.created_at DESC, c.id DESC
    `);
    return rows;
  }

  /**
   * Retrieves a specific category by ID.
   * 
   * @async
   * @param {number} id 
   * @returns {Promise<Object|null>} Category record.
   */
  async findById(id, connection = pool, includeDeleted = false) {
    const [rows] = await connection.execute(
      `SELECT * FROM categories WHERE id = :id ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
      { id }
    );
    return rows[0];
  }

  async findBySlug(slug, includeDeleted = false, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT * FROM categories WHERE slug = :slug ${includeDeleted ? '' : 'AND deleted_at IS NULL'} LIMIT 1`,
      { slug }
    );
    return rows[0] || null;
  }

  /**
   * Creates a new business category.
   * 
   * @async
   * @param {Object} categoryData - Multi-language labels and SEO slug.
   * @returns {Promise<Object>} Created category summary.
   */
  async create(categoryData, connection = pool) {
    const { nameAr, nameEn, slug, icon, parentId } = categoryData;
    const sql = `
      INSERT INTO categories (name_ar, name_en, slug, icon, parent_id, created_at, updated_at)
      VALUES (:nameAr, :nameEn, :slug, :icon, :parentId, NOW(), NOW())
    `;
    const [result] = await connection.execute(sql, { nameAr, nameEn, slug, icon, parentId });
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
  async update(id, categoryData, connection = pool) {
    const { nameAr, nameEn, slug, icon, parentId } = categoryData;
    const sql = `
      UPDATE categories 
      SET name_ar = :nameAr, name_en = :nameEn, slug = :slug, icon = :icon, parent_id = :parentId, updated_at = NOW()
      WHERE id = :id AND deleted_at IS NULL
    `;
    await connection.execute(sql, { id, nameAr, nameEn, slug, icon, parentId });
    return this.findById(id, connection);
  }

  async findDescendantIds(rootId, connection = pool, includeDeleted = false) {
    const [rows] = await connection.execute(
      `SELECT id, parent_id FROM categories ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}`
    );

    const descendants = new Set();
    const queue = [Number(rootId)];

    while (queue.length) {
      const currentId = queue.shift();
      if (descendants.has(currentId)) continue;
      descendants.add(currentId);

      rows
        .filter((row) => Number(row.parent_id) === Number(currentId))
        .forEach((row) => queue.push(Number(row.id)));
    }

    return Array.from(descendants);
  }

  async expandIds(ids, options = {}, connection = pool, includeDeleted = false) {
    const { includeDescendants = false, includeAncestors = false } = options;
    const normalizedIds = Array.isArray(ids)
      ? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [];

    if (!normalizedIds.length) return [];

    const [rows] = await connection.execute(
      `SELECT id, parent_id FROM categories ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}`
    );

    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    const expanded = new Set(normalizedIds);

    if (includeDescendants) {
      const queue = [...normalizedIds];
      while (queue.length) {
        const currentId = Number(queue.shift());
        rows
          .filter((row) => Number(row.parent_id) === currentId)
          .forEach((row) => {
            const nextId = Number(row.id);
            if (!expanded.has(nextId)) {
              expanded.add(nextId);
              queue.push(nextId);
            }
          });
      }
    }

    if (includeAncestors) {
      normalizedIds.forEach((seedId) => {
        let currentId = seedId;
        while (byId.get(currentId)?.parent_id != null) {
          const parentId = Number(byId.get(currentId).parent_id);
          if (!Number.isFinite(parentId) || expanded.has(parentId)) break;
          expanded.add(parentId);
          currentId = parentId;
        }
      });
    }

    return Array.from(expanded);
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

  async hardDeleteByIds(ids, connection = pool) {
    if (!ids?.length) return 0;
    const [result] = await connection.query(
      'DELETE FROM categories WHERE id IN (?)',
      [ids]
    );
    return result.affectedRows || 0;
  }

  async purgeSoftDeletedBySlug(slug, connection = pool) {
    if (!slug) return 0;
    const [result] = await connection.execute(
      'DELETE FROM categories WHERE slug = :slug AND deleted_at IS NOT NULL',
      { slug }
    );
    return result.affectedRows || 0;
  }
}

export default new CategoryRepository();
