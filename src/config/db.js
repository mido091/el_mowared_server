/**
 * @file db.js
 * @description Database connection pool configuration using mysql2.
 * This module exports a promise-based MySQL connection pool with support
 * for named placeholders and automatic keep-alive.
 */

import mysql from "mysql2/promise";
import { env } from "./env.js";
import logger from "../utils/logger.js";
import fs from "fs";
import path from "path";

const resolveSslConfig = () => {
  const rawValue = `${process.env.DB_ATTR_SSL_CA || "isrgrootx1.pem"}`.trim();

  if (!rawValue) {
    return undefined;
  }

  if (rawValue.startsWith("-----BEGIN CERTIFICATE-----")) {
    return {
      ca: rawValue,
      rejectUnauthorized: false,
    };
  }

  const certificatePath = path.isAbsolute(rawValue)
    ? rawValue
    : path.join(process.cwd(), rawValue);

  if (!fs.existsSync(certificatePath)) {
    logger.warn("SSL CA file not found; using relaxed TLS settings without custom CA", {
      certificatePath,
    });
    return {
      rejectUnauthorized: false,
    };
  }

  return {
    ca: fs.readFileSync(certificatePath, "utf8"),
    rejectUnauthorized: false,
  };
};

const pool = mysql.createPool({
  host: env.dbHost,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  port: env.dbPort,
  ssl: resolveSslConfig(),
  namedPlaceholders: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});
pool.on("error", (err) => {
  logger.error("Unexpected error on idle database client", {
    name: err.name,
    message: err.message,
  });
});

export { pool };
export default pool;
