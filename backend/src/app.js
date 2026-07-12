'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const meetingRoutes = require('./routes/meeting.routes');
const messageRoutes = require('./routes/message.routes');
const fileRoutes = require('./routes/file.routes');
const whiteboardRoutes = require('./routes/whiteboard.routes');
const notificationRoutes = require('./routes/notification.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', '*.supabase.co'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // Filter out undefined so helmet never receives an invalid directive value
      connectSrc: ["'self'", 'wss:', 'ws:', '*.supabase.co'].concat(
        process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []
      ),
      mediaSrc: ["'self'", 'blob:'],
    },
  },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Strip trailing slash from FRONTEND_URL so exact-match never fails
const _frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

const ALLOWED_ORIGINS = [
  _frontendUrl,                      // Dynamically binds FRONTEND_URL from your .env
  'http://localhost:5000',           // Monolithic local host port
  'http://127.0.0.1:5000',
  'http://localhost:3000',           // Local dev ports
  'http://127.0.0.1:3000',
  'http://localhost:5500',           // VS Code Live Server
  'https://connect-pro-communication-app.vercel.app' // Vercel alias
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // Allow any Vercel preview deployment for this project
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    // Allow any Render deployment for this project
    if (origin.endsWith('.onrender.com')) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,   // 5-minute window (was 15 min)
  max: 30,                    // 30 attempts (was 10 — too easy to hit during dev)
  message: { success: false, message: 'Too many authentication attempts. Please wait 5 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failed attempts toward the limit
});

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ─── Parsing Middleware ───────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(compression());

// ─── Logging ─────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
  }));
}

// ─── Static Files & Frontend serving ───────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Serve frontend static assets from public folder inside backend
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV,
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/whiteboards', whiteboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// SPA Wildcard fallback routing to serve index.html for virtual browser URLs
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
