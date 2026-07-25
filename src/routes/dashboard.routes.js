import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ConnectedChannel } from '../models/ConnectedChannel.js';
import { UploadJob } from '../models/UploadJob.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { getQuota } from '../services/quota.service.js';
import { env } from '../config/env.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const since = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const [channels, connectedChannels, totalUploads, successful, failed, recentUploads, activities, quota, timeline] = await Promise.all([
    ConnectedChannel.find({ userId }).sort({ createdAt: -1 }).limit(12),
    ConnectedChannel.countDocuments({ userId }),
    UploadJob.countDocuments({ userId }),
    UploadJob.countDocuments({ userId, status: { $in: ['published', 'scheduled', 'completed'] } }),
    UploadJob.countDocuments({ userId, status: 'failed' }),
    UploadJob.find({ userId }).populate('channelId', 'title thumbnailUrl').sort({ createdAt: -1 }).limit(6),
    ActivityLog.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
    getQuota(),
    UploadJob.aggregate([
      { $match: { userId, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ])
  ]);
  const byDate = new Map(timeline.map((x) => [x._id, x.count]));
  const uploadTimeline = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(since); date.setUTCDate(since.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, label: date.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }), count: byDate.get(key) || 0 };
  });
  res.json({
    ok: true,
    data: {
      overview: { totalUploads, successful, failed, connectedChannels, successRate: totalUploads ? Math.round(successful / totalUploads * 100) : 0 },
      channels,
      recentUploads,
      activities,
      quota,
      uploadTimeline
    }
  });
}));

dashboardRouter.get('/api-status', asyncHandler(async (_req, res) => {
  const quota = await getQuota();
  res.json({ ok: true, data: {
    services: [
      { name: 'YouTube Data API v3', configured: Boolean(env.googleClientId && env.googleClientSecret), detail: env.googleClientId ? 'OAuth credentials configured' : 'Credentials required' },
      { name: 'Public URL Analyzer', configured: Boolean(env.youtubeApiKey), detail: env.youtubeApiKey ? 'Server-side API key protected' : 'YOUTUBE_API_KEY required' },
      { name: 'AI Provider', configured: Boolean(env.aiApiKey), detail: env.aiApiKey ? `${env.aiModel} connected` : 'Template mode active' },
      { name: 'Encrypted token vault', configured: Boolean(env.encryptionKey), detail: 'AES-256-GCM at rest' }
    ],
    quota,
    environment: env.nodeEnv,
    security: { keysExposedToBrowser: false, oauth: 'OAuth 2.0', sessionCookie: env.isProduction ? 'Secure + HttpOnly' : 'HttpOnly' }
  } }));
}));
