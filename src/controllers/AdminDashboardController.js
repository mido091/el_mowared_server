import AdminDashboardService from '../services/AdminDashboardService.js';
import OrderService from '../services/OrderService.js';
import pool from '../config/db.js';
import UserRepository from '../repositories/UserRepository.js';

class AdminDashboardController {
  /**
   * Fetches the entire non-deleted user base.
   * 
   * @async
   */
  async getUsers(req, res, next) {
    try {
      const users = await UserRepository.findAll();
      res.status(200).json(users);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves security and administrative audit logs.
   * 
   * @async
   */
  async getLogs(req, res, next) {
    try {
      // Query admin logs with admin context for the security audit view
      const [logs] = await pool.execute(`
        SELECT l.*, u.first_name, u.last_name 
        FROM admin_logs l
        JOIN users u ON l.admin_id = u.id
        ORDER BY l.created_at DESC
        LIMIT 100
      `);
      
      // Post-process for frontend compatibility (e.g., combining names)
      const formattedLogs = logs.map(log => ({
        ...log,
        admin: { full_name: `${log.first_name} ${log.last_name}` }
      }));

      res.status(200).json(formattedLogs);
    } catch (error) {
      next(error);
    }
  }

  async getTrustReport(req, res, next) {
    try {
      const report = await AdminDashboardService.getTransactionTrustReport(req.params.id, true);
      res.status(200).json({
        status: 'success',
        data: report
      });
    } catch (error) {
      console.error('Trust Report Error:', error);
      next(error);
    }
  }

  async verifyPayment(req, res, next) {
    try {
      const { status, note } = req.body;
      await OrderService.confirmPayment(req.params.id, true, status, note);
      res.status(200).json({
        status: 'success',
        message: 'Payment verification processed'
      });
    } catch (error) {
      console.error('Verify Payment Error:', error);
      next(error);
    }
  }

  async getPayments(req, res, next) {
    try {
      const [payments] = await pool.execute(`
        SELECT 
          op.id as payment_id, 
          op.order_id, 
          op.transaction_image,
          op.verification_status as payment_status, 
          op.admin_status, 
          op.created_at,
          o.total_price as amount, 
          o.deposit_amount,
          o.payment_method,
          u.first_name,
          u.last_name,
          u.email
        FROM order_payments op
        JOIN orders o ON op.order_id = o.id
        JOIN users u ON o.user_id = u.id
        ORDER BY op.created_at DESC
      `);

      const formatted = payments.map(p => ({
        id: p.payment_id,
        order_id: p.order_id,
        transaction_image: p.transaction_image,
        verification_status: p.payment_status,
        admin_status: p.admin_status,
        created_at: p.created_at,
        amount: p.amount,
        deposit_amount: p.deposit_amount,
        payment_method: p.payment_method,
        buyer: {
          full_name: p.full_name || `${p.first_name} ${p.last_name}`.trim(),
          email: p.email
        }
      }));

      res.status(200).json({
        status: 'success',
        data: formatted
      });
    } catch (error) {
      console.error('Get Payments Error:', error);
      next(error);
    }
  }

  async getVendors(req, res, next) {
    try {
      const { status } = req.query;
      
      let query = `
        SELECT v.*, u.email, u.profile_image_url, 
               (SELECT c.slug FROM categories c 
                JOIN vendor_category_junction vcj ON c.id = vcj.category_id 
                WHERE vcj.vendor_id = v.id LIMIT 1) as category
        FROM vendor_profiles v 
        JOIN users u ON v.user_id = u.id 
        WHERE v.deleted_at IS NULL
      `;
      const params = [];

      if (status && status !== 'ALL') {
        query += ` AND v.verification_status = ?`;
        params.push(status);
      }

      const [vendors] = await pool.execute(query, params);
      res.status(200).json({
        status: 'success',
        data: res.formatLocalization(vendors)
      });
    } catch (error) {
      console.error('Get Vendors Error:', error);
      next(error);
    }
  }

  async verifyVendorDirect(req, res, next) {
    try {
      const { id } = req.params;
      await pool.execute(
        `UPDATE users u
         JOIN vendor_profiles v ON v.user_id = u.id
         SET v.verification_status = 'APPROVED',
             u.is_active = TRUE,
             v.updated_at = NOW(),
             u.updated_at = NOW()
         WHERE v.id = ?`,
        [id]
      );
      res.status(200).json({
        status: 'success',
        message: 'Vendor approved successfully'
      });
    } catch (error) {
      console.error('Verify Vendor Direct Error:', error);
      next(error);
    }
  }

  async rejectVendorDirect(req, res, next) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      await pool.execute(
        `UPDATE users u
         JOIN vendor_profiles v ON v.user_id = u.id
         SET v.verification_status = 'REJECTED',
             u.is_active = FALSE,
             v.updated_at = NOW(),
             u.updated_at = NOW()
         WHERE v.id = ?`,
        [id]
      );
      // Optionally log the rejection reason
      if (reason) {
        await pool.execute(
          "INSERT INTO admin_logs (admin_id, action, details) VALUES (?, 'VENDOR_REJECTED', ?)",
          [req.user.id, `Vendor ID ${id} rejected. Reason: ${reason}`]
        ).catch(() => {}); // Don't fail if admin_logs insert fails
      }
      res.status(200).json({
        status: 'success',
        message: 'Vendor rejected successfully'
      });
    } catch (error) {
      console.error('Reject Vendor Direct Error:', error);
      next(error);
    }
  }


  async getAlerts(req, res, next) {
    try {
      const alerts = [];
      const [pendingPayments] = await pool.execute("SELECT COUNT(*) as count FROM order_payments WHERE admin_status = 'PENDING'");
      if (pendingPayments[0].count > 0) {
        alerts.push({ 
          id: 1, 
          type: 'payment', 
          titleKey: 'admin.alerts.pending_payments.title',
          descKey: 'admin.alerts.pending_payments.desc',
          params: { n: pendingPayments[0].count }
        });
      }
      
      const [pendingVendors] = await pool.execute("SELECT COUNT(*) as count FROM vendor_profiles WHERE verification_status = 'PENDING'");
      if (pendingVendors[0].count > 0) {
        alerts.push({ 
          id: 2, 
          type: 'vendor', 
          titleKey: 'admin.alerts.pending_vendors.title',
          descKey: 'admin.alerts.pending_vendors.desc',
          params: { n: pendingVendors[0].count }
        });
      }

      res.status(200).json({
        status: 'success',
        data: alerts
      });
    } catch (error) {
      console.error('Get Alerts Error:', error);
      next(error);
    }
  }
}

export default new AdminDashboardController();
