import request from 'supertest';
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// 1. Environment Guard: Force 'test' mode to prevent production pollution.
process.env.NODE_ENV = 'test';

// 2. Mocking Cloudinary BEFORE importing app
// We need to track 'upload' for products and profiles, and 'destroy' for cleanup.
const mockCloudinary = {
  config: jest.fn(),
  uploader: {
    upload_stream: jest.fn((options, callback) => {
      // console.log('MOCK Cloudinary upload_stream called');
      // Mock successful upload stream
      callback(null, { 
        secure_url: 'https://res.cloudinary.com/test/image.jpg',
        public_id: 'test_public_id' 
      });
      return { end: jest.fn() };
    }),
    destroy: jest.fn().mockResolvedValue({ result: 'ok' })
  }
};

// Target the internal config file which exports the cloudinary instance
jest.unstable_mockModule('../src/config/cloudinary.js', () => ({
  default: mockCloudinary
}));

// Dynamic import of app and pool to ensure mocks are applied correctly.
const { app, pool } = await import('../index.js');
// IMPORT THE MOCKED INSTANCE TO USE FOR EXPECTATIONS
const { default: actualMockCloudinary } = await import('../src/config/cloudinary.js');
const { isApprovedVendor } = await import('../src/middlewares/vendorGuard.js');

describe('🚀 Elmowared Full-Cycle Platform Verification', () => {
  let userId, categoryId, mowaredId, saleProductId;
  let testProductId;
  const timestamp = Date.now();
  jest.setTimeout(15000); // 15 seconds for complex flows

  beforeAll(async () => {
    // 3. Database Sync: Ensure connection is healthy before seeding.
    const conn = await pool.getConnection();
    conn.release();

    const [catResult] = await pool.execute(
      'INSERT INTO categories (name_ar, name_en, slug) VALUES (?, ?, ?)',
      [`تصنيف_${timestamp}`, `Category_${timestamp}`, `cat-${timestamp}`]
    );
    categoryId = catResult.insertId;
  });

  afterAll(async () => {
    // 4. Resource Cleanup: Graceful shutdown of persistent connections.
    await pool.end();
  });

  describe('🔐 Authentication & Role Management', () => {
    test('Should register and login a regular User', async () => {
      const email = `user_${timestamp}@example.com`;
      const res = await request(app)
        .post('/api/v1/auth/register/user')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email,
          phone: '01234567890',
          password: 'password123'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(email);
      
      // Get the OTP from the database
      const [otpRows] = await pool.execute('SELECT otp_hash FROM verification_codes WHERE email = ? AND type = "REGISTRATION" ORDER BY created_at DESC LIMIT 1', [email]);
      
      // We don't have the plaintext OTP, but auth tests usually bypass or we can force verify.
      // Let's force verify the user directly in DB to get a token via login,
      // as we don't have the plaintext OTP to submit to the verify endpoint.
      await pool.execute('UPDATE users SET is_active = TRUE WHERE email = ?', [email]);
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' });

      userToken = loginRes.body.data.token;
      userId = loginRes.body.data.user.id;
    });

    test('Should register and login a Mowared (Vendor)', async () => {
      const email = `vendor_${timestamp}@example.com`;
      const res = await request(app)
        .post('/api/v1/auth/register/mowared')
        .send({
          firstName: 'Mowared',
          lastName: 'Vendor',
          email,
          phone: '01234567891',
          password: 'password123',
          companyNameAr: 'شركة المورد',
          companyNameEn: 'Mowared Co',
          categoryIds: [categoryId]
        });

      expect(res.status).toBe(200);
      
      // Force verify the vendor
      await pool.execute('UPDATE users SET is_active = TRUE WHERE email = ?', [email]);
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' });

      mowaredToken = loginRes.body.data.token;
      const mUserId = loginRes.body.data.user.id;
      
      // Capture Mowared Profile ID for RFQ tests
      const [vRows] = await pool.execute('SELECT id FROM vendor_profiles WHERE user_id = ?', [mUserId]);
      mowaredId = vRows[0].id;
    });

    test('Should register/login an Owner (Platform Controller)', async () => {
      const regEmail = `owner_real_${timestamp}@example.com`;
      await request(app).post('/api/v1/auth/register/user').send({
        firstName: 'Master', lastName: 'Owner', email: regEmail, phone: '01234567892', password: 'password123'
      });
      
      // Promotion via direct SQL and activate
      await pool.execute("UPDATE users SET role = 'OWNER', is_active = TRUE WHERE email = ?", [regEmail]);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: regEmail, password: 'password123' });

      expect(res.status).toBe(200);
      ownerToken = res.body.data.token;
    });
  });

  describe('👑 Owner & Admin Privileges', () => {
    test('Should escalate a regular User to ADMIN role', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/users/${userId}/role`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      
      const checkRes = await pool.execute('SELECT role FROM users WHERE id = ?', [userId]);
      expect(checkRes[0][0].role).toBe('ADMIN');
    });

    test('Should update global site settings (Site Name)', async () => {
      const res = await request(app)
        .patch('/api/v1/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          settings: [{ key: 'site_name', value: 'Elmowared Corporate' }]
        });

      if (res.status !== 200) console.error('Settings update failed:', res.body);
      expect(res.status).toBe(200);
    });
  });

  describe('📦 Mowared Workflow (Product Lifecycle)', () => {
    test('Should reject product creation if required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${mowaredToken}`)
        .send({
          titleAr: 'ناقص',
          // missing titleEn, price, etc.
        });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe('fail');
    });

    test('Should create a product with bilingual fields', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${mowaredToken}`)
        .field('titleAr', 'منتج تجريبي ' + Date.now())
        .field('titleEn', 'Test Product ' + Date.now())
        .field('descAr', 'وصف طويل للحديد')
        .field('descEn', 'Long description of iron')
        .field('categoryId', categoryId)
        .field('price', 500)
        .field('location', 'Cairo')
        .field('minOrderQuantity', 10)
        .attach('images', Buffer.from('fake_image_data'), 'test.jpg');
  
      expect(res.status).toBe(201);
      testProductId = res.body.data.id;
    });

    test('Should return correct pagination metadata', async () => {
      const res = await request(app)
        .get('/api/v1/products?page=1&limit=5');

      expect(res.status).toBe(200);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.currentPage).toBe(1);
      expect(res.body.data.pagination.itemsPerPage).toBe(5);
      expect(res.body.data.pagination.totalItems).toBeGreaterThan(0);
    });

    test('Should search products with partial Arabic words', async () => {
      const res = await request(app)
        .get('/api/v1/products?search=حد');

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });

    test('Should filter products by price and location', async () => {
      const res = await request(app)
        .get('/api/v1/products?minPrice=400&maxPrice=600&location=Cairo');

      expect(res.status).toBe(200);
      expect(parseFloat(res.body.data.items[0].price)).toBeGreaterThanOrEqual(400);
    });

    test('Should perform a Soft Delete on the product', async () => {
      const res = await request(app)
        .delete(`/api/v1/products/${testProductId}`)
        .set('Authorization', `Bearer ${mowaredToken}`);

      expect(res.status).toBe(204);

      // Verify it's hidden from public search
      const searchRes = await request(app).get('/api/v1/products');
      const found = searchRes.body.data.items.find(p => p.id === testProductId);
      expect(found).toBeUndefined();

      // Verify it still exists in DB with deleted_at set
      const [dbRes] = await pool.execute('SELECT deleted_at FROM products WHERE id = ?', [testProductId]);
      expect(dbRes[0].deleted_at).not.toBeNull();
    });
  });

  describe('💸 Escrow & Order Lifecycle', () => {
    let orderId;

    test('Should setup product for purchase', async () => {
      const prodRes = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${mowaredToken}`)
        .field('titleAr', 'منتج للبيع ' + timestamp)
        .field('titleEn', 'Product for Sale ' + timestamp)
        .field('descAr', 'وصف منتج البيع بالتفصيل')
        .field('descEn', 'Detailed description of sale product')
        .field('categoryId', categoryId)
        .field('price', 1000)
        .field('minOrderQuantity', 1)
        .field('location', 'Giza')
        .attach('images', Buffer.from('sale_product_image'), 'sale.jpg');

      expect(prodRes.status).toBe(201);
      saleProductId = prodRes.body.data.id;
    });

    test('Should add product to cart', async () => {
      const res = await request(app)
        .post('/api/v1/cart')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ productId: saleProductId, quantity: 2 });

      expect(res.status).toBe(201);
    });

    test('Should process Checkout flow safely', async () => {
      const checkoutRes = await request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ paymentMethod: 'INSTAPAY', depositAmount: 200 });

      expect(checkoutRes.status).toBe(201);
      expect(checkoutRes.body.data.orderIds).toBeDefined();
      orderId = checkoutRes.body.data.orderIds[0];
    });

    test('Should handle Receipt Upload with Cloudinary intercept', async () => {
      const res = await request(app)
        .post(`/api/v1/orders/${orderId}/receipt`)
        .set('Authorization', `Bearer ${userToken}`)
        .attach('receipt', Buffer.from('fake_receipt_data'), 'receipt.jpg');

      expect(res.status).toBe(200);
      expect(actualMockCloudinary.uploader.upload_stream).toHaveBeenCalled();
    });

    test('Should allow Admin to Verify payment and move to PROCESSING', async () => {
      const res = await request(app)
        .patch(`/api/v1/orders/${orderId}/confirm-payment`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'VERIFIED', note: 'Looks good' });

      expect(res.status).toBe(200);

      // Verify final status
      const [orderRes] = await pool.execute('SELECT status FROM orders WHERE id = ?', [orderId]);
      expect(orderRes[0].status).toBe('PROCESSING');
    });
  });

  describe('🖼️ Performance & Integrity', () => {
    test('Should handle Profile Image update and old asset deletion', async () => {
      // 1. Initial upload
      const res1 = await request(app)
        .put('/api/v1/user/profile/image')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('image', Buffer.from('initial_image'), 'avatar1.jpg');

      expect(res1.status).toBe(200);
      expect(actualMockCloudinary.uploader.upload_stream).toHaveBeenCalled();
      
      // Reset mocks to track the second call
      actualMockCloudinary.uploader.upload_stream.mockClear();
      actualMockCloudinary.uploader.destroy.mockClear();

      // 2. Second upload (Replacement)
      const res2 = await request(app)
        .put('/api/v1/user/profile/image')
        .set('Authorization', `Bearer ${userToken}`)
        .attach('image', Buffer.from('new_image'), 'avatar2.jpg');

      expect(res2.status).toBe(200);
      expect(actualMockCloudinary.uploader.upload_stream).toHaveBeenCalled();
      // Integrity Check: Cloudinary.destroy must be called for the old image ID
      expect(actualMockCloudinary.uploader.destroy).toHaveBeenCalledWith('test_public_id');
    });
  });

  describe('🔒 Security Guards', () => {
    test('Should block USER from accessing Owner routes', async () => {
      const res = await request(app)
        .patch('/api/v1/owner/update-me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ firstName: 'Hacker' });

      expect(res.status).toBe(403);
    });
  });

  describe('🛠️ Advanced QA & Technical Rigor', () => {
    test('Critical: Should rollback User creation if Vendor profile fails (Transaction Integrity)', async () => {
      const email = `fail_tx_${timestamp}@example.com`;
      const res = await request(app)
        .post('/api/v1/auth/register/mowared')
        .send({
          firstName: 'Fail',
          lastName: 'Tx',
          email,
          phone: '01234567895',
          password: 'password123',
          companyNameAr: 'فشل',
          companyNameEn: 'Fail Co',
          categoryIds: [999999] // Non-existent category to trigger FK failure
        });

      expect(res.status).toBeGreaterThanOrEqual(400);
      
      // Verify rollback: User should NOT exist in DB
      const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
      expect(rows.length).toBe(0);
    });

    test('Should block unapproved Mowared from creating products', async () => {
      // 1. Register a new Mowared
      const email = `pending_${timestamp}@example.com`;
      const regRes = await request(app)
        .post('/api/v1/auth/register/mowared')
        .send({
          firstName: 'Pending',
          lastName: 'Vendor',
          email,
          phone: '01234567896',
          password: 'password123',
          companyNameAr: 'قيد المراجعة',
          companyNameEn: 'Pending Co',
          categoryIds: [categoryId]
        });

      const token = regRes.body.data.token;
      const userId = regRes.body.data.user.id;

      // 2. Manually set to PENDING (downgrade from default 'APPROVED' for testing)
      await pool.execute("UPDATE vendor_profiles SET verification_status = 'PENDING' WHERE user_id = ?", [userId]);

      // 3. Try to create product
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${token}`)
        .field('titleAr', 'يجب أن يفشل')
        .field('titleEn', 'Should Fail')
        .field('categoryId', categoryId)
        .field('price', 100)
        .field('location', 'Cairo')
        .attach('images', Buffer.from('data'), 'test.jpg');

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('pending review');
    });

    test('Should persist Chat conversations and messages correctly', async () => {
      const email = `chat_user_${timestamp}@example.com`;
      await request(app).post('/api/v1/auth/register/user').send({
        firstName: 'Chatter', lastName: 'Doe', email, phone: '01234567897', password: 'password123'
      });
      await pool.execute('UPDATE users SET is_active = TRUE WHERE email = ?', [email]);
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'password123' });
      const cToken = loginRes.body.data.token;
      const cUserId = loginRes.body.data.user.id;

      // Start a manual inquiry via API
      const res = await request(app)
        .post('/api/v1/chats/start')
        .set('Authorization', `Bearer ${cToken}`)
        .send({
          vendorId: 1, // Assuming vendor 1 exists (the one we created in Phase 2)
          messageText: 'Hello, I am interested in your iron products.',
          productId: testProductId
        });

      expect(res.status).toBe(201);
      
      // Verify persistence in DB
      const [conv] = await pool.execute('SELECT * FROM conversations WHERE user_id = ?', [cUserId]);
      expect(conv.length).toBe(1);
      
      const [msg] = await pool.execute('SELECT * FROM messages WHERE conversation_id = ?', [conv[0].id]);
      expect(msg.length).toBe(1);
      expect(msg[0].message_text).toBe('Hello, I am interested in your iron products.');
    });
  });

  describe('🏁 Phase 7: Production Finalization Verification', () => {
    let p7UserToken, p7MowaredToken, p7UserId, p7CategoryId, p7ProductId;

    test('Should setup fresh environment for Phase 7', async () => {
      // 1. Fresh Category
      const [cat] = await pool.execute("INSERT INTO categories (name_ar, name_en, slug) VALUES ('P7_AR', 'P7_EN', ?)", [`p7-${Date.now()}`]);
      p7CategoryId = cat.insertId;

      // 2. Fresh User
      const uEmail = `p7u_${Date.now()}@test.com`;
      await request(app).post('/api/v1/auth/register/user').send({
        firstName: 'P7', lastName: 'User', email: uEmail, phone: '01000000007', password: 'password123'
      });
      await pool.execute('UPDATE users SET is_active = TRUE WHERE email = ?', [uEmail]);
      const uLoginRes = await request(app).post('/api/v1/auth/login').send({ email: uEmail, password: 'password123' });
      p7UserToken = uLoginRes.body.data.token;
      p7UserId = uLoginRes.body.data.user.id;

      // 3. Fresh Mowared & Manual Approval
      const mEmail = `p7m_${Date.now()}@test.com`;
      await request(app).post('/api/v1/auth/register/mowared').send({
        firstName: 'P7', lastName: 'Vendor', email: mEmail, phone: '01000000008', password: 'password123',
        companyNameAr: 'P7 Ar', companyNameEn: 'P7 En', categoryIds: [p7CategoryId]
      });
      await pool.execute('UPDATE users SET is_active = TRUE WHERE email = ?', [mEmail]);
      const mLoginRes = await request(app).post('/api/v1/auth/login').send({ email: mEmail, password: 'password123' });
      p7MowaredToken = mLoginRes.body.data.token;
      const vId = mLoginRes.body.data.user.id;
      
      // Force Approval to bypass gate
      await pool.execute("UPDATE vendor_profiles SET verification_status = 'APPROVED' WHERE user_id = ?", [vId]);

      // 4. Fresh Product (Long descriptions for Zod)
      const pRes = await request(app).post('/api/v1/products').set('Authorization', `Bearer ${p7MowaredToken}`)
        .field('titleAr', 'P7 Product Ar').field('titleEn', 'P7 Product En')
        .field('descAr', 'Description is long enough in Arabic')
        .field('descEn', 'Description is long enough in English')
        .field('categoryId', p7CategoryId).field('price', 1000).field('minOrderQuantity', 1);
      
      if (pRes.status !== 201) {
        console.error('P7 Product Error:', pRes.body);
      }
      expect(pRes.status).toBe(201);
      p7ProductId = pRes.body.data.id;
    });

    test('Should verify Site Settings seed data (Public)', async () => {
      // Note: We expect 'Elmowared Marketplace' or the updated one from previous test.
      const res = await request(app).get('/api/v1/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.site_name).toBeDefined();
    });

    test('Should verify Cart persistence and CRUD', async () => {
      // 1. Add item
      await request(app)
        .post('/api/v1/cart')
        .set('Authorization', `Bearer ${p7UserToken}`)
        .send({ productId: p7ProductId, quantity: 5 });

      // 2. Fetch from DB
      const [rows] = await pool.execute('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?', [p7UserId, p7ProductId]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].quantity).toBe(5);

      // 3. Update quantity
      const cartItemId = rows[0].id;
      await request(app)
        .put(`/api/v1/cart/${cartItemId}`)
        .set('Authorization', `Bearer ${p7UserToken}`)
        .send({ quantity: 10 });

      const [updatedRows] = await pool.execute('SELECT quantity FROM cart_items WHERE id = ?', [cartItemId]);
      expect(updatedRows[0].quantity).toBe(10);
    });

    test('Should enforce 10% Escrow deposit during checkout', async () => {
      // Checkout (Total = 1000 * 2 = 2000)
      await pool.execute('DELETE FROM cart_items WHERE user_id = ?', [p7UserId]);
      await request(app).post('/api/v1/cart').set('Authorization', `Bearer ${p7UserToken}`).send({ productId: p7ProductId, quantity: 2 });

      const res = await request(app)
        .post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${p7UserToken}`)
        .send({ paymentMethod: 'WALLET' });

      expect(res.status).toBe(201);
      const orderId = res.body.data.orderIds[0];

      const [order] = await pool.execute('SELECT deposit_amount FROM orders WHERE id = ?', [orderId]);
      expect(parseFloat(order[0].deposit_amount)).toBe(200);
    });

    test('Should block reviews for non-COMPLETED orders', async () => {
      // 1. Create a fresh order (Re-add item first as previous test cleared it)
      await request(app)
        .post('/api/v1/cart')
        .set('Authorization', `Bearer ${p7UserToken}`)
        .send({ productId: p7ProductId, quantity: 2 });

      const res = await request(app).post('/api/v1/orders/checkout')
        .set('Authorization', `Bearer ${p7UserToken}`).send({ paymentMethod: 'COD' });
      const orderId = res.body.data.orderIds[0];

      // 2. Try to review
      const reviewRes = await request(app)
        .post('/api/v1/reviews')
        .set('Authorization', `Bearer ${p7UserToken}`)
        .send({ orderId, rating: 5, comment: 'Excellent' });

      expect(reviewRes.status).toBe(403);
      expect(reviewRes.body.message).toContain('after order completion');
    });
  });

  describe('🛡️ Phase 8: B2B RFQ & Search Optimization', () => {
    let rfqId;

    it('Should filter products by JSON technical specs', async () => {
      // Create a product with specific specs
      const productRes = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${mowaredToken}`)
        .field('titleAr', 'كاميرا مراقبة 4K')
        .field('titleEn', '4K Security Camera')
        .field('descAr', 'وصف الكاميرا')
        .field('descEn', 'Camera Description')
        .field('categoryId', categoryId)
        .field('price', 1500)
        .field('specs', JSON.stringify({ resolution: '4K', infrared: true }));

      expect(productRes.status).toBe(201);

      // Search with exact JSON spec match
      const searchRes = await request(app)
        .get(`/api/v1/products?specs=${encodeURIComponent(JSON.stringify({ resolution: '4K' }))}`);
      
      expect(searchRes.status).toBe(200);
      expect(searchRes.body.data.items.length).toBeGreaterThan(0);
      expect(searchRes.body.data.items[0].title_en).toBe('4K Security Camera');
    });

    it('Should initialize an RFQ and trigger Chat RFQ Card', async () => {
      const rfqRes = await request(app)
        .post('/api/v1/quotes/request')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          productId: saleProductId,
          vendorId: mowaredId,
          requestedQuantity: 50,
          targetPrice: 95,
          notes: 'Looking for a bulk discount'
        });

      expect(rfqRes.status).toBe(201);
      expect(rfqRes.body.data.quote.status).toBe('PENDING');
      rfqId = rfqRes.body.data.quote.id;

      // Verify Chat Integration: Check if a conversation was created/updated
      const chatRes = await request(app)
        .get('/api/v1/chats/conversations')
        .set('Authorization', `Bearer ${userToken}`);
      
      expect(chatRes.status).toBe(200);
      const conv = chatRes.body.data.find(c => c.product_id === saleProductId);
      expect(conv).toBeDefined();
      expect(conv.last_msg_text).toContain('[RFQ]');
    });

    it('Should allow Vendor to respond to RFQ with an offer', async () => {
      const respondRes = await request(app)
        .post(`/api/v1/quotes/${rfqId}/respond`)
        .set('Authorization', `Bearer ${mowaredToken}`)
        .send({
          status: 'OFFERED',
          notes: 'We can do 98 EGP per unit for 50 units.'
        });

      expect(respondRes.status).toBe(200);
      expect(respondRes.body.data.quote.status).toBe('OFFERED');
    });
  });

  describe('🎬 Phase 9: B2B Marketplace & Comparison Engine', () => {
    let marketerToken, marketerId, rfqId, offerId, catId, p1Id, p2Id;

    test('Should register a Marketer and verify role', async () => {
      const email = `marketer_${Date.now()}@test.com`;
      await request(app).post('/api/v1/auth/register/user').send({
        firstName: 'Mark', lastName: 'Affiliate', email, phone: '01011111111', password: 'password123'
      });
      await pool.execute('UPDATE users SET is_active = TRUE WHERE email = ?', [email]);
      const loginRes = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
      marketerToken = loginRes.body.data.token;
      marketerId = loginRes.body.data.user.id;
      
      // Manually set role to MARKETER in DB for testing
      await pool.execute("UPDATE users SET role = 'MARKETER' WHERE id = :id", { id: marketerId });
      
      const [user] = await pool.execute('SELECT role FROM users WHERE id = ?', [marketerId]);
      expect(user[0].role).toBe('MARKETER');
    });

    test('Should allow User to create a Category RFQ', async () => {
      // 1. Setup Category
      const [cat] = await pool.execute("INSERT INTO categories (name_ar, name_en, slug) VALUES ('Phase9_AR', 'Phase9_EN', ?)", [`p9-${Date.now()}`]);
      catId = cat.insertId;

      const res = await request(app)
        .post('/api/v1/rfq')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          categoryId: catId,
          title: 'Looking for 50 Managed Switches',
          description: 'Need POE L2 managed switches with 24 ports minimum.',
          quantity: 50,
          targetPrice: 25000
        });

      expect(res.status).toBe(201);
      rfqId = res.body.data.id;
      expect(res.body.data.status).toBe('OPEN');
    });

    test('Should allow Vendor to submit an Offer', async () => {
      const res = await request(app)
        .post(`/api/v1/rfq/${rfqId}/offers`)
        .set('Authorization', `Bearer ${mowaredToken}`)
        .send({
          offeredPrice: 22000,
          deliveryTime: '10 Days',
          notes: 'Special price for Elmowared users.'
        });

      expect(res.status).toBe(201);
      offerId = res.body.data.id;
      expect(res.body.data.status).toBe('PENDING');
    });

    test('Should allow User to accept Offer and track Marketer', async () => {
      const res = await request(app)
        .patch(`/api/v1/rfq/offers/${offerId}/accept`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ marketerId: marketerId });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ORDER_CREATED');
      
      const [order] = await pool.execute('SELECT referred_by_marketer_id FROM orders WHERE id = ?', [res.body.data.orderId]);
      expect(order[0].referred_by_marketer_id).toBe(marketerId);
    });

    test('Should compare multiple products', async () => {
      // 1. Create two products to compare
      const p1 = await request(app).post('/api/v1/products').set('Authorization', `Bearer ${mowaredToken}`)
        .field('titleAr', 'P9-1').field('titleEn', 'P9-1')
        .field('descAr', 'Compare 1 long description').field('descEn', 'Compare 1 long description')
        .field('categoryId', catId).field('price', 500).field('minOrderQuantity', 1);
      p1Id = p1.body.data.id;

      const p2 = await request(app).post('/api/v1/products').set('Authorization', `Bearer ${mowaredToken}`)
        .field('titleAr', 'P9-2').field('titleEn', 'P9-2')
        .field('descAr', 'Compare 2 long description').field('descEn', 'Compare 2 long description')
        .field('categoryId', catId).field('price', 600).field('minOrderQuantity', 1);
      p2Id = p2.body.data.id;

      const res = await request(app)
        .get(`/api/v1/products/compare?ids=${p1Id},${p2Id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.find(p => p.id === p1Id).price).toBe("500.00");
    });
  });
});
