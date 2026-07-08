'use strict';

const { body, param, query, validationResult } = require('express-validator');
const { errorResponse } = require('../utils/helpers');

/**
 * Handle validation errors
 */
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return errorResponse(res, 'Validation failed', 400, errors.array());
  }
  next();
};

// ─── Auth Validators ──────────────────────────────────────────────────────────
const validateRegister = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be 8+ chars with uppercase, lowercase, and number'),
  body('full_name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be 2-100 characters'),
  handleValidation,
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation,
];

const validateForgotPassword = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  handleValidation,
];

const validateResetPassword = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be 8+ chars with uppercase, lowercase, and number'),
  handleValidation,
];

const validateChangePassword = [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must be 8+ chars with uppercase, lowercase, and number'),
  handleValidation,
];

// ─── Meeting Validators ───────────────────────────────────────────────────────
const validateCreateMeeting = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Meeting title is required (max 200 chars)'),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('scheduled_at').optional().isISO8601().withMessage('Invalid date format'),
  body('password').optional().isLength({ max: 50 }),
  body('max_participants').optional().isInt({ min: 2, max: 500 }),
  handleValidation,
];

const validateJoinMeeting = [
  body('meeting_id').trim().notEmpty().withMessage('Meeting ID is required'),
  body('password').optional().trim(),
  handleValidation,
];

// ─── Profile Validators ───────────────────────────────────────────────────────
const validateUpdateProfile = [
  body('full_name').optional().trim().isLength({ min: 2, max: 100 }),
  body('bio').optional().trim().isLength({ max: 500 }),
  body('job_title').optional().trim().isLength({ max: 100 }),
  body('company').optional().trim().isLength({ max: 100 }),
  body('phone').optional().trim().isMobilePhone(),
  body('timezone').optional().trim().isLength({ max: 50 }),
  body('language').optional().trim().isLength({ max: 10 }),
  handleValidation,
];

// ─── Message Validators ───────────────────────────────────────────────────────
const validateSendMessage = [
  body('content').trim().isLength({ min: 1, max: 5000 }).withMessage('Message cannot be empty (max 5000 chars)'),
  body('meeting_id').notEmpty().withMessage('Meeting ID is required'),
  handleValidation,
];

module.exports = {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateCreateMeeting,
  validateJoinMeeting,
  validateUpdateProfile,
  validateSendMessage,
};
