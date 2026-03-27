import ContactMessageRepository from '../repositories/ContactMessageRepository.js';
import ChatService from '../services/ChatService.js';
import { z } from 'zod';

const createContactSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  message: z.string().min(5)
});

const updateStatusSchema = z.object({
  status: z.enum(['new', 'converted', 'closed'])
});

const convertToChatSchema = z.object({
  locale: z.string().optional()
});

class ContactController {
  _respond(res, statusCode, data, message = '') {
    res.status(statusCode).json({
      success: statusCode >= 200 && statusCode < 300,
      data,
      message
    });
  }

  submitMessage = async (req, res, next) => {
    try {
      const data = createContactSchema.parse(req.body);
      const result = await ContactMessageRepository.create(data);
      this._respond(res, 201, result, 'Contact message submitted successfully.');
    } catch (error) {
      next(error);
    }
  }

  getMessages = async (req, res, next) => {
    try {
      const messages = await ContactMessageRepository.findAll();
      this._respond(res, 200, messages, 'Contact messages fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  updateStatus = async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = updateStatusSchema.parse(req.body);
      await ContactMessageRepository.updateStatus(id, status);
      this._respond(res, 200, { id, status }, 'Status updated');
    } catch (error) {
      next(error);
    }
  }

  convertToChat = async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { locale } = convertToChatSchema.parse(req.body || {});
      const result = await ChatService.convertContactMessageToSupportChat(id, req.user.id, locale || req.locale || 'en');
      this._respond(res, 201, result, 'Contact message converted to support chat.');
    } catch (error) {
      next(error);
    }
  }
}

export default new ContactController();
