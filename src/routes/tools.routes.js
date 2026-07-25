import { Router } from 'express';
import { body } from 'express-validator';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { analyzeSeo } from '../services/seo.service.js';
import { generateContent } from '../services/ai.service.js';
import { logActivity } from '../services/activity.service.js';

export const toolsRouter = Router();
toolsRouter.use(requireAuth);
const generationLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Generation limit reached. Please wait before trying again.' } } });

toolsRouter.post('/seo/analyze',
  body('title').optional().isString().isLength({ max: 100 }),
  body('description').optional().isString().isLength({ max: 5000 }),
  body('keyword').optional().isString().isLength({ max: 120 }),
  body('tags').optional(),
  validate,
  asyncHandler(async (req, res) => {
    const result = analyzeSeo(req.body);
    await logActivity(req.user._id, 'seo', 'SEO analysis completed', `Score: ${result.score}/100`, 'info');
    res.json({ ok: true, data: { result } });
  })
);

toolsRouter.post('/ai/generate', generationLimiter,
  body('type').isIn(['titles', 'descriptions', 'hashtags', 'tags', 'thumbnails']),
  body('topic').trim().isLength({ min: 3, max: 500 }).withMessage('Describe your topic in 3–500 characters.'),
  body('tone').optional().isIn(['professional', 'energetic', 'educational', 'witty', 'minimal']),
  body('audience').optional().isString().isLength({ max: 100 }),
  body('keywords').optional().isArray({ max: 20 }),
  validate,
  asyncHandler(async (req, res) => {
    const result = await generateContent(req.body);
    await logActivity(req.user._id, 'ai', 'AI content generated', `${req.body.type} for ${req.body.topic.slice(0, 80)}`, 'success');
    res.json({ ok: true, data: { result } });
  })
);
