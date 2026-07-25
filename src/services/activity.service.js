import { ActivityLog } from '../models/ActivityLog.js';

export async function logActivity(userId, type, title, detail = '', status = 'info', metadata = {}) {
  try {
    return await ActivityLog.create({ userId, type, title, detail, status, metadata });
  } catch {
    return null; // Logging must never break the primary operation.
  }
}
