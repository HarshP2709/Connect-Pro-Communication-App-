'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { validateRegister, validateLogin, validateForgotPassword, validateResetPassword } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', validateRegister, authController.register);
router.post('/login', validateLogin, authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refreshToken);
router.post('/forgot-password', validateForgotPassword, authController.forgotPassword);
router.post('/reset-password', validateResetPassword, authController.resetPassword);
router.post('/verify-email', authController.verifyEmail);
router.get('/me', authenticate, authController.getMe);

module.exports = router;
