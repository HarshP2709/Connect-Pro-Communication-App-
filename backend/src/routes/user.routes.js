'use strict';

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate, requireAdmin } = require('../middleware/auth.middleware');
const { uploadAvatar } = require('../middleware/upload.middleware');
const { validateUpdateProfile } = require('../middleware/validation.middleware');

router.use(authenticate);

// Specific /me routes must be registered BEFORE the wildcard /:id route
router.get('/me', userController.getProfile);
router.patch('/me', validateUpdateProfile, userController.updateProfile);
router.post('/me/avatar', uploadAvatar, userController.uploadAvatar);
router.get('/me/settings', userController.getSettings);
router.patch('/me/settings', userController.updateSettings);
router.delete('/me', userController.deleteAccount);

// Wildcard and admin routes after /me routes
router.get('/', requireAdmin, userController.listUsers);
router.get('/:id', userController.getProfile);

module.exports = router;
