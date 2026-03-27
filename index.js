import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { i18nMiddleware } from './src/middlewares/i18n.js';
import { AppError, createErrorPayload, errorHandler, requestIdMiddleware } from './src/middlewares/errorHandler.js';
import pool from './src/config/db.js';
import { initSocket, closeSocket } from './src/config/socket.js';
import { env, isDevelopment } from './src/config/env.js';
import apiRoutes from './src/routes/index.js';
import ChatRetentionJob from './src/services/ChatRetentionJob.js';
import SeoService from './src/services/SeoService.js';
import { compressionMiddleware } from './src/middlewares/compression.js';
import logger from './src/utils/logger.js';
import { ensureRuntimeReadiness } from './src/bootstrap/runtimeReadiness.js';

let httpServerInstance;

const shutdown = async (signal, reason) => {
  logger.warn('Graceful shutdown initiated', { signal, reason });

  try {
    ChatRetentionJob.stop?.();
  } catch (error) {
    logger.warn('ChatRetentionJob stop failed', { message: error.message });
  }

  try {
    await closeSocket();
  } catch (error) {
    logger.warn('Socket shutdown failed', { message: error.message });
  }

  try {
    if (httpServerInstance) {
      await new Promise((resolve, reject) => {
        httpServerInstance.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } catch (error) {
    logger.error('HTTP server shutdown failed', { message: error.message });
  }

  try {
    await pool.end();
  } catch (error) {
    logger.error('Database pool shutdown failed', { message: error.message });
  }

  process.exit(reason === 'error' ? 1 : 0);
};

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { name: err.name, message: err.message, stack: err.stack });
  shutdown('uncaughtException', 'error');
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', {
    name: err?.name,
    message: err?.message,
    stack: err?.stack
  });
  shutdown('unhandledRejection', 'error');
});

process.on('SIGINT', () => shutdown('SIGINT', 'signal'));
process.on('SIGTERM', () => shutdown('SIGTERM', 'signal'));

const app = express();
const server = http.createServer(app);

initSocket(server);
ChatRetentionJob.start();

const normalizeOrigin = (origin) => `${origin || ''}`.trim().replace(/\/+$/, '');

const isOriginAllowed = (origin) => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return true;

  return env.frontendOrigins.some((allowedOrigin) => {
    const normalizedAllowed = normalizeOrigin(allowedOrigin);
    if (!normalizedAllowed) return false;

    if (normalizedAllowed.includes('*')) {
      const pattern = `^${normalizedAllowed
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*')}$`;
      return new RegExp(pattern, 'i').test(normalizedOrigin);
    }

    return normalizedAllowed.toLowerCase() === normalizedOrigin.toLowerCase();
  });
};

const runtimeReadinessPromise = ensureRuntimeReadiness();

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    return callback(new AppError({
      en: 'This request is not allowed from the current origin.',
      ar: 'هذا الطلب غير مسموح به من المصدر الحالي.'
    }, 403, 'CORS_BLOCKED'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language', 'X-Lang', 'X-Request-Id']
};

app.use(requestIdMiddleware);
app.use(cors(corsOptions));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compressionMiddleware);

if (isDevelopment) {
  app.use(morgan('dev'));
}

const apiLimiter = rateLimit({
  max: 300,
  windowMs: 15 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const error = new AppError({
      en: 'Too many requests from this IP, please try again later.',
      ar: 'هناك عدد كبير من الطلبات من هذا العنوان. يرجى المحاولة لاحقًا.'
    }, 429, 'RATE_LIMITED');

    res.status(429).json(createErrorPayload(error, req));
  }
});
app.use('/api/v1', apiLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(i18nMiddleware);
app.use('/api/v1', async (req, res, next) => {
  try {
    await runtimeReadinessPromise;
    next();
  } catch (error) {
    next(error);
  }
});

app.get('/health', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    res.status(200).json({ success: true, status: 'ok' });
  } catch (error) {
    res.status(503).json({ success: false, status: 'degraded' });
  }
});

app.get('/robots.txt', async (req, res, next) => {
  try {
    res.type('text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(await SeoService.getRobotsTxt());
  } catch (error) {
    next(error);
  }
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    res.type('application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.send(await SeoService.getSitemapXml());
  } catch (error) {
    next(error);
  }
});

app.use('/api/v1', apiRoutes);
app.use(errorHandler);

const startServer = async () => {
  try {
    await runtimeReadinessPromise;
    const connection = await pool.getConnection();
    connection.release();

    httpServerInstance = server.listen(env.port, () => {
      logger.info('Elmowared backend started', {
        port: env.port,
        nodeEnv: env.nodeEnv
      });
    });
  } catch (error) {
    logger.error('Unable to connect to the database during startup', {
      message: error.message
    });
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, pool, server };
export default app;
