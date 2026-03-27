/**
 * @file SiteSettingsController.js
 * @description Controller for managing global platform configurations (Logo, Banners, SEO).
 * Implements a dual-path update logic for raw text strings and binary media assets.
 */

import SiteSettingsService from '../services/SiteSettingsService.js';
import { z } from 'zod';
import { AppError } from '../middlewares/errorHandler.js';

class SiteSettingsController {
  /**
   * Retrieves all active platform configurations.
   * 
   * @async
   */
  async getSettings(req, res, next) {
    try {
      const settings = await SiteSettingsService.getSettings();
      res.status(200).json({
        status: 'success',
        data: settings
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Public settings exposure for unauthenticated frontend branding.
   * Filters out sensitive keys and parses JSON assets.
   * 
   * @async
   */
  async getPublicSettings(req, res, next) {
    try {
      const settings = await SiteSettingsService.getSettings();
      
      // Parse JSON assets (Logo, Favicon) if they exist
      const parseAsset = (val) => {
        try { return JSON.parse(val); } catch(e) { return val; }
      };

      const publicData = {
        site_name_ar: settings.site_name_ar || settings.site_name || 'المورد',
        site_name_en: settings.site_name_en || settings.site_name || 'Elmowared',
        site_description_ar: settings.site_description_ar || '',
        site_description_en: settings.site_description_en || '',
        site_logo: parseAsset(settings.site_logo),
        site_favicon: parseAsset(settings.site_favicon),
        default_language: settings.default_language || 'ar',
        default_theme: settings.default_theme || 'light',
        
        primary_color: settings.primary_color || '#0B1E3C',
        secondary_color: settings.secondary_color || '#1A9882',
        accent_color: settings.accent_color || '#F7F9FC',

        enable_rfq: settings.enable_rfq !== 'false',
        enable_chat: settings.enable_chat !== 'false',
        enable_vendor_registration: settings.enable_vendor_registration !== 'false',
        maintenance_mode: settings.maintenance_mode === 'true',

        meta_title_ar: settings.meta_title_ar || '',
        meta_title_en: settings.meta_title_en || '',
        meta_description_ar: settings.meta_description_ar || '',
        meta_description_en: settings.meta_description_en || '',
        meta_keywords: settings.meta_keywords || '',
        seo_og_image: parseAsset(settings.seo_og_image),
        social_links: parseAsset(settings.social_links || '[]')
      };

      res.status(200).json({
        status: 'success',
        data: publicData
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Universal update handler for site configuration.
   * Dynamically switches between media rotation (for logos/icons) 
   * and batch text updates for standard settings.
   * 
   * @async
   */
  async updateSetting(req, res, next) {
    try {
      // 1. Media Branch: Handles binary uploads for visual brand assets.
      if (req.file) {
        const { key } = req.body;
        // Validation: Restrict media logic to authorized brand keys.
        if (!['site_logo', 'site_favicon', 'seo_og_image'].includes(key)) {
          throw new AppError('Invalid key for media upload', 400);
        }
        
        const result = await SiteSettingsService.updateMediaSetting(key, req.file);
        return res.status(200).json({
          status: 'success',
          data: result
        });
      }

      // 2. Batch Text Branch: Processes multiple key-value pairs in a single request.
      const { settings } = z.object({
        settings: z.array(z.object({
          key: z.string(),
          value: z.any()
        }))
      }).parse(req.body);

      for (const { key, value } of settings) {
        // Serialization: Ensure complex objects are stored as valid JSON strings.
        await SiteSettingsService.updateSetting(key, typeof value === 'object' ? JSON.stringify(value) : value);
      }

      res.status(200).json({
        status: 'success',
        message: 'Settings updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new SiteSettingsController();
