'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse, parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * GET /api/whiteboards/:meetingId - Get whiteboard for a meeting
 */
exports.getWhiteboard = asyncHandler(async (req, res) => {
  const { meetingId } = req.params;

  let { data, error } = await supabaseAdmin
    .from('whiteboards')
    .select('*, elements:whiteboard_elements(*)')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (error) return errorResponse(res, 'Failed to fetch whiteboard', 500);

  if (!data) {
    const { data: newBoard, error: createErr } = await supabaseAdmin
      .from('whiteboards')
      .insert({ meeting_id: meetingId, created_by: req.userId, title: 'Meeting Whiteboard' })
      .select()
      .single();
    if (createErr) return errorResponse(res, 'Failed to create whiteboard', 500);
    data = { ...newBoard, elements: [] };
  }

  return successResponse(res, data);
});

/**
 * POST /api/whiteboards/:id/elements - Add element
 */
exports.addElement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { type, data, position, style } = req.body;

  const { data: elem, error } = await supabaseAdmin
    .from('whiteboard_elements')
    .insert({
      whiteboard_id: id,
      created_by: req.userId,
      type,
      data,
      position,
      style,
    })
    .select()
    .single();

  if (error) return errorResponse(res, 'Failed to add element', 500);
  return successResponse(res, elem, 'Element added', 201);
});

/**
 * DELETE /api/whiteboards/:id/elements - Clear whiteboard
 */
exports.clearWhiteboard = asyncHandler(async (req, res) => {
  const { id } = req.params;

  await supabaseAdmin.from('whiteboard_elements').delete().eq('whiteboard_id', id);

  return successResponse(res, null, 'Whiteboard cleared');
});

/**
 * POST /api/whiteboards/:id/save - Save whiteboard as image
 */
exports.saveWhiteboard = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { image_data } = req.body; // base64 PNG

  if (!image_data) return errorResponse(res, 'Image data required', 400);

  const buffer = Buffer.from(image_data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const bucket = process.env.STORAGE_BUCKET_WHITEBOARDS || 'whiteboards';
  const path = `${req.userId}/${id}/snapshot_${Date.now()}.png`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, buffer, { contentType: 'image/png', upsert: false });

  if (uploadError) return errorResponse(res, 'Failed to save whiteboard', 500);

  const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);

  await supabaseAdmin.from('whiteboards').update({ snapshot_url: urlData.publicUrl }).eq('id', id);

  return successResponse(res, { snapshot_url: urlData.publicUrl }, 'Whiteboard saved');
});
