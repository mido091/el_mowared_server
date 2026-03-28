/**
 * @file CategoryService.js
 * @description Service for managing the multi-level product taxonomy.
 * Implements recursive tree-building logic for front-end navigation components.
 */

import CategoryRepository from '../repositories/CategoryRepository.js';
import MetricsCacheService from './MetricsCacheService.js';
import pool from '../config/db.js';
import { AppError } from '../middlewares/errorHandler.js';
import UploadService from './UploadService.js';

class CategoryService {
  /**
   * Retrieves the full category map organized in a nested hierarchy.
   * 
   * @async
   * @returns {Promise<Array>} Tree structure of categories.
   */
  async getAllCategories() {
    const categories = await CategoryRepository.findAll();
    return this.buildHierarchy(categories);
  }

  /**
   * Recursive transformer that converts a flat SQL result set into a JSON tree.
   * 
   * @param {Array} categories - The full flat array of categories.
   * @param {number|null} [parentId=null] - Marker for the current branch level.
   * @returns {Array} Nested children branches.
   */
  buildHierarchy(categories, parentId = null) {
    const branch = [];
    const children = categories.filter(c => c.parent_id === parentId);

    children.forEach(child => {
      // Recursive Call: Deep-scan for sub-levels.
      const nested = this.buildHierarchy(categories, child.id);
      if (nested.length > 0) {
        child.children = nested;
      }
      branch.push(child);
    });

    return branch;
  }

  async getCategoryById(id) {
    return CategoryRepository.findById(id);
  }

  async createCategory(data) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      await CategoryRepository.purgeSoftDeletedBySlug(data.slug, connection);
      const category = await CategoryRepository.create(data, connection);
      await connection.commit();
      MetricsCacheService.invalidate('public:categories');
      MetricsCacheService.invalidate('public:marketplace-summary');
      MetricsCacheService.invalidate('public:vendors');
      return category;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateCategory(id, data) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const existing = await CategoryRepository.findById(id, connection);
      if (!existing) {
        throw new AppError('Category not found', 404);
      }

      if (data.slug && data.slug !== existing.slug) {
        await CategoryRepository.purgeSoftDeletedBySlug(data.slug, connection);
      }

      const category = await CategoryRepository.update(id, data, connection);
      await connection.commit();
      MetricsCacheService.invalidate('public:categories');
      MetricsCacheService.invalidate('public:marketplace-summary');
      MetricsCacheService.invalidate('public:vendors');
      return category;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteCategoryCascade(id) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const existing = await CategoryRepository.findById(id, connection, true);
      if (!existing) {
        throw new AppError('Category not found', 404);
      }

      const idsToDelete = await CategoryRepository.findDescendantIds(id, connection, true);
      const [productImageRows] = await connection.query(
        `
        SELECT pi.public_id
        FROM product_images pi
        JOIN products p ON p.id = pi.product_id
        WHERE p.category_id IN (?)
        `,
        [idsToDelete]
      );
      const assetPublicIds = productImageRows
        .map((row) => row.public_id)
        .filter(Boolean);
      const deletedCount = await CategoryRepository.hardDeleteByIds(idsToDelete, connection);

      await connection.commit();
      await Promise.allSettled(assetPublicIds.map((publicId) => UploadService.deleteImage(publicId)));
      MetricsCacheService.invalidate('public:categories');
      MetricsCacheService.invalidate('public:marketplace-summary');
      MetricsCacheService.invalidate('public:vendors');

      return {
        id: Number(id),
        deletedCategoryIds: idsToDelete,
        deletedCount
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export default new CategoryService();
