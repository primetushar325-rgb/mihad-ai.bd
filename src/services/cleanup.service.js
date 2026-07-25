import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { UploadJob } from '../models/UploadJob.js';

const tmpDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage/tmp');

export async function cleanupExpiredUploads() {
  const cutoff = Date.now() - env.failedUploadRetentionHours * 60 * 60 * 1000;
  const protectedJobs = await UploadJob.find({
    $or: [
      { status: { $in: ['queued', 'uploading'] } },
      { status: 'failed', updatedAt: mongoose.trusted({ $gte: new Date(cutoff) }) }
    ]
  }).select('+sourcePath +thumbnailPath').lean();
  const protectedPaths = new Set(protectedJobs.flatMap((job) => [job.sourcePath, job.thumbnailPath]).filter(Boolean).map((file) => path.resolve(file)));
  const entries = await fs.promises.readdir(tmpDir, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.filter((entry) => entry.isFile() && entry.name !== '.gitkeep').map(async (entry) => {
    const full = path.join(tmpDir, entry.name);
    if (protectedPaths.has(path.resolve(full))) return;
    const stat = await fs.promises.stat(full).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) await fs.promises.unlink(full).catch(() => {});
  }));
}
