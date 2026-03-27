/**
 * @file emailTemplates.js
 * @description HTML email template builder for OTP verification emails.
 * Follows the Elmowared Navy (#1e293b) / Teal (#06b6d4) design system.
 * Mobile-responsive, professional layout.
 */

const BRAND = {
  navy:  '#1e293b',
  teal:  '#06b6d4',
  light: '#f0f9ff',
  text:  '#334155',
  muted: '#64748b',
};

/**
 * Builds a professional OTP email HTML string.
 * @param {object} opts
 * @param {string} opts.otp     - The 6-digit OTP code (plain text, for display)
 * @param {string} opts.type    - 'REGISTRATION' | 'PASSWORD_RESET'
 * @param {string} opts.lang    - 'ar' | 'en'
 * @param {string} opts.name    - Optional recipient name for greeting
 * @param {string} opts.logoUrl - Extracted dynamic logo url
 * @returns {string} Full HTML email string
 */
export function buildOtpEmail({ otp, type, lang = 'en', name = '', logoUrl = '' }) {
  const isAr = lang === 'ar';
  const dir  = isAr ? 'rtl' : 'ltr';

  const strings = {
    en: {
      subject_reg:   'Verify Your Email — Elmowared',
      subject_reset: 'Password Reset Code — Elmowared',
      greeting:      name ? `Hello, ${name}` : 'Hello',
      body_reg:      'To complete your registration on <strong>Elmowared</strong>, please use the verification code below:',
      body_reset:    'You requested a password reset on <strong>Elmowared</strong>. Use the code below to proceed:',
      code_label:    'Your Verification Code',
      expires:       'This code expires in <strong>10 minutes</strong>. Do not share it with anyone.',
      ignore:        "If you didn't request this, you can safely ignore this email.",
      footer:        '© 2026 Elmowared B2B Marketplace. All rights reserved.',
    },
    ar: {
      subject_reg:   'تحقق من بريدك الإلكتروني — المورد',
      subject_reset: 'كود إعادة تعيين كلمة المرور — المورد',
      greeting:      name ? `مرحباً، ${name}` : 'مرحباً',
      body_reg:      'لإتمام تسجيلك في منصة <strong>المورد</strong>، يرجى استخدام رمز التحقق أدناه:',
      body_reset:    'لقد طلبت إعادة تعيين كلمة المرور على منصة <strong>المورد</strong>. استخدم الرمز أدناه للمتابعة:',
      code_label:    'رمز التحقق الخاص بك',
      expires:       'هذا الرمز صالح لمدة <strong>10 دقائق</strong> فقط. لا تشاركه مع أي شخص.',
      ignore:        'إذا لم تطلب هذا، يمكنك تجاهل هذا البريد الإلكتروني بأمان.',
      footer:        '© 2026 منصة المورد لتجارة B2B. جميع الحقوق محفوظة.',
    },
  };
  
  const s = strings[isAr ? 'ar' : 'en'];
  const bodyText = type === 'PASSWORD_RESET' ? s.body_reset : s.body_reg;

  // Render each digit as a separate cell in a non-wrapping table to ensure LTR order and responsiveness
  const otpCells = otp
    .split('')
    .map(
      digit =>
        `<td style="padding: 0 2px;">
          <div style="
            width: 32px; height: 44px; line-height: 44px;
            text-align: center; font-size: 20px; font-weight: 800;
            background: #f0f9ff; border: 2px solid ${BRAND.teal};
            border-radius: 8px; color: ${BRAND.navy};
          ">${digit}</div>
        </td>`
    )
    .join('');

  const otpTable = `
    <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; direction: ltr !important; width: 100%; max-width: 280px;">
      <tr>${otpCells}</tr>
    </table>
  `;

  return {
    subject: type === 'PASSWORD_RESET' ? s.subject_reset : s.subject_reg,
    html: `
<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${type === 'PASSWORD_RESET' ? s.subject_reset : s.subject_reg}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;direction:${dir};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <!-- Logo -->
        <div style="margin-bottom: 24px;">
           ${logoUrl 
             ? `<img src="${logoUrl}" height="50" alt="Elmowared" style="display:block; margin: 0 auto 20px auto; max-width: 100%;">` 
             : `<div style="text-align: center; margin: 0 auto 20px auto; background-color: #ffffff; padding: 10px; border-radius: 8px; display: inline-block;"><span style="color: #1e293b; font-size: 28px; font-weight: bold;">Elmowared</span></div>`
           }
        </div>

        <table width="100%" style="max-width:500px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(30,41,59,0.08); border: 1px solid #e2e8f0;">
          
          <!-- Header Accent -->
          <tr>
            <td style="height: 6px; background: linear-gradient(to right, ${BRAND.navy}, ${BRAND.teal});"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px 16px;">
              <p style="font-size: 18px; font-weight: 800; color: ${BRAND.navy}; margin: 0 0 12px; text-align: center;">${s.greeting},</p>
              <p style="font-size: 15px; color: ${BRAND.text}; line-height: 1.6; margin: 0 0 24px; text-align: center;">${bodyText}</p>
              
              <!-- OTP Section -->
              <div style="text-align:center;margin-bottom:32px; background: #fafafa; padding: 20px 10px; border-radius: 12px; border: 1px dashed #cbd5e1;">
                <p style="font-size:11px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;font-weight:700;">${s.code_label}</p>
                ${otpTable}
              </div>

              <!-- Expiry Warning -->
              <div style="background:${BRAND.light};border-right: 4px solid ${BRAND.teal}; border-left: 4px solid ${BRAND.teal}; border-radius:12px;padding:16px 20px;margin-bottom:24px; text-align: center;">
                <p style="margin:0;font-size:14px;color:${BRAND.navy};font-weight: 500;">⏱ ${s.expires}</p>
              </div>

              <p style="font-size:13px;color:${BRAND.muted};margin:0; text-align: center;">${s.ignore}</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #f1f5f9;text-align:center;">
              <p style="margin:0;font-size:12px;color:${BRAND.muted};">${s.footer}</p>
              <div style="margin-top: 12px; font-size: 11px; color: #94a3b8;">
                B2B Smart Marketplace
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  };
}
