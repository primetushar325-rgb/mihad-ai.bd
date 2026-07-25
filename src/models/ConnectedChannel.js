import mongoose from 'mongoose';

const connectedChannelSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  youtubeChannelId: { type: String, required: true },
  title: { type: String, required: true },
  handle: { type: String, default: '' },
  description: { type: String, default: '' },
  thumbnailUrl: { type: String, default: '' },
  subscriberCount: { type: Number, default: 0 },
  videoCount: { type: Number, default: 0 },
  viewCount: { type: Number, default: 0 },
  accessTokenEncrypted: { type: String, select: false },
  refreshTokenEncrypted: { type: String, select: false },
  tokenExpiry: Date,
  scopes: [String],
  status: { type: String, enum: ['connected', 'attention', 'revoked'], default: 'connected' },
  lastSyncedAt: Date,
  googleAccountEmail: { type: String, default: '' }
}, { timestamps: true });

connectedChannelSchema.index({ userId: 1, youtubeChannelId: 1 }, { unique: true });
connectedChannelSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    delete ret.accessTokenEncrypted;
    delete ret.refreshTokenEncrypted;
    ret.id = String(ret._id);
    delete ret._id;
    ret.isTokenExpiring = ret.tokenExpiry ? new Date(ret.tokenExpiry).getTime() < Date.now() + 5 * 60_000 : false;
    return ret;
  }
});

export const ConnectedChannel = mongoose.model('ConnectedChannel', connectedChannelSchema);
