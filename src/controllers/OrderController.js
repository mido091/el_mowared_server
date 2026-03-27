/**
 * @file OrderController.js
 * @description Controller for managing Order lifecycles and Escrow flows.
 * Handles checkout, payment proof verification, and status transitions.
 */

import OrderService from '../services/OrderService.js';
import OrderRepository from '../repositories/OrderRepository.js';
import { z } from 'zod';
import pool from '../config/db.js';
import { AppError } from '../middlewares/errorHandler.js';

class OrderController {
  /**
   * Finalizes the checkout process.
   * Generates localized order splits and initializes payment tracking.
   * 
   * @async
   */
  async checkout(req, res, next) {
    try {
      const { paymentMethod, depositAmount, marketerId } = z.object({
        paymentMethod: z.enum(['COD', 'WALLET', 'INSTAPAY']),
        depositAmount: z.number().optional().default(0),
        marketerId: z.number().int().optional()
      }).parse(req.body);

      const orderIds = await OrderService.checkout(req.user.id, paymentMethod, depositAmount, marketerId);
      res.status(201).json({
        status: 'success',
        data: { orderIds }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload boundary for payment receipts.
   * Links a binary image to an existing order for administrative review.
   * 
   * @async
   */
  async uploadReceipt(req, res, next) {
    try {
      // 1. Media Guard: Enforce receipt presence.
      if (!req.file) {
        throw new AppError({
          en: 'Please upload a receipt image.',
          ar: 'يرجى رفع صورة الإيصال.'
        }, 400, 'MISSING_UPLOAD');
      }

      // 2. Service Delegation: Offload media processing to specialized service.
      await OrderService.uploadReceipt(req.params.id, req.user.id, req.file);
      res.status(200).json({
        status: 'success',
        message: 'Receipt uploaded successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves personal purchase history for the authenticated user.
   * 
   * @async
   */
  async getMyOrders(req, res, next) {
    try {
      const orders = await OrderService.getMyOrders(req.user.id);
      res.status(200).json({
        status: 'success',
        data: orders
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Detailed view for a specific order with localized strings.
   * 
   * @async
   */
  async getOrderDetails(req, res, next) {
    try {
      const order = await OrderService.getOrderDetails(req.params.id);
      res.status(200).json({
        status: 'success',
        data: res.formatLocalization(order)
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Administrative audit tool: Generates a 360-degree transaction report.
   * Restricted to OWNER/ADMIN roles via route guards.
   * 
   * @async
   */
  async getAdminReport(req, res, next) {
    try {
      const detailedReport = await OrderRepository.getAdminOrderReport(req.params.id);
      res.status(200).json({
        status: 'success',
        data: detailedReport
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Administrative decision point for escrow payments.
   * Confirms/Rejects proof-of-payment receipts.
   * 
   * @async
   */
  async confirmPayment(req, res, next) {
    try {
      const { status, note } = z.object({
        status: z.enum(['VERIFIED', 'REJECTED']),
        note: z.string().optional()
      }).parse(req.body);

      await OrderService.confirmPayment(req.params.id, true, status, note);
      res.status(200).json({
        status: 'success',
        message: `Payment ${status.toLowerCase()} successfully`
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unified status update for participating parties (Admin/Vendor/User).
   * Enforces transition rules and emits notifications.
   * 
   * @async
   */
  async updateStatus(req, res, next) {
    try {
      const { status } = z.object({
        status: z.enum(['PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED'])
      }).parse(req.body);

      const vendorProfileId = req.user.role === 'MOWARED' ? req.user.vendorProfile.id : null;
      
      const order = await OrderService.updateOrderStatus(
        req.params.id, 
        req.user.id, 
        req.user.role, 
        status,
        vendorProfileId
      );

      res.status(200).json({
        status: 'success',
        data: order
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * User-initiated cancellation/dispute flow.
   * Updates status to CANCELLED and captures the customer's rationale.
   * 
   * @async
   */
  async disputeOrder(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = z.object({ reason: z.string().min(10) }).parse(req.body);

      const [order] = await pool.execute(
        'SELECT * FROM orders WHERE id = :id AND user_id = :userId',
        { id, userId: req.user.id }
      );

      if (!order.length) {
        throw new AppError('Order not found or unauthorized', 404);
      }

      await pool.execute(
        'UPDATE orders SET status = "CANCELLED", dispute_reason = :reason WHERE id = :id',
        { id, reason }
      );

      res.status(200).json({
        status: 'success',
        message: 'Dispute submitted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new OrderController();
