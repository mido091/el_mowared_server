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

const pool = mysql.createPool({
  host: env.dbHost,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  port: env.dbPort,
  ssl: {
    ca: fs.readFileSync(
      path.join(process.cwd(), process.env.DB_ATTR_SSL_CA || "isrgrootx1.pem"),
    ),
    rejectUnauthorized: false,
  },
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
