import express from 'express';
import RfqController from '../controllers/RfqController.js';
import { protect, authorize } from '../middlewares/auth.js';
import { rfqCreationLimiter, offerSubmissionLimiter, inquiryLimiter, uploadLimiter } from '../middlewares/rateLimiters.js';
import { upload, verifyUploadedImages, uploadErrorHandler } from '../utils/upload.js';
import { validate } from '../middlewares/validate.js';
import { rfqSchemas } from '../validators/schemas.js';

const router = express.Router();

router.use(protect);

// ── Vendor Actions ──
router.get('/feed', authorize('MOWARED'), validate({ query: rfqSchemas.feedQuery }), RfqController.getFeed);
router.patch('/:id/decline', authorize('MOWARED'), validate({ params: rfqSchemas.idParam }), RfqController.decline);
router.post('/:id/offer', authorize('MOWARED'), validate({ params: rfqSchemas.idParam, body: rfqSchemas.submitOffer }), offerSubmissionLimiter, RfqController.submitOffer);

// ── Admin Actions ──
router.get('/', (req, res, next) => {
  const role = req.user.role?.toUpperCase();
  if (role === 'USER') return RfqController.getMine(req, res, next);
  if (role === 'ADMIN' || role === 'OWNER') return RfqController.getAllAdmin(req, res, next);
  return res.status(403).json({
    success: false,
    data: null,
    message: 'Only buyers, admins, or owners can access this RFQ listing.',
    error: 'Forbidden'
  });
});
router.get('/:id', authorize('USER', 'MOWARED', 'ADMIN', 'OWNER'), validate({ params: rfqSchemas.idParam }), RfqController.getOne);
router.post('/:id/broadcast', authorize('ADMIN', 'OWNER'), validate({ params: rfqSchemas.idParam }), RfqController.broadcast);
router.post('/:id/reject', authorize('ADMIN', 'OWNER'), validate({ params: rfqSchemas.idParam }), RfqController.reject);

// ── User Actions ──
router.post(
  '/',
  (req, res, next) => {
    const role = req.user.role?.toUpperCase();
    if (role === 'USER' || role === 'MARKETER') return next();
    return res.status(403).json({
      success: false,
      data: null,
      message: 'Only buyer accounts can create RFQs.',
      error: 'Forbidden'
    });
  },
  rfqCreationLimiter,
  uploadLimiter,
  upload.single('image'),
  uploadErrorHandler,
  verifyUploadedImages,
  validate({ body: rfqSchemas.create }),
  RfqController.create
);
router.delete('/:id', authorize('USER'), validate({ params: rfqSchemas.idParam }), RfqController.delete);
router.patch('/offers/:offerId/accept', authorize('USER'), validate({ params: rfqSchemas.offerIdParam }), inquiryLimiter, RfqController.acceptOffer);

export default router;
