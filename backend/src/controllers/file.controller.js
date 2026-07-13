'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { successResponse, errorResponse, parsePagination, generateStoragePath, formatBytes } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * POST /api/files/upload - Upload file to Supabase Storage
 */
exports.uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) return errorResponse(res, 'No file provided', 400);

  const { meeting_id, description } = req.body;

  if (meeting_id) {
    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('host_id')
      .eq('id', meeting_id)
      .single();

    if (meeting && meeting.host_id !== req.userId) {
      return errorResponse(res, 'Only the host is allowed to upload files in this meeting', 403);
    }
  }

  const bucket = process.env.STORAGE_BUCKET_FILES || 'meeting-files';
  const storagePath = generateStoragePath(bucket, req.userId, req.file.originalname);

  // Upload to Supabase Storage
  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      cacheControl: '3600',
    });

  if (uploadError) return errorResponse(res, 'Failed to upload file', 500);

  // Get public URL
  const { data: urlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);

  // Save to database
  const { data: fileRecord, error: dbError } = await supabaseAdmin
    .from('files')
    .insert({
      uploader_id: req.userId,
      meeting_id: meeting_id || null,
      name: req.file.originalname,
      storage_path: storagePath,
      public_url: urlData.publicUrl,
      mime_type: req.file.mimetype,
      size: req.file.size,
      description: description || null,
      bucket,
    })
    .select()
    .single();

  if (dbError) return errorResponse(res, 'Failed to save file record', 500);

  return successResponse(res, fileRecord, 'File uploaded successfully', 201);
});

/**
 * GET /api/files - List user's files
 */
exports.getFiles = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { meeting_id } = req.query;

  let query = supabaseAdmin
    .from('files')
    .select(`
      *,
      uploader:profiles!files_uploader_id_fkey(id, full_name, avatar_url)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (meeting_id) {
    query = query.eq('meeting_id', meeting_id);
  } else {
    query = query.eq('uploader_id', req.userId);
  }

  const { data, error, count } = await query;
  if (error) return errorResponse(res, 'Failed to fetch files', 500);

  return successResponse(res, {
    files: data,
    pagination: { page, limit, total: count, pages: Math.ceil(count / limit) },
  });
});

/**
 * GET /api/files/:id - Get file
 */
exports.getFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: file, error } = await supabaseAdmin
    .from('files')
    .select('*, uploader:profiles!files_uploader_id_fkey(id, full_name, avatar_url)')
    .eq('id', id)
    .single();

  if (error || !file) return errorResponse(res, 'File not found', 404);

  return successResponse(res, file);
});

/**
 * GET /api/files/:id/download - Get a short-lived signed download URL
 */
exports.downloadFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: file } = await supabaseAdmin
    .from('files')
    .select('*')
    .eq('id', id)
    .single();

  if (!file) return errorResponse(res, 'File not found', 404);

  if (file.uploader_id !== req.userId) {
    if (!file.meeting_id) {
      return errorResponse(res, 'Only the host or uploader is allowed to download files', 403);
    }
    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('host_id')
      .eq('id', file.meeting_id)
      .single();

    if (!meeting || meeting.host_id !== req.userId) {
      return errorResponse(res, 'Only the host or uploader is allowed to download files', 403);
    }
  }

  // Try signed URL first (works for both public and private buckets)
  const { data: signedData, error: signedErr } = await supabaseAdmin.storage
    .from(file.bucket)
    .createSignedUrl(file.storage_path, 300); // 5-minute expiry

  if (!signedErr && signedData?.signedUrl) {
    return successResponse(res, { url: signedData.signedUrl, name: file.name });
  }

  // Fallback: public URL stored at upload time
  return successResponse(res, { url: file.public_url, name: file.name });
});

/**
 * DELETE /api/files/:id - Delete file
 */
exports.deleteFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: file } = await supabaseAdmin.from('files').select('*').eq('id', id).single();
  if (!file) return errorResponse(res, 'File not found', 404);
  if (file.uploader_id !== req.userId && req.user.role !== 'admin') {
    return errorResponse(res, 'Cannot delete another user\'s file', 403);
  }

  // Delete from storage
  await supabaseAdmin.storage.from(file.bucket).remove([file.storage_path]);

  // Delete from DB
  await supabaseAdmin.from('files').delete().eq('id', id);

  return successResponse(res, null, 'File deleted');
});

/**
 * GET /api/files/storage-usage - Get user's storage usage
 */
exports.getStorageUsage = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('files')
    .select('size')
    .eq('uploader_id', req.userId);

  if (error) return errorResponse(res, 'Failed to get storage usage', 500);

  const totalBytes = (data || []).reduce((sum, f) => sum + (f.size || 0), 0);
  const limitBytes = 5 * 1024 * 1024 * 1024; // 5 GB

  return successResponse(res, {
    used: totalBytes,
    used_formatted: formatBytes(totalBytes),
    limit: limitBytes,
    limit_formatted: formatBytes(limitBytes),
    percentage: Math.round((totalBytes / limitBytes) * 100),
    files_count: data.length,
  });
});
