import rateLimit from 'express-rate-limit';
import { AppError, createErrorPayload } from './errorHandler.js';

const buildLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const error = new AppError({
      en: message,
      ar: 'تم تجاوز عدد المحاولات المسموح. يرجى المحاولة لاحقًا.'
    }, 429, 'RATE_LIMITED');

    res.status(429).json(createErrorPayload(error, req));
  }
});

export const loginLimiter = buildLimiter(
  15 * 60 * 1000,
  10,
  'Too many login attempts. Please try again later.'
);

export const otpLimiter = buildLimiter(
  10 * 60 * 1000,
  8,
  'Too many OTP requests. Please wait before trying again.'
);

export const uploadLimiter = buildLimiter(
  15 * 60 * 1000,
  20,
  'Too many uploads. Please try again later.'
);

export const rfqCreationLimiter = buildLimiter(
  60 * 60 * 1000,
  10,
  'Too many RFQs created from this IP, please try again after an hour.'
);

export const offerSubmissionLimiter = buildLimiter(
  15 * 60 * 1000,
  30,
  'Too many offers submitted. Please slow down.'
);

export const inquiryLimiter = buildLimiter(
  15 * 60 * 1000,
  30,
  'Too many inquiries sent. Please try again later.'
);

export const chatMessageLimiter = buildLimiter(
  60 * 1000,
  25,
  'Too many chat actions. Please slow down.'
);

export const reviewWriteLimiter = buildLimiter(
  15 * 60 * 1000,
  10,
  'Too many review submissions. Please try again later.'
);
