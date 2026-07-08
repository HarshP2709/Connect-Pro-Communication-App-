'use strict';

const express = require('express');
const router = express.Router();
const meetingController = require('../controllers/meeting.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validateCreateMeeting, validateJoinMeeting } = require('../middleware/validation.middleware');

router.use(authenticate);

router.get('/dashboard', meetingController.getDashboard);
router.get('/', meetingController.getMeetings);
router.post('/', validateCreateMeeting, meetingController.createMeeting);
router.get('/:id', meetingController.getMeeting);
router.patch('/:id', meetingController.updateMeeting);
router.delete('/:id', meetingController.deleteMeeting);
router.post('/:id/join', meetingController.joinMeeting);
router.post('/:id/end', meetingController.endMeeting);

module.exports = router;
