'use strict';

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../config/supabase');
const { jwtSecret } = require('../config');
const { errorResponse } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Verify JWT token and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    // Check cookie
    else if (req.cookies?.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) {
      return errorResponse(res, 'Authentication required', 401);
    }

    // Verify JWT
    const decoded = jwt.verify(token, jwtSecret);

    // Fetch user profile from Supabase
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', decoded.sub)
      .eq('is_active', true)
      .single();

    if (error || !profile) {
      return errorResponse(res, 'User not found or inactive', 401);
    }

    req.user = profile;
    req.userId = profile.id;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 'Token expired. Please log in again.', 401);
    }
    if (err.name === 'JsonWebTokenError') {
      return errorResponse(res, 'Invalid token', 401);
    }
    logger.error('Authentication middleware error:', err);
    return errorResponse(res, 'Authentication failed', 401);
  }
};

/**
 * Optional authentication — attaches user if token present but doesn't block
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token = null;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) return next();

    const decoded = jwt.verify(token, jwtSecret);
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', decoded.sub)
      .eq('is_active', true)
      .single();

    if (profile) {
      req.user = profile;
      req.userId = profile.id;
    }
    next();
  } catch {
    next();
  }
};

/**
 * Role-based authorization
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return errorResponse(res, 'Authentication required', 401);
  if (!roles.includes(req.user.role)) {
    return errorResponse(res, 'Insufficient permissions', 403);
  }
  next();
};

/**
 * Require admin role
 */
const requireAdmin = authorize('admin');

/**
 * Require admin or moderator role
 */
const requireModerator = authorize('admin', 'moderator');

module.exports = { authenticate, optionalAuth, authorize, requireAdmin, requireModerator };
