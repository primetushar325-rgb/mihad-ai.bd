import { Router } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { body, param, query } from 'express-validator';
import { rateLimit } from 'express-rate-limit';
import { google } from 'googleapis';
import { fileTypeFromFile } from 'file-type';
import { ConnectedChannel } from '../models/ConnectedChannel.js';
import { UploadJob } from '../models/UploadJob.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { videoUpload } from '../middleware/upload.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../utils/AppError.js';
import { createOAuthClient, YOUTUBE_SCOPES } from '../config/google.js';
import { encrypt, decrypt } from '../services/crypto.service.js';
import { consumeQuota } from '../services/quota.service.js';
import { logActivity } from '../services/activity.service.js';
import { authorizedChannel, analyzePublicVideo, bulkUpdateVideos, getChannelVideos, getPlaylists, processUpload, syncChannel } from '../services/youtube.service.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export const youtubeRouter = Router();
youtubeRouter.use(requireAuth);
const uploadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Hourly upload request limit reached.' } } });
const writeLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Hourly YouTube operation limit reached.' } } });
const analyzerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Analyzer request limit reached. Please try later.' } } });

youtubeRouter.get('/oauth/start', asyncHandler(async (req, res) => {
  const state = crypto.randomBytes(32).toString('base64url');
  req.session.youtubeOAuthState = state;
  req.session.youtubeOAuthStartedAt = Date.now();
  const auth = createOAuthClient();
  const url = auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: YOUTUBE_SCOPES, state });
  res.json({ ok: true, data: { url } });
}));

youtubeRouter.get('/oauth/callback', asyncHandler(async (req, res) => {
  if (req.query.error) return res.redirect('/channels?oauth=denied');
  const validState = req.query.state && req.session.youtubeOAuthState && req.query.state === req.session.youtubeOAuthState;
  const fresh = Date.now() - Number(req.session.youtubeOAuthStartedAt || 0) < 10 * 60_000;
  delete req.session.youtubeOAuthState;
  delete req.session.youtubeOAuthStartedAt;
  if (!validState || !fresh) return res.redirect('/channels?oauth=invalid_state');
  if (!req.query.code) return res.redirect('/channels?oauth=missing_code');

  const auth = createOAuthClient();
  const { tokens } = await auth.getToken(String(req.query.code));
  auth.setCredentials(tokens);
  const youtube = google.youtube({ version: 'v3', auth });
  const [channelResponse, profileResponse] = await Promise.all([
    youtube.channels.list({ part: ['snippet', 'statistics'], mine: true }),
    google.oauth2({ version: 'v2', auth }).userinfo.get().catch(() => ({ data: {} }))
  ]);
  await consumeQuota('channels.list');
  const channel = channelResponse.data.items?.[0];
  if (!channel) throw new AppError('No YouTube channel is associated with this Google account.', 404, 'NO_YOUTUBE_CHANNEL');

  const existing = await ConnectedChannel.findOne({ userId: req.user._id, youtubeChannelId: channel.id }).select('+refreshTokenEncrypted');
  const record = {
    userId: req.user._id,
    youtubeChannelId: channel.id,
    title: channel.snippet.title,
    handle: channel.snippet.customUrl || '',
    description: channel.snippet.description || '',
    thumbnailUrl: channel.snippet.thumbnails?.high?.url || channel.snippet.thumbnails?.default?.url || '',
    subscriberCount: Number(channel.statistics.subscriberCount || 0),
    videoCount: Number(channel.statistics.videoCount || 0),
    viewCount: Number(channel.statistics.viewCount || 0),
    accessTokenEncrypted: encrypt(tokens.access_token),
    refreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refreshTokenEncrypted,
    tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    scopes: String(tokens.scope || '').split(' ').filter(Boolean),
    status: 'connected',
    lastSyncedAt: new Date(),
    googleAccountEmail: profileResponse.data.email || ''
  };
  if (!record.refreshTokenEncrypted) throw new AppError('Google did not provide an offline token. Remove Mihad AI from your Google account permissions and connect again.', 409, 'REFRESH_TOKEN_MISSING');
  await ConnectedChannel.findOneAndUpdate({ userId: req.user._id, youtubeChannelId: channel.id }, record, { upsert: true, new: true, setDefaultsOnInsert: true });
  await logActivity(req.user._id, 'channel', 'Channel connected', channel.snippet.title, 'success', { youtubeChannelId: channel.id });
  res.redirect('/channels?oauth=success');
}));

youtubeRouter.get('/channels', asyncHandler(async (req, res) => {
  const channels = await ConnectedChannel.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json({ ok: true, data: { channels } });
}));

youtubeRouter.post('/channels/:id/sync', param('id').isMongoId(), validate, asyncHandler(async (req, res) => {
  try {
    const channel = await syncChannel(req.user._id, req.params.id);
    res.json({ ok: true, data: { channel } });
  } catch (error) {
    if ([400, 401].includes(error.response?.status)) await ConnectedChannel.updateOne({ _id: req.params.id, userId: req.user._id }, { status: 'attention' });
    throw error;
  }
}));

youtubeRouter.delete('/channels/:id', param('id').isMongoId(), validate, asyncHandler(async (req, res) => {
  const channel = await ConnectedChannel.findOne({ _id: req.params.id, userId: req.user._id }).select('+accessTokenEncrypted');
  if (!channel) throw new AppError('Connected channel not found.', 404, 'CHANNEL_NOT_FOUND');
  const accessToken = decrypt(channel.accessTokenEncrypted);
  if (accessToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: 'POST', signal: AbortSignal.timeout(5000) }).catch(() => {});
  await channel.deleteOne();
  await logActivity(req.user._id, 'channel', 'Channel removed', channel.title, 'warning');
  res.json({ ok: true, data: { message: 'Channel access removed.' } });
}));

youtubeRouter.get('/channels/:id/playlists', param('id').isMongoId(), validate, asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { playlists: await getPlaylists(req.user._id, req.params.id) } });
}));

youtubeRouter.get('/channels/:id/videos', param('id').isMongoId(), query('limit').optional().isInt({ min: 1, max: 50 }), validate, asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { videos: await getChannelVideos(req.user._id, req.params.id, Number(req.query.limit || 24)) } });
}));

youtubeRouter.post('/uploads', (req, res, next) => videoUpload(req, res, (error) => error ? next(error) : next()), asyncHandler(async (req, res) => {
  const video = req.files?.video?.[0];
  const thumbnail = req.files?.thumbnail?.[0];
  const cleanup = () => Promise.all([video?.path, thumbnail?.path].filter(Boolean).map((file) => fs.promises.unlink(file).catch(() => {})));
  if (!video) { await cleanup(); throw new AppError('Select a video file to upload.', 422, 'VIDEO_REQUIRED'); }
  if (thumbnail && thumbnail.size > env.maxThumbnailBytes) { await cleanup(); throw new AppError('Thumbnail must be within the configured size limit.', 413, 'THUMBNAIL_TOO_LARGE'); }
  const [detectedVideo, detectedThumbnail] = await Promise.all([fileTypeFromFile(video.path), thumbnail ? fileTypeFromFile(thumbnail.path) : null]);
  const validVideoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/vnd.avi']);
  if (!detectedVideo || !validVideoTypes.has(detectedVideo.mime)) { await cleanup(); throw new AppError('The file content is not a supported video format.', 422, 'VIDEO_CONTENT_INVALID'); }
  if (thumbnail && (!detectedThumbnail || !['image/jpeg', 'image/png'].includes(detectedThumbnail.mime))) { await cleanup(); throw new AppError('Thumbnail content must be a valid JPG or PNG image.', 422, 'THUMBNAIL_CONTENT_INVALID'); }
  const { channelId, title, description = '', privacy = 'private', playlistId = '', scheduledAt = '' } = req.body;
  const fieldsAreStrings = [channelId, title, description, privacy, playlistId, scheduledAt, req.body.tags ?? ''].every((value) => typeof value === 'string');
  if (!fieldsAreStrings) { await cleanup(); throw new AppError('Upload fields must contain single text values.', 422, 'INVALID_UPLOAD_FIELDS'); }
  if (!/^[a-f\d]{24}$/i.test(channelId)) { await cleanup(); throw new AppError('Select a valid connected channel.', 422, 'CHANNEL_REQUIRED'); }
  if (!title.trim() || title.trim().length > 100) { await cleanup(); throw new AppError('Title is required and must be at most 100 characters.', 422, 'INVALID_TITLE'); }
  if (description.length > 5000) { await cleanup(); throw new AppError('Description must be at most 5,000 characters.', 422, 'INVALID_DESCRIPTION'); }
  if (!['private', 'unlisted', 'public'].includes(privacy)) { await cleanup(); throw new AppError('Select a valid privacy setting.', 422, 'INVALID_PRIVACY'); }
  if (playlistId.length > 100 || scheduledAt.length > 40) { await cleanup(); throw new AppError('Playlist or schedule value is invalid.', 422, 'INVALID_UPLOAD_FIELDS'); }
  const scheduleDate = scheduledAt ? new Date(scheduledAt) : null;
  if (scheduledAt && (!Number.isFinite(scheduleDate.getTime()) || scheduleDate.getTime() < Date.now() + 15 * 60_000)) { await cleanup(); throw new AppError('Scheduled time must be at least 15 minutes in the future.', 422, 'INVALID_SCHEDULE'); }
  if (scheduleDate && privacy !== 'public') { await cleanup(); throw new AppError('Scheduled videos must use Public as their final privacy.', 422, 'SCHEDULE_PRIVACY'); }
  const ownsChannel = await ConnectedChannel.exists({ _id: channelId, userId: req.user._id, status: { $ne: 'revoked' } });
  if (!ownsChannel) { await cleanup(); throw new AppError('You are not authorized to upload to this channel.', 403, 'CHANNEL_FORBIDDEN'); }
  const tags = String(req.body.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30);
  const job = await UploadJob.create({
    userId: req.user._id, channelId, title: title.trim(), description, tags, privacy, playlistId,
    scheduledAt: scheduleDate || undefined, sourceFilename: video.originalname, sourcePath: video.path,
    thumbnailPath: thumbnail?.path, bytes: video.size, progress: 10, stage: 'Queued for YouTube', status: 'queued'
  });
  setImmediate(() => processUpload(job._id).catch((error) => logger.error({ err: error, jobId: job._id }, 'Background upload failed')));
  res.status(202).json({ ok: true, data: { job } });
}));

youtubeRouter.get('/uploads', query('limit').optional().isInt({ min: 1, max: 100 }), validate, asyncHandler(async (req, res) => {
  const jobs = await UploadJob.find({ userId: req.user._id }).populate('channelId', 'title thumbnailUrl').sort({ createdAt: -1 }).limit(Number(req.query.limit || 30));
  res.json({ ok: true, data: { jobs } });
}));

youtubeRouter.post('/uploads/:id/retry', param('id').isMongoId(), validate, asyncHandler(async (req, res) => {
  const job = await UploadJob.findOne({ _id: req.params.id, userId: req.user._id, status: 'failed' }).select('+sourcePath +thumbnailPath');
  if (!job) throw new AppError('Failed upload not found.', 404, 'UPLOAD_NOT_FOUND');
  if (!job.youtubeVideoId && (!job.sourcePath || !fs.existsSync(job.sourcePath))) throw new AppError('The retained source file expired. Please upload the file again.', 410, 'SOURCE_EXPIRED');
  job.status = 'queued'; job.stage = 'Queued for retry'; job.progress = 10; job.retryCount += 1; job.errorMessage = '';
  await job.save();
  setImmediate(() => processUpload(job._id).catch((error) => logger.error({ err: error, jobId: job._id }, 'Retry failed')));
  res.status(202).json({ ok: true, data: { job } });
}));

youtubeRouter.post('/bulk-update',
  body('channelId').isMongoId(),
  body('videoIds').isArray({ min: 1, max: 50 }).withMessage('Select 1–50 videos.'),
  body('videoIds.*').matches(/^[\w-]{11}$/),
  body('changes').isObject(),
  body('changes.title').optional().isLength({ max: 100 }),
  body('changes.description').optional().isLength({ max: 5000 }),
  body('changes.privacy').optional().isIn(['private', 'unlisted', 'public']),
  body('changes.tags').optional().isArray({ max: 30 }),
  validate,
  asyncHandler(async (req, res) => {
    const changes = req.body.changes;
    if (!Object.keys(changes).length) throw new AppError('Choose at least one change.', 422, 'NO_CHANGES');
    const results = await bulkUpdateVideos(req.user._id, req.body.channelId, req.body.videoIds, changes);
    res.json({ ok: true, data: { results, succeeded: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length } });
  })
);

youtubeRouter.get('/thumbnails/download',
  query('url').isURL({ protocols: ['https'], require_protocol: true }),
  query('filename').optional().matches(/^[\w.-]{1,100}$/),
  validate,
  asyncHandler(async (req, res) => {
    const source = new URL(String(req.query.url));
    if (!(source.hostname === 'i.ytimg.com' || source.hostname.endsWith('.ytimg.com'))) throw new AppError('Only official YouTube thumbnail assets can be downloaded.', 422, 'THUMBNAIL_HOST_INVALID');
    const response = await fetch(source, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new AppError('The thumbnail asset is unavailable.', 502, 'THUMBNAIL_UNAVAILABLE');
    const type = response.headers.get('content-type') || '';
    const size = Number(response.headers.get('content-length') || 0);
    if (!type.startsWith('image/') || size > 5 * 1024 * 1024) throw new AppError('The remote asset is not a valid thumbnail.', 422, 'THUMBNAIL_INVALID');
    const extension = type.includes('png') ? 'png' : 'jpg';
    const base = String(req.query.filename || 'youtube-thumbnail').replace(/\.(jpg|jpeg|png)$/i, '');
    res.setHeader('content-type', type);
    res.setHeader('content-disposition', `attachment; filename="${base}.${extension}"`);
    res.setHeader('cache-control', 'private, max-age=300');
    let received = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(received > 5 * 1024 * 1024 ? new Error('Thumbnail exceeded the streaming limit.') : null, chunk);
      }
    });
    limiter.on('error', () => res.destroy());
    Readable.fromWeb(response.body).pipe(limiter).pipe(res);
  })
);

youtubeRouter.post('/analyze', analyzerLimiter, body('url').trim().isLength({ min: 1, max: 500 }), validate, asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { video: await analyzePublicVideo(req.body.url) } });
}));
