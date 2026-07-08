'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Generate a random meeting ID: XXX-XXXX-XXX format
 */
const generateMeetingId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const seg = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg(3)}-${seg(4)}-${seg(3)}`;
};

/**
 * Generate a random 6-digit meeting PIN
 */
const generateMeetingPin = () => Math.floor(100000 + Math.random() * 900000).toString();

/**
 * Sanitize filename for safe storage
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 200);
};

/**
 * Format bytes to human readable
 */
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
};

/**
 * Generate unique storage path
 */
const generateStoragePath = (bucket, userId, filename) => {
  const date = new Date().toISOString().split('T')[0];
  const uniqueName = `${uuidv4()}-${sanitizeFilename(filename)}`;
  return `${userId}/${date}/${uniqueName}`;
};

/**
 * Parse pagination parameters
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * Build success response
 */
const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Build error response
 */
const errorResponse = (res, message = 'Internal Server Error', statusCode = 500, errors = null) => {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };
  if (errors) response.errors = errors;
  return res.status(statusCode).json(response);
};

/**
 * Mask sensitive data
 */
const maskEmail = (email) => {
  const [user, domain] = email.split('@');
  const masked = user.length > 2 ? user[0] + '*'.repeat(user.length - 2) + user.slice(-1) : user;
  return `${masked}@${domain}`;
};

module.exports = {
  generateMeetingId,
  generateMeetingPin,
  sanitizeFilename,
  formatBytes,
  generateStoragePath,
  parsePagination,
  successResponse,
  errorResponse,
  maskEmail,
};
