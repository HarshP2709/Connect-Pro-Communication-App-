'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/notifications - Get user notifications
 */
exports.getNotifications = asyncHandler(async (req, res) => {
  const { unread_only } = req.query;

  let query = supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (unread_only === 'true') query = query.eq('is_read', false);

  const { data, error } = await query;
  if (error) return errorResponse(res, 'Failed to fetch notifications', 500);

  const unreadCount = data.filter(n => !n.is_read).length;

  return successResponse(res, { notifications: data, unread_count: unreadCount });
});

/**
 * PATCH /api/notifications/:id/read - Mark as read
 */
exports.markRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', req.userId);

  return successResponse(res, null, 'Notification marked as read');
});

/**
 * PATCH /api/notifications/read-all - Mark all as read
 */
exports.markAllRead = asyncHandler(async (req, res) => {
  await supabaseAdmin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', req.userId)
    .eq('is_read', false);

  return successResponse(res, null, 'All notifications marked as read');
});

/**
 * DELETE /api/notifications/:id - Delete notification
 */
exports.deleteNotification = asyncHandler(async (req, res) => {
  await supabaseAdmin.from('notifications').delete().eq('id', req.params.id).eq('user_id', req.userId);
  return successResponse(res, null, 'Notification deleted');
});
