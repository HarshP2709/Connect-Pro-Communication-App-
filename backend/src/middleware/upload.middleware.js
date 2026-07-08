'use strict';

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ],
  archive: ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed'],
  video: ['video/mp4', 'video/webm', 'video/ogg'],
};

const ALL_ALLOWED = [
  ...ALLOWED_TYPES.image,
  ...ALLOWED_TYPES.document,
  ...ALLOWED_TYPES.archive,
  ...ALLOWED_TYPES.video,
];

// Memory storage for Supabase uploads
const storage = multer.memoryStorage();

const fileFilter = (allowedMimes) => (req, file, cb) => {
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`), false);
  }
};

const uploadSingle = (fieldName, maxSizeMB = 50, allowed = ALL_ALLOWED) =>
  multer({
    storage,
    limits: { fileSize: maxSizeMB * 1024 * 1024 },
    fileFilter: fileFilter(allowed),
  }).single(fieldName);

const uploadMultiple = (fieldName, maxCount = 10, maxSizeMB = 50) =>
  multer({
    storage,
    limits: { fileSize: maxSizeMB * 1024 * 1024 },
    fileFilter: fileFilter(ALL_ALLOWED),
  }).array(fieldName, maxCount);

const uploadAvatar = uploadSingle('avatar', 5, ALLOWED_TYPES.image);

module.exports = { uploadSingle, uploadMultiple, uploadAvatar, ALLOWED_TYPES };
