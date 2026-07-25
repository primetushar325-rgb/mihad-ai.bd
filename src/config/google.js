import { google } from 'googleapis';
import { env } from './env.js';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email'
];

export function createOAuthClient() {
  if (!env.googleClientId || !env.googleClientSecret) throw new Error('Google OAuth is not configured.');
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

export function publicYouTubeClient() {
  if (!env.youtubeApiKey) throw new Error('YOUTUBE_API_KEY is not configured.');
  return google.youtube({ version: 'v3', auth: env.youtubeApiKey });
}
