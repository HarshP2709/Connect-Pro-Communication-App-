'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse, parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/messages/:meetingId - Get messages for a meeting
 */
exports.getMessages = asyncHandler(async (req, res) => {
  const { meetingId } = req.params;
  const { page, limit, offset } = parsePagination(req.query);

  // Verify user is a participant
  const { data: participant } = await supabaseAdmin
    .from('meeting_participants')
    .select('id')
    .eq('meeting_id', meetingId)
    .eq('user_id', req.userId)
    .maybeSingle();

  if (!participant && req.user.role !== 'admin') {
    return errorResponse(res, 'Access denied', 403);
  }

  const { data, error, count } = await supabaseAdmin
    .from('meeting_messages')
    .select(`
      *,
      sender:profiles!meeting_messages_sender_id_fkey(id, full_name, avatar_url),
      reply_to:meeting_messages!meeting_messages_reply_to_fkey(id, content, sender:profiles!meeting_messages_sender_id_fkey(full_name))
    `, { count: 'exact' })
    .eq('meeting_id', meetingId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return errorResponse(res, 'Failed to fetch messages', 500);

  return successResponse(res, {
    messages: data,
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  });
});

/**
 * POST /api/messages - Send message
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const { content, meeting_id, message_type = 'text', reply_to, mentions } = req.body;

  const { data, error } = await supabaseAdmin
    .from('meeting_messages')
    .insert({
      meeting_id,
      sender_id: req.userId,
      content,
      message_type,
      reply_to: reply_to || null,
      mentions: mentions || [],
    })
    .select(`
      *,
      sender:profiles!meeting_messages_sender_id_fkey(id, full_name, avatar_url)
    `)
    .single();

  if (error) return errorResponse(res, 'Failed to send message', 500);

  return successResponse(res, data, 'Message sent', 201);
});

/**
 * PATCH /api/messages/:id - Edit message
 */
exports.editMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;

  const { data: msg } = await supabaseAdmin.from('meeting_messages').select('sender_id').eq('id', id).single();
  if (!msg) return errorResponse(res, 'Message not found', 404);
  if (msg.sender_id !== req.userId) return errorResponse(res, 'Cannot edit another user\'s message', 403);

  const { data, error } = await supabaseAdmin
    .from('meeting_messages')
    .update({ content, is_edited: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return errorResponse(res, 'Failed to edit message', 500);
  return successResponse(res, data, 'Message edited');
});

/**
 * DELETE /api/messages/:id - Delete message (soft delete)
 */
exports.deleteMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: msg } = await supabaseAdmin.from('meeting_messages').select('sender_id').eq('id', id).single();
  if (!msg) return errorResponse(res, 'Message not found', 404);
  if (msg.sender_id !== req.userId && req.user.role !== 'admin') {
    return errorResponse(res, 'Cannot delete another user\'s message', 403);
  }

  await supabaseAdmin.from('meeting_messages')
    .update({ deleted_at: new Date().toISOString(), content: '[Message deleted]' })
    .eq('id', id);

  return successResponse(res, null, 'Message deleted');
});

/**
 * POST /api/messages/:id/react - React to a message
 */
exports.reactToMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { emoji } = req.body;

  const { data: msg } = await supabaseAdmin.from('meeting_messages').select('id, reactions').eq('id', id).single();
  if (!msg) return errorResponse(res, 'Message not found', 404);

  const reactions = msg.reactions || {};
  if (!reactions[emoji]) reactions[emoji] = [];

  const userIdx = reactions[emoji].indexOf(req.userId);
  if (userIdx > -1) {
    reactions[emoji].splice(userIdx, 1);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji].push(req.userId);
  }

  const { data, error } = await supabaseAdmin
    .from('meeting_messages')
    .update({ reactions })
    .eq('id', id)
    .select()
    .single();

  if (error) return errorResponse(res, 'Failed to react', 500);
  return successResponse(res, data);
});
