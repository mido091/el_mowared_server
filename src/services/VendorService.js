/**
 * @file VendorService.js
 * @description Service for managing Merchant Profiles and platform verification.
 * Handles the administrative approval flow for new vendors.
 */

import VendorRepository from '../repositories/VendorRepository.js';
import NotificationService from './NotificationService.js';
import DashboardMetricsService from './DashboardMetricsService.js';
import MetricsCacheService from './MetricsCacheService.js';
import { AppError } from '../middlewares/errorHandler.js';
import pool from '../config/db.js';

class VendorService {
  /**
   * Retrieves all registered vendors with aggregate performance stats.
   * 
   * @async
   * @returns {Promise<Array>} List of merchant summaries.
   */
  async getVendors(options = {}) {
    const search = `${options.search || ''}`.trim().toLowerCase();
    const limit = Number(options.limit || 0);

    if (!search && !limit) {
      return VendorRepository.findAll();
    }

    return MetricsCacheService.withCache(
      `public:vendors:${search || 'all'}:${limit || 'all'}`,
      () => VendorRepository.findAll({ search, limit }),
      5 * 60 * 1000
    );
  }

  /**
   * Retrieves full profile of a single vendor including business categories.
   * 
   * @async
   * @param {number} id 
   * @returns {Promise<Object>} Enriched merchant profile.
   */
  async getVendorById(id) {
    const vendor = await VendorRepository.findById(id);
    if (!vendor) {
      throw new AppError('Vendor not found', 404);
    }
    return vendor;
  }

  /**
   * Updates a vendor's platform verification status.
   * Triggers multilingual notifications to the vendor owner upon decision.
   * 
   * @async
   * @param {number} vendorId 
   * @param {string} status - 'APPROVED' or 'REJECTED'.
   */
  async verifyVendor(vendorId, status) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const vendor = await VendorRepository.findById(vendorId);
      if (!vendor) {
        throw new AppError('Vendor not found', 404);
      }

      // 1. Authorization Update: Modify verification flag in the profile.
      const sql = 'UPDATE vendor_profiles SET verification_status = :status, updated_at = NOW() WHERE id = :vendorId';
      await connection.execute(sql, { status, vendorId });

      // 2. Identity Resolution: Fetch the actual User ID associated with the profile for notification.
      const [profile] = await connection.execute('SELECT user_id FROM vendor_profiles WHERE id = :vendorId', { vendorId });
      const userId = profile[0].user_id;

      // Vendor login is gated by users.is_active, so approval must activate the owner account.
      await connection.execute(
        'UPDATE users SET is_active = :isActive, updated_at = NOW() WHERE id = :userId',
        { userId, isActive: status === 'APPROVED' }
      );

      // 3. Multilingual Alert: Notify the owner in their preferred locale.
      await NotificationService.createSystemNotification(
        userId,
        status === 'APPROVED' ? 'تم توثيق حسابك' : 'تم رفض توثيق حسابك',
        status === 'APPROVED' ? 'Your account has been verified' : 'Your account verification was rejected',
        status === 'APPROVED' ? 'مبروك! يمكنك الآن إضافة منتجاتك وبدء البيع.' : 'عذراً، لم نتمكن من توثيق حسابك. يرجى التواصل مع الدعم.',
        status === 'APPROVED' ? 'Congratulations! You can now add products and start selling.' : "Sorry, we couldn't verify your account. Please contact support."
      );

      await connection.commit();
      return { vendorId, status };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Updates an existing Merchant Profile.
   * Handles both core attributes and business category synchronization.
   * 
   * @async
   * @param {number} userId - Owner's User ID.
   * @param {Object} updateData - { companyNameAr, companyNameEn, bioAr, bioEn, location, categoryIds }.
   */
  async updateVendorProfile(userId, updateData) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Identity Resolution: Map User ID → Vendor Profile ID.
      const vendor = await VendorRepository.findByUserId(userId);
      if (!vendor) throw new AppError('Vendor profile not found', 404);

      // 2. Profile Persistence: Update core business metadata.
      await VendorRepository.update(vendor.id, updateData, connection);

      // 3. Category Synchronization: Rebuild associations if provided.
      if (updateData.categoryIds) {
        await VendorRepository.setCategories(vendor.id, updateData.categoryIds, connection);
      }

      await connection.commit();
      return this.getVendorById(vendor.id);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Aggregates performance metrics for the Vendor Dashboard.
   * 
   * @async
   * @param {number} userId 
   */
  async getVendorStats(userId) {
    const vendor = await VendorRepository.findByUserId(userId);
    if (!vendor) throw new AppError('Vendor profile not found', 404);

    return DashboardMetricsService.getVendorDashboardStats(userId, { force: true });
  }

  /**
   * Retrieves recent orders for the Vendor Dashboard.
   * 
   * @async
   * @param {number} userId 
   * @param {number} [limit=5] 
   */
  async getVendorOrders(userId, limit = 5) {
    const vendor = await VendorRepository.findByUserId(userId);
    if (!vendor) throw new AppError('Vendor profile not found', 404);

    const safeLimit = parseInt(limit) || 5;
    const [rows] = await pool.execute(`
      SELECT o.*, u.first_name, u.last_name, u.email as buyer_email
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.vendor_id = :vendorId
      ORDER BY o.created_at DESC
      LIMIT ${safeLimit}
    `, { vendorId: vendor.id });

    return rows.map(o => ({
      ...o,
      buyer: { full_name: `${o.first_name} ${o.last_name}`, email: o.buyer_email }
    }));
  }
}

export default new VendorService();
