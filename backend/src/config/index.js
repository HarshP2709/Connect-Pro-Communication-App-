'use strict';

// In production the frontend and backend are on different origins (Vercel vs Render).
// Cross-origin cookies require sameSite:'none' + secure:true.
// In development (localhost) sameSite:'lax' + secure:false is fine.
const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-change-in-production',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  cookieOptions: {
    httpOnly: true,
    secure: isProduction,                    // true in prod (HTTPS), false locally
    sameSite: isProduction ? 'none' : 'lax', // 'none' required for cross-origin cookies
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  iceServers: [
    { urls: process.env.STUN_SERVER || 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...(process.env.TURN_SERVER ? [{
      urls: process.env.TURN_SERVER,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    }] : []),
  ],
};
