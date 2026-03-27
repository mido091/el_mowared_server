import pool from './src/config/db.js';

async function safeExecute(connection, sql, label) {
  try {
    await connection.execute(sql);
    console.log(`[ReviewsMigration] OK: ${label}`);
  } catch (error) {
    if (
      error.code === 'ER_DUP_FIELDNAME' ||
      error.code === 'ER_DUP_KEYNAME' ||
      error.code === 'ER_FK_DUP_NAME' ||
      error.message?.includes('Duplicate')
    ) {
      console.log(`[ReviewsMigration] Skip: ${label}`);
      return;
    }
    throw error;
  }
}

async function hasColumn(connection, tableName, columnName) {
  const escapedColumn = connection.escape(columnName);
  const [rows] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ${escapedColumn}`);
  return rows.length > 0;
}

async function hasIndex(connection, tableName, indexName) {
  const escapedIndex = connection.escape(indexName);
  const [rows] = await connection.query(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ${escapedIndex}`);
  return rows.length > 0;
}

async function getDuplicateVendorReviews(connection) {
  const [rows] = await connection.execute(`
    SELECT vendor_id, user_id, COUNT(*) AS duplicates
    FROM vendor_reviews
    GROUP BY vendor_id, user_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  return rows[0] || null;
}

async function main() {
  const connection = await pool.getConnection();

  try {
    console.log('[ReviewsMigration] Applying safe reviews system changes...');

    await safeExecute(
      connection,
      `ALTER TABLE vendor_profiles ADD COLUMN avg_rating DECIMAL(3,1) NOT NULL DEFAULT 0.0 AFTER location`,
      'vendor_profiles.avg_rating'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_profiles ADD COLUMN review_count INT NOT NULL DEFAULT 0 AFTER avg_rating`,
      'vendor_profiles.review_count'
    );
    await safeExecute(
      connection,
      `ALTER TABLE products ADD COLUMN avg_rating DECIMAL(3,1) NOT NULL DEFAULT 0.0 AFTER quantity_available`,
      'products.avg_rating'
    );
    await safeExecute(
      connection,
      `ALTER TABLE products ADD COLUMN review_count INT NOT NULL DEFAULT 0 AFTER avg_rating`,
      'products.review_count'
    );

    if (await hasColumn(connection, 'vendor_reviews', 'order_id')) {
      await safeExecute(
        connection,
        `ALTER TABLE vendor_reviews MODIFY COLUMN order_id INT NULL`,
        'vendor_reviews.order_id nullable'
      );
    }

    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING' AFTER comment`,
      'vendor_reviews.status'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at`,
      'vendor_reviews.updated_at'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN moderated_by INT NULL AFTER updated_at`,
      'vendor_reviews.moderated_by'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN moderated_at DATETIME NULL AFTER moderated_by`,
      'vendor_reviews.moderated_at'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN is_verified_review BOOLEAN NOT NULL DEFAULT TRUE AFTER status`,
      'vendor_reviews.is_verified_review'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN interaction_type ENUM('ORDER','RFQ','CHAT','QUOTE') NULL AFTER is_verified_review`,
      'vendor_reviews.interaction_type'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN interaction_reference_id INT NULL AFTER interaction_type`,
      'vendor_reviews.interaction_reference_id'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN profanity_flag BOOLEAN NOT NULL DEFAULT FALSE AFTER interaction_reference_id`,
      'vendor_reviews.profanity_flag'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN profanity_score INT NOT NULL DEFAULT 0 AFTER profanity_flag`,
      'vendor_reviews.profanity_score'
    );
    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD COLUMN flag_reason VARCHAR(255) NULL AFTER profanity_score`,
      'vendor_reviews.flag_reason'
    );

    if (!(await hasIndex(connection, 'vendor_reviews', 'idx_vendor_reviews_vendor_status'))) {
      await safeExecute(
        connection,
        `ALTER TABLE vendor_reviews ADD INDEX idx_vendor_reviews_vendor_status (vendor_id, status)`,
        'vendor_reviews status index'
      );
    }

    await safeExecute(
      connection,
      `
      CREATE TABLE IF NOT EXISTS product_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        user_id INT NOT NULL,
        rating TINYINT NOT NULL,
        comment TEXT NULL,
        status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
        is_verified_review BOOLEAN NOT NULL DEFAULT FALSE,
        interaction_type ENUM('ORDER','RFQ','CHAT','QUOTE') NULL,
        interaction_reference_id INT NULL,
        profanity_flag BOOLEAN NOT NULL DEFAULT FALSE,
        profanity_score INT NOT NULL DEFAULT 0,
        flag_reason VARCHAR(255) NULL,
        order_id INT NULL,
        moderated_by INT NULL,
        moderated_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_product_reviews_target_user (product_id, user_id),
        INDEX idx_product_reviews_status (status),
        INDEX idx_product_reviews_product_status (product_id, status),
        CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        CONSTRAINT fk_product_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_product_reviews_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
        CONSTRAINT fk_product_reviews_moderated_by FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      'product_reviews table'
    );

    if (!(await hasColumn(connection, 'vendor_reviews', 'moderated_by'))) {
      throw new Error('vendor_reviews.moderated_by column was not created.');
    }

    await safeExecute(
      connection,
      `ALTER TABLE vendor_reviews ADD CONSTRAINT fk_vendor_reviews_moderated_by FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL`,
      'vendor_reviews moderated_by foreign key'
    );

    await connection.execute(`
      UPDATE vendor_reviews
      SET status = COALESCE(status, 'APPROVED'),
          is_verified_review = 1,
          interaction_type = COALESCE(interaction_type, CASE WHEN order_id IS NOT NULL THEN 'ORDER' ELSE interaction_type END),
          interaction_reference_id = COALESCE(interaction_reference_id, order_id),
          updated_at = COALESCE(updated_at, created_at)
    `);

    if (await hasIndex(connection, 'vendor_reviews', 'order_id')) {
      try {
        await connection.execute('ALTER TABLE vendor_reviews DROP INDEX order_id');
        console.log('[ReviewsMigration] OK: dropped legacy vendor_reviews.order_id unique index');
      } catch (error) {
        const message = String(error.message || '');
        if (
          message.includes('check that column/key exists') ||
          message.includes('needed in a foreign key constraint')
        ) {
          console.log('[ReviewsMigration] Skip: legacy vendor_reviews.order_id index retained for foreign key compatibility.');
        } else {
          throw error;
        }
      }
    }

    if (!(await hasIndex(connection, 'vendor_reviews', 'idx_vendor_reviews_target_user'))) {
      const duplicateVendorReview = await getDuplicateVendorReviews(connection);
      if (!duplicateVendorReview) {
        await safeExecute(
          connection,
          `ALTER TABLE vendor_reviews ADD UNIQUE KEY idx_vendor_reviews_target_user (vendor_id, user_id)`,
          'vendor_reviews unique vendor/user'
        );
      } else {
        console.log('[ReviewsMigration] Skip: vendor/user unique key because duplicate historical reviews exist.');
      }
    }

    await connection.execute(`
      UPDATE vendor_profiles vp
      LEFT JOIN (
        SELECT vendor_id,
               ROUND(COALESCE(AVG(CASE WHEN status = 'APPROVED' THEN rating END), 0), 1) AS avg_rating,
               COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) AS review_count
        FROM vendor_reviews
        GROUP BY vendor_id
      ) vr ON vr.vendor_id = vp.id
      SET vp.avg_rating = COALESCE(vr.avg_rating, 0),
          vp.review_count = COALESCE(vr.review_count, 0)
    `);

    await connection.execute(`
      UPDATE products p
      LEFT JOIN (
        SELECT product_id,
               ROUND(COALESCE(AVG(CASE WHEN status = 'APPROVED' THEN rating END), 0), 1) AS avg_rating,
               COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) AS review_count
        FROM product_reviews
        GROUP BY product_id
      ) pr ON pr.product_id = p.id
      SET p.avg_rating = COALESCE(pr.avg_rating, 0),
          p.review_count = COALESCE(pr.review_count, 0)
    `);

    await connection.execute(`
      CREATE OR REPLACE VIEW vendor_stats AS
      SELECT
        v.id AS vendor_id,
        v.user_id,
        v.company_name_ar,
        v.company_name_en,
        v.bio_ar,
        v.bio_en,
        v.location,
        v.verification_status,
        (v.verification_status = 'APPROVED') AS is_verified,
        COALESCE(v.avg_rating, 0) AS avg_rating,
        COALESCE(v.review_count, 0) AS review_count,
        IFNULL(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.total_price ELSE 0 END), 0) AS total_sales,
        COUNT(DISTINCT CASE WHEN o.status = 'COMPLETED' THEN o.id END) AS total_orders,
        IFNULL(vs.response_rate, 0) AS response_rate
      FROM vendor_profiles v
      LEFT JOIN orders o ON o.vendor_id = v.id
      LEFT JOIN vendor_scores vs ON vs.vendor_id = v.id
      WHERE v.deleted_at IS NULL
      GROUP BY
        v.id,
        v.user_id,
        v.company_name_ar,
        v.company_name_en,
        v.bio_ar,
        v.bio_en,
        v.location,
        v.verification_status,
        v.avg_rating,
        v.review_count,
        vs.response_rate
    `);

    console.log('[ReviewsMigration] Completed successfully.');
  } catch (error) {
    console.error('[ReviewsMigration] Failed:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
