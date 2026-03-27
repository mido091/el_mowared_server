import pool from './src/config/db.js';

async function check() {
  try {
    const [convs] = await pool.execute('SELECT * FROM conversations');
    console.log('TOTAL CONVERSATIONS:', convs.length);
    console.log('TYPES:', [...new Set(convs.map(c => c.type))]);
    
    // Check specific user visibility
    const userId = 1; // Assuming 1 for now, or we can look for any admin
    const [admins] = await pool.execute("SELECT id, role FROM users WHERE role IN ('ADMIN', 'OWNER')");
    console.log('ADMINS/OWNERS:', admins.map(a => `${a.id} (${a.role})`));
    
    for (const admin of admins) {
      const [visible] = await pool.execute(
        `SELECT COUNT(*) as count FROM conversations c WHERE c.user_id = ? OR c.type IN ('SUPPORT', 'INTERNAL')`,
        [admin.id]
      );
      console.log(`User ${admin.id} (${admin.role}) sees ${visible[0].count} conversations with current logic`);
    }
    
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
