import mongoose from 'mongoose';

const uploadJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectedChannel', required: true, index: true },
  youtubeVideoId: { type: String, default: '' },
  title: { type: String, required: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 5000 },
  tags: [{ type: String, maxlength: 500 }],
  privacy: { type: String, enum: ['private', 'unlisted', 'public'], default: 'private' },
  playlistId: { type: String, default: '' },
  scheduledAt: Date,
  sourceFilename: String,
  sourcePath: { type: String, select: false },
  thumbnailPath: { type: String, select: false },
  thumbnailApplied: { type: Boolean, default: false },
  playlistApplied: { type: Boolean, default: false },
  bytes: Number,
  progress: { type: Number, min: 0, max: 100, default: 0 },
  stage: { type: String, default: 'queued' },
  status: { type: String, enum: ['queued', 'uploading', 'processing', 'scheduled', 'published', 'completed', 'failed'], default: 'queued', index: true },
  errorCode: String,
  errorMessage: String,
  retryCount: { type: Number, default: 0 },
  completedAt: Date
}, { timestamps: true });

uploadJobSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.sourcePath;
    delete ret.thumbnailPath;
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  }
});

export const UploadJob = mongoose.model('UploadJob', uploadJobSchema);
