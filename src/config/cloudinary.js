/**
 * @file cloudinary.js
 * @description Centralized Cloudinary configuration for media uploads.
 * This module initializes the Cloudinary SDK with credentials from environment variables.
 */

import { v2 as cloudinary } from 'cloudinary';
import { env } from './env.js';

/**
 * Cloudinary configuration object.
 * Uses CLD_NAME, API_KEY, and API_SECRET from environment.
 */
cloudinary.config({
  cloud_name: env.cloudinaryName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
});

export default cloudinary;
