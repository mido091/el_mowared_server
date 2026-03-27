import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../middlewares/errorHandler.js';

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

const storage = multer.memoryStorage();

const basicImageFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return cb(new AppError({
      en: 'Invalid file type. Only JPG, JPEG, PNG, and WebP images are allowed.',
      ar: 'نوع الملف غير صحيح. يُسمح فقط بصور JPG وJPEG وPNG وWebP.'
    }, 400, 'INVALID_FILE_TYPE'));
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    return cb(new AppError({
      en: 'Invalid file type. Only image files are allowed.',
      ar: 'نوع الملف غير صحيح. يُسمح فقط برفع الصور.'
    }, 400, 'INVALID_FILE_TYPE'));
  }

  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter: basicImageFilter,
  limits: { fileSize: MAX_IMAGE_SIZE, files: 5 }
});

export const chatUpload = multer({
  storage,
  fileFilter: basicImageFilter,
  limits: { fileSize: MAX_IMAGE_SIZE, files: 5 }
});

const flattenFiles = (req) => {
  if (req.file) return [req.file];
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') {
    return Object.values(req.files).flat();
  }
  return [];
};

export const verifyUploadedImages = async (req, res, next) => {
  try {
    const files = flattenFiles(req);
    if (!files.length) return next();

    for (const file of files) {
      if (!file?.buffer) {
        throw new AppError({
          en: 'The uploaded file could not be processed.',
          ar: 'تعذر معالجة الملف المرفوع.'
        }, 400, 'MISSING_UPLOAD');
      }

      if (file.size > MAX_IMAGE_SIZE) {
        throw new AppError({
          en: 'The image is too large. Maximum size is 2MB.',
          ar: 'حجم الصورة كبير جدًا. الحد الأقصى 2 ميجابايت.'
        }, 400, 'FILE_TOO_LARGE');
      }

      const extension = path.extname(file.originalname || '').toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
        throw new AppError({
          en: 'Invalid file type. Only JPG, JPEG, PNG, and WebP images are allowed.',
          ar: 'نوع الملف غير صحيح. يُسمح فقط بصور JPG وJPEG وPNG وWebP.'
        }, 400, 'INVALID_FILE_TYPE');
      }

      const actualType = await fileTypeFromBuffer(file.buffer);
      if (!actualType || !ALLOWED_IMAGE_MIME_TYPES.has(actualType.mime)) {
        throw new AppError({
          en: 'The uploaded file is not a valid image.',
          ar: 'الملف المرفوع ليس صورة صالحة.'
        }, 400, 'INVALID_IMAGE_CONTENT');
      }

      const normalizedExtension = actualType.ext === 'jpg' ? '.jpg' : `.${actualType.ext}`;
      file.safeExtension = normalizedExtension;
      file.safeFileName = `${crypto.randomUUID()}-${Date.now()}${normalizedExtension}`;
      file.detectedMime = actualType.mime;
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const uploadErrorHandler = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError({
        en: 'The image is too large. Maximum size is 2MB.',
        ar: 'حجم الصورة كبير جدًا. الحد الأقصى 2 ميجابايت.'
      }, 400, 'FILE_TOO_LARGE'));
    }
    return next(new AppError({
      en: 'The uploaded file could not be processed.',
      ar: 'تعذر معالجة الملف المرفوع.'
    }, 400, 'UPLOAD_ERROR'));
  }

  return next(error);
};
