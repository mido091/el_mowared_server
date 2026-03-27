/**
 * @file CategoryService.js
 * @description Service for managing the multi-level product taxonomy.
 * Implements recursive tree-building logic for front-end navigation components.
 */

import CategoryRepository from '../repositories/CategoryRepository.js';

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
    return CategoryRepository.create(data);
  }
}

export default new CategoryService();
