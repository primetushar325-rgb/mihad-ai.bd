import 'dotenv/config';

const requiredInProduction = ['APP_URL', 'MONGODB_URI', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'YOUTUBE_API_KEY'];
if (process.env.NODE_ENV === 'production') {
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
  const tokenKey = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'base64');
  if (tokenKey.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 32 random bytes encoded as base64.');
  if (!process.env.APP_URL.startsWith('https://') || !process.env.GOOGLE_REDIRECT_URI.startsWith('https://')) throw new Error('APP_URL and GOOGLE_REDIRECT_URI must use HTTPS in production.');
}

const int = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = (value) => ['1', 'true', 'yes'].includes(String(value).toLowerCase());

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  trustProxy: bool(process.env.TRUST_PROXY),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mihad-ai',
  sessionSecret: process.env.SESSION_SECRET || 'development-only-secret-change-me-now',
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY || 'development-only-encryption-key',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:3000'}/api/youtube/oauth/callback`,
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  youtubeDailyQuota: int(process.env.YOUTUBE_DAILY_QUOTA, 10000),
  aiApiKey: process.env.AI_API_KEY || '',
  aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  aiModel: process.env.AI_MODEL || 'gpt-4.1-mini',
  maxVideoBytes: int(process.env.MAX_VIDEO_SIZE_MB, 5120) * 1024 * 1024,
  maxThumbnailBytes: int(process.env.MAX_THUMBNAIL_SIZE_MB, 2) * 1024 * 1024,
  failedUploadRetentionHours: int(process.env.FAILED_UPLOAD_RETENTION_HOURS, 24),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || process.env.APP_URL || 'http://localhost:3000').split(',').map((x) => x.trim()),
  logLevel: process.env.LOG_LEVEL || 'info',
  isProduction: process.env.NODE_ENV === 'production'
});
