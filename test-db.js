import pool from './src/config/db.js';

async function test() {
  const connection = await pool.getConnection();
  try {
    const errorBody = {
      vendorId: 1,
      categoryId: 1,
      name_ar: 'موبايل',
      name_en: 'mobile',
      description_ar: 'مواصفات الموبايل',
      description_en: 'mobile rev',
      slug: 'mobile-test-' + Date.now(),
      price: 50,
      discountPrice: 500,
      minOrderQuantity: 10,
      location: null,
      specs: '[{\"key_ar\":\"رام\",\"key_en\":\"ram\",\"value_ar\":\"8\",\"value_en\":\"8\"}]'
    };
    
    const columns = ['vendor_id', 'category_id', 'name_ar', 'name_en', 'description_ar', 'description_en', 'slug', 'price', 'discount_price', 'min_order_quantity', 'location', 'specs', 'lifecycle_status'];
    const values = [':vendorId', ':categoryId', ':name_ar', ':name_en', ':description_ar', ':description_en', ':slug', ':price', ':discountPrice', ':minOrderQuantity', ':location', ':specs', '\'PENDING\''];
    columns.push('status');
    values.push('\'DRAFT\'');
    columns.push('created_at', 'updated_at');
    values.push('NOW()', 'NOW()');
    
    // Check is_visible
    columns.push('is_visible');
    values.push('0');

    const sql = `INSERT INTO products (${columns.join(', ')}) VALUES (${values.join(', ')})`;
    console.log(sql);
    
    const [result] = await connection.execute(sql, errorBody);
    console.log('SUCCESS', result.insertId);
  } catch(e) { 
    console.error('RAW_ERROR_MESSAGE:', e.message); 
    console.error('RAW_ERROR_SQL:', e.sqlMessage); 
    console.error('RAW_ERROR_CODE:', e.code); 
  } finally {
    connection.release();
    process.exit(0);
  }
}

test();
