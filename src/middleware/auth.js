import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  if (!req.session?.userId) throw new AppError('Authentication required.', 401, 'AUTH_REQUIRED');
  const user = await User.findById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    throw new AppError('Your session is no longer valid.', 401, 'SESSION_INVALID');
  }
  req.user = user;
  next();
});

export function requireGuest(req, res, next) {
  if (req.session?.userId) return res.redirect('/dashboard');
  next();
}
