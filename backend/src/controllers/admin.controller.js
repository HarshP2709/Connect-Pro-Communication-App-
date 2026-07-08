'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse, parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/admin/dashboard
 */
exports.getDashboard = asyncHandler(async (req, res) => {
  const [users, meetings, files, activeMeetings] = await Promise.all([
    supabaseAdmin.from('profiles').select('id', { count: 'exact' }).eq('is_active', true),
    supabaseAdmin.from('meetings').select('id', { count: 'exact' }),
    supabaseAdmin.from('files').select('size'),
    supabaseAdmin.from('meetings').select('id', { count: 'exact' }).eq('status', 'active'),
  ]);

  const totalStorage = (files.data || []).reduce((s, f) => s + (f.size || 0), 0);

  return successResponse(res, {
    users: { total: users.count || 0 },
    meetings: { total: meetings.count || 0, active: activeMeetings.count || 0 },
    storage: { total_bytes: totalStorage },
  });
});

/**
 * GET /api/admin/users
 */
exports.getUsers = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { search, role, is_active } = req.query;

  let query = supabaseAdmin
    .from('profiles')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
  if (role) query = query.eq('role', role);
  if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');

  const { data, error, count } = await query;
  if (error) return errorResponse(res, 'Failed to fetch users', 500);

  return successResponse(res, { users: data, pagination: { page, limit, total: count, pages: Math.ceil(count / limit) } });
});

/**
 * PATCH /api/admin/users/:id - Update user (admin)
 */
exports.updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const allowed = ['role', 'is_active', 'is_verified'];
  const updates = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const { data, error } = await supabaseAdmin.from('profiles').update(updates).eq('id', id).select().single();
  if (error) return errorResponse(res, 'Failed to update user', 500);

  return successResponse(res, data, 'User updated');
});

/**
 * GET /api/admin/meetings - All meetings
 */
exports.getMeetings = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);

  const { data, error, count } = await supabaseAdmin
    .from('meetings')
    .select('*, host:profiles!meetings_host_id_fkey(id, full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return errorResponse(res, 'Failed to fetch meetings', 500);

  return successResponse(res, { meetings: data, pagination: { page, limit, total: count, pages: Math.ceil(count / limit) } });
});

/**
 * GET /api/admin/logs - Activity logs
 */
exports.getLogs = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);

  const { data, error, count } = await supabaseAdmin
    .from('activity_logs')
    .select('*, user:profiles!activity_logs_user_id_fkey(id, full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return errorResponse(res, 'Failed to fetch logs', 500);

  return successResponse(res, { logs: data, pagination: { page, limit, total: count, pages: Math.ceil(count / limit) } });
});
