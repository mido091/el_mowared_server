/**
 * @file SiteSettingsService.js
 * @description Service for managing platform-wide configurations and brand assets.
 * Handles dynamic settings storage and automated media swapping for logos/banners.
 */

import SiteSettingsRepository from '../repositories/SiteSettingsRepository.js';
import UploadService from './UploadService.js';

class SiteSettingsService {
  /**
   * Retrieves all global platform settings.
   * 
   * @async
   */
  async getSettings() {
    return SiteSettingsRepository.getSettings();
  }

  /**
   * Direct update for text-based settings.
   * 
   * @async
   */
  async updateSetting(key, value) {
    return SiteSettingsRepository.updateSetting(key, value);
  }

  /**
   * Orchestrates the replacement of media-based settings (logos, banners).
   * Parses existing JSON values to identify and purge obsolete Cloudinary assets.
   * 
   * @async
   * @param {string} key - Configuration key (e.g., 'site_logo').
   * @param {Object} file - Buffer from Multer.
   * @param {string} [folder='elmowared/settings'] 
   */
  async updateMediaSetting(key, file, folder = 'elmowared/settings') {
    const oldUrl = await SiteSettingsRepository.getSettingByKey(key);
    
    // 1. Asset Rotation: Upload new version to Cloudinary.
    const { url, publicId } = await UploadService.uploadImage(file.buffer, folder);

    // 2. Automated Cleanup: If the previous value was a JSON object containing a publicId, purge it.
    if (oldUrl) {
      try {
        const parsed = JSON.parse(oldUrl);
        if (parsed.publicId) {
          await UploadService.deleteImage(parsed.publicId);
        }
      } catch (e) {
        // Fallback: If not JSON, it might be a legacy raw URL; skip automated deletion.
      }
    }

    // 3. Serialization: Store the new asset metadata as JSON for future lifecycle management.
    const newValue = JSON.stringify({ url, publicId });
    await SiteSettingsRepository.updateSetting(key, newValue);
    return { url, publicId };
  }
}

export default new SiteSettingsService();
