/**
 * @file auth.js
 * @description Authentication and Authorization middlewares.
 * Uses JWT to verify identities and restricted access based on user roles.
 */

import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';
import UserRepository from '../repositories/UserRepository.js';
import VendorRepository from '../repositories/VendorRepository.js';
import { env } from '../config/env.js';

/**
 * Global Authentication Guard.
 * 1. Checks for 'Bearer' token in Authorization header.
 * 2. Verifies JWT integrity and expiration.
 * 3. Ensures the user still exists and their account is active.
 * 4. Attaches the user object to the request.
 * 
 * @function protect
 * @param {Object} req - Request object.
 * @param {Object} res - Response object.
 * @param {Function} next - Next middleware function.
 */
export const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new AppError('You are not logged in. Please provide a valid token.', 401));
    }

    // Verify token cryptographic signature
    const decoded = jwt.verify(token, env.jwtSecret);

    // Check if user record exists in database
    const user = await UserRepository.findById(decoded.id);
    if (!user) {
      return next(new AppError('The user belonging to this token no longer exists.', 401));
    }

    // Security: Block deactivated accounts even with a valid token
    if (!user.is_active) {
      return next(new AppError('User account is deactivated. Contact administration.', 403));
    }

    // Grant access for subsequent handlers
    if (user.role === 'MOWARED') {
      user.vendorProfile = await VendorRepository.findByUserId(user.id);
    }
    // Standardize avatar field for frontend compatibility
    user.avatar = user.profile_image_url;
    
    req.user = user;
    next();
  } catch (error) {
    next(new AppError('Invalid or expired token. Please log in again.', 401));
  }
};

/**
 * Role-Based Access Control (RBAC) Guard.
 * Compares the authenticated user's role against a list of permitted roles.
 * 
 * @function authorize
 * @param {...string} roles - Permitted roles (e.g., 'OWNER', 'ADMIN', 'MOWARED').
 * @returns {Function} Middleware function that performs the role check.
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    // Standardize comparison to avoid case-sensitivity bugs (all roles in DB are uppercase)
    const userRole = req.user.role?.toUpperCase();
    const allowedRoles = roles.map(r => r.toUpperCase());

    if (!allowedRoles.includes(userRole)) {
      return next(new AppError('Permission Denied: You do not have the required role to perform this action.', 403));
    }
    next();
  };
};
