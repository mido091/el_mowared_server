/**
 * @file UserService.js
 * @description Service for managing User identity and profile attributes.
 * Handles sensitive profile synchronization and automated avatar rotation.
 */

import UserRepository from '../repositories/UserRepository.js';
import UploadService from './UploadService.js';
import { AppError } from '../middlewares/errorHandler.js';

class UserService {
  /**
   * Universal Profile Image Sync.
   * Conducts a safe rotation: uploads new asset to 'elmowared/profiles' 
   * and purges the old image from Cloudinary ONLY if it's not the platform default.
   * 
   * @async
   * @param {number} userId 
   * @param {Buffer} fileBuffer - New binary image content.
   * @returns {Promise<{ url: string, publicId: string }>} New asset metadata.
   */
  async updateProfileImage(userId, fileBuffer) {
    const user = await UserRepository.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Asset Shielding: Define the default avatar URL to prevent accidental deletion of shared assets.
    const defaultImageUrl = 'https://res.cloudinary.com/ddqlt5oqu/image/upload/v1764967019/default_pi1ur8.webp';
    const oldPublicId = user.profile_image_public_id;

    // 1. Transactional Upload: High-integrity media transfer to the cloud.
    const { url, publicId } = await UploadService.uploadImage(fileBuffer, 'elmowared/profiles');

    // 2. Safe Purge: Clean up obsolete custom avatars while preserving default assets.
    if (oldPublicId && user.profile_image_url !== defaultImageUrl) {
      await UploadService.deleteImage(oldPublicId);
    }

    // 3. Metadata Sync: Commit the new URL and Public ID to the user record.
    await UserRepository.updateProfileImage(userId, url, publicId);

    return { url, publicId };
  }
}

export default new UserService();
