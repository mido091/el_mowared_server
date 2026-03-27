import express from 'express';
import AuthController from '../controllers/AuthController.js';
import { protect } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { authSchemas } from '../validators/schemas.js';
import { loginLimiter, otpLimiter } from '../middlewares/rateLimiters.js';

const router = express.Router();

// ── Core Auth ────────────────────────────────────────────────
router.post('/login',             loginLimiter, validate({ body: authSchemas.login }), AuthController.login);
router.get('/me',                 protect, AuthController.getMe);

// ── User Registration (OTP-gated) ───────────────────────────
router.post('/register/user',     otpLimiter, AuthController.registerUser);
router.post('/register/mowared',  otpLimiter, AuthController.registerMowared);
router.delete('/registration/cancel', validate({ body: authSchemas.cancelRegistration }), AuthController.cancelRegistration);

// ── OTP Verification ─────────────────────────────────────────
router.post('/otp/verify-registration', otpLimiter, validate({ body: authSchemas.verifyOtp }), AuthController.verifyRegistrationOtp);
router.post('/otp/verify-vendor',       otpLimiter, validate({ body: authSchemas.verifyOtp }), AuthController.verifyVendorRegistrationOtp);
router.post('/otp/resend',              otpLimiter, validate({ body: authSchemas.resendOtp }), AuthController.resendOtp);

// ── Password Reset Flow ──────────────────────────────────────
router.post('/otp/forgot-password',  otpLimiter, validate({ body: authSchemas.forgotPassword }), AuthController.forgotPassword);
router.post('/otp/verify-reset',     otpLimiter, validate({ body: authSchemas.verifyOtp }), AuthController.verifyResetOtp);
router.post('/otp/reset-password',   otpLimiter, validate({ body: authSchemas.resetPassword }), AuthController.resetPassword);
router.patch('/change-password',     protect, validate({ body: authSchemas.changePassword }), AuthController.changePassword);

export default router;
