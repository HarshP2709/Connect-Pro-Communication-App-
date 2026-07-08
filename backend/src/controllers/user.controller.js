'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse, parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/users/:id - Get user profile
 */
exports.getProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // When called via GET /me, req.params.id is undefined — fall back to req.userId
  const targetId = (!id || id === 'me') ? req.userId : id;

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, avatar_url, bio, job_title, company, phone, location, timezone, language, role, is_verified, created_at, last_seen')
    .eq('id', targetId)
    .single();

  if (error || !profile) return errorResponse(res, 'User not found', 404);

  return successResponse(res, profile);
});

/**
 * PATCH /api/users/me - Update own profile
 */
exports.updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['full_name', 'bio', 'job_title', 'company', 'phone', 'location', 'timezone', 'language'];
  const updates = {};
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  });

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.userId)
    .select()
    .single();

  if (error) return errorResponse(res, 'Failed to update profile', 500);

  return successResponse(res, data, 'Profile updated');
});

/**
 * POST /api/users/me/avatar - Upload avatar
 */
exports.uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 'No file provided', 400);

  const { supabaseAdmin: sAdmin } = require('../config/supabase');
  const path = `${req.userId}/avatar.${req.file.originalname.split('.').pop()}`;

  const { data, error } = await sAdmin.storage
    .from('avatars')
    .upload(path, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });

  if (error) return errorResponse(res, 'Failed to upload avatar', 500);

  const { data: urlData } = sAdmin.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = urlData.publicUrl;

  await sAdmin.from('profiles').update({ avatar_url: avatarUrl }).eq('id', req.userId);

  return successResponse(res, { avatar_url: avatarUrl }, 'Avatar uploaded');
});

/**
 * GET /api/users/me/settings - Get user settings
 */
exports.getSettings = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select('*')
    .eq('user_id', req.userId)
    .maybeSingle();

  if (error) return errorResponse(res, 'Failed to fetch settings', 500);

  // Return defaults if no settings exist
  if (!data) {
    const defaults = {
      user_id: req.userId,
      theme: 'dark',
      language: 'en',
      notifications_enabled: true,
      meeting_notifications: true,
      message_notifications: true,
      sound_enabled: true,
      video_quality: 'hd',
      audio_input: null,
      audio_output: null,
      video_input: null,
      blur_background: false,
      noise_suppression: true,
    };
    const { data: newSettings } = await supabaseAdmin.from('user_settings').insert(defaults).select().single();
    return successResponse(res, newSettings);
  }

  return successResponse(res, data);
});

/**
 * PATCH /api/users/me/settings - Update user settings
 */
exports.updateSettings = asyncHandler(async (req, res) => {
  const allowed = [
    'theme', 'language', 'notifications_enabled', 'meeting_notifications',
    'message_notifications', 'sound_enabled', 'video_quality', 'audio_input',
    'audio_output', 'video_input', 'blur_background', 'noise_suppression',
  ];
  const updates = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: req.userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) return errorResponse(res, 'Failed to update settings', 500);

  return successResponse(res, data, 'Settings updated');
});

/**
 * DELETE /api/users/me - Delete account
 */
exports.deleteAccount = asyncHandler(async (req, res) => {
  await supabaseAdmin.from('profiles').update({ is_active: false, email: `deleted_${req.userId}@deleted.com` }).eq('id', req.userId);
  await supabaseAdmin.auth.admin.deleteUser(req.userId);
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  return successResponse(res, null, 'Account deleted');
});

/**
 * GET /api/users - Search users (admin)
 */
exports.listUsers = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { search, role } = req.query;

  let query = supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, avatar_url, role, is_active, is_verified, created_at, last_seen', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  if (role) query = query.eq('role', role);

  const { data, error, count } = await query;
  if (error) return errorResponse(res, 'Failed to fetch users', 500);

  return successResponse(res, {
    users: data,
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  });
});
