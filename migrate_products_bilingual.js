import pool from './src/config/db.js';

async function migrate() {
  try {
    console.log('🚀 Starting Database Migration: Renaming Product Columns...');
    
    // Using CHANGE COLUMN for maximum compatibility
    const queries = [
      'ALTER TABLE products CHANGE COLUMN title_ar name_ar VARCHAR(255)',
      'ALTER TABLE products CHANGE COLUMN title_en name_en VARCHAR(255)',
      'ALTER TABLE products CHANGE COLUMN desc_ar description_ar TEXT',
      'ALTER TABLE products CHANGE COLUMN desc_en description_en TEXT'
    ];

    for (const query of queries) {
      console.log(`Executing: ${query}`);
      try {
        await pool.query(query);
      } catch (e) {
        if (e.code === 'ER_BAD_FIELD_ERROR') {
          console.log(`⚠️ Column already renamed or missing. Skipping...`);
        } else {
          throw e;
        }
      }
    }

    console.log('✅ Migration Successful!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration Failed:', error);
    process.exit(1);
  }
}

migrate();
