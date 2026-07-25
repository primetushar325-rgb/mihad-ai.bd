import multer from 'multer';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export function notFound(req, res) {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} was not found.` } });
}

export function errorHandler(error, req, res, _next) {
  let status = error.status || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.expose ? error.message : 'Something went wrong. Please try again.';

  if (error instanceof multer.MulterError) {
    status = 413;
    code = 'UPLOAD_LIMIT';
    message = error.code === 'LIMIT_FILE_SIZE' ? 'The selected file exceeds the allowed size.' : error.message;
  } else if (error?.response?.data?.error) {
    status = error.response.status || 502;
    code = `YOUTUBE_${error.response.data.error.code || 'ERROR'}`;
    message = error.response.data.error.message || 'YouTube could not complete the request.';
  } else if (error?.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'That record already exists.';
  }

  const log = { err: error, requestId: req.id, method: req.method, path: req.originalUrl, userId: req.session?.userId };
  status >= 500 ? logger.error(log, 'Request failed') : logger.warn(log, 'Request rejected');

  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(error.details ? { details: error.details } : {}),
      ...(!env.isProduction && status >= 500 ? { debug: error.message } : {})
    },
    requestId: req.id
  });
}
