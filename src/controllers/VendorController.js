/**
 * @file VendorController.js
 * @description Controller for public and administrative merchant management.
 * Handles merchant discovery and the administrative verification pipeline.
 */

import VendorService from '../services/VendorService.js';
import SalesReviewService from '../services/SalesReviewService.js';
import VendorMetricsService from '../services/VendorMetricsService.js';
import { z } from 'zod';
import VendorRepository from '../repositories/VendorRepository.js';
import TransactionRepository from '../repositories/TransactionRepository.js';
import { AppError } from '../middlewares/errorHandler.js';

class VendorController {
  /**
   * Retrieves the current authenticated vendor's full profile.
   * 
   * @async
   */
  getMyProfile = async (req, res, next) => {
    try {
      // 1. Map User ID → Vendor Profile ID.
      const vendorProfile = await VendorRepository.findByUserId(req.user.id);
      if (!vendorProfile) {
        throw new AppError({
          en: 'Vendor profile not found.',
          ar: 'ملف المورد غير موجود.'
        }, 404, 'NOT_FOUND');
      }

      // 2. Fetch enriched data (includes categories).
      const vendor = await VendorService.getVendorById(vendorProfile.id);

      res.status(200).json({
        status: 'success',
        data: { vendor }
      });
    } catch (error) {
      next(error);
    }
  }

  getVendors = async (req, res, next) => {
    try {
      const vendors = await VendorService.getVendors(req.query);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({
        status: 'success',
        results: vendors.length,
        data: { vendors }
      });
    } catch (error) {
      next(error);
    }
  }

  getVendorById = async (req, res, next) => {
    try {
      const vendor = await VendorService.getVendorById(req.params.id);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({
        status: 'success',
        data: { vendor }
      });
    } catch (error) {
      next(error);
    }
  }

  getVendorMetrics = async (req, res, next) => {
    try {
      const metrics = await VendorMetricsService.getVendorMetrics(req.params.id);
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.status(200).json({
        status: 'success',
        data: metrics
      });
    } catch (error) {
      next(error);
    }
  }

  verifyVendor = async (req, res, next) => {
    try {
      const { status } = req.body;
      const result = await VendorService.verifyVendor(req.params.id, status);
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }

  updateMyProfile = async (req, res, next) => {
    try {
      // 1. Structural Validation: Ensure bilingual consistency and category association format.
      const schema = z.object({
        companyNameAr: z.string().min(2),
        companyNameEn: z.string().min(2),
        bioAr: z.string().optional().nullable(),
        bioEn: z.string().optional().nullable(),
        location: z.string().optional().nullable(),
        categoryIds: z.array(z.number()).min(1, 'At least one category is required')
      });

      const validatedData = schema.parse(req.body);

      // 2. Business Execution: Pass to service layer for transactional update.
      const updatedVendor = await VendorService.updateVendorProfile(req.user.id, validatedData);

      res.status(200).json({
        status: 'success',
        data: { vendor: updatedVendor }
      });
    } catch (error) {
      next(error);
    }
  }

  getMyStats = async (req, res, next) => {
    try {
      const stats = await VendorService.getVendorStats(req.user.id);
      res.status(200).json({ status: 'success', data: stats });
    } catch (error) {
      next(error);
    }
  }

  getMyOrders = async (req, res, next) => {
    try {
      const { limit } = req.query;
      const orders = await VendorService.getVendorOrders(req.user.id, limit);
      res.status(200).json({ status: 'success', data: orders });
    } catch (error) {
      next(error);
    }
  }

  getMyWallet = async (req, res, next) => {
    try {
      const vendor = await VendorRepository.findByUserId(req.user.id);
      if (!vendor) throw new AppError('Vendor profile not found', 404);

      const [summary, transactions] = await Promise.all([
        TransactionRepository.getSummary(vendor.id),
        TransactionRepository.findByVendor(vendor.id)
      ]);

      res.status(200).json({
        status: 'success',
        data: { summary, transactions }
      });
    } catch (error) {
      next(error);
    }
  }

  getSalesReview = async (req, res, next) => {
    try {
      const data = await SalesReviewService.getDashboard(req.user.id);
      res.status(200).json({
        status: 'success',
        data
      });
    } catch (error) {
      next(error);
    }
  }

  createSalesReviewEntry = async (req, res, next) => {
    try {
      const schema = z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
        grossSaleAmount: z.number().min(0),
        netProfit: z.number().min(0),
        saleDate: z.string().min(1),
        notes: z.string().optional().nullable()
      });

      const payload = schema.parse({
        productId: Number(req.body.productId),
        quantity: Number(req.body.quantity),
        grossSaleAmount: Number(req.body.grossSaleAmount),
        netProfit: Number(req.body.netProfit),
        saleDate: req.body.saleDate,
        notes: req.body.notes || null
      });

      const sale = await SalesReviewService.createSale(req.user.id, payload);
      res.status(201).json({
        status: 'success',
        data: sale
      });
    } catch (error) {
      next(error);
    }
  }

  updateSalesReviewEntry = async (req, res, next) => {
    try {
      const schema = z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
        grossSaleAmount: z.number().min(0),
        netProfit: z.number().min(0),
        saleDate: z.string().min(1),
        notes: z.string().optional().nullable()
      });

      const payload = schema.parse({
        productId: Number(req.body.productId),
        quantity: Number(req.body.quantity),
        grossSaleAmount: Number(req.body.grossSaleAmount),
        netProfit: Number(req.body.netProfit),
        saleDate: req.body.saleDate,
        notes: req.body.notes || null
      });

      const sale = await SalesReviewService.updateSale(req.user.id, Number(req.params.id), payload);
      res.status(200).json({
        status: 'success',
        data: sale
      });
    } catch (error) {
      next(error);
    }
  }

  deleteSalesReviewEntry = async (req, res, next) => {
    try {
      const result = await SalesReviewService.deleteSale(req.user.id, Number(req.params.id));
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new VendorController();
