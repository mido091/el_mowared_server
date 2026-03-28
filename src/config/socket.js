import Pusher from 'pusher';
import ChatRepository from '../repositories/ChatRepository.js';
import { AppError, badRequest, forbidden } from '../middlewares/errorHandler.js';
import { env } from './env.js';
import logger from '../utils/logger.js';

const PRESENCE_CHANNEL = 'presence-online-users';
const realtimeBuckets = new Map();
const PRESENCE_TTL_MS = 45_000;
const onlineHeartbeatCache = new Map();
const onlineUsersCache = {
  users: new Set(),
  expiresAt: 0,
  pending: null
};

let pusherClient = null;

const normalizeUserId = (value) => {
  const numeric = Number(value);
  return Number.isNaN(numeric) ? String(value) : numeric;
};

const normalizeRoomToChannel = (room) => {
  const normalizedRoom = `${room || ''}`.trim();
  if (!normalizedRoom) return null;

  if (normalizedRoom === PRESENCE_CHANNEL || normalizedRoom.startsWith('private-') || normalizedRoom.startsWith('presence-')) {
    return normalizedRoom;
  }

  if (normalizedRoom.startsWith('conv_')) {
    return `private-conversation.${normalizedRoom.replace(/^conv_/, '')}`;
  }

  if (/^\d+$/.test(normalizedRoom)) {
    return `private-user.${normalizedRoom}`;
  }

  return normalizedRoom;
};

const ensurePusher = () => {
  if (pusherClient) {
    return pusherClient;
  }

  pusherClient = new Pusher({
    appId: env.pusherAppId,
    key: env.pusherKey,
    secret: env.pusherSecret,
    cluster: env.pusherCluster,
    useTLS: true
  });

  return pusherClient;
};

const consumeRealtimeQuota = (userId, eventName, maxEvents, windowMs) => {
  const now = Date.now();
  const bucketKey = `${userId}:${eventName}`;
  const bucket = realtimeBuckets.get(bucketKey) || [];
  const freshEntries = bucket.filter((timestamp) => now - timestamp < windowMs);

  if (freshEntries.length >= maxEvents) {
    return false;
  }

  freshEntries.push(now);
  realtimeBuckets.set(bucketKey, freshEntries);
  return true;
};

const requireConversationAccess = async (user, conversationId) => {
  const numericConversationId = Number(conversationId);

  if (!Number.isInteger(numericConversationId) || numericConversationId <= 0) {
    throw badRequest({
      en: 'Invalid conversation id.',
      ar: 'معرف المحادثة غير صالح.'
    }, 'INVALID_CONVERSATION_ID');
  }

  const canAccess = await ChatRepository.userCanAccessConversation(
    numericConversationId,
    user.id,
    user.role
  );

  if (!canAccess) {
    throw forbidden({
      en: 'Access denied for this conversation.',
      ar: 'ليس لديك صلاحية الوصول إلى هذه المحادثة.'
    }, 'CONVERSATION_ACCESS_DENIED');
  }

  return numericConversationId;
};

const parsePresenceUsersResponse = (response) => {
  if (!response) return [];

  const body = typeof response.body === 'string'
    ? JSON.parse(response.body || '{}')
    : (response.body || response);

  return Array.isArray(body?.users) ? body.users : [];
};

const pruneHeartbeatPresence = () => {
  const now = Date.now();
  Array.from(onlineHeartbeatCache.entries()).forEach(([userId, expiresAt]) => {
    if (expiresAt <= now) {
      onlineHeartbeatCache.delete(userId);
    }
  });
};

const getHeartbeatOnlineUsers = () => {
  pruneHeartbeatPresence();
  return new Set(Array.from(onlineHeartbeatCache.keys()));
};

const markUserPresence = (userId, state = 'online') => {
  const normalizedUserId = normalizeUserId(userId);
  if (state === 'offline') {
    onlineHeartbeatCache.delete(normalizedUserId);
    onlineHeartbeatCache.delete(String(normalizedUserId));
    return;
  }

  const expiresAt = Date.now() + PRESENCE_TTL_MS;
  onlineHeartbeatCache.set(normalizedUserId, expiresAt);
  onlineHeartbeatCache.set(String(normalizedUserId), expiresAt);
};

const refreshOnlineUsers = async (force = false) => {
  const now = Date.now();
  if (!force && onlineUsersCache.pending) {
    return onlineUsersCache.pending;
  }

  if (!force && onlineUsersCache.expiresAt > now) {
    return onlineUsersCache.users;
  }

  onlineUsersCache.pending = ensurePusher()
    .get({ path: `/channels/${PRESENCE_CHANNEL}/users` })
    .then((response) => {
      const users = new Set(
        parsePresenceUsersResponse(response).map((member) => normalizeUserId(member.id))
      );
      onlineUsersCache.users = users;
      onlineUsersCache.expiresAt = Date.now() + 10_000;
      return users;
    })
    .catch((error) => {
      logger.warn('Unable to refresh Pusher presence users', {
        message: error.message
      });
      return onlineUsersCache.users;
    })
    .finally(() => {
      onlineUsersCache.pending = null;
    });

  return onlineUsersCache.pending;
};

class RealtimeEmitter {
  constructor(channels = []) {
    this.channels = [...new Set(channels.filter(Boolean))];
  }

  to(room) {
    const channel = normalizeRoomToChannel(room);
    return new RealtimeEmitter([...this.channels, channel]);
  }

  emit(eventName, payload) {
    if (!this.channels.length) {
      return Promise.resolve(false);
    }

    return ensurePusher()
      .trigger(this.channels, eventName, payload)
      .catch((error) => {
        logger.warn('Realtime trigger failed', {
          eventName,
          channels: this.channels,
          message: error.message
        });
        return false;
      });
  }
}

export const initSocket = () => {
  ensurePusher();
  return getIO();
};

export const closeSocket = async () => {
  pusherClient = null;
  onlineUsersCache.users = new Set();
  onlineUsersCache.expiresAt = 0;
  onlineUsersCache.pending = null;
};

export const getIO = () => {
  ensurePusher();
  return new RealtimeEmitter();
};

export const getPresenceChannelName = () => PRESENCE_CHANNEL;

export const authorizePusherChannel = async ({ socketId, channelName, user }) => {
  if (!socketId || !channelName) {
    throw badRequest({
      en: 'Pusher authorization payload is incomplete.',
      ar: 'بيانات توثيق Pusher غير مكتملة.'
    }, 'REALTIME_AUTH_INVALID');
  }

  if (channelName === PRESENCE_CHANNEL) {
    markUserPresence(user.id, 'online');
    return ensurePusher().authorizeChannel(socketId, channelName, {
      user_id: `${user.id}`,
      user_info: {
        id: user.id,
        role: user.role,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        vendor_profile_id: user.vendorProfile?.id || null
      }
    });
  }

  const userChannelMatch = channelName.match(/^private-user\.(\d+)$/);
  if (userChannelMatch) {
    if (Number(userChannelMatch[1]) !== Number(user.id)) {
      throw forbidden({
        en: 'You are not allowed to subscribe to this realtime channel.',
        ar: 'غير مسموح لك بالاشتراك في هذه القناة الفورية.'
      }, 'REALTIME_CHANNEL_FORBIDDEN');
    }

    return ensurePusher().authorizeChannel(socketId, channelName);
  }

  const conversationMatch = channelName.match(/^private-conversation\.(\d+)$/);
  if (conversationMatch) {
    await requireConversationAccess(user, conversationMatch[1]);
    return ensurePusher().authorizeChannel(socketId, channelName);
  }

  throw forbidden({
    en: 'This realtime channel is not available for your account.',
    ar: 'هذه القناة الفورية غير متاحة لحسابك.'
  }, 'REALTIME_CHANNEL_FORBIDDEN');
};

export const handlePresenceSync = async ({ user, state }) => {
  const normalizedState = `${state || ''}`.toLowerCase();
  if (!['online', 'offline'].includes(normalizedState)) {
    throw badRequest({
      en: 'Presence state is invalid.',
      ar: 'حالة التواجد غير صالحة.'
    }, 'INVALID_PRESENCE_STATE');
  }

  markUserPresence(user.id, normalizedState);

  return {
    userId: normalizeUserId(user.id),
    state: normalizedState
  };
};

export const getOnlineUserIds = async () => {
  const pusherUsers = await refreshOnlineUsers();
  const combined = new Set([
    ...Array.from(pusherUsers || []),
    ...Array.from(getHeartbeatOnlineUsers())
  ]);
  return Array.from(combined);
};

export const isUserOnline = async (userId) => {
  if (userId === undefined || userId === null) return false;
  const normalized = normalizeUserId(userId);
  const users = new Set(await getOnlineUserIds());
  return users.has(normalized) || users.has(String(normalized));
};

export const handleTypingEvent = async ({ user, conversationId, state }) => {
  const normalizedState = `${state || ''}`.toLowerCase();
  if (!['start', 'stop'].includes(normalizedState)) {
    throw badRequest({
      en: 'Typing state is invalid.',
      ar: 'حالة الكتابة غير صالحة.'
    }, 'INVALID_TYPING_STATE');
  }

  if (normalizedState === 'start' && !consumeRealtimeQuota(user.id, 'typing_start', 12, 5000)) {
    throw new AppError({
      en: 'Typing rate limit exceeded.',
      ar: 'تم تجاوز الحد المسموح لإشعارات الكتابة.'
    }, 429, 'RATE_LIMITED');
  }

  const allowedConversationId = await requireConversationAccess(user, conversationId);
  await getIO()
    .to(`conv_${allowedConversationId}`)
    .emit(`typing_${normalizedState}`, {
      conversationId: allowedConversationId,
      userId: normalizeUserId(user.id)
    });

  return {
    conversationId: allowedConversationId,
    state: normalizedState
  };
};

export const handleMessageReadEvent = async ({ user, conversationId, messageId }) => {
  if (!consumeRealtimeQuota(user.id, 'message_read', 30, 10000)) {
    throw new AppError({
      en: 'Read receipt rate limit exceeded.',
      ar: 'تم تجاوز الحد المسموح لإشعارات قراءة الرسائل.'
    }, 429, 'RATE_LIMITED');
  }

  const allowedConversationId = await requireConversationAccess(user, conversationId);
  const normalizedMessageId = Number(messageId);
  if (!Number.isInteger(normalizedMessageId) || normalizedMessageId <= 0) {
    throw badRequest({
      en: 'Message id is invalid.',
      ar: 'معرف الرسالة غير صالح.'
    }, 'INVALID_MESSAGE_ID');
  }

  await ChatRepository.markMessageRead(normalizedMessageId, normalizeUserId(user.id));

  const payload = {
    conversationId: allowedConversationId,
    messageId: normalizedMessageId,
    readBy: normalizeUserId(user.id),
    readAt: new Date().toISOString()
  };

  await getIO()
    .to(`conv_${allowedConversationId}`)
    .emit('message_read_update', payload);

  return payload;
};
