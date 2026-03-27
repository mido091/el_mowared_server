/**
 * @file UploadService.js
 * @description Master utility service for Media Asset Management via Cloudinary.
 * Implements stream-based uploads to handle multi-part file buffers without local storage.
 */

import cloudinary from '../config/cloudinary.js';

class UploadService {
  /**
   * Uploads an image buffer directly to a Cloudinary folder.
   * Utilizes upload_stream for efficient memory usage with large assets.
   * 
   * @async
   * @param {Buffer} fileBuffer - The binary file content from Multer.
   * @param {string} [folder='elmowared/common'] - Cloudinary destination path.
   * @returns {Promise<{ url: string, publicId: string }>} Secure URL and Public ID for future reference.
   * @throws {Error} Cascades Cloudinary API exceptions.
   */
  async uploadImage(fileBuffer, folder = 'elmowared/common') {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          unique_filename: true,
          overwrite: false
        },
        (error, result) => {
          if (error) return reject(error);
          resolve({
            url: result.secure_url,
            publicId: result.public_id
          });
        }
      );
      uploadStream.end(fileBuffer);
    });
  }

  /**
   * Deletes an asset from Cloudinary using its unique Public ID.
   * 
   * @async
   * @param {string} publicId - The unique asset identifier.
   */
  async deleteImage(publicId) {
    if (!publicId) return;
    try {
      // Suppression: Permanently removes the asset from Cloudinary storage.
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('Cloudinary deletion error:', error);
    }
  }
}

export default new UploadService();
