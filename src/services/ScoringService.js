import pool from '../config/db.js';

class ScoringService {
  /**
   * Recalculates and updates the total score for a specific vendor based on their
   * historic performance, response rates, and conversion successes natively.
   */
  async calculateVendorScore(vendorId) {
    const connection = await pool.getConnection();

    try {
      // 1. Fetch total RFQs received/viewed
      const [viewedLogs] = await connection.execute(
        `SELECT COUNT(*) as total_viewed FROM rfq_assignment_logs WHERE vendor_id = :vendorId`,
        { vendorId }
      );
      const totalViewed = viewedLogs[0].total_viewed || 0;

      // 2. Fetch total responses
      const [respondedLogs] = await connection.execute(
        `SELECT COUNT(*) as total_responded FROM rfq_assignment_logs 
         WHERE vendor_id = :vendorId AND action = 'RESPONDED'`,
        { vendorId }
      );
      const totalResponded = respondedLogs[0].total_responded || 0;

      // 3. Response Rate
      const responseRate = totalViewed > 0 ? (totalResponded / totalViewed) * 100 : 0;

      // 4. Conversion Rate (Offers -> Accepted)
      const [offerStats] = await connection.execute(
        `SELECT 
            COUNT(*) as total_offers,
            SUM(CASE WHEN status = 'ACCEPTED' THEN 1 ELSE 0 END) as accepted_offers
         FROM rfq_offers WHERE vendor_id = :vendorId`,
        { vendorId }
      );
      const totalOffers = offerStats[0].total_offers || 0;
      const acceptedOffers = offerStats[0].accepted_offers || 0;
      const conversionRate = totalOffers > 0 ? (acceptedOffers / totalOffers) * 100 : 0;

      // 5. Completed Deals (From vendor_stats view)
      const [dealStats] = await connection.execute(
        `SELECT total_orders FROM vendor_stats WHERE vendor_id = :vendorId`,
        { vendorId }
      );
      const completedDeals = dealStats.length > 0 ? dealStats[0].total_orders : 0;

      // 6. Response Speed (Approximation based on diff between broadcast and offer time)
      const [speedStats] = await connection.execute(
        `SELECT AVG(TIMESTAMPDIFF(MINUTE, r.created_at, o.created_at)) as avg_delay 
         FROM rfq_offers o
         JOIN rfq_requests r ON o.rfq_id = r.id
         WHERE o.vendor_id = :vendorId`,
        { vendorId }
      );
      // Default to 0 minutes if no data
      const responseSpeedAvg = speedStats[0].avg_delay ? parseInt(speedStats[0].avg_delay) : 0;

      // 7. Calculate Total Score Algorithm (Weighted Formula)
      // High response rate = up to 40 points
      // High conversion = up to 30 points
      // Deals completed = 2 points per deal (capped at 15 points)
      // Fast response = Under 10 mins (+15 points), under 60 mins (+5 points)
      
      let score = 0;
      score += (responseRate * 0.40); // 40%
      score += (conversionRate * 0.30); // 30%
      score += Math.min(completedDeals * 2, 15); // Capped 15%
      
      if (totalResponded > 0) {
        if (responseSpeedAvg < 10) score += 15;
        else if (responseSpeedAvg < 60) score += 5;
      }

      // Format decimal
      const finalScore = parseFloat(Math.min(score, 100).toFixed(2));

      // Badges system
      const badges = [];
      if (responseSpeedAvg < 30 && totalResponded > 2) badges.push('FAST_RESPONDER');
      if (conversionRate >= 20 && totalOffers > 5) badges.push('HIGH_CONVERSION');
      if (completedDeals >= 10) badges.push('TRUSTED_SUPPLIER');

      // 8. UPSERT Data into vendor_scores
      await connection.execute(
        `INSERT INTO vendor_scores 
          (vendor_id, response_speed_avg, response_rate, conversion_rate, completed_deals, badges, total_score)
         VALUES 
          (:vendorId, :responseSpeedAvg, :responseRate, :conversionRate, :completedDeals, :badges, :finalScore)
         ON DUPLICATE KEY UPDATE 
          response_speed_avg = :responseSpeedAvg,
          response_rate = :responseRate,
          conversion_rate = :conversionRate,
          completed_deals = :completedDeals,
          badges = :badges,
          total_score = :finalScore`,
        {
          vendorId,
          responseSpeedAvg,
          responseRate: responseRate.toFixed(2),
          conversionRate: conversionRate.toFixed(2),
          completedDeals,
          badges: JSON.stringify(badges),
          finalScore
        }
      );

      return {
        vendorId,
        finalScore,
        badges
      };
    } finally {
      connection.release();
    }
  }
}

export default new ScoringService();
