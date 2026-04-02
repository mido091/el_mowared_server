/**
 * @file ChatController.js
 * @description Controller for B2B communications and real-time inquiries.
 * Orchestrates the creation of product-linked conversations and message retrieval.
 */

import ChatService from '../services/ChatService.js';
import ChatRepository from '../repositories/ChatRepository.js';
import UploadService from '../services/UploadService.js';
import pool from '../config/db.js';
import { z } from 'zod';
import { AppError } from '../middlewares/errorHandler.js';

// Request Validation
const startConversationSchema = z.object({
  vendorId: z.number().or(z.string().regex(/^\d+$/).transform(v => parseInt(v))).nullable().optional(),
  buyerId: z.number().or(z.string().regex(/^\d+$/).transform(v => parseInt(v))).nullable().optional(),
  type: z.enum(['INQUIRY', 'SUPPORT', 'PRODUCT', 'RFQ', 'ADMIN_VENDOR', 'INTERNAL']).optional(),
  productId: z.number().or(z.string().regex(/^\d+$/).transform(v => parseInt(v))).nullable().optional(),
  relatedRfqId: z.number().or(z.string().regex(/^\d+$/).transform(v => parseInt(v))).nullable().optional(),
  relatedOrderId: z.number().or(z.string().regex(/^\d+$/).transform(v => parseInt(v))).nullable().optional(),
  requestedQuantity: z.preprocess((value) => value === null || value === undefined || value === '' ? null : Number(value), z.number().nullable().optional()),
  messageText: z.string().min(1),
  metadata: z.record(z.string(), z.any()).optional(),
  source: z.string().optional()
});

const sendMessageSchema = z.object({
  message: z.string().min(1),
  metadata: z.record(z.string(), z.any()).nullable().optional()
});

const updateConversationStatusSchema = z.object({
  status: z.enum(['active', 'idle', 'resolved', 'closed', 'archived'])
});

const supportAvailabilityQuerySchema = z.object({
  conversationId: z.string().regex(/^\d+$/).optional()
});

const LOCKED_CONVERSATION_TYPES = new Set(['SUPPORT']);

class ChatController {
  _respond(res, statusCode, data, message = '') {
    res.status(statusCode).json({
      success: statusCode >= 200 && statusCode < 300,
      data,
      message
    });
  }

  async _loadConversationForParticipant(conversationId, user) {
    const [rows] = await pool.execute(
      `SELECT id, type, status, user_id, admin_id
       FROM conversations
       WHERE id = ?
         AND (
           user_id = ?
           OR vendor_id = (SELECT id FROM vendor_profiles WHERE user_id = ?)
           OR admin_id = ?
           OR (? IN ('ADMIN', 'OWNER') AND admin_id IS NULL AND type IN ('SUPPORT', 'INTERNAL'))
         )`,
      [conversationId, user.id, user.id, user.id, user.role]
    );

    return rows[0] || null;
  }

  _isOwnerParticipant(conversation, user) {
    return conversation.user_id === user.id;
  }

  _shouldGateMessage(conversation, user) {
    return LOCKED_CONVERSATION_TYPES.has(conversation.type) &&
      this._isOwnerParticipant(conversation, user) &&
      !!conversation.admin_id &&
      ['assigned'].includes((conversation.status || '').toLowerCase());
  }

  async _unlockConversationIfNeeded(conversation, user) {
    const status = (conversation.status || '').toLowerCase();
    const isPrivilegedResponder =
      conversation.user_id !== user.id &&
      (conversation.admin_id === user.id || ['ADMIN', 'OWNER'].includes(user.role) || user.role === 'MOWARED');

    if (LOCKED_CONVERSATION_TYPES.has(conversation.type) && isPrivilegedResponder && ['waiting', 'assigned'].includes(status)) {
      await pool.execute("UPDATE conversations SET status = 'active' WHERE id = ?", [conversation.id]);
      conversation.status = 'active';
    }
  }

  /**
   * Initializes a new inquiry thread.
   * Transparently captures product snapshots to preserve B2B context for the merchant.
   */
  startConversation = async (req, res, next) => {
    try {
      const { vendorId, buyerId, productId, relatedRfqId, relatedOrderId, messageText, requestedQuantity, type, metadata, source } = startConversationSchema.parse(req.body);
      const result = await ChatService.startInquiry(req.user.id, {
        vendorId,
        buyerId,
        productId,
        relatedRfqId,
        relatedOrderId,
        messageText,
        requestedQuantity,
        type,
        metadata,
        source,
        initiatorRole: req.user.role,
        initiatorVendorProfileId: req.user.vendorProfile?.id || null,
        locale: req.locale || req.headers['accept-language'] || 'en'
      });
      this._respond(res, 201, result, 'Conversation started successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sends a message to an existing conversation without creating a new thread.
   * Used by the Chat page when replying to an established conversation.
   */
  sendMessage = async (req, res, next) => {
    try {
      const { message, metadata } = sendMessageSchema.parse(req.body);
      const conversationId = parseInt(req.params.id);

      const conv = await this._loadConversationForParticipant(conversationId, req.user);
      if (!conv) {
        throw new AppError('Conversation not found or access denied', 403);
      }

      if (this._shouldGateMessage(conv, req.user)) {
        throw new AppError('Please wait for the support agent to reply before sending another message.', 403);
      }

      await this._unlockConversationIfNeeded(conv, req.user);

      const messageType = conv.type === 'INTERNAL' ? 'SYSTEM' : 'TEXT';
      const newMessage = await ChatService.sendConversationMessage({
        conversationId,
        senderId: req.user.id,
        senderRole: req.user.role,
        messageText: message,
        messageType,
        metadata,
        locale: req.locale || req.headers['accept-language'] || 'en'
      });

      this._respond(res, 201, newMessage, 'Message sent successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves inbox list using universal RBAC.
   */
  getConversations = async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) throw new AppError('Authentication context missing', 401);
      const conversations = await ChatService.getConversations(req.user.id, req.user.role);
      this._respond(res, 200, conversations, 'Conversations fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  getSupportAvailability = async (req, res, next) => {
    try {
      const { conversationId } = supportAvailabilityQuerySchema.parse(req.query || {});
      const data = await ChatService.getSupportAvailability(
        conversationId ? Number(conversationId) : null
      );
      this._respond(res, 200, data, 'Support availability fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves historic messages for a thread.
   */
  getMessages = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);

      const conv = await this._loadConversationForParticipant(conversationId, req.user);
      if (!conv) {
        throw new AppError('Conversation not found or access denied', 403);
      }

      const messages = await ChatRepository.getMessages(conversationId);
      this._respond(res, 200, messages, 'Messages fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Processes multipart/form-data for Chat Attachments (Images, PDFs).
   * Verifies access via RBAC, uploads to Cloudinary, stores metadata, and broadcasts.
   */
  uploadAttachments = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conv = await this._loadConversationForParticipant(conversationId, req.user);

      if (!conv) {
        throw new AppError('Conversation not found or access denied', 403);
      }

      if (this._shouldGateMessage(conv, req.user)) {
        throw new AppError('Please wait for the support agent to reply before sending another message.', 403);
      }

      await this._unlockConversationIfNeeded(conv, req.user);

      if (!req.files || req.files.length === 0) {
        throw new AppError('No files uploaded', 400);
      }

      const attachments = [];
      for (const file of req.files) {
        const result = await UploadService.uploadImage(file.buffer, 'elmowared/chat');
        attachments.push({
          url: result.url,
          format: file.safeExtension?.replace('.', '') || 'image',
          name: file.safeFileName || 'attachment',
          size: file.size
        });
      }

      const newMessage = await ChatService.sendConversationMessage({
        conversationId,
        senderId: req.user.id,
        senderRole: req.user.role,
        messageText: 'Attachment',
        messageType: 'IMAGE',
        attachments,
        locale: req.locale || req.headers['accept-language'] || 'en'
      });

      this._respond(res, 201, newMessage, 'Attachments uploaded successfully.');
    } catch (error) {
      next(error);
    }
  }

  updateConversationStatus = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);
      const { status } = updateConversationStatusSchema.parse(req.body);

      const conv = await this._loadConversationForParticipant(conversationId, req.user);
      if (!conv) {
        throw new AppError('Conversation not found or access denied', 403);
      }

      const updated = await ChatService.updateConversationStatus(conversationId, status, req.user.id);
      this._respond(res, 200, updated, 'Conversation status updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  claimSupportConversation = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);

      const conv = await this._loadConversationForParticipant(conversationId, req.user);
      if (!conv) {
        throw new AppError('Conversation not found or access denied', 403);
      }

      const claimed = await ChatService.claimSupportConversation(conversationId, req.user.id, req.user.role);
      this._respond(res, 200, claimed, 'Support conversation claimed successfully.');
    } catch (error) {
      next(error);
    }
  }

  deleteConversation = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conv = await this._loadConversationForParticipant(conversationId, req.user);

      if (!conv) {
        throw new AppError('Conversation not found or access denied', 403);
      }

      if (!['ADMIN', 'OWNER'].includes(`${req.user.role || ''}`.toUpperCase()) || `${conv.type || ''}`.toUpperCase() !== 'SUPPORT') {
        throw new AppError('Only admin or owner can permanently delete support conversations.', 403);
      }

      await ChatService.deleteSupportConversation(conversationId);
      this._respond(res, 200, { id: conversationId }, 'Conversation deleted permanently.');
    } catch (error) {
      next(error);
    }
  }

  getOwnerSupportArchives = async (req, res, next) => {
    try {
      const archives = await ChatService.getOwnerSupportArchives();
      this._respond(res, 200, archives, 'Support archives fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  getOwnerSupportConversations = async (req, res, next) => {
    try {
      const scope = ['all', 'expiring', 'archived'].includes(`${req.query.scope || 'all'}`.toLowerCase())
        ? `${req.query.scope || 'all'}`.toLowerCase()
        : 'all';
      const conversations = await ChatService.getOwnerSupportConversations(scope);
      this._respond(res, 200, conversations, 'Support conversations fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  getOwnerSupportConversationMessages = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);
      const details = await ChatService.getOwnerSupportConversationMessages(conversationId);
      this._respond(res, 200, details, 'Support conversation fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  archiveSupportConversation = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);
      const archived = await ChatService.archiveSupportConversation(conversationId);
      this._respond(res, 200, archived, 'Support conversation archived successfully.');
    } catch (error) {
      next(error);
    }
  }

  deleteSupportConversation = async (req, res, next) => {
    try {
      const conversationId = parseInt(req.params.id);
      await ChatService.deleteSupportConversation(conversationId);
      this._respond(res, 200, { id: conversationId }, 'Support conversation deleted permanently.');
    } catch (error) {
      next(error);
    }
  }

  deleteOwnerSupportConversations = async (req, res, next) => {
    try {
      const scope = ['all', 'expiring', 'archived'].includes(`${req.query.scope || 'all'}`.toLowerCase())
        ? `${req.query.scope || 'all'}`.toLowerCase()
        : 'all';
      const result = await ChatService.deleteOwnerSupportConversations(scope);
      this._respond(res, 200, result, 'Support conversations deleted permanently.');
    } catch (error) {
      next(error);
    }
  }
}

export default new ChatController();
