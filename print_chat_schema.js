import pool from './src/config/db.js';
import fs from 'fs';

(async () => {
  try {
    const [convCols] = await pool.query("DESCRIBE conversations");
    const [msgCols] = await pool.query("DESCRIBE messages");
    let cpCols = null;
    try {
      [cpCols] = await pool.query("DESCRIBE conversation_participants");
    } catch(e) {}

    fs.writeFileSync('schema.json', JSON.stringify({
      conversations: convCols,
      messages: msgCols,
      conversation_participants: cpCols
    }, null, 2), 'utf-8');

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    process.exit(0);
  }
})();
