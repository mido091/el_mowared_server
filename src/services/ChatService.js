/**
 * @file ChatService.js
 * @description Service for handling B2B inquiries and real-time messaging.
 */

import ChatRepository from '../repositories/ChatRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import NotificationRepository from '../repositories/NotificationRepository.js';
import ContactMessageRepository from '../repositories/ContactMessageRepository.js';
import UserRepository from '../repositories/UserRepository.js';
import pool from '../config/db.js';
import { getIO, isUserOnline } from '../config/socket.js';
import { sendSimpleEmail } from './EmailService.js';
import { AppError } from '../middlewares/errorHandler.js';

class ChatService {
  async _resolveConversationAudience(conversation, connection = pool) {
    const audience = new Set();
    if (conversation?.id) {
      audience.add(`conv_${conversation.id}`);
    }
    if (conversation?.user_id) {
      audience.add(`${conversation.user_id}`);
    }
    if (conversation?.admin_id) {
      audience.add(`${conversation.admin_id}`);
    }

    if (conversation?.vendor_id) {
      const [rows] = await connection.execute(
        'SELECT user_id FROM vendor_profiles WHERE id = ? LIMIT 1',
        [conversation.vendor_id]
      );
      if (rows[0]?.user_id) {
        audience.add(`${rows[0].user_id}`);
      }
    }

    return Array.from(audience);
  }

  _emitToAudience(event, payload, rooms = []) {
    if (!rooms.length) return;
    try {
      const io = getIO();
      let emitter = io;
      rooms.forEach((room) => {
        emitter = emitter.to(room);
      });
      emitter.emit(event, payload);
    } catch {
      // Socket availability is optional in non-live/script flows.
    }
  }

  _normalizeConversationType(type) {
    if (type === 'SUPPORT') return 'SUPPORT';
    if (type === 'INTERNAL' || type === 'ADMIN_VENDOR') return 'INTERNAL';
    return 'INQUIRY';
  }

  _getInitialStatus(type) {
    return type === 'INTERNAL' ? 'active' : 'waiting';
  }

  _isPrivilegedRole(role) {
    return ['ADMIN', 'OWNER', 'MOWARED'].includes(`${role || ''}`.toUpperCase());
  }

  _isSupportAgentRole(role) {
    return ['ADMIN', 'OWNER'].includes(`${role || ''}`.toUpperCase());
  }

  _getLocalizedSupportTexts(locale = 'en', hasAgent = true) {
    const isArabic = `${locale}`.toLowerCase().startsWith('ar');
    if (hasAgent) {
      return {
        intro: isArabic ? 'التواصل مع الدعم' : 'Contact Support',
        waiting: isArabic ? 'يرجى الانتظار حتى يتم الرد' : 'Please wait while we connect you'
      };
    }

    return {
      intro: isArabic ? 'التواصل مع الدعم' : 'Contact Support',
      waiting: isArabic
        ? 'جميع خدمة العملاء مشغولين حالياً...'
        : 'All support agents are busy...'
    };
  }

  _getLocalizedVendorAvailabilityText(locale = 'en') {
    const isArabic = `${locale}`.toLowerCase().startsWith('ar');
    return isArabic
      ? 'المورد غير متصل الآن. أرسل استفسارك وسيتم الرد عليك في أقرب وقت.'
      : 'The supplier is currently offline. Send your inquiry and they will reply as soon as possible.';
  }

  _estimateResponseMinutes(queueLength, onlineAgentsCount = 1) {
    const normalizedAgents = Math.max(onlineAgentsCount || 0, 1);
    return Math.max(2, Math.ceil(((queueLength || 0) + 1) * 4 / normalizedAgents));
  }

  async _getSupportPoolState(connection = pool) {
    const adminPool = await UserRepository.findAdminPool(connection);
    const onlineAdmins = adminPool.filter((user) => user.role === 'ADMIN' && isUserOnline(user.id));
    const onlineOwners = adminPool.filter((user) => user.role === 'OWNER' && isUserOnline(user.id));
    return {
      adminPool,
      onlineAdmins,
      onlineOwners,
      hasAnyOnlineAgent: onlineAdmins.length > 0 || onlineOwners.length > 0,
      onlineAgentCount: onlineAdmins.length + onlineOwners.length
    };
  }

  async _getSupportRecipients(connection = pool) {
    const supportPoolState = await this._getSupportPoolState(connection);
    if (supportPoolState.onlineAdmins.length) return supportPoolState.onlineAdmins;
    if (supportPoolState.onlineOwners.length) return supportPoolState.onlineOwners;
    return supportPoolState.adminPool;
  }

  async _notifyUser(userId, payload, connection = pool) {
    if (!userId) return;
    await NotificationRepository.create(payload, connection);
    try {
      getIO().to(`${userId}`).emit('notification', {
        message: payload.titleEn,
        messageAr: payload.titleAr,
        type: 'info',
        notificationType: payload.type || null
      });
    } catch {
      // Socket optional in non-live execution paths.
    }
  }

  async _notifySupportPool(conversation, connection = pool) {
    const recipients = await this._getSupportRecipients(connection);
    const createJobs = recipients.map((admin) =>
      NotificationRepository.create({
        userId: admin.id,
        type: 'SUPPORT_REQUEST',
        titleAr: 'طلب دعم جديد',
        titleEn: 'New Support Request',
        contentAr: `يوجد طلب دعم جديد برقم المحادثة #${conversation.id}.`,
        contentEn: `A new support conversation #${conversation.id} is waiting for attention.`
      }, connection)
    );
    await Promise.allSettled(createJobs);

    try {
      const io = getIO();
      recipients.forEach((admin) => {
        io.to(`${admin.id}`).emit('support_assigned', {
          conversationId: conversation.id,
          adminId: conversation.admin_id || null,
          status: conversation.status
        });
      });
    } catch {
      // Ignore socket unavailability here.
    }
  }

  async _emitSupportPoolUpdate(conversation) {
    try {
      const admins = await UserRepository.findAdminPool();
      const io = getIO();
      admins.forEach((admin) => {
        io.to(`${admin.id}`).emit('support_assigned', {
          conversationId: conversation.id,
          adminId: conversation.admin_id || null,
          status: conversation.status
        });
      });
      io.to(`${conversation.user_id}`).emit('support_assigned', {
        conversationId: conversation.id,
        adminId: conversation.admin_id || null,
        status: conversation.status
      });
    } catch {
      // Ignore socket issues in non-live flows.
    }
  }

  async _buildProductSnapshot(productId, metadata = null) {
    let productSnapshot = null;

    if (productId) {
      const product = await ProductRepository.findById(productId);
      if (product) {
        productSnapshot = {
          id: product.id,
          titleAr: product.name_ar,
          titleEn: product.name_en,
          product_name: product.name_en || product.name_ar,
          product_image: product.images?.[0]?.image_url || product.main_image || product.product_image || null,
          image: product.images?.[0]?.image_url || product.main_image || product.product_image || null,
          url: `/product/${product.id}`,
          product_url: `/product/${product.id}`,
          vendorId: product.vendor_id,
          priceAtInquiry: product.price_max || product.discount_price || product.price || null,
          moq: product.minimum_order_quantity || product.min_order_quantity || null
        };
      }
    }

    if (metadata && typeof metadata === 'object') {
      return {
        ...(productSnapshot || {}),
        ...metadata
      };
    }

    return productSnapshot;
  }

  async _resolveConversationUserId(defaultUserId, options = {}, connection = pool) {
    if (options.buyerId) {
      return Number(options.buyerId);
    }

    const normalizedType = this._normalizeConversationType(options.type);
    const initiatorRole = `${options.initiatorRole || ''}`.toUpperCase();
    const relatedRfqId = Number(options.relatedRfqId || 0) || null;

    if (normalizedType === 'INQUIRY' && relatedRfqId && initiatorRole === 'MOWARED') {
      const [rows] = await connection.execute(
        `SELECT user_id
         FROM rfq_requests
         WHERE id = ?
         LIMIT 1`,
        [relatedRfqId]
      );

      if (!rows[0]?.user_id) {
        throw new AppError('RFQ buyer could not be resolved for this conversation.', 404);
      }

      return Number(rows[0].user_id);
    }

    return Number(defaultUserId);
  }

  async _notifyVendorForConversation(conversation, messageText, productSnapshot, connection = pool) {
    if (!conversation.vendor_id) return;

    const [vendorUsers] = await connection.execute(
      `SELECT vp.user_id, u.email
       FROM vendor_profiles vp
       JOIN users u ON vp.user_id = u.id
       WHERE vp.id = :vendorId`,
      { vendorId: conversation.vendor_id }
    );

    if (!vendorUsers.length) return;
    const vendorUser = vendorUsers[0];

    await NotificationRepository.create({
      userId: vendorUser.user_id,
      type: 'NEW_MESSAGE',
      titleAr: 'رسالة جديدة',
      titleEn: 'New Message',
      contentAr: `لديك رسالة جديدة بخصوص ${productSnapshot?.titleAr || 'محادثة'}`,
      contentEn: `You have a new message regarding ${productSnapshot?.titleEn || 'a conversation'}`
    }, connection);

    try {
      getIO().to(`${vendorUser.user_id}`).emit('notification', {
        type: 'info',
        message: 'New vendor inquiry received',
        conversationId: conversation.id
      });
    } catch {
      // Ignore when socket server is unavailable.
    }

    if (!isUserOnline(vendorUser.user_id) && vendorUser.email) {
      const productTitle = productSnapshot?.product_name || productSnapshot?.titleEn || productSnapshot?.titleAr || 'a product';
      const productLink = `${process.env.CLIENT_URL || ''}${productSnapshot?.product_url || productSnapshot?.url || '/chat'}`;
      try {
        await sendSimpleEmail({
          to: vendorUser.email,
          subject: `New Elmowared inquiry for ${productTitle}`,
          text: `You received a new inquiry regarding ${productTitle}. Reply here: ${productLink}`,
          html: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6"><h2>New product inquiry</h2><p>You received a new inquiry regarding <strong>${productTitle}</strong>.</p><p>${messageText}</p><p><a href="${productLink}" style="color:#0891b2">Open conversation</a></p></div>`
        });
      } catch (emailError) {
        console.error('Offline inquiry email failed:', emailError.message);
      }
    }
  }

  async _notifyBuyerForConversation(conversation, messageText, connection = pool) {
    if (!conversation?.user_id) return;

    const [buyerRows] = await connection.execute(
      `SELECT id, email
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [conversation.user_id]
    );

    const buyer = buyerRows[0];
    if (!buyer) return;

    await NotificationRepository.create({
      userId: buyer.id,
      type: 'NEW_MESSAGE',
      titleAr: 'رسالة جديدة بخصوص طلبك',
      titleEn: 'New message about your request',
      contentAr: 'قام مورد بالرد وبدء محادثة بخصوص طلب العرض الخاص بك.',
      contentEn: 'A supplier has replied and started a conversation about your RFQ.'
    }, connection);

    try {
      getIO().to(`${buyer.id}`).emit('notification', {
        type: 'info',
        message: 'A supplier started a conversation about your RFQ',
        conversationId: conversation.id
      });
    } catch {
      // Socket optional in non-live execution paths.
    }

    if (!isUserOnline(buyer.id) && buyer.email) {
      try {
        await sendSimpleEmail({
          to: buyer.email,
          subject: 'A supplier replied to your Elmowared RFQ',
          text: `${messageText}\n\nOpen the conversation in Elmowared to continue the discussion.`,
          html: `<div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6"><h2>A supplier replied to your RFQ</h2><p>${messageText}</p><p>Open Elmowared to continue the discussion.</p></div>`
        });
      } catch (emailError) {
        console.error('Offline RFQ buyer email failed:', emailError.message);
      }
    }
  }

  async startInquiry(userId, options, passedConnection = null) {
    const { vendorId, productId, messageText, requestedQuantity, metadata, locale, source, contactMessageId } = options;
    const connection = passedConnection || await pool.getConnection();
    const isInternalTransaction = !passedConnection;
    const normalizedType = this._normalizeConversationType(options.type);

    if (isInternalTransaction) {
      await connection.beginTransaction();
    }

    try {
      const conversationUserId = await this._resolveConversationUserId(userId, options, connection);
      let conversation = normalizedType === 'SUPPORT'
        ? await ChatRepository.findOpenSupportConversationByUser(conversationUserId, connection)
        : await ChatRepository.findConversation({
            userId: conversationUserId,
            vendorId,
            productId: productId || null,
            type: normalizedType,
            relatedRfqId: options.relatedRfqId || null,
            relatedOrderId: options.relatedOrderId || null
          }, connection);

      let createdNow = false;

      if (!conversation) {
        let adminId = null;
        let status = this._getInitialStatus(normalizedType);
        let queuePosition = null;
        let estimatedResponseMinutes = null;
        let supportRequestedAt = null;
        let assignedAt = null;

        if (normalizedType === 'SUPPORT') {
          const supportPoolState = await this._getSupportPoolState(connection);
          supportRequestedAt = new Date();
          const pendingCount = await ChatRepository.countPendingSupportRequests(connection);
          queuePosition = pendingCount + 1;
          status = supportPoolState.hasAnyOnlineAgent ? 'assigned' : 'waiting';
          estimatedResponseMinutes = this._estimateResponseMinutes(
            pendingCount,
            supportPoolState.onlineAgentCount
          );
        }

        conversation = await ChatRepository.createConversation({
          userId: conversationUserId,
          vendorId,
          type: normalizedType,
          productId: productId || null,
          relatedRfqId: options.relatedRfqId || null,
          relatedOrderId: options.relatedOrderId || null,
          requestedQuantity,
          lastMessage: messageText,
          adminId,
          status,
          queuePosition,
          supportRequestedAt,
          assignedAt,
          estimatedResponseMinutes,
          source: source || (normalizedType === 'SUPPORT' ? 'support_widget' : normalizedType === 'INTERNAL' ? 'admin_vendor' : productId ? 'product' : options.relatedRfqId ? 'rfq' : 'chat'),
          contactMessageId: contactMessageId || null,
          retentionCategory: options.relatedRfqId ? 'rfq' : options.relatedOrderId ? 'order' : normalizedType === 'INTERNAL' ? 'internal' : normalizedType === 'SUPPORT' ? 'support' : 'standard',
          preserveMessages: !!(options.relatedRfqId || options.relatedOrderId || normalizedType === 'INTERNAL')
        }, connection);
        createdNow = true;
      } else {
        await ChatRepository.updateLastMessage(conversation.id, messageText, connection);
      }

      const productSnapshot = await this._buildProductSnapshot(productId, metadata);

      const message = await ChatRepository.createMessage({
        conversationId: conversation.id,
        senderId: userId,
        messageText,
        type: normalizedType === 'SUPPORT' ? 'TEXT' : 'TEXT',
        productSnapshot,
        attachments: [],
        metadata: {
          requestedQuantity: requestedQuantity || null,
          source: source || null
        }
      }, connection);

      await ChatRepository.updateLastMessage(conversation.id, messageText, connection);

      let systemMessage = null;
      if (normalizedType === 'SUPPORT' && createdNow) {
        const supportTexts = this._getLocalizedSupportTexts(locale, conversation.status === 'assigned');
        systemMessage = await ChatRepository.createMessage({
          conversationId: conversation.id,
          senderId: userId,
          messageText: supportTexts.waiting,
          type: 'SYSTEM',
          attachments: [],
          metadata: {
            supportAvailability: conversation.status === 'assigned' ? 'available' : 'busy',
            cta: conversation.status === 'assigned' ? null : '/contact-us',
            estimatedResponseMinutes: conversation.estimated_response_minutes || null
          }
        }, connection);
      } else if (normalizedType === 'INQUIRY' && createdNow && vendorId) {
        const [vendorRows] = await connection.execute(
          `SELECT user_id FROM vendor_profiles WHERE id = ? LIMIT 1`,
          [vendorId]
        );
        const vendorUserId = vendorRows[0]?.user_id ? Number(vendorRows[0].user_id) : null;
        if (!vendorUserId || !isUserOnline(vendorUserId)) {
          systemMessage = await ChatRepository.createMessage({
            conversationId: conversation.id,
            senderId: userId,
            messageText: this._getLocalizedVendorAvailabilityText(locale),
            type: 'SYSTEM',
            attachments: [],
            metadata: {
              vendorAvailability: 'offline'
            }
          }, connection);
        }
      }

      if (normalizedType === 'SUPPORT') {
        if (contactMessageId) {
          await ContactMessageRepository.updateStatus(contactMessageId, 'converted', connection);
          await ContactMessageRepository.linkConversation(contactMessageId, conversation.id, connection);
        }
        await this._notifySupportPool({
          ...conversation,
          estimated_response_minutes: conversation.estimated_response_minutes || null
        }, connection);
      } else if (vendorId) {
        const initiatorRole = `${options.initiatorRole || ''}`.toUpperCase();
        const initiatorVendorId = Number(options.initiatorVendorProfileId || 0) || null;
        const isVendorInitiatedRfq = normalizedType === 'INQUIRY' &&
          !!options.relatedRfqId &&
          initiatorRole === 'MOWARED' &&
          initiatorVendorId &&
          initiatorVendorId === Number(vendorId);

        if (isVendorInitiatedRfq) {
          await this._notifyBuyerForConversation({
            ...conversation,
            user_id: conversationUserId
          }, messageText, connection);
        } else {
        await this._notifyVendorForConversation(conversation, messageText, productSnapshot, connection);
        }
      }

      if (isInternalTransaction) {
        await connection.commit();
      }

      const enrichedConversation = await ChatRepository.findById(conversation.id, passedConnection || pool);

      const audience = await this._resolveConversationAudience(
        enrichedConversation || { ...conversation, user_id: conversationUserId, vendor_id: vendorId },
        passedConnection || pool
      );
      this._emitToAudience('new_message', {
        conversationId: conversation.id,
        message
      }, audience);
      if (systemMessage) {
        this._emitToAudience('new_message', {
          conversationId: conversation.id,
          message: systemMessage
        }, audience);
      }
      if (conversation.admin_id) {
        this._emitToAudience('support_assigned', {
          conversationId: conversation.id,
          userId,
          status: conversation.status
        }, [`${conversation.admin_id}`]);
      }

      return {
        conversation: enrichedConversation || conversation,
        message,
        systemMessage
      };
    } catch (error) {
      if (isInternalTransaction) {
        await connection.rollback();
      }
      throw error;
    } finally {
      if (isInternalTransaction) {
        connection.release();
      }
    }
  }

  async sendConversationMessage({
    conversationId,
    senderId,
    senderRole,
    messageText,
    messageType = 'TEXT',
    attachments = [],
    metadata = null,
    locale = 'en'
  }, passedConnection = null) {
    const connection = passedConnection || await pool.getConnection();
    const isInternalTransaction = !passedConnection;

    if (isInternalTransaction) {
      await connection.beginTransaction();
    }

    try {
      const conversation = await ChatRepository.findById(conversationId, connection);
      if (!conversation) throw new Error('Conversation not found');

      const isSupportResponder =
        conversation.type === 'SUPPORT' &&
        conversation.user_id !== senderId &&
        (conversation.admin_id === senderId || this._isSupportAgentRole(senderRole));

      const isPrivilegedResponder =
        conversation.user_id !== senderId &&
        (
          conversation.type === 'SUPPORT'
            ? isSupportResponder
            : (conversation.admin_id === senderId || this._isPrivilegedRole(senderRole))
        );

      const updates = {};
      if (
        conversation.type === 'SUPPORT' &&
        isPrivilegedResponder &&
        ['waiting', 'assigned'].includes(`${conversation.status || ''}`.toLowerCase())
      ) {
        updates.status = 'active';
        updates.admin_id = senderId;
        if (!conversation.first_response_at) {
          updates.first_response_at = new Date();
          updates.first_response_seconds = Math.max(
            0,
            Math.round((Date.now() - new Date(conversation.support_requested_at || conversation.created_at).getTime()) / 1000)
          );
        }
        if (!conversation.assigned_at) {
          updates.assigned_at = new Date();
        }
      } else if (
        conversation.type === 'INQUIRY' &&
        conversation.user_id !== senderId &&
        `${conversation.status || ''}`.toLowerCase() === 'waiting'
      ) {
        updates.status = 'active';
      }

      if (conversation.status === 'resolved') {
        updates.status = 'active';
        updates.resolved_at = null;
        updates.resolution_seconds = null;
      }

      if (Object.keys(updates).length) {
        await ChatRepository.updateConversation(conversationId, updates, connection);
      }

      const newMessage = await ChatRepository.createMessage({
        conversationId,
        senderId,
        messageText,
        type: messageType,
        attachments,
        metadata
      }, connection);

      await ChatRepository.updateLastMessage(conversationId, messageText || (messageType === 'IMAGE' ? 'Image' : messageType === 'FILE' ? 'File' : 'Message'), connection);

      if (isInternalTransaction) {
        await connection.commit();
      }

      const refreshedConversation = await ChatRepository.findById(conversationId, passedConnection || pool);
      const audience = await this._resolveConversationAudience(
        refreshedConversation || conversation,
        passedConnection || pool
      );
      this._emitToAudience('new_message', {
        conversationId,
        message: newMessage
      }, audience);

      if (conversation.type === 'SUPPORT' && isSupportResponder) {
        await this._emitSupportPoolUpdate({
          ...conversation,
          ...updates,
          id: conversationId,
          admin_id: updates.admin_id || conversation.admin_id,
          status: updates.status || conversation.status
        });
      }

      if (conversation.type === 'SUPPORT' && !conversation.admin_id && conversation.user_id === senderId) {
        await this._notifySupportPool({
          ...conversation,
          id: conversationId,
          status: conversation.status || 'waiting'
        });
      }

      if (conversation.type === 'SUPPORT' && isSupportResponder) {
        const supportTexts = this._getLocalizedSupportTexts(locale, true);
        await this._notifyUser(conversation.user_id, {
          userId: conversation.user_id,
          type: 'SUPPORT_REPLY',
          titleAr: 'تم الرد من فريق الدعم',
          titleEn: 'Support replied',
          contentAr: supportTexts.waiting,
          contentEn: 'Support has replied to your conversation.'
        }, connection);
      }

      return newMessage;
    } catch (error) {
      if (isInternalTransaction) {
        await connection.rollback();
      }
      throw error;
    } finally {
      if (isInternalTransaction) {
        connection.release();
      }
    }
  }

  async updateConversationStatus(conversationId, status, actorId, passedConnection = null) {
    const connection = passedConnection || await pool.getConnection();
    const isInternalTransaction = !passedConnection;

    if (isInternalTransaction) {
      await connection.beginTransaction();
    }

    try {
      const conversation = await ChatRepository.findById(conversationId, connection);
      if (!conversation) throw new Error('Conversation not found');

      const normalizedStatus = `${status || ''}`.toLowerCase();
      const updates = { status: normalizedStatus };

      if (normalizedStatus === 'resolved') {
        updates.resolved_at = new Date();
        const startDate = conversation.first_response_at || conversation.created_at;
        updates.resolution_seconds = Math.max(
          0,
          Math.round((Date.now() - new Date(startDate).getTime()) / 1000)
        );
      }

      if (normalizedStatus === 'closed') {
        updates.closed_at = new Date();
        if (!conversation.preserve_messages) {
          updates.expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
      }

      if (normalizedStatus === 'archived') {
        updates.archived_at = new Date();
        updates.chat_status = 'ARCHIVED';
        if (!conversation.preserve_messages) {
          updates.expires_at = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        }
      }

      await ChatRepository.updateConversation(conversationId, updates, connection);

      const systemText = normalizedStatus === 'resolved'
        ? 'Conversation resolved'
        : normalizedStatus === 'closed'
          ? 'Conversation closed'
          : 'Conversation archived';

      await ChatRepository.createMessage({
        conversationId,
        senderId: actorId,
        messageText: systemText,
        type: 'SYSTEM',
        attachments: [],
        metadata: { conversationStatus: normalizedStatus }
      }, connection);

      if (isInternalTransaction) {
        await connection.commit();
      }

      await this._emitSupportPoolUpdate({
        ...conversation,
        ...updates,
        id: conversationId,
        admin_id: updates.admin_id || conversation.admin_id,
        status: normalizedStatus
      });

      return ChatRepository.findById(conversationId, passedConnection || pool);
    } catch (error) {
      if (isInternalTransaction) {
        await connection.rollback();
      }
      throw error;
    } finally {
      if (isInternalTransaction) {
        connection.release();
      }
    }
  }

  async claimSupportConversation(conversationId, actorId, actorRole, passedConnection = null) {
    const connection = passedConnection || await pool.getConnection();
    const isInternalTransaction = !passedConnection;

    if (isInternalTransaction) {
      await connection.beginTransaction();
    }

    try {
      if (!['ADMIN', 'OWNER'].includes(`${actorRole || ''}`.toUpperCase())) {
        throw new AppError('Only admin or owner can claim support conversations.', 403);
      }

      const conversation = await ChatRepository.findById(conversationId, connection);
      if (!conversation || conversation.type !== 'SUPPORT') {
        throw new AppError('Support conversation not found.', 404);
      }

      const normalizedStatus = `${conversation.status || ''}`.toLowerCase();
      if (['closed', 'archived'].includes(normalizedStatus)) {
        throw new AppError('This support conversation is no longer active.', 409);
      }

      if (conversation.admin_id && Number(conversation.admin_id) !== Number(actorId)) {
        throw new AppError('This support conversation has already been claimed.', 409);
      }

      await ChatRepository.updateConversation(conversationId, {
        admin_id: actorId,
        status: 'assigned',
        assigned_at: conversation.assigned_at || new Date(),
        queue_position: null
      }, connection);

      if (isInternalTransaction) {
        await connection.commit();
      }

      const claimedConversation = await ChatRepository.findById(conversationId, passedConnection || pool);
      await this._emitSupportPoolUpdate({
        ...claimedConversation,
        id: conversationId,
        admin_id: actorId,
        status: 'assigned'
      });

      return claimedConversation;
    } catch (error) {
      if (isInternalTransaction) {
        await connection.rollback();
      }
      throw error;
    } finally {
      if (isInternalTransaction) {
        connection.release();
      }
    }
  }

  async convertContactMessageToSupportChat(contactMessageId, actorId, locale = 'en') {
    const contactMessage = await ContactMessageRepository.findById(contactMessageId);
    if (!contactMessage) {
      throw new Error('Contact message not found');
    }

    const pseudoUserId = actorId;
    return this.startInquiry(pseudoUserId, {
      type: 'SUPPORT',
      messageText: contactMessage.message,
      metadata: {
        contact_name: contactMessage.name,
        contact_email: contactMessage.email,
        contact_phone: contactMessage.phone || null
      },
      locale,
      source: 'contact_us',
      contactMessageId
    });
  }

  async getConversations(userId, role) {
    return ChatRepository.getConversations(userId, role);
  }

  async getOwnerSupportArchives() {
    return ChatRepository.getOwnerSupportArchives();
  }

  async getOwnerSupportConversations(scope = 'all') {
    return ChatRepository.getOwnerSupportConversations(scope);
  }

  async getOwnerSupportConversationMessages(conversationId) {
    const conversation = await ChatRepository.findById(conversationId);
    if (!conversation || !['SUPPORT', 'INQUIRY'].includes(`${conversation.type || ''}`.toUpperCase())) {
      throw new AppError('Conversation not found.', 404);
    }

    const messages = await ChatRepository.getMessages(conversationId);
    return {
      conversation,
      messages
    };
  }

  async archiveSupportConversation(conversationId) {
    return ChatRepository.archiveSupportConversation(conversationId);
  }

  async deleteSupportConversation(conversationId) {
    const conversation = await ChatRepository.findById(conversationId);
    if (!conversation) return true;

    await ChatRepository.deleteConversationPermanently(conversationId);

    try {
      const io = getIO();
      io.to(`conv_${conversationId}`).emit('conversation_deleted', { conversationId });
      io.to(`${conversation.user_id}`).emit('conversation_deleted', { conversationId });

      const admins = await UserRepository.findAdminPool();
      admins.forEach((admin) => {
        io.to(`${admin.id}`).emit('conversation_deleted', { conversationId });
      });
    } catch {
      // Socket availability is optional.
    }

    return true;
  }
}

export default new ChatService();
