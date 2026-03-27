/**
 * @file emailService.js
 * @description Nodemailer transporter and email sending functions.
 * Configured for Gmail SMTP on port 465 (secure/TLS).
 */

import nodemailer from 'nodemailer';
import { buildOtpEmail } from '../utils/emailTemplates.js';
import SiteSettingsRepository from '../repositories/SiteSettingsRepository.js';

let _transporter = null;

/**
 * Returns a singleton Nodemailer transporter for Gmail SMTP.
 * Lazy-initialized to avoid connection errors at startup.
 * @returns {import('nodemailer').Transporter}
 */
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // SSL
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return _transporter;
}

/**
 * Sends an OTP verification email to the specified address.
 *
 * @param {object} opts
 * @param {string} opts.to    - Recipient email address
 * @param {string} opts.otp   - Plain-text 6-digit OTP to display in the email
 * @param {string} opts.type  - 'REGISTRATION' | 'PASSWORD_RESET'
 * @param {string} [opts.lang='en'] - Language for email content: 'ar' | 'en'
 * @param {string} [opts.name]      - Optional recipient name for greeting
 * @returns {Promise<void>}
 */
export async function sendOtpEmail({ to, otp, type, lang = 'en', name = '' }) {
  let logoUrl = '';
  try {
    const siteLogoStr = await SiteSettingsRepository.getSettingByKey('site_logo');
    if (siteLogoStr) {
      const parsed = JSON.parse(siteLogoStr);
      if (parsed && parsed.url) {
        logoUrl = parsed.url;
      }
    }
  } catch (e) {
    console.error('Failed to fetch site_logo for email', e);
  }

  const { subject, html } = buildOtpEmail({ otp, type, lang, name, logoUrl });

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Elmowared Platform" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

export async function sendSimpleEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Elmowared Platform" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    text,
  });
}

export default { sendOtpEmail, sendSimpleEmail };
