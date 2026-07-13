'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase, supabaseAdmin } = require('../config/supabase');
const { jwtSecret, jwtExpiresIn, jwtRefreshSecret, jwtRefreshExpiresIn, bcryptRounds, cookieOptions } = require('../config');
const { successResponse, errorResponse, maskEmail } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const emailService = require('../services/email.service');

/**
 * Generate JWT tokens
 */
const generateTokens = (userId, role) => {
  const access = jwt.sign({ sub: userId, role }, jwtSecret, { expiresIn: jwtExpiresIn });
  const refresh = jwt.sign({ sub: userId, type: 'refresh' }, jwtRefreshSecret, { expiresIn: jwtRefreshExpiresIn });
  return { access, refresh };
};

/**
 * POST /api/auth/register
 */
exports.register = asyncHandler(async (req, res) => {
  const { email, password, full_name } = req.body;

  // Check if email already exists in profiles BEFORE calling signUp.
  // Supabase signUp silently succeeds for existing emails (anti-enumeration),
  // so we must do this check ourselves using the admin client.
  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (existing) {
    return errorResponse(res, 'An account with this email already exists. Please sign in instead.', 409);
  }

  // Register with Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name },
      emailRedirectTo: `${process.env.FRONTEND_URL}/auth/verify-email`,
    },
  });

  if (authError) {
    logger.error('Supabase register error:', authError);
    return errorResponse(res, authError.message, 400);
  }

  // Supabase returns a fake user object for existing emails — detect it
  if (!authData.user || authData.user.identities?.length === 0) {
    return errorResponse(res, 'An account with this email already exists. Please sign in instead.', 409);
  }

  const userId = authData.user.id;

  // Auto-confirm the user email so they don't get locked out in environments
  // where email delivery is not configured or fails.
  try {
    await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
  } catch (adminErr) {
    logger.warn('Admin auto-confirm failed:', adminErr.message);
  }

  // Upsert profile (trigger also handles this, but ensures immediate availability)
  await supabaseAdmin.from('profiles').upsert({
    id: userId,
    email,
    full_name,
    role: 'user',
    is_active: true,
  }, { onConflict: 'id' });

  const { access, refresh } = generateTokens(userId, 'user');

  res.cookie('access_token', access, cookieOptions);
  res.cookie('refresh_token', refresh, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });

  return successResponse(res, {
    user: { id: userId, email, full_name, role: 'user' },
    access_token: access,
    message: 'Registration successful. Please check your email for verification.',
  }, 'Registration successful', 201);
});

/**
 * POST /api/auth/login
 */
exports.login = asyncHandler(async (req, res) => {
  const { email, password, remember_me } = req.body;

  // Authenticate with Supabase
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError) {
    if (authError.message?.toLowerCase().includes('confirm') || authError.message?.toLowerCase().includes('verified')) {
      return errorResponse(res, 'Please confirm your email address before signing in.', 401);
    }
    return errorResponse(res, 'Invalid email or password', 401);
  }

  const userId = authData.user.id;

  // Fetch profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return errorResponse(res, 'User profile not found', 404);
  }

  if (!profile.is_active) {
    return errorResponse(res, 'Account has been deactivated. Contact support.', 403);
  }

  const { access, refresh } = generateTokens(userId, profile.role);

  const cookieOpts = remember_me
    ? { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 }
    : cookieOptions;

  res.cookie('access_token', access, cookieOpts);
  res.cookie('refresh_token', refresh, { ...cookieOpts, maxAge: 30 * 24 * 60 * 60 * 1000 });

  // Update last seen
  await supabaseAdmin.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', userId);

  // Log activity
  await supabaseAdmin.from('activity_logs').insert({
    user_id: userId,
    action: 'login',
    details: { ip: req.ip, user_agent: req.get('User-Agent') },
  });

  return successResponse(res, {
    user: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      role: profile.role,
    },
    access_token: access,
  }, 'Login successful');
});

/**
 * POST /api/auth/logout
 */
exports.logout = asyncHandler(async (req, res) => {
  await supabase.auth.signOut();
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  return successResponse(res, null, 'Logged out successfully');
});

/**
 * POST /api/auth/refresh
 */
exports.refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refresh_token || req.body?.refresh_token;
  if (!token) return errorResponse(res, 'Refresh token required', 401);

  const decoded = jwt.verify(token, jwtRefreshSecret);
  if (decoded.type !== 'refresh') return errorResponse(res, 'Invalid token type', 401);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', decoded.sub)
    .single();

  if (!profile || !profile.is_active) return errorResponse(res, 'User not found', 401);

  const { access, refresh } = generateTokens(profile.id, profile.role);
  res.cookie('access_token', access, cookieOptions);
  res.cookie('refresh_token', refresh, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });

  return successResponse(res, { access_token: access }, 'Token refreshed');
});

/**
 * POST /api/auth/forgot-password
 */
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`,
  });

  // Always return success to prevent email enumeration
  return successResponse(res, {
    message: `If an account exists for ${maskEmail(email)}, a reset link has been sent.`,
  }, 'Password reset email sent');
});

/**
 * POST /api/auth/reset-password
 */
exports.resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return errorResponse(res, error.message, 400);

  return successResponse(res, null, 'Password reset successful');
});

/**
 * GET /api/auth/me
 */
exports.getMe = asyncHandler(async (req, res) => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*, user_settings(*)')
    .eq('id', req.userId)
    .single();

  if (error || !profile) return errorResponse(res, 'Profile not found', 404);

  return successResponse(res, profile, 'Profile retrieved');
});

/**
 * POST /api/auth/verify-email
 */
exports.verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'email' });
  if (error) return errorResponse(res, 'Invalid or expired verification token', 400);
  return successResponse(res, null, 'Email verified successfully');
});
