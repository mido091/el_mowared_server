import fs from 'fs';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
const isProduction = process.env.NODE_ENV === 'production';
const logFile = path.join(process.cwd(), 'server_debug.log');
const REDACTED_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'resetToken',
  'token',
  'authorization',
  'otp',
  'api_secret',
  'apiSecret',
  'EMAIL_PASS',
  'DB_PASSWORD'
]);

const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (REDACTED_KEYS.has(key)) {
        return [key, '[REDACTED]'];
      }
      return [key, redact(nested)];
    })
  );
};

const writeLog = (level, message, meta = {}) => {
  const payload = {
    level,
    timestamp: new Date().toISOString(),
    message,
    meta: redact(meta)
  };
  const serialized = `${JSON.stringify(payload)}\n`;

  if (level === 'error') {
    console.error(serialized.trim());
  } else if (level === 'warn') {
    console.warn(serialized.trim());
  } else {
    console.log(serialized.trim());
  }

  if (!isProduction) {
    fs.appendFileSync(logFile, serialized);
  }
};

export const logger = {
  info: (message, meta = {}) => writeLog('info', message, meta),
  error: (message, meta = {}) => writeLog('error', message, meta),
  warn: (message, meta = {}) => writeLog('warn', message, meta),
  debug: (message, meta = {}) => {
    if (isDev) {
      writeLog('debug', message, meta);
    }
  }
};

export default logger;
