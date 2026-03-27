import QuickReplyRepository from '../repositories/QuickReplyRepository.js';
import { z } from 'zod';
import { AppError } from '../middlewares/errorHandler.js';

const createQuickReplySchema = z.object({
  category: z.string().optional(),
  title: z.string().min(1),
  content: z.string().min(1)
});

class QuickReplyController {
  async createReply(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError({
          en: 'You need to sign in to continue.',
          ar: 'تحتاج إلى تسجيل الدخول للمتابعة.'
        }, 401, 'UNAUTHORIZED');
      }
      const data = createQuickReplySchema.parse(req.body);
      
      const result = await QuickReplyRepository.create({
        userId: req.user.id,
        ...data
      });
      res.status(201).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  async getReplies(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        throw new AppError({
          en: 'You need to sign in to continue.',
          ar: 'تحتاج إلى تسجيل الدخول للمتابعة.'
        }, 401, 'UNAUTHORIZED');
      }
      const replies = await QuickReplyRepository.findAllByUser(req.user.id);
      res.status(200).json({ status: 'success', data: replies });
    } catch (error) {
      next(error);
    }
  }

  async deleteReply(req, res, next) {
    try {
      const id = parseInt(req.params.id);
      const success = await QuickReplyRepository.delete(id, req.user.id);
      if (!success) {
        throw new AppError({
          en: 'Reply not found or access denied.',
          ar: 'الرد السريع غير موجود أو لا تملك صلاحية الوصول إليه.'
        }, 404, 'NOT_FOUND');
      }
      res.status(200).json({ status: 'success', message: 'Reply deleted' });
    } catch (error) {
      next(error);
    }
  }
}

export default new QuickReplyController();
