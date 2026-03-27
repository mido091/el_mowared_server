import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'zlib';

const COMPRESSIBLE_TYPES = [
  'application/json',
  'application/javascript',
  'application/xml',
  'image/svg+xml',
  'text/',
  'application/rss+xml'
];

const isCompressible = (contentType = '') => COMPRESSIBLE_TYPES.some((type) => contentType.includes(type));

export const compressionMiddleware = (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || req.headers['x-no-compression']) {
    return next();
  }

  const acceptEncoding = `${req.headers['accept-encoding'] || ''}`;
  const supportsBr = acceptEncoding.includes('br');
  const supportsGzip = acceptEncoding.includes('gzip');

  if (!supportsBr && !supportsGzip) {
    return next();
  }

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  const chunks = [];

  res.write = (chunk, encoding, callback) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    }
    if (typeof callback === 'function') callback();
    return true;
  };

  res.end = (chunk, encoding, callback) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
    }

    const body = Buffer.concat(chunks);
    const contentType = `${res.getHeader('Content-Type') || ''}`;
    const shouldCompress = body.length > 1024 && isCompressible(contentType) && !res.getHeader('Content-Encoding');

    if (!shouldCompress || [204, 304].includes(res.statusCode)) {
      res.setHeader('Content-Length', body.length);
      originalWrite(body);
      return originalEnd(null, null, callback);
    }

    const compressed = supportsBr
      ? brotliCompressSync(body, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 }
        })
      : gzipSync(body, { level: 6 });

    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Encoding', supportsBr ? 'br' : 'gzip');
    res.setHeader('Content-Length', compressed.length);
    originalWrite(compressed);
    return originalEnd(null, null, callback);
  };

  next();
};
