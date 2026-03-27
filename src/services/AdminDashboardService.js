/**
 * @file AdminDashboardService.js
 * @description Service for centralized platform oversight and administrative trust reporting.
 * Orchestrates cross-entity data aggregation for high-level monitoring.
 */

import OrderRepository from '../repositories/OrderRepository.js';
import { AppError } from '../middlewares/errorHandler.js';

class AdminDashboardService {
  /**
   * Generates a comprehensive 'Trust Report' for any transaction.
   * Aggregates Order details, Customer identity, Merchant credentials, and Payment history.
   * Designed for manual conflict resolution and risk assessment.
   * 
   * @async
   * @param {number} orderId 
   * @param {boolean} [isAdmin=false] - Security gate for sensitive data access.
   * @returns {Promise<Object>} Flattened report structure.
   * @throws {AppError} 403 - Unauthorized access.
   */
  async getTransactionTrustReport(orderId, isAdmin = false) {
    if (!isAdmin) throw new AppError('Unauthorized', 403);
    
    // Cross-Domain Retrieval: Uses a optimized repository join for full context.
    const report = await OrderRepository.getAdminOrderReport(orderId);
    if (!report) throw new AppError('Report not found', 404);

    return report;
  }

  /**
   * Administrative interface for overriding payment states.
   * (Placeholder for specialized bulk operations).
   * 
   * @async
   */
  async verifyPayment(orderId, status, note, isAdmin = false) {
    if (!isAdmin) throw new AppError('Unauthorized', 403);
    // Note: Primary flow is standard in OrderService; this handles specialized admin overrides.
  }
}

export default new AdminDashboardService();
