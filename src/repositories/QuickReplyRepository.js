import pool from '../config/db.js';

class QuickReplyRepository {
  async create({ userId, category, title, content }) {
    const sql = `
      INSERT INTO quick_replies (user_id, category, title, content, created_at, updated_at)
      VALUES (:userId, :category, :title, :content, NOW(), NOW())
    `;
    const [result] = await pool.execute(sql, { userId, category: category || 'general', title, content });
    return { id: result.insertId, userId, category, title, content };
  }

  async findAllByUser(userId) {
    const sql = `
      SELECT * FROM quick_replies 
      WHERE user_id = :userId 
      ORDER BY created_at DESC
    `;
    const [rows] = await pool.execute(sql, { userId });
    return rows;
  }

  async delete(id, userId) {
    const sql = `
      DELETE FROM quick_replies 
      WHERE id = :id AND user_id = :userId
    `;
    const [result] = await pool.execute(sql, { id, userId });
    return result.affectedRows > 0;
  }
}

export default new QuickReplyRepository();
