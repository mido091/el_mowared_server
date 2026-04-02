import pool from '../config/db.js';
import { getIO } from '../config/socket.js';

export const REALTIME_CHANNELS = {
  PUBLIC_MARKETPLACE: 'public-marketplace',
  ROLE_ADMIN: 'private-role.admin',
  ROLE_VENDOR: 'private-role.vendor',
};

class RealtimeService {
  async emitToChannels(channels = [], eventName, payload = {}) {
    const normalizedChannels = [...new Set((channels || []).filter(Boolean))];
    if (!normalizedChannels.length || !eventName) return false;

    await getIO().toMany(normalizedChannels).emit(eventName, payload);
    return true;
  }

  async emitToUser(userId, eventName, payload = {}) {
    if (!userId || !eventName) return false;
    return this.emitToChannels([`${userId}`], eventName, payload);
  }

  async emitToUsers(userIds = [], eventName, payload = {}) {
    const channels = (userIds || []).filter(Boolean).map((userId) => `${userId}`);
    return this.emitToChannels(channels, eventName, payload);
  }

  async emitToRole(roleKey, eventName, payload = {}) {
    const normalizedRole = `${roleKey || ''}`.trim().toLowerCase();
    if (!normalizedRole || !eventName) return false;
    return this.emitToChannels([`private-role.${normalizedRole}`], eventName, payload);
  }

  async emitToMarketplace(eventName, payload = {}) {
    return this.emitToChannels([REALTIME_CHANNELS.PUBLIC_MARKETPLACE], eventName, payload);
  }

  async emitDashboardMetricsChanged({ admin = false, vendorUserIds = [], marketplace = false, payload = {} } = {}) {
    const jobs = [];

    if (admin) {
      jobs.push(this.emitToRole('admin', 'dashboard.metrics.changed', { scope: 'admin', ...payload }));
    }

    if (Array.isArray(vendorUserIds) && vendorUserIds.length) {
      jobs.push(this.emitToUsers(vendorUserIds, 'dashboard.metrics.changed', { scope: 'vendor', ...payload }));
    }

    if (marketplace) {
      jobs.push(this.emitToMarketplace('dashboard.metrics.changed', { scope: 'marketplace', ...payload }));
    }

    await Promise.allSettled(jobs);
  }

  async getAdminUserIds() {
    const [rows] = await pool.execute(
      `SELECT id FROM users WHERE role IN ('ADMIN', 'OWNER') AND is_active = 1 LIMIT 50`
    );
    return rows.map((row) => Number(row.id)).filter(Boolean);
  }
}

export default new RealtimeService();
