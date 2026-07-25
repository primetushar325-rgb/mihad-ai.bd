import mongoose from 'mongoose';
import fs from 'node:fs';
import { google } from 'googleapis';
import { ConnectedChannel } from '../models/ConnectedChannel.js';
import { UploadJob } from '../models/UploadJob.js';
import { createOAuthClient, publicYouTubeClient } from '../config/google.js';
import { encrypt, decrypt } from './crypto.service.js';
import { consumeQuota } from './quota.service.js';
import { logActivity } from './activity.service.js';
import { AppError } from '../utils/AppError.js';

export async function authorizedChannel(userId, channelRecordId) {
  const channel = await ConnectedChannel.findOne({ _id: channelRecordId, userId }).select('+accessTokenEncrypted +refreshTokenEncrypted');
  if (!channel) throw new AppError('Connected channel not found.', 404, 'CHANNEL_NOT_FOUND');
  if (channel.status === 'revoked') throw new AppError('This channel authorization was revoked. Reconnect it to continue.', 409, 'CHANNEL_REVOKED');

  const auth = createOAuthClient();
  auth.setCredentials({
    access_token: decrypt(channel.accessTokenEncrypted),
    refresh_token: decrypt(channel.refreshTokenEncrypted),
    expiry_date: channel.tokenExpiry?.getTime()
  });
  auth.on('tokens', async (tokens) => {
    const update = { status: 'connected' };
    if (tokens.access_token) update.accessTokenEncrypted = encrypt(tokens.access_token);
    if (tokens.refresh_token) update.refreshTokenEncrypted = encrypt(tokens.refresh_token);
    if (tokens.expiry_date) update.tokenExpiry = new Date(tokens.expiry_date);
    await ConnectedChannel.updateOne({ _id: channel._id }, update).catch(() => {});
  });
  return { channel, auth, youtube: google.youtube({ version: 'v3', auth }) };
}

export async function syncChannel(userId, channelRecordId) {
  const { channel, youtube } = await authorizedChannel(userId, channelRecordId);
  const { data } = await youtube.channels.list({ part: ['snippet', 'statistics'], id: [channel.youtubeChannelId] });
  await consumeQuota('channels.list');
  const item = data.items?.[0];
  if (!item) throw new AppError('YouTube no longer returns this channel.', 404, 'YOUTUBE_CHANNEL_MISSING');
  Object.assign(channel, {
    title: item.snippet.title,
    handle: item.snippet.customUrl || '',
    description: item.snippet.description || '',
    thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '',
    subscriberCount: Number(item.statistics.subscriberCount || 0),
    videoCount: Number(item.statistics.videoCount || 0),
    viewCount: Number(item.statistics.viewCount || 0),
    lastSyncedAt: new Date(),
    status: 'connected'
  });
  await channel.save();
  return channel;
}

export async function getPlaylists(userId, channelRecordId) {
  const { channel, youtube } = await authorizedChannel(userId, channelRecordId);
  const { data } = await youtube.playlists.list({ part: ['snippet', 'contentDetails'], channelId: channel.youtubeChannelId, mine: true, maxResults: 50 });
  await consumeQuota('playlists.list');
  return (data.items || []).map((p) => ({ id: p.id, title: p.snippet.title, itemCount: Number(p.contentDetails.itemCount || 0), thumbnail: p.snippet.thumbnails?.medium?.url || '' }));
}

export async function getChannelVideos(userId, channelRecordId, maxResults = 24) {
  const { channel, youtube } = await authorizedChannel(userId, channelRecordId);
  const channels = await youtube.channels.list({ part: ['contentDetails'], id: [channel.youtubeChannelId] });
  await consumeQuota('channels.list');
  const uploadsId = channels.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];
  const list = await youtube.playlistItems.list({ part: ['snippet', 'contentDetails'], playlistId: uploadsId, maxResults: Math.min(maxResults, 50) });
  await consumeQuota('playlistItems.list');
  const ids = (list.data.items || []).map((x) => x.contentDetails.videoId);
  if (!ids.length) return [];
  const details = await youtube.videos.list({ part: ['snippet', 'status', 'statistics'], id: ids });
  await consumeQuota('videos.list');
  return (details.data.items || []).map(toPublicVideo);
}

function toPublicVideo(item) {
  return {
    id: item.id,
    title: item.snippet?.title || '',
    description: item.snippet?.description || '',
    channelId: item.snippet?.channelId || '',
    channelTitle: item.snippet?.channelTitle || '',
    publishedAt: item.snippet?.publishedAt,
    tags: item.snippet?.tags || [],
    thumbnail: item.snippet?.thumbnails?.maxres?.url || item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || '',
    thumbnails: item.snippet?.thumbnails || {},
    privacy: item.status?.privacyStatus,
    statistics: {
      views: Number(item.statistics?.viewCount || 0),
      likes: Number(item.statistics?.likeCount || 0),
      comments: Number(item.statistics?.commentCount || 0)
    }
  };
}

export async function analyzePublicVideo(input) {
  const videoId = extractVideoId(input);
  if (!videoId) throw new AppError('Enter a valid YouTube video URL or 11-character video ID.', 422, 'INVALID_YOUTUBE_URL');
  const youtube = publicYouTubeClient();
  const { data } = await youtube.videos.list({ part: ['snippet', 'statistics', 'contentDetails', 'status'], id: [videoId] });
  await consumeQuota('videos.list');
  const item = data.items?.[0];
  if (!item) throw new AppError('The video was not found or is not publicly available.', 404, 'VIDEO_NOT_FOUND');
  return { ...toPublicVideo(item), duration: item.contentDetails?.duration || '', embeddable: item.status?.embeddable !== false, url: `https://www.youtube.com/watch?v=${videoId}` };
}

export function extractVideoId(value) {
  const raw = String(value || '').trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (url.hostname === 'youtu.be') return url.pathname.split('/')[1]?.slice(0, 11) || null;
    if (url.hostname.endsWith('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/);
      return match?.[1] || null;
    }
  } catch { return null; }
  return null;
}

export async function processUpload(jobId) {
  // Atomic claim prevents two web instances from publishing the same queued job.
  const job = await UploadJob.findOneAndUpdate(
    { _id: jobId, status: 'queued' },
    { status: 'uploading', stage: 'Sending video to YouTube', progress: 20, errorMessage: '' },
    { new: true }
  ).select('+sourcePath +thumbnailPath');
  if (!job) return null; // Already claimed, cancelled, completed, or removed.
  try {
    const { youtube } = await authorizedChannel(job.userId, job.channelId);
    const scheduled = job.scheduledAt && job.scheduledAt.getTime() > Date.now();

    // A finishing-step retry must never create a duplicate YouTube video.
    if (!job.youtubeVideoId) {
      if (!job.sourcePath || !fs.existsSync(job.sourcePath)) throw new AppError('The retained source file is unavailable. Upload it again.', 410, 'SOURCE_EXPIRED');
      const requestBody = {
        snippet: { title: job.title, description: job.description || '', tags: job.tags || [], categoryId: '22' },
        status: {
          privacyStatus: scheduled ? 'private' : job.privacy,
          selfDeclaredMadeForKids: false,
          ...(scheduled ? { publishAt: job.scheduledAt.toISOString() } : {})
        }
      };
      const response = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody,
        media: { body: fs.createReadStream(job.sourcePath) }
      });
      await consumeQuota('videos.insert');
      job.youtubeVideoId = response.data.id;
      job.progress = 85; job.stage = 'Applying finishing touches'; job.status = 'processing';
      await job.save();
    }

    if (job.thumbnailPath && !job.thumbnailApplied && fs.existsSync(job.thumbnailPath)) {
      await youtube.thumbnails.set({ videoId: job.youtubeVideoId, media: { body: fs.createReadStream(job.thumbnailPath) } });
      await consumeQuota('thumbnails.set');
      job.thumbnailApplied = true;
      await job.save();
    }
    if (job.playlistId && !job.playlistApplied) {
      await youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId: job.playlistId, resourceId: { kind: 'youtube#video', videoId: job.youtubeVideoId } } }
      });
      await consumeQuota('playlistItems.insert');
      job.playlistApplied = true;
      await job.save();
    }
    job.progress = 100;
    job.stage = scheduled ? 'Scheduled' : 'Complete';
    job.status = scheduled ? 'scheduled' : (job.privacy === 'public' ? 'published' : 'completed');
    job.completedAt = new Date();
    await job.save();
    await logActivity(job.userId, 'upload', scheduled ? 'Video scheduled' : 'Video uploaded', job.title, 'success', { jobId: String(job._id), videoId: job.youtubeVideoId });
    await cleanupJobFiles(job);
    return job;
  } catch (error) {
    job.status = 'failed'; job.stage = job.youtubeVideoId ? 'Video uploaded; finishing step failed' : 'Failed'; job.errorCode = error.code || 'UPLOAD_FAILED'; job.errorMessage = error.response?.data?.error?.message || error.message || 'Upload failed';
    await job.save();
    await logActivity(job.userId, 'upload', 'Upload failed', `${job.title}: ${job.errorMessage}`, 'error', { jobId: String(job._id) });
    throw error;
  }
}

export async function cleanupJobFiles(job) {
  await Promise.all([job.sourcePath, job.thumbnailPath].filter(Boolean).map((file) => fs.promises.unlink(file).catch(() => {})));
  job.sourcePath = undefined;
  job.thumbnailPath = undefined;
  await job.save();
}

export async function resumePendingUploads() {
  // Jobs left "uploading" after a hard restart are made claimable again.
  const staleBefore = new Date(Date.now() - 6 * 60 * 60_000);
  await UploadJob.updateMany(
    { status: 'uploading', updatedAt: mongoose.trusted({ $lt: staleBefore }) },
    { status: 'queued', stage: 'Recovered after restart', progress: 10 }
  );
  const queued = await UploadJob.find({ status: 'queued' }).select('_id').limit(25).lean();
  for (const job of queued) setImmediate(() => processUpload(job._id).catch(() => {}));
  return queued.length;
}

export async function bulkUpdateVideos(userId, channelRecordId, videoIds, changes) {
  const { channel, youtube } = await authorizedChannel(userId, channelRecordId);
  const lookup = await youtube.videos.list({ part: ['snippet', 'status'], id: videoIds });
  await consumeQuota('videos.list');
  const found = lookup.data.items || [];
  if (found.some((item) => item.snippet.channelId !== channel.youtubeChannelId)) {
    throw new AppError('One or more videos are not owned by the selected channel.', 403, 'VIDEO_OWNERSHIP_MISMATCH');
  }
  const foundIds = new Set(found.map((item) => item.id));
  if (videoIds.some((id) => !foundIds.has(id))) throw new AppError('One or more videos could not be verified.', 422, 'VIDEO_VERIFICATION_FAILED');

  const results = [];
  for (const item of found) {
    try {
      if (changes.title || changes.description !== undefined || changes.tags) {
        await youtube.videos.update({
          part: ['snippet'],
          requestBody: {
            id: item.id,
            snippet: {
              ...item.snippet,
              ...(changes.title ? { title: renderBulkValue(changes.title, item.snippet.title) } : {}),
              ...(changes.description !== undefined ? { description: renderBulkValue(changes.description, item.snippet.description || '') } : {}),
              ...(changes.tags ? { tags: changes.tags } : {})
            }
          }
        });
        await consumeQuota('videos.update');
      }
      if (changes.privacy) {
        const writableStatus = {
          privacyStatus: changes.privacy,
          embeddable: item.status.embeddable,
          license: item.status.license,
          publicStatsViewable: item.status.publicStatsViewable,
          ...(item.status.selfDeclaredMadeForKids !== undefined ? { selfDeclaredMadeForKids: item.status.selfDeclaredMadeForKids } : {}),
          ...(item.status.containsSyntheticMedia !== undefined ? { containsSyntheticMedia: item.status.containsSyntheticMedia } : {})
        };
        await youtube.videos.update({ part: ['status'], requestBody: { id: item.id, status: writableStatus } });
        await consumeQuota('videos.update');
      }
      if (changes.playlistId) {
        await youtube.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId: changes.playlistId, resourceId: { kind: 'youtube#video', videoId: item.id } } } });
        await consumeQuota('playlistItems.insert');
      }
      results.push({ videoId: item.id, ok: true });
    } catch (error) {
      results.push({ videoId: item.id, ok: false, message: error.response?.data?.error?.message || error.message });
    }
  }
  await logActivity(userId, 'bulk_edit', 'Bulk edit completed', `${results.filter((x) => x.ok).length} of ${results.length} videos updated`, results.every((x) => x.ok) ? 'success' : 'warning');
  return results;
}

function renderBulkValue(template, current) {
  return String(template).replaceAll('{current}', current);
}
