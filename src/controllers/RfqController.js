import RfqService from '../services/RfqService.js';
import RfqRepository from '../repositories/RfqRepository.js';
import UploadService from '../services/UploadService.js';
import pool from '../config/db.js';
import { z } from 'zod';
import { AppError } from '../middlewares/errorHandler.js';
import { normalizeRfqItems, parseRfqItemsInput } from '../utils/rfqItems.js';

class RfqController {
  _normalizeDateTime(value) {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    const seconds = String(parsed.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Universal standardized response wrapper.
   */
  _respond(res, statusCode, data, message = '') {
    if (statusCode >= 200 && statusCode < 300) {
      res.set('Cache-Control', 'no-store');
    }
    res.status(statusCode).json({
      success: statusCode >= 200 && statusCode < 300,
      data,
      message,
      error: null
    });
  }

  /**
   * Creates a new RFQ (For Users)
   */
  create = async (req, res, next) => {
    try {
      const normalizedBody = {
        category_id: req.body.category_id === '' || req.body.category_id == null ? undefined : Number(req.body.category_id),
        items: normalizeRfqItems(parseRfqItemsInput(req.body.items)),
        quantity: req.body.quantity === '' || req.body.quantity == null ? undefined : Number(req.body.quantity),
        target_price: req.body.target_price === '' || req.body.target_price == null ? undefined : Number(req.body.target_price),
        lead_priority: req.body.lead_priority,
        expiration_time: this._normalizeDateTime(req.body.expiration_time || undefined),
        max_responders: req.body.max_responders === '' || req.body.max_responders == null ? undefined : Number(req.body.max_responders),
        specs: req.body.specs,
        image_url: req.body.image_url || undefined
      };

      const schema = z.object({
        category_id: z.number().int().positive(),
        items: z.array(z.object({
          label: z.string().min(1).max(255),
          details: z.string().min(1).max(5000),
          order: z.number().int().positive().optional()
        })).min(1),
        quantity: z.number().int().positive(),
        target_price: z.number().positive().optional(),
        lead_priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
        expiration_time: z.string().optional(),
        max_responders: z.number().int().min(1).max(50).optional(),
        specs: z.any().optional(),
        image_url: z.string().url().optional()
      });

      const validatedData = schema.parse(normalizedBody);

      let uploadedImageUrl = validatedData.image_url;
      if (req.file?.buffer) {
        const { url } = await UploadService.uploadImage(req.file.buffer, 'elmowared/rfq');
        uploadedImageUrl = url;
      }
      
      const rfqId = await RfqService.createRfq({
        ...validatedData,
        image_url: uploadedImageUrl,
        user_id: req.user.id
      }, true); // Submit immediately

      this._respond(res, 201, { rfqId }, 'RFQ created and submitted successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Broadcasts an RFQ to matching vendors (For Admins)
   */
  broadcast = async (req, res, next) => {
    try {
      const { id } = req.params;
      const vendorsNotified = await RfqService.broadcastRfq(parseInt(id), req.user.id);

      this._respond(res, 200, { vendorsNotified }, `RFQ broadcasted to ${vendorsNotified} vendors.`);
    } catch (error) {
      next(error);
    }
  }

  reject = async (req, res, next) => {
    try {
      const { id } = req.params;
      const result = await RfqService.rejectRfq(parseInt(id), req.user.id);
      this._respond(res, 200, result, 'RFQ rejected successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetches all RFQs (For Admins)
   */
  getAllAdmin = async (req, res, next) => {
    try {
      const allRfqs = await RfqRepository.getAllAdmin();
      this._respond(res, 200, allRfqs, 'All RFQs fetched for moderation.');
    } catch (err) {
      next(err);
    }
  }

  getMine = async (req, res, next) => {
    try {
      const myRfqs = await RfqRepository.getByUserId(req.user.id);
      this._respond(res, 200, res.formatLocalization(myRfqs), 'Your RFQs fetched successfully.');
    } catch (err) {
      next(err);
    }
  }

  getOne = async (req, res, next) => {
    try {
      const rfqId = Number(req.params.id);
      const rfq = await RfqService.getRfqDetails(rfqId, req.user);
      this._respond(res, 200, rfq, 'RFQ details fetched successfully.');
    } catch (err) {
      next(err);
    }
  }

  /**
   * Submit an offer (For Vendors)
   */
  submitOffer = async (req, res, next) => {
    try {
      const { id } = req.params;
      const schema = z.object({
        offered_price: z.number().positive(),
        delivery_time: z.string(),
        notes: z.string().optional()
      });
      const validatedData = schema.parse(req.body);

      // Verify vendor profile setup natively
      if (!req.user.vendorProfile && req.user.role !== 'MOWARED') {
        throw new AppError({
          en: 'Only vendors can submit offers.',
          ar: 'فقط الموردون يمكنهم إرسال عروض.'
        }, 403, 'FORBIDDEN');
      }
      const vendorId = req.user.vendorProfile?.id;

      const offerId = await RfqService.submitOffer(parseInt(id), vendorId, req.user.id, validatedData);

      this._respond(res, 201, { offerId }, 'Offer submitted successfully. RFQ is active.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetches the personalized RFQ feed (For Vendors)
   */
  getFeed = async (req, res, next) => {
    try {
      if (!req.user.vendorProfile && req.user.role !== 'MOWARED') {
        throw new AppError({
          en: 'Only vendors have access to the lead feed.',
          ar: 'فقط الموردون لديهم صلاحية الوصول إلى قائمة الفرص.'
        }, 403, 'FORBIDDEN');
      }
      const vendorId = req.user.vendorProfile?.id;

      // Extract vendor categories (simplified lookup, assume attached to user or manually fetch)
      // Usually req.user has categories or we fetch natively here.
      // For this spec, let's assume `req.user.categories_ids` exists or fetch it natively
      const [rows] = await pool.execute(`SELECT category_id FROM vendor_category_junction WHERE vendor_id = ?`, [vendorId]);
      const categoryIds = rows.map(r => r.category_id);

      if (categoryIds.length === 0) {
        this._respond(res, 200, [], 'Add categories to your profile to see leads.');
        return;
      }

      const feed = await RfqRepository.getFeedForVendor(vendorId, categoryIds, {
        search: req.query.search,
        category: req.query.category
      });
      this._respond(res, 200, feed, 'Vendor lead feed fetched.');
    } catch (err) {
      next(err);
    }
  }

  decline = async (req, res, next) => {
    try {
      if (!req.user.vendorProfile && req.user.role !== 'MOWARED') {
        throw new AppError({
          en: 'Only vendors can decline RFQs.',
          ar: 'فقط الموردون يمكنهم رفض طلبات العروض.'
        }, 403, 'FORBIDDEN');
      }

      const vendorId = req.user.vendorProfile?.id;
      const rfqId = Number(req.params.id);
      const result = await RfqService.declineRfq(rfqId, vendorId, req.user);

      this._respond(res, 200, result, 'RFQ declined for this vendor.');
    } catch (err) {
      next(err);
    }
  }

  /**
   * Accepts a specific vendor offer (For Users)
   */
  acceptOffer = async (req, res, next) => {
    try {
      const { offerId } = req.params;
      const offer = await RfqService.acceptOffer(parseInt(offerId), req.user.id);

      this._respond(res, 200, offer, 'Offer accepted. Negotiation secured.');
    } catch (error) {
      next(error);
    }
  }

  delete = async (req, res, next) => {
    try {
      const rfqId = Number(req.params.id);
      const result = await RfqService.deleteRfq(rfqId, req.user.id);
      this._respond(res, 200, result, 'RFQ deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  complete = async (req, res, next) => {
    try {
      const rfqId = Number(req.params.id);
      const result = await RfqService.completeRfq(rfqId, req.user.id);
      this._respond(res, 200, result, 'RFQ marked as completed successfully.');
    } catch (error) {
      next(error);
    }
  }
}

export default new RfqController();
