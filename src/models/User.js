import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  avatarUrl: { type: String, default: '' },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  settings: {
    timezone: { type: String, default: 'Asia/Dhaka' },
    emailNotifications: { type: Boolean, default: true },
    uploadNotifications: { type: Boolean, default: true },
    compactMode: { type: Boolean, default: false }
  },
  lastLoginAt: Date
}, { timestamps: true });

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.__v;
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  }
});

export const User = mongoose.model('User', userSchema);
