
import pool from './src/config/db.js';

async function migrate() {
  try {
    console.log('Adding missing columns to conversations table...');
    
    // Standard ALTER TABLE ADD COLUMN
    const columns = [
      { name: 'support_requested_at', type: 'DATETIME NULL', after: 'chat_status' },
      { name: 'assigned_at', type: 'DATETIME NULL', after: 'support_requested_at' },
      { name: 'first_response_at', type: 'DATETIME NULL', after: 'assigned_at' },
      { name: 'first_response_seconds', type: 'INT NULL', after: 'first_response_at' },
      { name: 'resolved_at', type: 'DATETIME NULL', after: 'closed_at' },
      { name: 'resolution_seconds', type: 'INT NULL', after: 'resolved_at' }
    ];

    for (const col of columns) {
      try {
        const query = `ALTER TABLE conversations ADD COLUMN ${col.name} ${col.type} AFTER ${col.after}`;
        await pool.query(query);
        console.log(`Added column: ${col.name}`);
      } catch (err) {
        if (err.code === 'ER_DUP_COLUMN_NAME') {
          console.log(`Column already exists: ${col.name}`);
        } else {
          console.error(`Failed to add ${col.name}:`, err.message);
        }
      }
    }

    console.log('Migration process finished.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    process.exit();
  }
}

migrate();
