import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import { rateLimit } from 'express-rate-limit';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { issueCsrfToken } from '../middleware/csrf.js';
import { logActivity } from '../services/activity.service.js';

export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } } });

authRouter.get('/csrf', (req, res) => res.json({ ok: true, data: { csrfToken: issueCsrfToken(req) } }));

authRouter.post('/register', authLimiter,
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name must be 2–80 characters.'),
  body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  body('password').isLength({ min: 10, max: 128 }).withMessage('Use at least 10 characters.').matches(/[a-z]/).matches(/[A-Z]/).matches(/[0-9]/).withMessage('Include uppercase, lowercase, and a number.'),
  validate,
  asyncHandler(async (req, res) => {
    const exists = await User.exists({ email: req.body.email });
    if (exists) throw new AppError('An account already exists for this email.', 409, 'EMAIL_EXISTS');
    const user = await User.create({ name: req.body.name, email: req.body.email, passwordHash: await bcrypt.hash(req.body.password, 12), lastLoginAt: new Date() });
    req.session.userId = String(user._id);
    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ ok: false, error: { code: 'SESSION_ERROR', message: 'Could not start your session.' } });
      req.session.userId = String(user._id);
      issueCsrfToken(req);
      logActivity(user._id, 'account', 'Welcome to Mihad AI', 'Your workspace is ready.', 'success');
      res.status(201).json({ ok: true, data: { user: user.toJSON(), csrfToken: req.session.csrfToken } });
    });
  })
);

authRouter.post('/login', authLimiter,
  body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email address.'),
  body('password').isLength({ min: 1, max: 128 }).withMessage('Enter your password.'),
  validate,
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select('+passwordHash');
    const valid = user && await bcrypt.compare(req.body.password, user.passwordHash);
    if (!valid) throw new AppError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS');
    user.lastLoginAt = new Date();
    await user.save();
    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ ok: false, error: { code: 'SESSION_ERROR', message: 'Could not start your session.' } });
      req.session.userId = String(user._id);
      issueCsrfToken(req);
      logActivity(user._id, 'auth', 'Signed in', 'New workspace session started.', 'info');
      res.json({ ok: true, data: { user: user.toJSON(), csrfToken: req.session.csrfToken } });
    });
  })
);

authRouter.get('/me', requireAuth, (req, res) => res.json({ ok: true, data: { user: req.user.toJSON() } }));

authRouter.post('/logout', requireAuth, (req, res, next) => {
  const userId = req.user._id;
  req.session.destroy((error) => {
    if (error) return next(error);
    logActivity(userId, 'auth', 'Signed out', '', 'info');
    res.clearCookie('mihad.sid');
    res.json({ ok: true, data: { message: 'Signed out.' } });
  });
});
