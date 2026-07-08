'use strict';

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateSendMessage } = require('../middleware/validation.middleware');

router.use(authenticate);

router.get('/:meetingId', messageController.getMessages);
router.post('/', validateSendMessage, messageController.sendMessage);
router.patch('/:id', messageController.editMessage);
router.delete('/:id', messageController.deleteMessage);
router.post('/:id/react', messageController.reactToMessage);

module.exports = router;
