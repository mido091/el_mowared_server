import DashboardMetricsService from '../services/DashboardMetricsService.js';
import logger from '../utils/logger.js';

class StatsController {
  async getDashboardStats(req, res, next) {
    try {
      const stats = await DashboardMetricsService.getAdminDashboardStats({ force: true });
      res.status(200).json({
        status: 'success',
        data: stats
      });
    } catch (error) {
      logger.error('Get dashboard stats error', {
        message: error.message,
        stack: error.stack
      });
      next(error);
    }
  }
}

export default new StatsController();
