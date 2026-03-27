import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import UserRepository from '../repositories/UserRepository.js';
import ChatRepository from '../repositories/ChatRepository.js';
import { env } from './env.js';
import logger from '../utils/logger.js';

const onlineUsers = new Map();
const socketEventBuckets = new Map();
let io;

const normalizeUserId = (value) => {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? String(value) : numeric;
};

const consumeSocketQuota = (userId, eventName, maxEvents, windowMs) => {
  const now = Date.now();
  const bucketKey = `${userId}:${eventName}`;
  const bucket = socketEventBuckets.get(bucketKey) || [];
  const freshEntries = bucket.filter((timestamp) => now - timestamp < windowMs);

  if (freshEntries.length >= maxEvents) {
    return false;
  }

  freshEntries.push(now);
  socketEventBuckets.set(bucketKey, freshEntries);
  return true;
};

const emitSocketError = (socket, message) => {
  socket.emit('socket_error', { message });
};

const requireConversationAccess = async (socket, conversationId) => {
  const numericConversationId = Number(conversationId);
  if (!Number.isInteger(numericConversationId) || numericConversationId <= 0) {
    emitSocketError(socket, 'Invalid conversation id.');
    return null;
  }

  const canAccess = await ChatRepository.userCanAccessConversation(
    numericConversationId,
    socket.user.id,
    socket.user.role
  );

  if (!canAccess) {
    emitSocketError(socket, 'Access denied for this conversation.');
    logger.warn('Socket conversation access denied', {
      userId: socket.user.id,
      conversationId: numericConversationId,
      role: socket.user.role
    });
    return null;
  }

  return numericConversationId;
};

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: env.frontendOrigins,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Auth error: Token missing'));

    try {
      const decoded = jwt.verify(token, env.jwtSecret);
      const user = await UserRepository.findById(decoded.id);
      if (!user || !user.is_active) {
        return next(new Error('Auth error: User no longer exists'));
      }
      socket.user = user;
      next();
    } catch (error) {
      logger.warn('Socket authentication failed', { message: error.message });
      next(new Error('Auth error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = normalizeUserId(socket.user.id);
    socket.user.id = userId;

    socket.join(userId.toString());

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      io.emit('user_presence', { userId, status: 'online' });
    }
    onlineUsers.get(userId).add(socket.id);

    socket.on('join_conversation', async (conversationId) => {
      const allowedConversationId = await requireConversationAccess(socket, conversationId);
      if (!allowedConversationId) return;
      socket.join(`conv_${allowedConversationId}`);
    });

    socket.on('leave_conversation', async (conversationId) => {
      const allowedConversationId = await requireConversationAccess(socket, conversationId);
      if (!allowedConversationId) return;
      socket.leave(`conv_${allowedConversationId}`);
    });

    socket.on('typing_start', async ({ conversationId }) => {
      if (!consumeSocketQuota(userId, 'typing_start', 12, 5000)) {
        return emitSocketError(socket, 'Typing rate limit exceeded.');
      }

      const allowedConversationId = await requireConversationAccess(socket, conversationId);
      if (!allowedConversationId) return;
      socket.to(`conv_${allowedConversationId}`).emit('typing_start', { conversationId: allowedConversationId, userId });
    });

    socket.on('typing_stop', async ({ conversationId }) => {
      const allowedConversationId = await requireConversationAccess(socket, conversationId);
      if (!allowedConversationId) return;
      socket.to(`conv_${allowedConversationId}`).emit('typing_stop', { conversationId: allowedConversationId, userId });
    });

    socket.on('message_read', async ({ conversationId, messageId }) => {
      try {
        if (!consumeSocketQuota(userId, 'message_read', 30, 10000)) {
          return emitSocketError(socket, 'Read receipt rate limit exceeded.');
        }

        const allowedConversationId = await requireConversationAccess(socket, conversationId);
        if (!allowedConversationId) return;

        await ChatRepository.markMessageRead(Number(messageId), userId);
        socket.to(`conv_${allowedConversationId}`).emit('message_read_update', {
          conversationId: allowedConversationId,
          messageId: Number(messageId),
          readBy: userId,
          readAt: new Date().toISOString()
        });
      } catch (error) {
        logger.error('Socket read receipt error', {
          userId,
          conversationId,
          messageId,
          message: error.message
        });
      }
    });

    socket.on('disconnect', () => {
      const userSockets = onlineUsers.get(userId);
      if (!userSockets) return;

      userSockets.delete(socket.id);
      if (!userSockets.size) {
        onlineUsers.delete(userId);
        io.emit('user_presence', { userId, status: 'offline', lastSeen: new Date().toISOString() });
      }
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

export const closeSocket = async () => {
  if (io) {
    await io.close();
    io = null;
  }
};

export const isUserOnline = (userId) => {
  if (userId === undefined || userId === null) return false;
  const normalized = normalizeUserId(userId);
  return onlineUsers.has(normalized) || onlineUsers.has(String(userId));
};

export const getOnlineUserIds = () => Array.from(onlineUsers.keys());
