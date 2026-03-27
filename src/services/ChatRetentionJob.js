import pool from '../config/db.js';

class ChatRetentionJob {
  constructor() {
    this._columnCache = new Map();
  }

  start() {
    this.runCleanup();
    setInterval(() => this.runCleanup(), 12 * 60 * 60 * 1000);
  }

  async _getColumns(connection, tableName) {
    if (this._columnCache.has(tableName)) {
      return this._columnCache.get(tableName);
    }

    const [rows] = await connection.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    const columns = new Set(rows.map((row) => row.Field));
    this._columnCache.set(tableName, columns);
    return columns;
  }

  async runCleanup() {
    const connection = await pool.getConnection();
    try {
      console.log('[ChatRetentionJob] Starting Chat DB Retention Cleanup...');

      const conversationColumns = await this._getColumns(connection, 'conversations');
      const messageColumns = await this._getColumns(connection, 'messages');

      const lastActivityExpr = conversationColumns.has('last_activity_at')
        ? 'last_activity_at'
        : 'COALESCE(updated_at, created_at)';
      const preserveFilter = conversationColumns.has('preserve_messages')
        ? 'AND preserve_messages = 0'
        : `AND related_rfq_id IS NULL AND related_order_id IS NULL AND type != 'INTERNAL'`;

      await connection.execute(`
        UPDATE conversations
        SET status = 'idle'
        WHERE status IN ('active', 'assigned', 'waiting')
          AND ${lastActivityExpr} < DATE_SUB(NOW(), INTERVAL 3 DAY)
      `);

      await connection.execute(`
        UPDATE conversations
        SET status = 'closed'
            ${conversationColumns.has('closed_at') ? ', closed_at = COALESCE(closed_at, NOW())' : ''}
        WHERE status = 'idle'
          AND type != 'SUPPORT'
          ${preserveFilter}
          AND ${lastActivityExpr} < DATE_SUB(NOW(), INTERVAL 10 DAY)
      `);

      if (conversationColumns.has('chat_status') && conversationColumns.has('archived_at')) {
        const archiveAgeExpr = conversationColumns.has('closed_at')
          ? `COALESCE(closed_at, ${lastActivityExpr})`
          : lastActivityExpr;
        const expiresSet = conversationColumns.has('expires_at')
          ? `,
            expires_at = CASE
              WHEN ${conversationColumns.has('preserve_messages') ? 'preserve_messages = 1' : '0 = 1'} THEN expires_at
              WHEN expires_at IS NULL THEN DATE_ADD(NOW(), INTERVAL 60 DAY)
              ELSE expires_at
            END`
          : '';

        await connection.execute(`
          UPDATE conversations
          SET status = 'archived',
              chat_status = 'ARCHIVED',
              archived_at = COALESCE(archived_at, NOW())
              ${expiresSet}
          WHERE status = 'closed'
            ${preserveFilter}
            AND ${archiveAgeExpr} < DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);
      }

      if (
        messageColumns.has('deleted_at') &&
        messageColumns.has('attachments') &&
        conversationColumns.has('expires_at')
      ) {
        await connection.execute(`
          UPDATE messages m
          JOIN conversations c ON m.conversation_id = c.id
          SET m.deleted_at = COALESCE(m.deleted_at, NOW()),
              m.message_text = CASE
                WHEN m.deleted_at IS NULL THEN '[Message expired by retention policy]'
                ELSE m.message_text
              END,
              m.attachments = CASE
                WHEN m.deleted_at IS NULL THEN JSON_ARRAY()
                ELSE m.attachments
              END,
              m.updated_at = NOW()
          WHERE c.status = 'archived'
            ${conversationColumns.has('preserve_messages') ? 'AND c.preserve_messages = 0' : `AND c.related_rfq_id IS NULL AND c.related_order_id IS NULL AND c.type != 'INTERNAL'`}
            AND c.expires_at IS NOT NULL
            AND c.expires_at < NOW()
            AND m.deleted_at IS NULL
        `);
      }

      const supportPreserveFilter = conversationColumns.has('preserve_messages')
        ? 'AND COALESCE(c.preserve_messages, 0) = 0'
        : '';
      const supportConversationPreserveFilter = conversationColumns.has('preserve_messages')
        ? 'AND COALESCE(preserve_messages, 0) = 0'
        : '';
      const closedAtExpr = conversationColumns.has('closed_at')
        ? 'c.closed_at'
        : (conversationColumns.has('last_activity_at')
            ? 'COALESCE(c.last_activity_at, c.updated_at, c.created_at)'
            : 'COALESCE(c.updated_at, c.created_at)');
      const closedConversationExpr = conversationColumns.has('closed_at')
        ? 'closed_at'
        : (conversationColumns.has('last_activity_at')
            ? 'COALESCE(last_activity_at, updated_at, created_at)'
            : 'COALESCE(updated_at, created_at)');

      await connection.execute(`
        DELETE m
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE c.type = 'SUPPORT'
          AND c.status = 'closed'
          ${supportPreserveFilter}
          AND ${closedAtExpr} < DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);

      await connection.execute(`
        DELETE FROM conversations
        WHERE type = 'SUPPORT'
          AND status = 'closed'
          ${supportConversationPreserveFilter}
          AND ${closedConversationExpr} < DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);

      console.log('[ChatRetentionJob] Cleanup completed successfully.');
    } catch (error) {
      console.error('[ChatRetentionJob] Error during cleanup:', error.message);
    } finally {
      connection.release();
    }
  }
}

export default new ChatRetentionJob();
