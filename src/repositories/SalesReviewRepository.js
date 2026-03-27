import pool from '../config/db.js';

class SalesReviewRepository {
  _schemaReady = false;
  _schemaReadyPromise = null;

  async initializeSchema(connection = pool) {
    if (this._schemaReady) return;
    if (this._schemaReadyPromise) return this._schemaReadyPromise;

    this._schemaReadyPromise = (async () => {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS vendor_sales_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          vendor_id INT NOT NULL,
          product_id INT NOT NULL,
          quantity INT NOT NULL,
          gross_sale_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          net_profit DECIMAL(10,2) NOT NULL DEFAULT 0.00,
          sale_date DATETIME NOT NULL,
          notes TEXT NULL,
          created_by INT NOT NULL,
          updated_by INT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_vendor_sales_logs_vendor FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE,
          CONSTRAINT fk_vendor_sales_logs_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
          CONSTRAINT fk_vendor_sales_logs_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_vendor_sales_logs_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
          INDEX idx_vendor_sales_logs_vendor (vendor_id),
          INDEX idx_vendor_sales_logs_product (product_id),
          INDEX idx_vendor_sales_logs_sale_date (sale_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      this._schemaReady = true;
    })().catch((error) => {
      this._schemaReadyPromise = null;
      throw error;
    });

    return this._schemaReadyPromise;
  }

  async findVendorProductById(vendorId, productId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT p.id,
              p.vendor_id,
              p.name_ar,
              p.name_en,
              p.price,
              p.quantity_available,
              p.lifecycle_status,
              p.is_active,
              p.deleted_at
       FROM products p
       WHERE p.id = :productId
         AND p.vendor_id = :vendorId
         AND p.deleted_at IS NULL
       LIMIT 1`,
      { vendorId, productId }
    );

    return rows[0] || null;
  }

  async findVendorProductByIdForUpdate(vendorId, productId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT p.id,
              p.vendor_id,
              p.name_ar,
              p.name_en,
              p.price,
              p.quantity_available,
              p.lifecycle_status,
              p.is_active
       FROM products p
       WHERE p.id = :productId
         AND p.vendor_id = :vendorId
         AND p.deleted_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      { vendorId, productId }
    );

    return rows[0] || null;
  }

  async listSelectableProducts(vendorId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT p.id,
              p.name_ar,
              p.name_en,
              p.price,
              p.quantity_available
       FROM products p
       WHERE p.vendor_id = :vendorId
         AND p.deleted_at IS NULL
         AND p.is_active = 1
         AND p.lifecycle_status = 'APPROVED'
       ORDER BY p.created_at DESC`,
      { vendorId }
    );

    return rows;
  }

  async getSummary(vendorId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT COUNT(*) AS total_records,
              COUNT(DISTINCT product_id) AS sold_products,
              IFNULL(SUM(quantity), 0) AS total_quantity,
              IFNULL(SUM(gross_sale_amount), 0) AS total_sales,
              IFNULL(SUM(net_profit), 0) AS total_profit
       FROM vendor_sales_logs
       WHERE vendor_id = :vendorId`,
      { vendorId }
    );

    return rows[0] || {
      total_records: 0,
      sold_products: 0,
      total_quantity: 0,
      total_sales: 0,
      total_profit: 0
    };
  }

  async listSales(vendorId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT s.*,
              p.name_ar AS product_name_ar,
              p.name_en AS product_name_en,
              p.quantity_available AS current_quantity_available
       FROM vendor_sales_logs s
       JOIN products p ON p.id = s.product_id
       WHERE s.vendor_id = :vendorId
       ORDER BY s.sale_date DESC, s.id DESC`,
      { vendorId }
    );

    return rows;
  }

  async listLowStockProducts(vendorId, threshold = 10, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT p.id,
              p.name_ar,
              p.name_en,
              p.quantity_available,
              p.price
       FROM products p
       WHERE p.vendor_id = :vendorId
         AND p.deleted_at IS NULL
         AND p.is_active = 1
         AND p.lifecycle_status = 'APPROVED'
         AND p.quantity_available < :threshold
       ORDER BY p.quantity_available ASC, p.updated_at DESC`,
      { vendorId, threshold }
    );

    return rows;
  }

  async createSale(data, connection = pool) {
    const [result] = await connection.execute(
      `INSERT INTO vendor_sales_logs (
         vendor_id, product_id, quantity, gross_sale_amount, net_profit, sale_date, notes, created_by, updated_by
       ) VALUES (
         :vendorId, :productId, :quantity, :grossSaleAmount, :netProfit, :saleDate, :notes, :createdBy, :updatedBy
       )`,
      data
    );

    return result.insertId;
  }

  async findSaleById(id, vendorId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT *
       FROM vendor_sales_logs
       WHERE id = :id AND vendor_id = :vendorId
       LIMIT 1`,
      { id, vendorId }
    );

    return rows[0] || null;
  }

  async findSaleByIdForUpdate(id, vendorId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT *
       FROM vendor_sales_logs
       WHERE id = :id AND vendor_id = :vendorId
       LIMIT 1
       FOR UPDATE`,
      { id, vendorId }
    );

    return rows[0] || null;
  }

  async updateSale(id, vendorId, data, connection = pool) {
    await connection.execute(
      `UPDATE vendor_sales_logs
       SET product_id = :productId,
           quantity = :quantity,
           gross_sale_amount = :grossSaleAmount,
           net_profit = :netProfit,
           sale_date = :saleDate,
           notes = :notes,
           updated_by = :updatedBy,
           updated_at = NOW()
       WHERE id = :id
         AND vendor_id = :vendorId`,
      {
        id,
        vendorId,
        ...data
      }
    );
  }

  async deleteSale(id, vendorId, connection = pool) {
    const [result] = await connection.execute(
      `DELETE FROM vendor_sales_logs
       WHERE id = :id
         AND vendor_id = :vendorId`,
      { id, vendorId }
    );

    return result.affectedRows > 0;
  }

  async adjustProductStock(productId, quantityDelta, connection = pool) {
    await connection.execute(
      `UPDATE products
       SET quantity_available = quantity_available + :quantityDelta,
           updated_at = NOW()
       WHERE id = :productId`,
      { productId, quantityDelta }
    );
  }
}

export default new SalesReviewRepository();
