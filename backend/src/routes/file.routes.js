'use strict';

const express = require('express');
const router = express.Router();
const fileController = require('../controllers/file.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { uploadSingle } = require('../middleware/upload.middleware');

router.use(authenticate);

router.get('/storage-usage', fileController.getStorageUsage);
router.get('/', fileController.getFiles);
router.post('/upload', uploadSingle('file', 100), fileController.uploadFile);
router.get('/:id/download', fileController.downloadFile);
router.get('/:id', fileController.getFile);
router.delete('/:id', fileController.deleteFile);

module.exports = router;
