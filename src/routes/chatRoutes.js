import express from 'express';
import ChatController from '../controllers/ChatController.js';
import { protect } from '../middlewares/auth.js';
import { chatUpload, verifyUploadedImages, uploadErrorHandler } from '../utils/upload.js';
import { validate } from '../middlewares/validate.js';
import { chatSchemas } from '../validators/schemas.js';
import { chatMessageLimiter, uploadLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

router.post('/start', protect, chatMessageLimiter, validate({ body: chatSchemas.start }), ChatController.startConversation);
router.get('/conversations', protect, ChatController.getConversations);
router.get('/support/availability', protect, ChatController.getSupportAvailability);
router.patch('/:id/claim', protect, validate({ params: chatSchemas.conversationIdParam }), ChatController.claimSupportConversation);
router.delete('/:id', protect, validate({ params: chatSchemas.conversationIdParam }), ChatController.deleteConversation);
router.get('/:id/messages', protect, validate({ params: chatSchemas.conversationIdParam }), ChatController.getMessages);
router.post('/:id/messages', protect, validate({ params: chatSchemas.conversationIdParam, body: chatSchemas.sendMessage }), chatMessageLimiter, ChatController.sendMessage);
router.post('/:id/messages/upload', protect, validate({ params: chatSchemas.conversationIdParam }), uploadLimiter, chatUpload.array('attachments', 5), uploadErrorHandler, verifyUploadedImages, ChatController.uploadAttachments);
router.patch('/:id/status', protect, validate({ params: chatSchemas.conversationIdParam, body: chatSchemas.updateStatus }), ChatController.updateConversationStatus);

export default router;
