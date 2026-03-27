import pool from './src/config/db.js';

(async () => {
  try {
    const [rows] = await pool.execute("SELECT * FROM users WHERE email='mowared@gmail.com'");
    console.log("USER:", rows[0]);
    if (!rows[0]) return;
    
    const [vm] = await pool.execute('SELECT * FROM vendor_profiles WHERE user_id=' + rows[0].id);
    console.log("VENDOR PROFILE:", vm[0]);
    
    if (vm[0]) {
       const [stats] = await pool.execute('SELECT * FROM vendor_stats WHERE vendor_id=' + vm[0].id);
       console.log("VENDOR STATS:", stats[0]);
    }
  } catch (err) {
    console.error(err.message);
  } finally {
    process.exit(0);
  }
})();
