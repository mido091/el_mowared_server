import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

const resolveSslOptions = () => {
  const configuredPath = process.env.DB_ATTR_SSL_CA || './isrgrootx1.pem';
  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`SSL CA file not found: ${absolutePath}`);
  }

  return {
    ca: fs.readFileSync(absolutePath),
    rejectUnauthorized: true
  };
};

const createPool = () =>
  mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    ssl: resolveSslOptions(),
    namedPlaceholders: true,
    waitForConnections: true,
    connectionLimit: 2
  });

const dropVendorStatsSql = 'DROP VIEW IF EXISTS vendor_stats';

const createVendorStatsSql = `
CREATE VIEW vendor_stats AS
SELECT
  vp.id AS vendor_id,
  vp.company_name_ar,
  vp.company_name_en,
  vp.bio_ar,
  vp.bio_en,
  vp.location,
  vp.verification_status,
  CASE
    WHEN vp.verification_status = 'APPROVED' THEN TRUE
    ELSE FALSE
  END AS is_verified,
  COALESCE(vp.avg_rating, 0) AS avg_rating,
  COALESCE(vp.review_count, 0) AS review_count,
  COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN o.total_price ELSE 0 END), 0) AS total_sales,
  COALESCE(COUNT(DISTINCT CASE WHEN o.status = 'COMPLETED' THEN o.id END), 0) AS total_orders,
  COALESCE(MAX(vs.response_rate), 0) AS response_rate
FROM vendor_profiles vp
LEFT JOIN orders o
  ON o.vendor_id = vp.id
LEFT JOIN vendor_scores vs
  ON vs.vendor_id = vp.id
WHERE vp.deleted_at IS NULL
GROUP BY
  vp.id,
  vp.company_name_ar,
  vp.company_name_en,
  vp.bio_ar,
  vp.bio_en,
  vp.location,
  vp.verification_status,
  vp.avg_rating,
  vp.review_count
`;

const inspectDatabaseObjects = async (connection) => {
  const [views] = await connection.query(`
    SELECT TABLE_NAME, DEFINER, SECURITY_TYPE
    FROM information_schema.VIEWS
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);

  const [triggers] = await connection.query(`
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, DEFINER, ACTION_TIMING, EVENT_MANIPULATION
    FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()
    ORDER BY TRIGGER_NAME
  `);

  return { views, triggers };
};

const verifyVendorStats = async (connection) => {
  const [rows] = await connection.query(`
    SELECT vendor_id, company_name_en, total_orders, response_rate
    FROM vendor_stats
    ORDER BY vendor_id
    LIMIT 5
  `);

  return rows;
};

const run = async () => {
  const pool = createPool();
  const connection = await pool.getConnection();

  try {
    console.log('Recreating vendor_stats view...');
    await connection.query(dropVendorStatsSql);
    await connection.query(createVendorStatsSql);

    const objects = await inspectDatabaseObjects(connection);
    const sample = await verifyVendorStats(connection);

    console.log(
      JSON.stringify(
        {
          success: true,
          recreated: 'vendor_stats',
          views: objects.views,
          triggers: objects.triggers,
          sample
        },
        null,
        2
      )
    );
  } finally {
    connection.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        message: error.message,
        code: error.code || 'SCRIPT_ERROR'
      },
      null,
      2
    )
  );
  process.exit(1);
});
