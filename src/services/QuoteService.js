/**
 * @file QuoteService.js
 * @description Service for managing RFQ lifecycle and chat integration.
 */

import QuoteRepository from '../repositories/QuoteRepository.js';
import ChatService from './ChatService.js';
import NotificationService from './NotificationService.js';
import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';

class QuoteService {
  /**
   * Initializes an RFQ and sends a chat integration message.
   */
  async requestQuote(userId, quoteData) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    try {
      // 1. Create the RFQ record
      const quoteId = await QuoteRepository.create(
        { ...quoteData, userId },
        connection
      );

      // 2. Fetch the created quote to ensure we have all details (including relations)
      const quote = await QuoteRepository.findById(quoteId, connection);

      if (!quote) {
        throw new Error(`Critical Error: Quote #${quoteId} created but could not be retrieved.`);
      }

      // 3. Integrate with Chat: Send system message
      const systemMsgBody = {
        type: 'RFQ_CARD',
        quoteId: quote.id,
        productId: quote.product_id,
        requestedQuantity: quote.requested_quantity,
        targetPrice: quote.target_price,
        status: quote.status
      };

      await ChatService.startInquiry(userId, {
        vendorId: quote.vendor_id,
        productId: quote.product_id,
        messageText: `[RFQ] I am requesting a quote for ${quote.requested_quantity} units. Target Price: ${quote.target_price || 'Negotiable'}. Notes: ${quote.notes || 'None'}`,
        metadata: JSON.stringify(systemMsgBody)
      }, connection);

      // 4. Real-time Notification
      try {
        const io = getIO();
        const [vendorUsers] = await connection.execute('SELECT user_id FROM vendor_profiles WHERE id = ?', [quote.vendor_id]);
        if (vendorUsers.length > 0) {
          await io.to(vendorUsers[0].user_id.toString()).emit('new_quote', { quoteId: quote.id });
        }
      } catch (e) {}

      await connection.commit();
      return quote;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Vendor responds to a quote with an offer.
   */
  async respondToQuote(vendorId, quoteId, offerData) {
    const quote = await QuoteRepository.findById(quoteId);
    if (!quote || quote.vendor_id !== vendorId) {
      throw new Error('Quote not found or unauthorized');
    }

    await QuoteRepository.updateStatus(quoteId, offerData.status || 'OFFERED', offerData.notes);

    // Notify User
    await NotificationService.createSystemNotification(
      quote.user_id,
      'عرض سعر جديد',
      'New Price Offer',
      `أرسل المورد عرض سعر لطلبك #${quoteId}`,
      `Vendor sent a price offer for your RFQ #${quoteId}`
    );

    return QuoteRepository.findById(quoteId);
  }

  async getQuote(id) {
    return QuoteRepository.findById(id);
  }

  async listUserQuotes(userId) {
    return QuoteRepository.findByUserId(userId);
  }

  async listVendorQuotes(vendorId) {
    return QuoteRepository.findByVendorId(vendorId);
  }
}

export default new QuoteService();
