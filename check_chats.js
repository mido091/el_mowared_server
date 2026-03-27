
import pool from './src/config/db.js';

async function checkChats() {
  try {
    const [rows] = await pool.execute("SELECT id, type, status, user_id, admin_id FROM conversations WHERE type = 'SUPPORT'");
    console.log('Support Chats:', rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkChats();
