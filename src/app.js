import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFound } from './middleware/error.js';
import { authRouter } from './routes/auth.routes.js';
import { youtubeRouter } from './routes/youtube.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { toolsRouter } from './routes/tools.routes.js';
import { settingsRouter } from './routes/settings.routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
export const app = express();
if (env.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
mongoose.set('sanitizeFilter', true);

app.use((req, res, next) => {
  req.id = req.get('x-request-id')?.slice(0, 80) || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ytimg.com', 'https://yt3.ggpht.com', 'https://yt3.googleusercontent.com'],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.youtube.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", 'https://accounts.google.com']
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origin is not allowed.'));
  }
}));
app.use(morgan(env.isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  name: 'mihad.sid',
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({ mongoUrl: env.mongoUri, ttl: 7 * 24 * 60 * 60, autoRemove: 'native' }),
  cookie: { httpOnly: true, secure: env.isProduction, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(csrfProtection);

app.get('/health', (_req, res) => res.json({ ok: true, status: 'healthy', database: mongoose.connection.readyState === 1 ? 'connected' : 'unavailable', timestamp: new Date().toISOString() }));
app.use('/api/auth', authRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/settings', settingsRouter);

app.use(express.static(root, { maxAge: env.isProduction ? '1d' : 0, etag: true, index: false }));
app.get(['/', '/login', '/register'], (req, res) => res.sendFile(path.join(root, 'login.html')));
app.get(['/dashboard', '/upload', '/channels', '/bulk-editor', '/seo', '/assistant', '/thumbnails', '/url-analyzer', '/analytics', '/settings', '/api-manager'], (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.sendFile(path.join(root, 'index.html'));
});
app.use('/api', notFound);
app.get('*splat', (_req, res) => res.status(404).sendFile(path.join(root, '404.html')));
app.use(errorHandler);
