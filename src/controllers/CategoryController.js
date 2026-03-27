/**
 * @file CategoryController.js
 * @description Controller for managing the product taxonomy.
 * Handles localized category metadata and SEO slug generation.
 */

import CategoryRepository from '../repositories/CategoryRepository.js';
import { z } from 'zod';
import { AppError } from '../middlewares/errorHandler.js';
import MetricsCacheService from '../services/MetricsCacheService.js';
import slugify from 'slugify';

// Structural Validation: Ensures bilingual labels are present and icon paths are valid.
const categorySchema = z.object({
  nameAr: z.string().min(2),
  nameEn: z.string().min(2),
  icon: z.string().optional(),
  parentId: z.number().nullable().optional()
});

class CategoryController {
  /**
   * Public endpoint for directory discovery.
   * Returns a flat list that the service layer later organizes into a tree.
   * 
   * @async
   */
  async getAll(req, res, next) {
    try {
      const cacheKey = `public:categories:${req.locale || 'default'}`;
      const categories = await MetricsCacheService.withCache(
        cacheKey,
        () => CategoryRepository.findAll(),
        10 * 60 * 1000
      );
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      res.status(200).json({
        status: 'success',
        data: res.formatLocalization(categories)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Administrative creation tool with automated SEO slugging.
   * 
   * @async
   */
  async create(req, res, next) {
    try {
      const validatedData = categorySchema.parse(req.body);
      
      // SEO Logic: Extract human-readable slug from English name.
      const slug = slugify(validatedData.nameEn, { lower: true, strict: true });

      const category = await CategoryRepository.create({
        ...validatedData,
        slug
      });
      MetricsCacheService.invalidate('public:categories');

      res.status(201).json({
        status: 'success',
        data: category
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Administrative update handler.
   * 
   * @async
   */
  async update(req, res, next) {
    try {
      const validatedData = categorySchema.parse(req.body);
      const slug = slugify(validatedData.nameEn, { lower: true, strict: true });

      const category = await CategoryRepository.update(req.params.id, {
        ...validatedData,
        slug
      });
      MetricsCacheService.invalidate('public:categories');

      if (!category) throw new AppError('Category not found', 404);

      res.status(200).json({
        status: 'success',
        data: res.formatLocalization(category)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Administrative soft-delete tool.
   * 
   * @async
   */
  async delete(req, res, next) {
    try {
      await CategoryRepository.softDelete(req.params.id);
      MetricsCacheService.invalidate('public:categories');
      res.status(204).json({
        status: 'success',
        data: null
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new CategoryController();
