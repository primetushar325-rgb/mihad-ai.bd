import crypto from 'node:crypto';
import { env } from '../config/env.js';

const key = (() => {
  try {
    const decoded = Buffer.from(env.encryptionKey, 'base64');
    if (decoded.length === 32) return decoded;
  } catch { /* derive below */ }
  return crypto.createHash('sha256').update(env.encryptionKey).digest();
})();

export function encrypt(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decrypt(payload) {
  if (!payload) return '';
  const [iv, tag, encrypted] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted payload');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
