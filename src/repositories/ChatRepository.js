/**
 * @file ChatRepository.js
 * @description Repository for B2B Conversations and Messages.
 * Handles the persistence of chat history and context-aware snapshots.
 */

import pool from '../config/db.js';

class ChatRepository {
  constructor() {
    this._columnCache = new Map();
  }

  async _getColumns(tableName, connection = pool) {
    const cacheKey = `${tableName}`;
    if (this._columnCache.has(cacheKey)) {
      return this._columnCache.get(cacheKey);
    }

    const [rows] = await connection.execute(`SHOW COLUMNS FROM \`${tableName}\``);
    const columns = new Set(rows.map((row) => row.Field));
    this._columnCache.set(cacheKey, columns);
    return columns;
  }

  async _hasColumn(tableName, columnName, connection = pool) {
    const columns = await this._getColumns(tableName, connection);
    return columns.has(columnName);
  }

  async findConversation({ userId, vendorId, type = 'INQUIRY', productId = null, relatedRfqId = null, relatedOrderId = null }, connection = pool) {
    const sql = `
      SELECT *
      FROM conversations
      WHERE user_id = :userId
        AND vendor_id <=> :vendorId
        AND type = :type
        AND product_id <=> :productId
        AND related_rfq_id <=> :relatedRfqId
        AND related_order_id <=> :relatedOrderId
        AND status NOT IN ('closed', 'archived')
    `;
    const [rows] = await connection.execute(sql, {
      userId,
      vendorId: vendorId || null,
      type,
      productId: productId || null,
      relatedRfqId: relatedRfqId || null,
      relatedOrderId: relatedOrderId || null
    });
    return rows[0] || null;
  }

  async findOpenSupportConversationByUser(userId, connection = pool) {
    const columns = await this._getColumns('conversations', connection);
    const archivedFilter = columns.has('chat_status')
      ? `AND COALESCE(chat_status, 'ACTIVE') != 'ARCHIVED'`
      : '';
    const [rows] = await connection.execute(
      `
      SELECT *
      FROM conversations
      WHERE user_id = ?
        AND type = 'SUPPORT'
        AND status NOT IN ('closed', 'archived')
        ${archivedFilter}
      ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC
      LIMIT 1
      `,
      [userId]
    );
    return rows[0] || null;
  }

  async findById(conversationId, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT *
       FROM conversations
       WHERE id = :conversationId
       LIMIT 1`,
      { conversationId }
    );
    return rows[0] || null;
  }

  async userCanAccessConversation(conversationId, userId, role, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT id
       FROM conversations
       WHERE id = ?
         AND (
           user_id = ?
           OR vendor_id = (SELECT id FROM vendor_profiles WHERE user_id = ?)
           OR admin_id = ?
           OR (? IN ('ADMIN', 'OWNER') AND admin_id IS NULL AND type IN ('SUPPORT', 'INTERNAL'))
         )
       LIMIT 1`,
      [conversationId, userId, userId, userId, role]
    );

    return !!rows[0];
  }

  async countWaitingSupportConversations(connection = pool) {
    const hasChatStatus = await this._hasColumn('conversations', 'chat_status', connection);
    const [rows] = await connection.execute(`
      SELECT COUNT(*) AS count
      FROM conversations
      WHERE type = 'SUPPORT'
        AND status = 'waiting'
        ${hasChatStatus ? "AND COALESCE(chat_status, 'ACTIVE') != 'ARCHIVED'" : ''}
    `);
    return Number(rows[0]?.count || 0);
  }

  async countPendingSupportRequests(connection = pool) {
    const hasChatStatus = await this._hasColumn('conversations', 'chat_status', connection);
    const [rows] = await connection.execute(`
      SELECT COUNT(*) AS count
      FROM conversations
      WHERE type = 'SUPPORT'
        AND admin_id IS NULL
        AND status IN ('waiting', 'assigned')
        ${hasChatStatus ? "AND COALESCE(chat_status, 'ACTIVE') != 'ARCHIVED'" : ''}
    `);
    return Number(rows[0]?.count || 0);
  }

  async createConversation(convData, connection = pool) {
    const columns = await this._getColumns('conversations', connection);
    const {
      userId,
      vendorId,
      type = 'INQUIRY',
      productId,
      relatedRfqId,
      relatedOrderId,
      requestedQuantity,
      lastMessage,
      adminId,
      status,
      queuePosition,
      supportRequestedAt,
      assignedAt,
      estimatedResponseMinutes,
      source,
      contactMessageId,
      retentionCategory,
      preserveMessages
    } = convData;

    const insertColumns = [
      'user_id',
      'vendor_id',
      'admin_id',
      'status',
      'type',
      'product_id',
      'related_rfq_id',
      'related_order_id',
      'requested_quantity',
      'last_message',
      'created_at',
      'updated_at'
    ];
    const insertValues = [
      ':userId',
      ':vendorId',
      ':adminId',
      ':status',
      ':type',
      ':productId',
      ':relatedRfqId',
      ':relatedOrderId',
      ':requestedQuantity',
      ':lastMessage',
      'NOW()',
      'NOW()'
    ];
    const params = {
      userId,
      vendorId: vendorId || null,
      adminId: adminId || null,
      status: status || 'active',
      type,
      productId: productId || null,
      relatedRfqId: relatedRfqId || null,
      relatedOrderId: relatedOrderId || null,
      requestedQuantity: requestedQuantity || null,
      lastMessage
    };

    const optionalColumns = [
      ['queue_position', 'queuePosition', queuePosition],
      ['support_requested_at', 'supportRequestedAt', supportRequestedAt || null],
      ['assigned_at', 'assignedAt', assignedAt || null],
      ['estimated_response_minutes', 'estimatedResponseMinutes', estimatedResponseMinutes || null],
      ['source', 'source', source || null],
      ['contact_message_id', 'contactMessageId', contactMessageId || null],
      ['retention_category', 'retentionCategory', retentionCategory || null],
      ['preserve_messages', 'preserveMessages', preserveMessages ? 1 : 0]
    ];

    for (const [column, paramKey, value] of optionalColumns) {
      if (!columns.has(column)) continue;
      insertColumns.push(column);
      insertValues.push(`:${paramKey}`);
      params[paramKey] = value;
    }

    const sql = `
      INSERT INTO conversations (${insertColumns.join(', ')})
      VALUES (${insertValues.join(', ')})
    `;
    const [result] = await connection.execute(sql, params);

    await connection.execute(
      'UPDATE conversations SET last_activity_at = NOW() WHERE id = ?',
      [result.insertId]
    );

    return {
      id: result.insertId,
      userId,
      vendorId,
      type,
      status: status || 'active',
      adminId: adminId || null
    };
  }

  async updateConversation(conversationId, updates = {}, connection = pool) {
    const columns = await this._getColumns('conversations', connection);
    const parts = [];
    const params = { conversationId };

    Object.entries(updates).forEach(([key, value]) => {
      if (!columns.has(key)) return;
      parts.push(`${key} = :${key}`);
      params[key] = value;
    });

    if (!columns.has('updated_at')) {
      return false;
    }

    parts.push('updated_at = NOW()');
    if (columns.has('last_activity_at') && !Object.prototype.hasOwnProperty.call(updates, 'last_activity_at')) {
      parts.push('last_activity_at = NOW()');
    }

    if (!parts.length) return false;

    await connection.execute(
      `UPDATE conversations SET ${parts.join(', ')} WHERE id = :conversationId`,
      params
    );
    return true;
  }

  async updateLastMessage(convId, messageText, connection = pool) {
    await connection.execute(
      'UPDATE conversations SET last_message = :messageText, last_activity_at = NOW(), updated_at = NOW() WHERE id = :convId',
      { messageText, convId }
    );
  }

  async assignQueuedSupportConversation(adminId, connection = pool) {
    const columns = await this._getColumns('conversations', connection);
    const orderBy = columns.has('support_requested_at')
      ? 'ORDER BY support_requested_at ASC, created_at ASC'
      : columns.has('last_activity_at')
        ? 'ORDER BY COALESCE(last_activity_at, created_at) ASC'
        : 'ORDER BY created_at ASC';
    const archivedFilter = columns.has('chat_status')
      ? `AND COALESCE(chat_status, 'ACTIVE') != 'ARCHIVED'`
      : '';
    const [rows] = await connection.execute(`
      SELECT id
      FROM conversations
      WHERE type = 'SUPPORT'
        AND status = 'waiting'
        AND admin_id IS NULL
        ${archivedFilter}
      ${orderBy}
      LIMIT 1
    `);

    const conversation = rows[0];
    if (!conversation) return null;

    await this.updateConversation(conversation.id, {
      admin_id: adminId,
      status: 'assigned',
      assigned_at: new Date(),
      queue_position: null
    }, connection);

    return this.findById(conversation.id, connection);
  }

  async createMessage(msgData, connection = pool) {
    const columns = await this._getColumns('messages', connection);
    const {
      conversationId,
      senderId,
      messageText,
      type,
      attachments,
      productSnapshot,
      metadata
    } = msgData;

    const insertColumns = [
      'conversation_id',
      'sender_id',
      'message_text',
      'type',
      'attachments',
      'product_snapshot',
      'is_read',
      'created_at',
      'updated_at'
    ];
    const insertValues = [
      ':conversationId',
      ':senderId',
      ':messageText',
      ':type',
      ':attachments',
      ':productSnapshot',
      '0',
      'NOW()',
      'NOW()'
    ];
    const params = {
      conversationId,
      senderId,
      messageText,
      type: type || 'TEXT',
      attachments: JSON.stringify(attachments || []),
      productSnapshot: productSnapshot ? JSON.stringify(productSnapshot) : null
    };

    if (columns.has('metadata')) {
      insertColumns.splice(6, 0, 'metadata');
      insertValues.splice(6, 0, ':metadata');
      params.metadata = metadata ? JSON.stringify(metadata) : null;
    }

    const sql = `
      INSERT INTO messages (${insertColumns.join(', ')})
      VALUES (${insertValues.join(', ')})
    `;
    const [result] = await connection.execute(sql, params);

    return {
      id: result.insertId,
      conversation_id: conversationId,
      sender_id: senderId,
      message_text: messageText,
      type: type || 'TEXT',
      attachments: attachments || [],
      product_snapshot: productSnapshot || null,
      metadata: metadata || null,
      created_at: new Date().toISOString(),
      is_read: 0
    };
  }

  async getConversations(userId, role) {
    const conversationColumns = await this._getColumns('conversations');
    const messageColumns = await this._getColumns('messages');
    let whereClause = 'c.user_id = :userId';

    if (role === 'MOWARED') {
      whereClause = '(c.vendor_id = (SELECT id FROM vendor_profiles WHERE user_id = :userId) OR c.user_id = :userId)';
    } else if (role === 'ADMIN' || role === 'OWNER') {
      whereClause = `
        c.user_id = :userId
        OR c.admin_id = :userId
        OR (c.admin_id IS NULL AND c.type IN ('SUPPORT', 'INTERNAL'))
      `;
    }

    const deletedAtFilter = messageColumns.has('deleted_at') ? 'AND deleted_at IS NULL' : '';
    const metadataSelect = messageColumns.has('metadata')
      ? `(SELECT metadata FROM messages WHERE conversation_id = c.id AND metadata IS NOT NULL ${deletedAtFilter} ORDER BY created_at ASC LIMIT 1) as first_message_metadata,`
      : `NULL as first_message_metadata,`;
    const archivedWhere = conversationColumns.has('chat_status')
      ? `AND COALESCE(c.chat_status, 'ACTIVE') != 'ARCHIVED'`
      : '';
    const sql = `
      SELECT c.*,
             c.related_rfq_id as rfq_id,
             c.related_order_id as order_id,
             u.first_name as user_first_name,
             u.last_name as user_last_name,
             u.profile_image_url as user_image,
             a.first_name as admin_first_name,
             a.last_name as admin_last_name,
             v.company_name_ar as vendor_company_name_ar,
             v.company_name_en as vendor_company_name_en,
             v.logo as vendor_logo,
             v.user_id as vendor_user_id,
             (SELECT message_text FROM messages WHERE conversation_id = c.id ${deletedAtFilter} ORDER BY created_at DESC LIMIT 1) as last_msg_text,
             (SELECT product_snapshot FROM messages WHERE conversation_id = c.id AND product_snapshot IS NOT NULL ORDER BY created_at ASC LIMIT 1) as product_context,
             ${metadataSelect}
             (SELECT COUNT(id) FROM messages WHERE conversation_id = c.id AND is_read = 0 AND sender_id != :userId) as unread_count
      FROM conversations c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN users a ON c.admin_id = a.id
      LEFT JOIN vendor_profiles v ON c.vendor_id = v.id
      WHERE (${whereClause})
        ${archivedWhere}
        AND COALESCE(c.status, 'active') NOT IN ('closed', 'archived')
      ORDER BY COALESCE(c.last_activity_at, c.updated_at, c.created_at) DESC
    `;
    const [rows] = await pool.execute(sql, { userId });

    for (const row of rows) {
      const context = this._parseJson(row.product_context);
      const metadata = this._parseJson(row.first_message_metadata);
      row.product_image = context?.product_image || context?.thumbnail || context?.image || null;
      row.product_name = context?.product_name || context?.titleEn || context?.titleAr || null;
      row.product_url = context?.product_url || context?.url || (row.product_id ? `/product/${row.product_id}` : null);
      row.product_price = context?.priceAtInquiry || metadata?.priceAtInquiry || null;
      row.product_moq = context?.moq || metadata?.moq || null;
      row.estimated_response_minutes = Number(row.estimated_response_minutes || 0) || null;
      row.first_response_seconds = Number(row.first_response_seconds || 0) || null;
      row.resolution_seconds = Number(row.resolution_seconds || 0) || null;
    }

    setTimeout(() => this.autoCleanupArchivedChats().catch(console.error), 0);
    return rows;
  }

  async getOwnerSupportArchives(connection = pool) {
    const sql = `
      SELECT c.*,
             u.first_name as user_first_name,
             u.last_name as user_last_name,
             u.email as user_email,
             a.first_name as admin_first_name,
             a.last_name as admin_last_name,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
      FROM conversations c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN users a ON c.admin_id = a.id
      WHERE c.type = 'SUPPORT'
        AND c.status = 'closed'
      ORDER BY COALESCE(c.closed_at, c.updated_at, c.created_at) DESC
    `;
    const [rows] = await connection.execute(sql);
    return rows;
  }

  async getOwnerSupportConversations(scope = 'all', connection = pool) {
    const columns = await this._getColumns('conversations', connection);
    const hasPreserveMessages = columns.has('preserve_messages');
    const hasChatStatus = columns.has('chat_status');
    const hasClosedAt = columns.has('closed_at');
    const preserveExpr = hasPreserveMessages ? 'COALESCE(c.preserve_messages, 0)' : '0';
    const closedAtExpr = hasClosedAt
      ? 'COALESCE(c.closed_at, c.updated_at, c.created_at)'
      : 'COALESCE(c.updated_at, c.created_at)';

    let scopeFilter = '';
    if (scope === 'expiring') {
      scopeFilter = `
        AND c.status = 'closed'
        AND ${preserveExpr} = 0
      `;
    } else if (scope === 'archived') {
      scopeFilter = `
        AND (
          ${preserveExpr} = 1
          ${hasChatStatus ? "OR COALESCE(c.chat_status, 'ACTIVE') = 'ARCHIVED'" : ''}
          OR c.status = 'archived'
        )
      `;
    }

    const sql = `
      SELECT c.*,
             u.first_name as user_first_name,
             u.last_name as user_last_name,
             u.email as user_email,
             a.first_name as admin_first_name,
             a.last_name as admin_last_name,
             v.company_name_ar as vendor_company_name_ar,
             v.company_name_en as vendor_company_name_en,
             v.user_id as vendor_user_id,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count,
             ${preserveExpr} as preserve_messages_normalized,
             ${closedAtExpr} as retention_base_at
      FROM conversations c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN users a ON c.admin_id = a.id
      LEFT JOIN vendor_profiles v ON c.vendor_id = v.id
      WHERE c.type IN ('SUPPORT', 'INQUIRY')
        ${scopeFilter}
      ORDER BY COALESCE(c.last_activity_at, c.updated_at, c.created_at) DESC
    `;

    const [rows] = await connection.execute(sql);
    return rows;
  }

  async archiveSupportConversation(conversationId, connection = pool) {
    const columns = await this._getColumns('conversations', connection);
    const updates = {
      preserve_messages: 1,
      status: 'archived'
    };

    if (columns.has('chat_status')) updates.chat_status = 'ARCHIVED';
    if (columns.has('archived_at')) updates.archived_at = new Date();
    if (columns.has('expires_at')) updates.expires_at = null;

    await this.updateConversation(conversationId, updates, connection);
    return this.findById(conversationId, connection);
  }

  async deleteConversationPermanently(conversationId, connection = pool) {
    await connection.execute('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
    await connection.execute('DELETE FROM conversations WHERE id = ?', [conversationId]);
    return true;
  }

  async deleteConversationsPermanently(conversationIds = [], connection = pool) {
    const normalizedIds = [...new Set(
      (Array.isArray(conversationIds) ? conversationIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )];

    if (!normalizedIds.length) {
      return 0;
    }

    const placeholders = normalizedIds.map(() => '?').join(', ');
    await connection.execute(
      `DELETE FROM messages WHERE conversation_id IN (${placeholders})`,
      normalizedIds
    );
    await connection.execute(
      `DELETE FROM conversations WHERE id IN (${placeholders})`,
      normalizedIds
    );
    return normalizedIds.length;
  }

  async autoCleanupArchivedChats() {
    const columns = await this._getColumns('conversations');
    if (!columns.has('chat_status') || !columns.has('archived_at')) {
      return;
    }
    const preserveFilter = columns.has('preserve_messages')
      ? 'AND preserve_messages = 0'
      : `AND related_rfq_id IS NULL AND related_order_id IS NULL AND type != 'INTERNAL'`;
    const expiresSet = columns.has('expires_at')
      ? `,
          expires_at = CASE
            WHEN ${columns.has('preserve_messages') ? 'preserve_messages = 1' : '0 = 1'} THEN expires_at
            WHEN expires_at IS NULL THEN DATE_ADD(NOW(), INTERVAL 60 DAY)
            ELSE expires_at
          END`
      : '';
    await pool.execute(`
      UPDATE conversations
      SET chat_status = 'ARCHIVED',
          status = 'archived',
          archived_at = COALESCE(archived_at, NOW())
          ${expiresSet}
      WHERE status = 'closed'
        AND COALESCE(chat_status, 'ACTIVE') != 'ARCHIVED'
        ${preserveFilter}
        AND COALESCE(closed_at, last_activity_at, updated_at, created_at) < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);
  }

  async getMessages(conversationId) {
    const hasMetadata = await this._hasColumn('messages', 'metadata');
    const sql = `
      SELECT id, sender_id, message_text, type, attachments, product_snapshot${hasMetadata ? ', metadata' : ''}, is_read, read_at, deleted_at, created_at
      FROM messages
      WHERE conversation_id = :conversationId
      ORDER BY created_at ASC
    `;
    const [rows] = await pool.execute(sql, { conversationId });

    for (const row of rows) {
      row.attachments = this._parseJson(row.attachments) || [];
      row.product_snapshot = this._parseJson(row.product_snapshot);
      if (hasMetadata) {
        row.metadata = this._parseJson(row.metadata);
      }
    }
    return rows;
  }

  async markMessageRead(messageId, readerId, connection = pool) {
    await connection.execute(
      `UPDATE messages
       SET is_read = 1,
           read_at = NOW(),
           updated_at = NOW()
       WHERE id = :messageId
         AND sender_id != :readerId`,
      { messageId, readerId }
    );
  }

  _parseJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

export default new ChatRepository();
