'use strict';

const express = require('express');
const router = express.Router();
const whiteboardController = require('../controllers/whiteboard.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/:meetingId', whiteboardController.getWhiteboard);
router.post('/:id/elements', whiteboardController.addElement);
router.delete('/:id/elements', whiteboardController.clearWhiteboard);
router.post('/:id/save', whiteboardController.saveWhiteboard);

module.exports = router;
