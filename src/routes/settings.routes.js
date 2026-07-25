import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { body } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { User } from '../models/User.js';
import { logActivity } from '../services/activity.service.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.patch('/profile',
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('settings.timezone').optional().isString().isLength({ min: 3, max: 80 }),
  body('settings.emailNotifications').optional().isBoolean(),
  body('settings.uploadNotifications').optional().isBoolean(),
  body('settings.compactMode').optional().isBoolean(),
  validate,
  asyncHandler(async (req, res) => {
    if (req.body.name) req.user.name = req.body.name;
    if (req.body.settings) {
      for (const key of ['timezone', 'emailNotifications', 'uploadNotifications', 'compactMode']) {
        if (req.body.settings[key] !== undefined) req.user.settings[key] = req.body.settings[key];
      }
    }
    await req.user.save();
    await logActivity(req.user._id, 'settings', 'Profile updated', '', 'success');
    res.json({ ok: true, data: { user: req.user.toJSON() } });
  })
);

settingsRouter.patch('/password',
  body('currentPassword').isLength({ min: 1, max: 128 }),
  body('newPassword').isLength({ min: 10, max: 128 }).matches(/[a-z]/).matches(/[A-Z]/).matches(/[0-9]/),
  validate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!await bcrypt.compare(req.body.currentPassword, user.passwordHash)) throw new AppError('Current password is incorrect.', 401, 'PASSWORD_INCORRECT');
    user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await user.save();
    await logActivity(req.user._id, 'security', 'Password changed', '', 'success');
    res.json({ ok: true, data: { message: 'Password updated securely.' } });
  })
);
