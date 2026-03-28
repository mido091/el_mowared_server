import express from 'express';
import RealtimeController from '../controllers/RealtimeController.js';
import { protect } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { realtimeSchemas } from '../validators/schemas.js';

const router = express.Router();

router.post('/pusher/auth', protect, validate({ body: realtimeSchemas.pusherAuth }), RealtimeController.authorizeChannel);
router.post('/presence', protect, validate({ body: realtimeSchemas.presence }), RealtimeController.presence);
router.post('/chat/typing', protect, validate({ body: realtimeSchemas.typing }), RealtimeController.typing);
router.post('/chat/read', protect, validate({ body: realtimeSchemas.read }), RealtimeController.read);

export default router;
