/**
 * @file OrderService.js
 * @description Core service for Order processing and Escrow management.
 * Handles multi-vendor checkouts, payment receipt uploads, and admin verification.
 */

import pool from '../config/db.js';
import OrderRepository from '../repositories/OrderRepository.js';
import CartRepository from '../repositories/CartRepository.js';
import ChatService from './ChatService.js';
import NotificationService from './NotificationService.js';
import UploadService from './UploadService.js';
import TransactionRepository from '../repositories/TransactionRepository.js';
import { getIO } from '../config/socket.js';
import { AppError } from '../middlewares/errorHandler.js';
import CartService from './CartService.js';

class OrderService {
  /**
   * Processes the user checkout.
   * Splits a single cart into multiple orders grouped by Vendor.
   * Manages a MySQL transaction to ensure that either all orders are created or none.
   * 
   * @async
   * @param {number} userId - ID of the customer.
   * @param {string} paymentMethod - 'COD', 'WALLET', or 'INSTAPAY'.
   * @param {number} [depositAmount=0] - Manual deposit override (rare).
   * @param {number} [referredByMarketerId=null] - Optional affiliate tracking.
   * @returns {Promise<Array<number>>} List of created order IDs.
   * @throws {AppError} 400 - If the cart is empty.
   */
  async checkout(userId, paymentMethod, depositAmount = 0, referredByMarketerId = null) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const cartItems = await CartRepository.findByUserId(userId, connection);
      if (cartItems.length === 0) throw new AppError('Cart is empty', 400);

      // 1. Vendor Split: Group products by merchant to honor B2B multi-shipping/multi-billing.
      const vendorGroups = cartItems.reduce((groups, item) => {
        const vendorId = item.vendor_id;
        if (!groups[vendorId]) groups[vendorId] = [];
        groups[vendorId].push(item);
        return groups;
      }, {});

      const createdOrders = [];

      for (const [vendorId, items] of Object.entries(vendorGroups)) {
        const totalPrice = items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
        
        // 2. Snapshot Escrow: Calculate fixed deposit at the time of order creation.
        const depositPercentage = 10; // Default platform-wide escrow baseline.
        const calculatedDeposit = (totalPrice * depositPercentage) / 100;

        // 3. Persist Order: Shared escrow and payment method context.
        const orderId = await OrderRepository.createOrder({
          userId,
          vendorId,
          totalPrice,
          depositAmount: calculatedDeposit,
          depositPercentage,
          paymentMethod,
          referredByMarketerId
        }, connection);

        // 4. Snapshot Items: Lock pricing for each product in the order.
        const orderItems = items.map(item => ({
          productId: item.product_id,
          priceAtPurchase: item.price || 0,
          quantity: item.quantity
        }));

        await OrderRepository.createOrderItems(orderId, orderItems, connection);

        // 5. Initialize Payment Tracking: Create a placeholder for the escrow verification.
        await connection.execute(
          'INSERT INTO order_payments (order_id, verification_status, admin_status) VALUES (?, \'PENDING\', \'PENDING\')',
          [orderId]
        );

        // 6. Auto-Inquiry: Start a chat thread automatically for order tracking.
        await ChatService.startInquiry(userId, {
          vendorId,
          productId: null,
          messageText: `New Order #${orderId} has been placed. Payment Method: ${paymentMethod}. Deposit: ${calculatedDeposit}`,
          requestedQuantity: null
        }, connection);

        createdOrders.push(orderId);
      }

      // 7. Cleanup: Clear shopping cart only after successful order splits.
      await CartService.clearCart(userId, connection);
      await connection.commit();
      return createdOrders;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Uploads a visual proof of payment (screenshot/receipt).
   * 
   * @async
   * @param {number} orderId 
   * @param {number} userId - Security: Verification of ownership.
   * @param {Object} file - Buffer and metadata from Multer.
   */
  async uploadReceipt(orderId, userId, file) { 
    const order = await OrderRepository.findById(orderId);
    if (!order || order.user_id !== userId) throw new AppError('Order not found', 404);

    // 1. Media Persistence: Upload proof to Cloudinary.
    const { url, publicId } = await UploadService.uploadImage(file.buffer, 'elmowared/receipts');

    // 2. Data Update: Attach receipt and move to PENDING verification.
    await OrderRepository.uploadPaymentReceipt(orderId, {
      transactionImage: url,
      transactionImagePublicId: publicId
    });

    // 3. Admin Notification: Alert platform owners for manual verification.
    await NotificationService.createSystemNotification(
      1, 
      'إيصال دفع جديد لمراجعته',
      'New Payment Receipt for Review',
      `قام المستخدم برفع إيصال دفع للطلب #${orderId}. يرجى المراجعة والتحقق.`,
      `A new payment receipt has been uploaded for Order #${orderId}. Please review and verify.`
    );
  }

  /**
   * Administrative confirmation or rejection of a payment.
   * 
   * @async
   * @param {number} orderId 
   * @param {boolean} isAdmin - Security: Must be authorized for finance.
   * @param {string} [approvalStatus='VERIFIED'] 
   * @param {string} [adminNote=null] 
   */
  async confirmPayment(orderId, isAdmin = false, approvalStatus = 'VERIFIED', adminNote = null) {
    if (!isAdmin) throw new AppError('Unauthorized', 403);
    
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new AppError('Order not found', 404);

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const finalStatus = approvalStatus === 'VERIFIED' ? 'PROCESSING' : 'CANCELLED';
      
      // 1. Order Guard: Update status and verification flags.
      await OrderRepository.updateStatus(orderId, finalStatus, connection);
      await OrderRepository.verifyPayment(orderId, approvalStatus, adminNote, connection);
      await OrderRepository.updateAdminApproval(orderId, approvalStatus, connection);

      if (approvalStatus === 'VERIFIED') {
        // 2. Ledger Update: Confirm the deposit in the vendor's financial ledger.
        await TransactionRepository.create({
          vendorId: order.vendor_id,
          orderId: orderId,
          amount: order.deposit_amount,
          type: 'DEPOSIT',
          status: 'COMPLETED',
          details: `Automatic deposit entry for Order #${orderId}`
        }, connection);

        // 3. Merchant Alert: Signal the vendor to begin manufacturing/shipping.
        await NotificationService.createSystemNotification(
          order.vendor_user_id, 
          'تم تأكيد الدفع - ابدأ التجهيز',
          'Payment Verified - Start Preparation',
          `تم تأكيد دفع العربون للطلب #${orderId}. يمكنك البدء في التجهيز.`,
          `Payment for Order #${orderId} has been verified. You can start preparation.`
        );

        // 4. Customer Confirmation: Notify user of successful verification.
        await NotificationService.createSystemNotification(
          order.user_id,
          'تم تأكيد دفعتك',
          'Payment Verified',
          `تم تأكيد دفع العربون للطلب #${orderId} بنجاح.`,
          `Your payment for Order #${orderId} has been successfully verified.`
        );

        // Notify via Socket
        try {
          const io = getIO();
          await io.to(order.user_id.toString()).emit('order_update', { orderId, status: 'PROCESSING', message: 'Payment Verified' });
          await io.to(order.vendor_user_id.toString()).emit('order_update', { orderId, status: 'PROCESSING', message: 'Payment Verified' });
        } catch (e) {}
      } else {
        // 5. Rejection Flow: Inform the user to re-upload the receipt.
        await NotificationService.createSystemNotification(
          order.user_id,
          'تم رفض إيصال الدفع',
          'Payment Receipt Rejected',
          `تم رفض إيصال الدفع للطلب #${orderId}. السبب: ${adminNote}`,
          `Your payment receipt for Order #${orderId} was rejected. Note: ${adminNote}`
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Universal status update for the order lifecycle.
   * Implements role-based transition rules.
   * 
   * @async
   */
  async updateOrderStatus(orderId, userId, role, newStatus, vendorProfileId = null) {
    const order = await OrderRepository.findById(orderId);
    if (!order) throw new AppError('Order not found', 404);

    const isAdmin = ['ADMIN', 'OWNER'].includes(role);
    const isVendor = role === 'MOWARED';

    // 1. Authorization Check: Ensures only the relevant participants can modify state.
    if (isVendor && order.vendor_id !== vendorProfileId) {
      throw new AppError('Unauthorized to update this order', 403);
    }
    if (!isAdmin && !isVendor && order.user_id !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    // 2. Finite State Machine: Only allows logical status progressions.
    const currentStatus = order.status;
    const allowedTransitions = {
      'PENDING': ['CANCELLED'],
      'PROCESSING': ['SHIPPED', 'CANCELLED'],
      'SHIPPED': ['COMPLETED'],
      'COMPLETED': [],
      'CANCELLED': []
    };

    if (!isAdmin && (!allowedTransitions[currentStatus] || !allowedTransitions[currentStatus].includes(newStatus))) {
      throw new AppError(`Cannot move from ${currentStatus} to ${newStatus}`, 400);
    }

    await OrderRepository.updateStatus(order.id, newStatus);
    
    // 3. Side Effects: Notify the customer of shipping or completion.
    if (userId !== order.user_id) {
       await NotificationService.createSystemNotification(
        order.user_id,
        'تحديث حالة الطلب',
        'Order Status Updated',
        `تم تحديث حالة طلبك #${order.id} إلى ${newStatus}.`,
        `Your order #${order.id} status has been updated to ${newStatus}.`
      );

      // Notify via Socket
      try {
        const io = getIO();
        await io.to(order.user_id.toString()).emit('order_update', { orderId: order.id, status: newStatus });
        if (order.vendor_user_id) {
          await io.to(order.vendor_user_id.toString()).emit('order_update', { orderId: order.id, status: newStatus });
        }
      } catch (e) {}
    }

    return OrderRepository.findById(order.id);
  }

  // Simplified Lookups
  async getOrderDetails(id) {
    const order = await OrderRepository.findById(id);
    if (!order) throw new AppError('Order not found', 404);
    return order;
  }

  async getMyOrders(userId) {
    return OrderRepository.getUserOrders(userId);
  }

  async getVendorOrders(vendorId) {
    return OrderRepository.getVendorOrders(vendorId);
  }
}

export default new OrderService();
