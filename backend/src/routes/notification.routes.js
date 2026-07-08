'use strict';

const express = require('express');
const router = express.Router();
const notifController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', notifController.getNotifications);
router.patch('/read-all', notifController.markAllRead);
router.patch('/:id/read', notifController.markRead);
router.delete('/:id', notifController.deleteNotification);

module.exports = router;
