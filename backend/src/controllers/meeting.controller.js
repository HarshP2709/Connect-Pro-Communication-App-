'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { generateMeetingId, generateMeetingPin, successResponse, errorResponse, parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * POST /api/meetings - Create meeting
 */
exports.createMeeting = asyncHandler(async (req, res) => {
  const {
    title, description, scheduled_at, password, max_participants = 100,
    enable_waiting_room = true, enable_recording = false, is_recurring = false,
    meeting_type = 'video',
  } = req.body;

  const meetingId = generateMeetingId();
  const pin = generateMeetingPin();

  const { data: meeting, error } = await supabaseAdmin
    .from('meetings')
    .insert({
      meeting_id: meetingId,
      host_id: req.userId,
      title,
      description,
      password: password || null,
      pin,
      scheduled_at: scheduled_at || null,
      max_participants,
      enable_waiting_room,
      enable_recording,
      is_recurring,
      meeting_type,
      status: 'scheduled',
    })
    .select()
    .single();

  if (error) {
    logger.error('Create meeting error:', error);
    return errorResponse(res, 'Failed to create meeting', 500);
  }

  // Add host as participant
  await supabaseAdmin.from('meeting_participants').insert({
    meeting_id: meeting.id,
    user_id: req.userId,
    role: 'host',
    joined_at: new Date().toISOString(),
  });

  // Log activity
  await supabaseAdmin.from('activity_logs').insert({
    user_id: req.userId,
    action: 'meeting_created',
    resource_id: meeting.id,
    details: { meeting_id: meetingId, title },
  });

  return successResponse(res, meeting, 'Meeting created successfully', 201);
});

/**
 * GET /api/meetings - List user's meetings
 */
exports.getMeetings = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { status, type } = req.query;

  let query = supabaseAdmin
    .from('meetings')
    .select('*, host:profiles!meetings_host_id_fkey(id, full_name, avatar_url)', { count: 'exact' })
    .eq('host_id', req.userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (type) query = query.eq('meeting_type', type);

  const { data, error, count } = await query;
  if (error) return errorResponse(res, 'Failed to fetch meetings', 500);

  return successResponse(res, {
    meetings: data,
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  });
});

/**
 * GET /api/meetings/:id - Get meeting by ID or meeting_id
 */
exports.getMeeting = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUUID = UUID_RE.test(id);

  let query = supabaseAdmin.from('meetings').select(`
      *,
      host:profiles!meetings_host_id_fkey(id, full_name, avatar_url, job_title),
      participants:meeting_participants(
        id, role, joined_at, left_at,
        user:profiles(id, full_name, avatar_url)
      )
    `);
  query = isUUID
    ? query.or(`id.eq.${id},meeting_id.eq.${id}`)
    : query.eq('meeting_id', id);

  const { data: meeting, error } = await query.maybeSingle();

  if (error || !meeting) return errorResponse(res, 'Meeting not found', 404);

  return successResponse(res, meeting);
});

/**
 * POST /api/meetings/:id/join - Join a meeting
 */
exports.joinMeeting = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  // id may be either the UUID primary key or the human-readable meeting_id (e.g. "1ib-pqh1-zis").
  // Passing a non-UUID value into id.eq.<uuid-column> causes a Postgres cast error in Supabase,
  // so query by meeting_id first, then fall back to UUID primary key.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUUID = UUID_RE.test(id);

  let query = supabaseAdmin.from('meetings').select('*');
  query = isUUID
    ? query.or(`id.eq.${id},meeting_id.eq.${id}`)
    : query.eq('meeting_id', id);

  const { data: meeting, error } = await query.maybeSingle();

  if (error || !meeting) return errorResponse(res, 'Meeting not found', 404);

  if (meeting.status === 'ended') return errorResponse(res, 'This meeting has ended', 410);
  if (meeting.status === 'cancelled') return errorResponse(res, 'This meeting was cancelled', 410);

  // Check password
  if (meeting.password && meeting.password !== password) {
    return errorResponse(res, 'Incorrect meeting password', 403);
  }

  // Check participant limit
  const { count } = await supabaseAdmin
    .from('meeting_participants')
    .select('id', { count: 'exact' })
    .eq('meeting_id', meeting.id)
    .is('left_at', null);

  if (count >= meeting.max_participants) {
    return errorResponse(res, 'Meeting is at capacity', 403);
  }

  // Check if user is already a participant
  const { data: existing } = await supabaseAdmin
    .from('meeting_participants')
    .select('id')
    .eq('meeting_id', meeting.id)
    .eq('user_id', req.userId)
    .maybeSingle();

  if (!existing) {
    await supabaseAdmin.from('meeting_participants').insert({
      meeting_id: meeting.id,
      user_id: req.userId,
      role: meeting.host_id === req.userId ? 'host' : 'participant',
      joined_at: new Date().toISOString(),
    });
  } else {
    // Rejoin — clear left_at
    await supabaseAdmin.from('meeting_participants')
      .update({ left_at: null, joined_at: new Date().toISOString() })
      .eq('id', existing.id);
  }

  // Set meeting to active if scheduled
  if (meeting.status === 'scheduled') {
    await supabaseAdmin.from('meetings').update({ status: 'active', started_at: new Date().toISOString() }).eq('id', meeting.id);
  }

  return successResponse(res, {
    meeting: { ...meeting, password: undefined },
    is_host: meeting.host_id === req.userId,
  });
});

/**
 * PATCH /api/meetings/:id - Update meeting
 */
exports.updateMeeting = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: meeting } = await supabaseAdmin.from('meetings').select('host_id').eq('id', id).single();
  if (!meeting) return errorResponse(res, 'Meeting not found', 404);
  if (meeting.host_id !== req.userId && req.user.role !== 'admin') {
    return errorResponse(res, 'Only host can update meeting', 403);
  }

  const allowed = ['title', 'description', 'scheduled_at', 'password', 'max_participants', 'enable_waiting_room', 'status'];
  const updates = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

  const { data, error } = await supabaseAdmin.from('meetings').update(updates).eq('id', id).select().single();
  if (error) return errorResponse(res, 'Failed to update meeting', 500);

  return successResponse(res, data, 'Meeting updated');
});

/**
 * DELETE /api/meetings/:id - Cancel meeting
 */
exports.deleteMeeting = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: meeting } = await supabaseAdmin.from('meetings').select('host_id').eq('id', id).single();
  if (!meeting) return errorResponse(res, 'Meeting not found', 404);
  if (meeting.host_id !== req.userId && req.user.role !== 'admin') {
    return errorResponse(res, 'Only host can cancel meeting', 403);
  }

  await supabaseAdmin.from('meetings').update({ status: 'cancelled' }).eq('id', id);
  return successResponse(res, null, 'Meeting cancelled');
});

/**
 * POST /api/meetings/:id/end - End meeting
 */
exports.endMeeting = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: meeting } = await supabaseAdmin.from('meetings').select('host_id').eq('id', id).single();
  if (!meeting) return errorResponse(res, 'Meeting not found', 404);
  if (meeting.host_id !== req.userId && req.user.role !== 'admin') {
    return errorResponse(res, 'Only host can end meeting', 403);
  }

  const now = new Date().toISOString();
  await supabaseAdmin.from('meetings').update({ status: 'ended', ended_at: now }).eq('id', id);
  await supabaseAdmin.from('meeting_participants').update({ left_at: now }).eq('meeting_id', id).is('left_at', null);

  return successResponse(res, null, 'Meeting ended');
});

/**
 * GET /api/meetings/dashboard - Dashboard stats
 */
exports.getDashboard = asyncHandler(async (req, res) => {
  const userId = req.userId;
  const today = new Date().toISOString().split('T')[0];

  const [upcoming, todayMeetings, recent, totalMeetings] = await Promise.all([
    supabaseAdmin.from('meetings').select('*').eq('host_id', userId).eq('status', 'scheduled').gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(5),
    supabaseAdmin.from('meetings').select('*').eq('host_id', userId).eq('status', 'active'),
    supabaseAdmin.from('meetings').select('*').eq('host_id', userId).eq('status', 'ended').order('ended_at', { ascending: false }).limit(10),
    supabaseAdmin.from('meetings').select('id', { count: 'exact' }).eq('host_id', userId),
  ]);

  return successResponse(res, {
    upcoming: upcoming.data || [],
    active: todayMeetings.data || [],
    recent: recent.data || [],
    stats: {
      total_meetings: totalMeetings.count || 0,
    },
  });
});
