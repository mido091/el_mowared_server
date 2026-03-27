/**
 * @file QuoteController.js
 * @description Controller for Request for Quote (RFQ) endpoints.
 */

import QuoteService from '../services/QuoteService.js';
import { z } from 'zod';

class QuoteController {
  constructor() {
    this.requestQuote = this.requestQuote.bind(this);
    this.respondToQuote = this.respondToQuote.bind(this);
    this.listQuotes = this.listQuotes.bind(this);
  }

  /**
   * Universal standardized response wrapper.
   */
  _respond(res, statusCode, data, message = '') {
    res.status(statusCode).json({
      success: statusCode >= 200 && statusCode < 300,
      data,
      message,
      error: null
    });
  }

  /**
   * Handlers for quote creation and response.
   */
  async requestQuote(req, res, next) {
    try {
      const schema = z.object({
        productId: z.number(),
        vendorId: z.number(),
        requestedQuantity: z.number().min(1),
        targetPrice: z.number().optional(),
        notes: z.string().optional()
      });

      const validatedData = schema.parse(req.body);
      const quote = await QuoteService.requestQuote(req.user.id, validatedData);

      this._respond(res, 201, quote, 'Quote request sent successfully.');
    } catch (error) {
      next(error);
    }
  }

  async respondToQuote(req, res, next) {
    try {
      const quoteId = parseInt(req.params.id);
      const schema = z.object({
        status: z.enum(['OFFERED', 'REJECTED']),
        notes: z.string().optional()
      });

      const validatedData = schema.parse(req.body);
      const quote = await QuoteService.respondToQuote(
        req.user.vendorProfile.id,
        quoteId,
        validatedData
      );

      this._respond(res, 200, quote, 'Quote response recorded.');
    } catch (error) {
      next(error);
    }
  }

  async listQuotes(req, res, next) {
    try {
      let quotes;
      if (req.user.role === 'MOWARED') {
        quotes = await QuoteService.listVendorQuotes(req.user.vendorProfile.id);
      } else {
        quotes = await QuoteService.listUserQuotes(req.user.id);
      }

      this._respond(res, 200, quotes, 'Quote list fetched.');
    } catch (error) {
      next(error);
    }
  }
}

export default new QuoteController();
