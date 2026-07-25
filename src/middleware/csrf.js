import crypto from 'node:crypto';
import { AppError } from '../utils/AppError.js';

export function issueCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expected = req.session?.csrfToken;
  const supplied = req.get('x-csrf-token');
  if (!expected || !supplied) return next(new AppError('Missing security token. Refresh and try again.', 403, 'CSRF_MISSING'));
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return next(new AppError('Invalid security token.', 403, 'CSRF_INVALID'));
  next();
}
