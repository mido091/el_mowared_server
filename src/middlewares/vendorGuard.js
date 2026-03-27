/**
 * @file vendorGuard.js
 * @description Middleware to enforce Mowared-specific account status checks.
 */

import { AppError } from './errorHandler.js';

/**
 * Ensures the requesting user has merchant access.
 * OWNER and ADMIN can bypass verification requirements for management purposes.
 * MOWARED users with a vendor profile are allowed during onboarding to preserve the existing workflow.
 * 
 * @function isApprovedVendor
 * @param {Object} req - Request object.
 * @param {Object} res - Response object.
 * @param {Function} next - Next middleware function.
 */
export const isApprovedVendor = (req, res, next) => {
  // Pass-through for high-privileged roles
  if (req.user.role === 'OWNER' || req.user.role === 'ADMIN') {
    return next();
  }

  // Allow MOWARED role even if PENDING (catalog management allowed during onboarding)
  if (req.user.role === 'MOWARED' && req.user.vendorProfile) {
    return next();
  }

  // Strictly block non-mowared roles
  if (req.user.role !== 'MOWARED') {
    return next(new AppError({
      en: 'Merchant access is required for this action.',
      ar: 'يلزم امتلاك صلاحية المورد لتنفيذ هذا الإجراء.'
    }, 403, 'VENDOR_ACCESS_REQUIRED'));
  }

  next();
};
