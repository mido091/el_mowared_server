/**
 * @file ProductRepository.js
 * @description Repository for managing Product data with full lifecycle support.
 * Handles multilingual searches, lifecycle status management, and status audit logs.
 */

import pool from '../config/db.js';

class ProductRepository {
  _productColumns = null;
  _productColumnMeta = null;
  _hasProductViewLogsTable = null;
  _inventorySchemaReady = false;
  _inventorySchemaReadyPromise = null;

  async initializeRuntimeSchema(connection = pool) {
    if (this._inventorySchemaReady) {
      return;
    }

    if (this._inventorySchemaReadyPromise) {
      return this._inventorySchemaReadyPromise;
    }

    this._inventorySchemaReadyPromise = (async () => {
      const [rows] = await connection.query('SHOW COLUMNS FROM products');
      const currentColumns = new Set(rows.map((row) => row.Field));

      if (!currentColumns.has('discount_price')) {
        await connection.query('ALTER TABLE products ADD COLUMN discount_price DECIMAL(10,2) NULL AFTER price');
      }

      if (!currentColumns.has('quantity_available')) {
        await connection.query('ALTER TABLE products ADD COLUMN quantity_available INT NOT NULL DEFAULT 0 AFTER min_order_quantity');
      }

      this._productColumns = null;
      this._productColumnMeta = null;
      this._inventorySchemaReady = true;
    })().catch((error) => {
      this._inventorySchemaReadyPromise = null;
      throw error;
    });

    return this._inventorySchemaReadyPromise;
  }

  async _getProductColumns(connection = pool) {
    if (this._productColumns) return this._productColumns;
    const [rows] = await connection.query('SHOW COLUMNS FROM products');
    this._productColumns = new Set(rows.map((row) => row.Field));
    return this._productColumns;
  }

  async _getProductColumnMeta(connection = pool) {
    if (this._productColumnMeta) return this._productColumnMeta;
    const [rows] = await connection.query('SHOW COLUMNS FROM products');
    this._productColumnMeta = new Map(rows.map((row) => [row.Field, row]));
    return this._productColumnMeta;
  }

  async _hasProductColumn(columnName, connection = pool) {
    const columns = await this._getProductColumns(connection);
    return columns.has(columnName);
  }

  async _productEnumSupportsValue(columnName, value, connection = pool) {
    const meta = await this._getProductColumnMeta(connection);
    const column = meta.get(columnName);
    if (!column?.Type?.startsWith('enum(')) return false;

    const enumValues = column.Type
      .slice(5, -1)
      .split(',')
      .map((entry) => entry.trim().replace(/^'/, '').replace(/'$/, ''));

    return enumValues.some((entry) => entry.toLowerCase() === `${value}`.toLowerCase());
  }

  async _normalizeProductEnumValue(columnName, value, connection = pool, fallback = null) {
    const meta = await this._getProductColumnMeta(connection);
    const column = meta.get(columnName);
    if (!column?.Type?.startsWith('enum(')) return fallback;

    const enumValues = column.Type
      .slice(5, -1)
      .split(',')
      .map((entry) => entry.trim().replace(/^'/, '').replace(/'$/, ''));

    return enumValues.find((entry) => entry.toLowerCase() === `${value}`.toLowerCase()) || fallback;
  }

  async _supportsProductViewLogs(connection = pool) {
    if (this._hasProductViewLogsTable !== null) return this._hasProductViewLogsTable;
    const [rows] = await connection.query(`SHOW TABLES LIKE 'product_view_logs'`);
    this._hasProductViewLogsTable = rows.length > 0;
    return this._hasProductViewLogsTable;
  }

  async _buildStatusSql(connection = pool) {
    const hasStatus = await this._hasProductColumn('status', connection);
    const hasVisible = await this._hasProductColumn('is_visible', connection);

    return {
      statusSelect: hasStatus ? 'COALESCE(p.lifecycle_status, p.status) AS status' : 'p.lifecycle_status AS status',
      visibilitySelect: hasVisible
        ? `COALESCE(p.is_visible, CASE WHEN COALESCE(p.lifecycle_status, p.status) = 'APPROVED' THEN 1 ELSE 0 END) AS is_visible`
        : `CASE WHEN ${hasStatus ? `COALESCE(p.lifecycle_status, p.status)` : 'p.lifecycle_status'} = 'APPROVED' THEN 1 ELSE 0 END AS is_visible`,
      publicWhere: hasVisible
        ? `COALESCE(p.is_visible, CASE WHEN COALESCE(p.lifecycle_status, p.status) = 'APPROVED' THEN 1 ELSE 0 END) = 1
           AND COALESCE(p.lifecycle_status, p.status) = 'APPROVED'`
        : `${hasStatus ? `COALESCE(p.lifecycle_status, p.status)` : 'p.lifecycle_status'} = 'APPROVED'`,
      filterWhere: hasStatus ? 'COALESCE(p.lifecycle_status, p.status) = :lifecycleStatus' : 'p.lifecycle_status = :lifecycleStatus',
      hasStatus,
      hasVisible
    };
  }

  /**
   * Retrieves a paginated list of products with advanced filtering.
   * Public endpoints only see APPROVED products; vendor/admin see all.
   */
  async findAll({ categoryId, vendorId, searchTerm, minPrice, maxPrice, moq, location, sortBy = 'newest', limit = 10, offset = 0, specs, discounted, publicOnly = false, lifecycleStatus }) {
    const statusSql = await this._buildStatusSql();
    const hasViewLogs = await this._supportsProductViewLogs();
    const selectClause = `
      SELECT p.*, 
             ${statusSql.statusSelect},
             ${statusSql.visibilitySelect},
             c.name_ar as category_name_ar, c.name_en as category_name_en,
             COALESCE(vpa.avg_rating, vs.avg_rating, 0) as avg_rating,
             COALESCE(vpa.review_count, vs.review_count, 0) as review_count,
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_main = 1 LIMIT 1) as main_image,
             ${hasViewLogs ? '(SELECT COUNT(*) FROM product_view_logs pvl WHERE pvl.product_id = p.id)' : '0'} as views_count,
             (SELECT COUNT(*) FROM conversations conv WHERE conv.product_id = p.id) as inquiries_count
    `;
    let fromWhereClause = `
      FROM products p
      INNER JOIN categories c ON p.category_id = c.id AND c.deleted_at IS NULL
      INNER JOIN vendor_profiles vpa ON p.vendor_id = vpa.id AND vpa.deleted_at IS NULL
      INNER JOIN users vu ON vpa.user_id = vu.id AND vu.deleted_at IS NULL
      LEFT JOIN vendor_stats vs ON p.vendor_id = vs.vendor_id
      WHERE p.deleted_at IS NULL
    `;
    const params = {};

    // Public access: only show approved products
    if (publicOnly) {
      fromWhereClause += ` AND ${statusSql.publicWhere}`;
    } else if (lifecycleStatus) {
      fromWhereClause += ` AND ${statusSql.filterWhere}`;
      params.lifecycleStatus = lifecycleStatus;
    }

    if (categoryId) {
      fromWhereClause += ' AND p.category_id = :categoryId';
      params.categoryId = categoryId;
    }
    if (vendorId) {
      fromWhereClause += ' AND p.vendor_id = :vendorId';
      params.vendorId = vendorId;
    }
    if (discounted) {
      fromWhereClause += ' AND p.discount_price IS NOT NULL AND p.discount_price > 0';
    }
    if (searchTerm) {
      fromWhereClause += ` AND (
        p.name_ar LIKE :searchTerm OR 
        p.name_en LIKE :searchTerm OR 
        p.description_ar LIKE :searchTerm OR 
        p.description_en LIKE :searchTerm OR 
        c.name_ar LIKE :searchTerm OR 
        c.name_en LIKE :searchTerm
      )`;
      params.searchTerm = `%${searchTerm}%`;
    }
    if (minPrice) {
      fromWhereClause += ' AND p.price >= :minPrice';
      params.minPrice = minPrice;
    }
    if (maxPrice) {
      fromWhereClause += ' AND p.price <= :maxPrice';
      params.maxPrice = maxPrice;
    }
    if (moq) {
      fromWhereClause += ' AND p.min_order_quantity <= :moq';
      params.moq = moq;
    }
    if (location) {
      fromWhereClause += ' AND (p.location LIKE :location OR vs.company_name_ar LIKE :location OR vs.company_name_en LIKE :location)';
      params.location = `%${location}%`;
    }
    if (specs) {
      try {
        const specObj = typeof specs === 'string' ? JSON.parse(specs) : specs;
        Object.entries(specObj).forEach(([key, value], index) => {
          const paramKey = `specVal${index}`;
          fromWhereClause += ` AND JSON_EXTRACT(p.specs, '$.${key}') = :${paramKey}`;
          params[paramKey] = value;
        });
      } catch (e) { /* skip malformed */ }
    }

    const cleanParams = Object.fromEntries(Object.entries(params).filter(([_, v]) => v !== undefined));
    const [countResult] = await pool.execute(
      `SELECT COUNT(DISTINCT p.id) as total ${fromWhereClause}`,
      cleanParams
    );
    const total = countResult[0]?.total || 0;

    let orderBy = 'p.created_at DESC';
    if (sortBy === 'price_low') orderBy = 'p.price ASC';
    else if (sortBy === 'price_high') orderBy = 'p.price DESC';
    else if (sortBy === 'rating') orderBy = 'COALESCE(vpa.avg_rating, vs.avg_rating, 0) DESC';

    const finalLimit = parseInt(limit) || 10;
    const finalOffset = parseInt(offset) || 0;
    const sql = `${selectClause} ${fromWhereClause} ORDER BY ${orderBy} LIMIT ${finalLimit} OFFSET ${finalOffset}`;

    const [products] = await pool.execute(sql, cleanParams);

    if (!publicOnly) {
      for (const product of products) {
        const [images] = await pool.execute('SELECT image_url, is_main, public_id FROM product_images WHERE product_id = :id', { id: product.id || null });
        product.images = images || [];
      }
    }

    return { products: products || [], total };
  }

  /**
   * Retrieves multiple products by IDs (for comparison).
   */
  async findManyByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const statusSql = await this._buildStatusSql();
    const sql = `
      SELECT p.*, ${statusSql.statusSelect}, ${statusSql.visibilitySelect},
             c.name_ar as category_name_ar, c.name_en as category_name_en,
             COALESCE(vpa.avg_rating, vs.avg_rating, 0) as avg_rating,
             COALESCE(vpa.review_count, vs.review_count, 0) as review_count,
             vs.company_name_ar as brand_ar, vs.company_name_en as brand_en,
             vp.logo as vendor_logo
      FROM products p
      INNER JOIN categories c ON p.category_id = c.id AND c.deleted_at IS NULL
      INNER JOIN vendor_profiles vpa ON p.vendor_id = vpa.id AND vpa.deleted_at IS NULL
      INNER JOIN users vu ON vpa.user_id = vu.id AND vu.deleted_at IS NULL
      LEFT JOIN vendor_stats vs ON p.vendor_id = vs.vendor_id
      LEFT JOIN vendor_profiles vp ON p.vendor_id = vp.id AND vp.deleted_at IS NULL
      WHERE p.id IN (?) AND p.deleted_at IS NULL AND ${statusSql.publicWhere}
    `;
    const [products] = await pool.query(sql, [ids]);
    for (const p of products) {
      const [images] = await pool.execute('SELECT image_url FROM product_images WHERE product_id = :id AND is_main = 1 LIMIT 1', { id: p.id });
      p.main_image = images[0]?.image_url || null;
    }
    return products;
  }

  async getPublicMarketplaceSummary() {
    const statusSql = await this._buildStatusSql();

    const [[products], [vendors], [orders], [countries], [users]] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) AS total
        FROM products p
        INNER JOIN categories c ON p.category_id = c.id AND c.deleted_at IS NULL
        INNER JOIN vendor_profiles vp ON p.vendor_id = vp.id AND vp.deleted_at IS NULL
        INNER JOIN users u ON vp.user_id = u.id AND u.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND ${statusSql.publicWhere}
      `),
      pool.query(`
        SELECT COUNT(*) AS total
        FROM vendor_profiles vp
        INNER JOIN users u ON vp.user_id = u.id AND u.deleted_at IS NULL
        WHERE vp.deleted_at IS NULL
      `),
      pool.query(`
        SELECT COUNT(*) AS total
        FROM orders
        WHERE UPPER(status) = 'COMPLETED'
      `),
      pool.query(`
        SELECT COUNT(DISTINCT TRIM(vp.location)) AS total
        FROM vendor_profiles vp
        INNER JOIN users u ON vp.user_id = u.id AND u.deleted_at IS NULL
        WHERE vp.deleted_at IS NULL
          AND vp.location IS NOT NULL
          AND TRIM(vp.location) <> ''
      `),
      pool.query(`
        SELECT COUNT(*) AS total
        FROM users
        WHERE deleted_at IS NULL
          AND is_active = 1
      `)
    ]);

    return {
      total_products: Number(products[0]?.total || 0),
      total_vendors: Number(vendors[0]?.total || 0),
      total_completed_orders: Number(orders[0]?.total || 0),
      total_countries: Number(countries[0]?.total || 0),
      total_users: Number(users[0]?.total || 0)
    };
  }

  /**
   * Retrieves a single product by ID including image gallery.
   * Joins vendor info for the marketplace product page.
   */
  async findById(id, options = {}) {
    const { includeDeleted = false } = options;
    const statusSql = await this._buildStatusSql();
    const hasViewLogs = await this._supportsProductViewLogs();
    const categoryJoin = includeDeleted
      ? 'LEFT JOIN categories c ON p.category_id = c.id'
      : 'INNER JOIN categories c ON p.category_id = c.id AND c.deleted_at IS NULL';
    const vendorJoin = includeDeleted
      ? 'LEFT JOIN vendor_profiles vpa ON p.vendor_id = vpa.id'
      : 'INNER JOIN vendor_profiles vpa ON p.vendor_id = vpa.id AND vpa.deleted_at IS NULL';
    const userJoin = includeDeleted
      ? 'LEFT JOIN users vu ON vpa.user_id = vu.id'
      : 'INNER JOIN users vu ON vpa.user_id = vu.id AND vu.deleted_at IS NULL';
    const vendorProfileJoin = includeDeleted
      ? 'LEFT JOIN vendor_profiles vp ON p.vendor_id = vp.id'
      : 'LEFT JOIN vendor_profiles vp ON p.vendor_id = vp.id AND vp.deleted_at IS NULL';
    const sql = `
      SELECT p.*,
             ${statusSql.statusSelect},
             ${statusSql.visibilitySelect},
             CASE
               WHEN p.deleted_at IS NOT NULL THEN 'DELETED'
               WHEN COALESCE(p.lifecycle_status, p.status) = 'REJECTED' THEN 'REJECTED'
               WHEN COALESCE(p.lifecycle_status, p.status) = 'APPROVED' THEN 'APPROVED'
               ELSE 'PENDING'
             END AS record_state,
             vs.company_name_ar, vs.company_name_en,
             COALESCE(vpa.avg_rating, vs.avg_rating, 0) as avg_rating,
             COALESCE(vpa.review_count, vs.review_count, 0) as review_count,
             vs.response_rate, vs.is_verified, vs.vendor_id as vs_vendor_id,
             vu.id as vendor_user_id,
             vp.logo as vendor_logo,
             vp.created_at as vendor_created_at,
             (
               SELECT COUNT(*)
               FROM products vendor_products
               INNER JOIN categories vc ON vendor_products.category_id = vc.id AND vc.deleted_at IS NULL
               WHERE vendor_products.vendor_id = p.vendor_id
                 AND vendor_products.deleted_at IS NULL
                 AND ${statusSql.publicWhere.replaceAll('p.', 'vendor_products.')}
             ) as vendor_total_products,
             ${hasViewLogs ? '(SELECT COUNT(*) FROM product_view_logs pvl WHERE pvl.product_id = p.id)' : '0'} as views_count,
             (SELECT COUNT(*) FROM conversations conv WHERE conv.product_id = p.id) as inquiries_count,
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_main = 1 LIMIT 1) as main_image
      FROM products p
      ${categoryJoin}
      ${vendorJoin}
      ${userJoin}
      LEFT JOIN vendor_stats vs ON p.vendor_id = vs.vendor_id
      ${vendorProfileJoin}
      WHERE p.id = :id ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}
    `;
    const [rows] = await pool.execute(sql, { id });
    const product = rows[0];
    if (product) {
      const [images] = await pool.execute('SELECT * FROM product_images WHERE product_id = :id', { id });
      product.images = images;
      // Normalize vendor card data
      product.vendor = {
        id: product.vendor_id,
        user_id: product.vendor_user_id,
        company_name_ar: product.company_name_ar,
        company_name_en: product.company_name_en,
        avg_rating: product.avg_rating,
        review_count: product.review_count,
        response_rate: product.response_rate,
        is_verified: product.is_verified,
        logo: product.vendor_logo,
        total_products: product.vendor_total_products,
        member_since: product.vendor_created_at,
      };
    }
    return product;
  }

  /**
   * Finds products by same category (for "Similar Products" section).
   */
  async findSimilar(categoryId, excludeId, limit = 4) {
    const statusSql = await this._buildStatusSql();
    const sql = `
      SELECT p.id, p.slug, p.name_ar, p.name_en, p.price, p.lifecycle_status, ${statusSql.statusSelect}, ${statusSql.visibilitySelect},
             COALESCE(vpa.avg_rating, vs.avg_rating, 0) as avg_rating,
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_main = 1 LIMIT 1) as main_image
      FROM products p
      INNER JOIN categories c ON p.category_id = c.id AND c.deleted_at IS NULL
      INNER JOIN vendor_profiles vpa ON p.vendor_id = vpa.id AND vpa.deleted_at IS NULL
      INNER JOIN users vu ON vpa.user_id = vu.id AND vu.deleted_at IS NULL
      LEFT JOIN vendor_stats vs ON p.vendor_id = vs.vendor_id
      WHERE p.category_id = :categoryId 
        AND p.id != :excludeId 
        AND p.deleted_at IS NULL
        AND ${statusSql.publicWhere}
      ORDER BY p.created_at DESC
      LIMIT ${parseInt(limit)}
    `;
    const [rows] = await pool.execute(sql, { categoryId, excludeId });
    return rows;
  }

  /**
   * Admin: find all products pending moderation.
   */
  async findPendingForAdmin({ lifecycleStatus, limit = 20, offset = 0 }) {
    const statusSql = await this._buildStatusSql();
    const hasViewLogs = await this._supportsProductViewLogs();
    const hasRejectionReason = await this._hasProductColumn('rejection_reason');
    const hasEdited = await this._hasProductColumn('is_edited');
    const hasLastReviewedAt = await this._hasProductColumn('last_reviewed_at');
    const hasQuantityAvailable = await this._hasProductColumn('quantity_available');
    let sql = `
      SELECT p.id, p.name_ar, p.name_en, p.lifecycle_status, ${statusSql.statusSelect}, ${statusSql.visibilitySelect},
             p.vendor_id,
             ${hasQuantityAvailable ? 'p.quantity_available' : '0 as quantity_available'},
             ${hasRejectionReason ? 'p.rejection_reason' : 'NULL as rejection_reason'},
             ${hasEdited ? 'p.is_edited' : '0 as is_edited'}, p.created_at, p.updated_at,
             ${hasLastReviewedAt ? 'p.last_reviewed_at' : 'NULL as last_reviewed_at'},
             p.deleted_at,
             CASE
               WHEN p.deleted_at IS NOT NULL THEN 'DELETED'
               WHEN COALESCE(p.lifecycle_status, p.status) = 'REJECTED' THEN 'REJECTED'
               WHEN COALESCE(p.lifecycle_status, p.status) = 'APPROVED' THEN 'APPROVED'
               ELSE 'PENDING'
             END AS record_state,
             ${hasViewLogs ? '(SELECT COUNT(*) FROM product_view_logs pvl WHERE pvl.product_id = p.id)' : '0'} as views_count,
             (SELECT COUNT(*) FROM conversations conv WHERE conv.product_id = p.id) as inquiries_count,
             vs.company_name_ar, vs.company_name_en,
             COALESCE(vpa.avg_rating, vs.avg_rating, 0) as avg_rating,
             COALESCE(vpa.review_count, vs.review_count, 0) as review_count,
             vp.logo as vendor_logo,
             (SELECT image_url FROM product_images WHERE product_id = p.id AND is_main = 1 LIMIT 1) as main_image
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN vendor_profiles vpa ON p.vendor_id = vpa.id
      LEFT JOIN users vu ON vpa.user_id = vu.id
      LEFT JOIN vendor_stats vs ON p.vendor_id = vs.vendor_id
      LEFT JOIN vendor_profiles vp ON p.vendor_id = vp.id
      WHERE 1 = 1
    `;
    const params = {};
    if (lifecycleStatus && lifecycleStatus !== 'ALL') {
      sql += ` AND ${statusSql.filterWhere}`;
      params.lifecycleStatus = lifecycleStatus;
    }
    sql += ` ORDER BY p.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;
    const [rows] = await pool.execute(sql, params);

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN vendor_profiles vp ON p.vendor_id = vp.id
       LEFT JOIN users u ON vp.user_id = u.id
       WHERE 1 = 1${lifecycleStatus && lifecycleStatus !== 'ALL' ? ` AND ${statusSql.filterWhere}` : ''}`,
      lifecycleStatus && lifecycleStatus !== 'ALL' ? { lifecycleStatus } : {}
    );
    return { products: rows, total: countResult[0]?.total || 0 };
  }

  /**
   * Hard update of lifecycle status with reviewer tracking.
   */
  async reviewProduct({ id, status, lifecycleStatus, rejectionReason, reviewerId }, connection = pool) {
    const hasStatus = await this._hasProductColumn('status', connection);
    const hasVisible = await this._hasProductColumn('is_visible', connection);
    const hasRejectionReason = await this._hasProductColumn('rejection_reason', connection);
    const hasLastReviewedBy = await this._hasProductColumn('last_reviewed_by', connection);
    const hasLastReviewedAt = await this._hasProductColumn('last_reviewed_at', connection);
    const hasEdited = await this._hasProductColumn('is_edited', connection);
    const fallbackLifecycleStatus = await this._normalizeProductEnumValue('lifecycle_status', 'PENDING', connection, 'PENDING');
    const safeLifecycleStatus = await this._normalizeProductEnumValue(
      'lifecycle_status',
      lifecycleStatus,
      connection,
      fallbackLifecycleStatus
    );
    const targetStatus = status || lifecycleStatus;
    let safeStatus = null;
    if (hasStatus) {
      if (await this._productEnumSupportsValue('status', targetStatus, connection)) {
        safeStatus = await this._normalizeProductEnumValue('status', targetStatus, connection);
      } else {
        const mappedStatus = String(targetStatus).toUpperCase() === 'APPROVED' ? 'ACTIVE' : 'DRAFT';
        safeStatus = await this._normalizeProductEnumValue('status', mappedStatus, connection, null);
      }
    }
    const updateParts = ['lifecycle_status = :lifecycleStatus', 'updated_at = NOW()'];

    if (hasStatus) updateParts.push('status = :status');
    if (hasVisible) updateParts.push('is_visible = :isVisible');
    if (hasRejectionReason) updateParts.push('rejection_reason = :rejectionReason');
    if (hasLastReviewedBy) updateParts.push('last_reviewed_by = :reviewerId');
    if (hasLastReviewedAt) updateParts.push('last_reviewed_at = NOW()');
    if (hasEdited) updateParts.push('is_edited = FALSE');

    const sql = `
      UPDATE products
      SET ${updateParts.join(', ')}
      WHERE id = :id AND deleted_at IS NULL
    `;
    await connection.execute(sql, {
      id,
      status: safeStatus,
      lifecycleStatus: safeLifecycleStatus,
      rejectionReason: rejectionReason || null,
      reviewerId,
      isVisible: `${safeStatus || ''}`.toUpperCase() === 'APPROVED' ? 1 : 0
    });
  }

  /**
   * Logs a status transition in product_status_logs.
   */
  async logStatusChange({ productId, oldStatus, newStatus, changedBy, note }, connection = pool) {
    const sql = `
      INSERT INTO product_status_logs (product_id, old_status, new_status, changed_by, note)
      VALUES (:productId, :oldStatus, :newStatus, :changedBy, :note)
    `;
    await connection.execute(sql, {
      productId,
      oldStatus: oldStatus || null,
      newStatus,
      changedBy: changedBy || null,
      note: note || null
    });
  }

  /**
   * Retrieves status history for a product.
   */
  async findStatusHistory(productId) {
    const sql = `
      SELECT psl.*, CONCAT_WS(' ', u.first_name, u.last_name) as reviewer_name
      FROM product_status_logs psl
      LEFT JOIN users u ON psl.changed_by = u.id
      WHERE psl.product_id = :productId
      ORDER BY psl.created_at DESC
    `;
    const [rows] = await pool.execute(sql, { productId });
    return rows;
  }

  /**
   * Creates a new product record (lifecycle_status = PENDING by default).
   */
  async create(productData, connection = pool) {
    const { vendorId, categoryId, name_ar, name_en, description_ar, description_en, slug, price, discountPrice, minOrderQuantity, quantityAvailable, location, specs } = productData;
    const hasStatus = await this._hasProductColumn('status', connection);
    const hasVisible = await this._hasProductColumn('is_visible', connection);
    const hasDiscountPrice = await this._hasProductColumn('discount_price', connection);
    const hasQuantityAvailable = await this._hasProductColumn('quantity_available', connection);
    const hasLocation = await this._hasProductColumn('location', connection);
    const hasSpecs = await this._hasProductColumn('specs', connection);

    const columns = ['vendor_id', 'category_id', 'name_ar', 'name_en', 'description_ar', 'description_en', 'slug', 'price', 'min_order_quantity', 'lifecycle_status'];
    const values = [':vendorId', ':categoryId', ':name_ar', ':name_en', ':description_ar', ':description_en', ':slug', ':price', ':minOrderQuantity', `'PENDING'`];
    
    if (hasDiscountPrice) {
      columns.push('discount_price');
      values.push(':discountPrice');
    }
    if (hasQuantityAvailable) {
      columns.push('quantity_available');
      values.push(':quantityAvailable');
    }
    if (hasLocation) {
      columns.push('location');
      values.push(':location');
    }
    if (hasSpecs) {
      columns.push('specs');
      values.push(':specs');
    }
    if (hasStatus) {
      columns.push('status');
      values.push(`'DRAFT'`);
    }
    if (hasVisible) {
      columns.push('is_visible');
      values.push('0');
    }
    columns.push('created_at', 'updated_at');
    values.push('NOW()', 'NOW()');
    const sql = `
      INSERT INTO products (${columns.join(', ')})
      VALUES (${values.join(', ')})
    `;
    const [result] = await connection.execute(sql, {
      vendorId, categoryId, name_ar, name_en, description_ar, description_en, slug,
      price: price || 0,
      discountPrice: discountPrice ?? null,
      minOrderQuantity: minOrderQuantity || 1,
      quantityAvailable: Number.isInteger(quantityAvailable) ? quantityAvailable : 0,
      location: location || null,
      specs: typeof specs === 'string' ? specs : (specs ? JSON.stringify(specs) : null),
    });
    return { id: result.insertId, vendorId, categoryId };
  }

  /**
   * Bulk inserts product images.
   */
  async addImages(productId, images, connection = pool) {
    if (!images || images.length === 0) return;
    const formattedValues = images.map((img) => [productId, img.imageUrl, img.publicId, img.isMain ? 1 : 0]);
    await connection.query('INSERT INTO product_images (product_id, image_url, public_id, is_main) VALUES ?', [formattedValues]);
  }

  /**
   * Updates an existing product.
   * If product was APPROVED → re-set to PENDING + mark is_edited.
   */
  async update(id, productData, connection = pool) {
    const { categoryId, name_ar, name_en, description_ar, description_en, slug, price, discountPrice, minOrderQuantity, quantityAvailable, location, specs, currentLifecycleStatus, currentStatus } = productData;
    const hasStatus = await this._hasProductColumn('status', connection);
    const hasVisible = await this._hasProductColumn('is_visible', connection);
    const hasEdited = await this._hasProductColumn('is_edited', connection);
    const hasDiscountPrice = await this._hasProductColumn('discount_price', connection);
    const hasQuantityAvailable = await this._hasProductColumn('quantity_available', connection);
    const hasLocation = await this._hasProductColumn('location', connection);
    const hasSpecs = await this._hasProductColumn('specs', connection);
    const hasLifecycleStatus = await this._hasProductColumn('lifecycle_status', connection);

    // Re-PENDING logic: if product was APPROVED, set back to PENDING for moderation
    const effectiveCurrentStatus = currentStatus || currentLifecycleStatus || 'PENDING';
    const isApprovedEdit = effectiveCurrentStatus === 'APPROVED';
    const requestedStatus = isApprovedEdit ? 'UPDATE_PENDING' : 'PENDING';
    const newLifecycleStatus = hasLifecycleStatus
      ? await this._normalizeProductEnumValue(
          'lifecycle_status',
          requestedStatus,
          connection,
          await this._normalizeProductEnumValue('lifecycle_status', 'PENDING', connection, 'PENDING')
        )
      : null;

    let newStatus = null;
    if (hasStatus) {
      if (await this._productEnumSupportsValue('status', requestedStatus, connection)) {
        newStatus = await this._normalizeProductEnumValue('status', requestedStatus, connection, requestedStatus);
      } else if (await this._productEnumSupportsValue('status', 'PENDING', connection)) {
        newStatus = await this._normalizeProductEnumValue('status', 'PENDING', connection, 'PENDING');
      }
    }
    const isEdited = isApprovedEdit;

    const updateParts = [
      'category_id = :categoryId',
      'name_ar = :name_ar',
      'name_en = :name_en',
      'description_ar = :description_ar',
      'description_en = :description_en',
      'slug = :slug',
      'price = :price',
      'min_order_quantity = :minOrderQuantity',
      'updated_at = NOW()'
    ];
    if (hasDiscountPrice) updateParts.push('discount_price = :discountPrice');
    if (hasQuantityAvailable) updateParts.push('quantity_available = :quantityAvailable');
    if (hasLocation) updateParts.push('location = :location');
    if (hasSpecs) updateParts.push('specs = :specs');
    if (hasLifecycleStatus && newLifecycleStatus) updateParts.push('lifecycle_status = :newLifecycleStatus');
    if (hasStatus) updateParts.push('status = :newStatus');
    if (hasVisible) updateParts.push('is_visible = 0');
    if (hasEdited) updateParts.push('is_edited = :isEdited');
    const sql = `
      UPDATE products 
      SET ${updateParts.join(', ')}
      WHERE id = :id AND deleted_at IS NULL
    `;
    await connection.execute(sql, {
      id, categoryId, name_ar, name_en, description_ar, description_en, slug, price,
      discountPrice: discountPrice === '' || discountPrice === undefined ? null : discountPrice,
      minOrderQuantity: minOrderQuantity || 1,
      quantityAvailable: Number.isInteger(quantityAvailable) ? quantityAvailable : 0,
      location: location || null,
      specs: typeof specs === 'string' ? specs : (specs ? JSON.stringify(specs) : null),
      newLifecycleStatus,
      newStatus,
      isEdited,
    });
    return this.findById(id);
  }

  /**
   * Soft delete.
   */
  async softDelete(id, connection = pool) {
    const hasVisible = await this._hasProductColumn('is_visible', connection);
    await connection.execute(`UPDATE products SET deleted_at = NOW()${hasVisible ? ', is_visible = 0' : ''} WHERE id = :id`, { id });
  }

  /**
   * Bulk soft delete.
   */
  async bulkSoftDelete(ids, vendorId) {
    if (!ids || ids.length === 0) return;
    const hasVisible = await this._hasProductColumn('is_visible');
    await pool.query(`UPDATE products SET deleted_at = NOW()${hasVisible ? ', is_visible = 0' : ''} WHERE id IN (?) AND vendor_id = ?`, [ids, vendorId]);
  }

  /**
   * Deletes all images associated with a product and returns their Cloudinary IDs.
   */
  async deleteImages(productId, connection = pool) {
    const [images] = await connection.execute('SELECT public_id FROM product_images WHERE product_id = :productId', { productId });
    await connection.execute('DELETE FROM product_images WHERE product_id = :productId', { productId });
    return images;
  }

  async purgeSoftDeletedBySlug(slug, connection = pool) {
    if (!slug) return 0;
    const [result] = await connection.execute(
      'DELETE FROM products WHERE slug = :slug AND deleted_at IS NOT NULL',
      { slug }
    );
    return result.affectedRows || 0;
  }

  async findPotentialDuplicate({ vendorId, categoryId, name_ar, name_en, excludeId = null }, connection = pool) {
    const normalizedArabicName = `${name_ar || ''}`.trim();
    const normalizedEnglishName = `${name_en || ''}`.trim();
    const params = {
      vendorId,
      categoryId,
      excludeId: excludeId ? Number(excludeId) : null
    };
    let duplicateCondition = '';

    if (normalizedArabicName && normalizedEnglishName) {
      duplicateCondition = `
        LOWER(TRIM(name_ar)) = LOWER(TRIM(:name_ar))
        AND LOWER(TRIM(name_en)) = LOWER(TRIM(:name_en))
      `;
      params.name_ar = normalizedArabicName;
      params.name_en = normalizedEnglishName;
    } else if (normalizedArabicName) {
      duplicateCondition = 'LOWER(TRIM(name_ar)) = LOWER(TRIM(:name_ar))';
      params.name_ar = normalizedArabicName;
    } else if (normalizedEnglishName) {
      duplicateCondition = 'LOWER(TRIM(name_en)) = LOWER(TRIM(:name_en))';
      params.name_en = normalizedEnglishName;
    } else {
      return null;
    }

    const sql = `
      SELECT id
      FROM products
      WHERE vendor_id = :vendorId
        AND category_id = :categoryId
        AND deleted_at IS NULL
        AND (${duplicateCondition})
        AND (:excludeId IS NULL OR id != :excludeId)
      LIMIT 1
    `;
    const [rows] = await connection.execute(sql, params);
    return rows[0] || null;
  }

  async logView(productId, viewContext = {}, connection = pool) {
    if (!(await this._supportsProductViewLogs(connection))) return;
    const {
      viewerId = null,
      sessionKey = null,
      ipHash = null,
      userAgentHash = null
    } = viewContext;

    const [recent] = await connection.execute(
      `
      SELECT id
      FROM product_view_logs
      WHERE product_id = :productId
        AND (
          (:viewerId IS NOT NULL AND viewer_id = :viewerId)
          OR (:viewerId IS NULL AND :sessionKey IS NOT NULL AND session_key = :sessionKey)
          OR (:viewerId IS NULL AND :sessionKey IS NULL AND :ipHash IS NOT NULL AND ip_hash = :ipHash AND (:userAgentHash IS NULL OR user_agent_hash = :userAgentHash))
        )
        AND viewed_at >= DATE_SUB(NOW(), INTERVAL 20 MINUTE)
      LIMIT 1
      `,
      { productId, viewerId, sessionKey, ipHash, userAgentHash }
    );

    if (recent.length > 0) return;

    await connection.execute(
      `
      INSERT INTO product_view_logs (product_id, viewer_id, session_key, ip_hash, user_agent_hash, viewed_at, created_at)
      VALUES (:productId, :viewerId, :sessionKey, :ipHash, :userAgentHash, NOW(), NOW())
      `,
      { productId, viewerId, sessionKey, ipHash, userAgentHash }
    );
  }
}

export default new ProductRepository();
