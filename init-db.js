/**
 * @file init-db.js
 * @description Automatic database initializer for the Elmowared B2B Marketplace.
 * This script handles database creation, schema execution (tables, views, constraints),
 * and environment verification.
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Initializes the database ecosystem.
 * 1. Connects to MySQL host.
 * 2. Creates the database if it doesn't exist.
 * 3. Executes the full SQL schema from src/config/schema.sql.
 * 
 * @async
 * @function initDb
 * @throws {Error} If connection or SQL execution fails.
 */
const initDb = async () => {
  try {
    console.log('🔗 Connecting to MySQL...');
    const dbConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true,
      port: process.env.DB_PORT || 3306,
      ssl: process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : null,
    };

    const connection = await mysql.createConnection(dbConfig);
    
    const dbName = process.env.DB_NAME || 'elmowared';
    console.log(`⚡ Ensuring database "${dbName}" exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
    await connection.query(`USE ${dbName}`);

    const schemaPath = path.join(process.cwd(), 'src', 'config', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('⚡ Building Ecosystem (Tables, Views, Constraints)...');
    await connection.query(sql);
    
    console.log('✅ System initialized successfully! Ready for launch.');
    console.log('💡 TO SYNC ROLES: Run "node init-db.js" in your terminal.');
    await connection.end();
  } catch (error) {
    console.error('❌ CRITICAL ERROR during initialization:', error.message);
    process.exit(1);
  }

};

initDb();
