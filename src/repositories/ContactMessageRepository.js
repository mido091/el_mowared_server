import pool from '../config/db.js';

class ContactMessageRepository {
  async create({ name, email, phone, message }, connection = pool) {
    const sql = `
      INSERT INTO contact_messages (name, email, phone, message, status, created_at, updated_at)
      VALUES (:name, :email, :phone, :message, 'new', NOW(), NOW())
    `;
    const [result] = await connection.execute(sql, { name, email, phone: phone || null, message });
    return { id: result.insertId, name, email, phone, status: 'new' };
  }

  async findAll(connection = pool) {
    const sql = `
      SELECT * FROM contact_messages 
      ORDER BY created_at DESC
    `;
    const [rows] = await connection.execute(sql);
    return rows;
  }

  async updateStatus(id, status, connection = pool) {
    const sql = `
      UPDATE contact_messages 
      SET status = :status, updated_at = NOW() 
      WHERE id = :id
    `;
    await connection.execute(sql, { id, status });
  }

  async findById(id, connection = pool) {
    const sql = `SELECT * FROM contact_messages WHERE id = :id`;
    const [rows] = await connection.execute(sql, { id });
    return rows[0];
  }

  async linkConversation(id, conversationId, connection = pool) {
    try {
      await connection.execute(
        `UPDATE contact_messages
         SET conversation_id = :conversationId,
             updated_at = NOW()
         WHERE id = :id`,
        { id, conversationId }
      );
    } catch (error) {
      if (!/Unknown column 'conversation_id'/i.test(error.message || '')) {
        throw error;
      }
    }
  }
}

export default new ContactMessageRepository();
