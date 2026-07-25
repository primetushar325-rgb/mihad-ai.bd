import { ApiUsage } from '../models/ApiUsage.js';
import { env } from '../config/env.js';

const COSTS = Object.freeze({
  'channels.list': 1,
  'videos.list': 1,
  'playlists.list': 1,
  'playlistItems.list': 1,
  'videos.insert': 1, // YouTube now accounts for this in a separate Video Uploads quota bucket.
  'videos.update': 50,
  'thumbnails.set': 50,
  'playlistItems.insert': 50,
  'playlistItems.delete': 50
});

const utcDate = () => new Date().toISOString().slice(0, 10);

export async function consumeQuota(operation, count = 1) {
  const units = (COSTS[operation] || 1) * count;
  return ApiUsage.findOneAndUpdate(
    { date: utcDate() },
    { $inc: { used: units, [`operations.${operation.replaceAll('.', '_')}`]: units } },
    { upsert: true, new: true }
  );
}

export async function getQuota() {
  const usage = await ApiUsage.findOne({ date: utcDate() }).lean();
  const used = usage?.used || 0;
  return { used, limit: env.youtubeDailyQuota, remaining: Math.max(0, env.youtubeDailyQuota - used), percentage: Math.min(100, Math.round(used / env.youtubeDailyQuota * 100)), resetsAt: `${utcDate()}T24:00:00.000Z` };
}
