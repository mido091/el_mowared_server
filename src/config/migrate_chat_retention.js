/**
 * @file migrate_chat_retention.js
 * @description Safe migration to add retention and status tracking columns to the conversations table.
 * Run with: node src/config/migrate_chat_retention.js
 */

import pool from './db.js';

async function migrate() {
  const connection = await pool.getConnection();
  try {
    console.log('Starting chat retention migration...');

    // 1. Add `status` column
    try {
      await connection.query(`
        ALTER TABLE conversations 
        ADD COLUMN status ENUM('active', 'assigned', 'waiting', 'idle', 'closed', 'archived') DEFAULT 'active'
      `);
      console.log('Added `status` column to conversations.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log('`status` column already exists.');
      else throw e;
    }

    // 2. Add `last_activity_at` column
    try {
      await connection.query(`
        ALTER TABLE conversations 
        ADD COLUMN last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('Added `last_activity_at` column to conversations.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log('`last_activity_at` column already exists.');
      else throw e;
    }

    // 3. Add `closed_at` column
    try {
      await connection.query(`
        ALTER TABLE conversations 
        ADD COLUMN closed_at DATETIME NULL
      `);
      console.log('Added `closed_at` column to conversations.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log('`closed_at` column already exists.');
      else throw e;
    }

    // 4. Add `archived_at` column
    try {
      await connection.query(`
        ALTER TABLE conversations 
        ADD COLUMN archived_at DATETIME NULL
      `);
      console.log('Added `archived_at` column to conversations.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log('`archived_at` column already exists.');
      else throw e;
    }
    
    // 5. Add `deleted_at` to messages table, just in case (the job updates this for soft-deletion)
    try {
      await connection.query(`
        ALTER TABLE messages 
        ADD COLUMN deleted_at DATETIME NULL
      `);
      console.log('Added `deleted_at` column to messages.');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log('`deleted_at` column already exists in messages.');
      else throw e;
    }

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    connection.release();
    process.exit(0);
  }
}

migrate();
