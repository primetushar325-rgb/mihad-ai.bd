import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage/tmp');
const storage = multer.diskStorage({
  destination: root,
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const allowedVideos = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/x-msvideo', 'video/vnd.avi', 'video/avi', 'application/octet-stream']);
const allowedImages = new Set(['image/jpeg', 'image/png']);

export const videoUpload = multer({
  storage,
  limits: { fileSize: env.maxVideoBytes, files: 2, fields: 30 },
  fileFilter(_req, file, cb) {
    if (file.fieldname === 'video' && allowedVideos.has(file.mimetype)) return cb(null, true);
    if (file.fieldname === 'thumbnail' && allowedImages.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported ${file.fieldname} file type.`));
  }
}).fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);
