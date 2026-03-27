import pool from '../config/db.js';
import SalesReviewRepository from '../repositories/SalesReviewRepository.js';
import VendorRepository from '../repositories/VendorRepository.js';
import { AppError } from '../middlewares/errorHandler.js';

class SalesReviewService {
  async _resolveVendorId(userId) {
    const vendor = await VendorRepository.findByUserId(userId);
    if (!vendor) throw new AppError('Vendor profile not found', 404);
    return vendor.id;
  }

  _normalizeSalePayload(payload) {
    return {
      productId: Number(payload.productId),
      quantity: Number(payload.quantity),
      grossSaleAmount: Number(payload.grossSaleAmount),
      netProfit: Number(payload.netProfit),
      saleDate: payload.saleDate,
      notes: payload.notes ? String(payload.notes).trim() : null
    };
  }

  _assertSalePayload(payload) {
    if (!Number.isInteger(payload.productId) || payload.productId <= 0) {
      throw new AppError('A valid product is required.', 400);
    }
    if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) {
      throw new AppError('Quantity must be greater than zero.', 400);
    }
    if (Number.isNaN(payload.grossSaleAmount) || payload.grossSaleAmount < 0) {
      throw new AppError('Gross sale amount must be zero or greater.', 400);
    }
    if (Number.isNaN(payload.netProfit) || payload.netProfit < 0) {
      throw new AppError('Net profit must be zero or greater.', 400);
    }
    if (!payload.saleDate || Number.isNaN(new Date(payload.saleDate).getTime())) {
      throw new AppError('A valid sale date is required.', 400);
    }
  }

  async getDashboard(userId) {
    const vendorId = await this._resolveVendorId(userId);

    const [summary, sales, lowStock, productOptions] = await Promise.all([
      SalesReviewRepository.getSummary(vendorId),
      SalesReviewRepository.listSales(vendorId),
      SalesReviewRepository.listLowStockProducts(vendorId, 10),
      SalesReviewRepository.listSelectableProducts(vendorId)
    ]);

    return {
      summary,
      sales,
      lowStock,
      productOptions
    };
  }

  async createSale(userId, payload) {
    const vendorId = await this._resolveVendorId(userId);
    const normalized = this._normalizeSalePayload(payload);
    this._assertSalePayload(normalized);

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const product = await SalesReviewRepository.findVendorProductByIdForUpdate(vendorId, normalized.productId, connection);
      if (!product) {
        throw new AppError('Selected product was not found for this vendor.', 404);
      }
      if (`${product.lifecycle_status || ''}`.toUpperCase() !== 'APPROVED' || !Number(product.is_active)) {
        throw new AppError('Only active approved products can be used in sales review.', 400);
      }
      if (Number(product.quantity_available || 0) < normalized.quantity) {
        throw new AppError('Insufficient stock for this sale quantity.', 400);
      }

      const saleId = await SalesReviewRepository.createSale({
        vendorId,
        productId: normalized.productId,
        quantity: normalized.quantity,
        grossSaleAmount: normalized.grossSaleAmount,
        netProfit: normalized.netProfit,
        saleDate: normalized.saleDate,
        notes: normalized.notes,
        createdBy: userId,
        updatedBy: userId
      }, connection);

      await SalesReviewRepository.adjustProductStock(normalized.productId, -normalized.quantity, connection);

      await connection.commit();

      return SalesReviewRepository.findSaleById(saleId, vendorId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateSale(userId, saleId, payload) {
    const vendorId = await this._resolveVendorId(userId);
    const normalized = this._normalizeSalePayload(payload);
    this._assertSalePayload(normalized);

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const existingSale = await SalesReviewRepository.findSaleByIdForUpdate(saleId, vendorId, connection);
      if (!existingSale) {
        throw new AppError('Sale record not found.', 404);
      }

      const oldProduct = await SalesReviewRepository.findVendorProductByIdForUpdate(vendorId, existingSale.product_id, connection);
      if (!oldProduct) {
        throw new AppError('Original product record was not found.', 404);
      }

      let targetProduct = oldProduct;
      if (Number(existingSale.product_id) !== normalized.productId) {
        targetProduct = await SalesReviewRepository.findVendorProductByIdForUpdate(vendorId, normalized.productId, connection);
        if (!targetProduct) {
          throw new AppError('Selected product was not found for this vendor.', 404);
        }
      }

      if (`${targetProduct.lifecycle_status || ''}`.toUpperCase() !== 'APPROVED' || !Number(targetProduct.is_active)) {
        throw new AppError('Only active approved products can be used in sales review.', 400);
      }

      await SalesReviewRepository.adjustProductStock(existingSale.product_id, Number(existingSale.quantity), connection);

      const availableQuantity = Number(targetProduct.id) === Number(existingSale.product_id)
        ? Number(oldProduct.quantity_available || 0) + Number(existingSale.quantity || 0)
        : Number(targetProduct.quantity_available || 0);

      if (availableQuantity < normalized.quantity) {
        throw new AppError('Insufficient stock for the updated sale quantity.', 400);
      }

      await SalesReviewRepository.adjustProductStock(normalized.productId, -normalized.quantity, connection);

      await SalesReviewRepository.updateSale(
        saleId,
        vendorId,
        {
          productId: normalized.productId,
          quantity: normalized.quantity,
          grossSaleAmount: normalized.grossSaleAmount,
          netProfit: normalized.netProfit,
          saleDate: normalized.saleDate,
          notes: normalized.notes,
          updatedBy: userId
        },
        connection
      );

      await connection.commit();

      return SalesReviewRepository.findSaleById(saleId, vendorId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteSale(userId, saleId) {
    const vendorId = await this._resolveVendorId(userId);
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const existingSale = await SalesReviewRepository.findSaleByIdForUpdate(saleId, vendorId, connection);
      if (!existingSale) {
        throw new AppError('Sale record not found.', 404);
      }

      const product = await SalesReviewRepository.findVendorProductByIdForUpdate(vendorId, existingSale.product_id, connection);
      if (!product) {
        throw new AppError('Product record was not found.', 404);
      }

      await SalesReviewRepository.adjustProductStock(existingSale.product_id, Number(existingSale.quantity), connection);
      await SalesReviewRepository.deleteSale(saleId, vendorId, connection);

      await connection.commit();
      return { id: saleId, deleted: true };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export default new SalesReviewService();
