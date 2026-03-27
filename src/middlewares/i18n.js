/**
 * @file i18n.js
 * @description Middleware for Internationalization.
 * Detects language via 'x-lang' header and formats localized database fields.
 */

/**
 * Middleware to detect language and provide a formatter for localized fields (e.g., name_ar, name_en).
 * 
 * @function i18nMiddleware
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next function.
 */
export const i18nMiddleware = (req, res, next) => {
  const lang = (req.headers['x-lang'] || req.headers['accept-language'])?.startsWith('ar') ? 'ar' : 'en';
  req.language = lang;
  req.locale = lang;


  // Helper to format localized fields in objects
  res.formatLocalization = (data) => {
    if (!data) return data;

    const formatObject = (obj) => {
      const formatted = { ...obj };
      const keys = Object.keys(obj);

      keys.forEach(key => {
        // Detect snake_case localized fields: title_ar/title_en or name_ar/name_en
        const match = key.match(/^(.*)_(ar|en)$/);
        if (match) {
          const baseKey = match[1];
          const fieldLang = match[2];
          
          if (fieldLang === lang) {
            formatted[baseKey] = obj[key];
          }
        }
      });
      return formatted;
    };

    if (Array.isArray(data)) {
      return data.map(item => typeof item === 'object' ? formatObject(item) : item);
    }

    return typeof data === 'object' ? formatObject(data) : data;
  };

  next();
};
