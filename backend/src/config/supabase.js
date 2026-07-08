'use strict';

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables');
}

// Admin client (bypasses RLS — use only in backend services)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Public client (respects RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
  }
);

// Test connection
supabaseAdmin.from('profiles').select('count').limit(1).then(({ error }) => {
  if (error) {
    logger.warn('Supabase connection check failed:', error.message);
  } else {
    logger.info('✅ Supabase connected successfully');
  }
}).catch((e) => logger.warn('Supabase ping failed:', e.message));

// Ensure the file storage bucket exists
const BUCKET_NAME = process.env.STORAGE_BUCKET_FILES || 'meeting-files';
supabaseAdmin.storage.getBucket(BUCKET_NAME).then(async ({ error }) => {
  if (error && error.message?.includes('not found')) {
    const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
      public: true,
      fileSizeLimit: 104857600, // 100 MB
    });
    if (createErr) {
      logger.warn(`Storage bucket '${BUCKET_NAME}' could not be created: ${createErr.message}`);
    } else {
      logger.info(`✅ Storage bucket '${BUCKET_NAME}' created`);
    }
  } else if (!error) {
    logger.info(`✅ Storage bucket '${BUCKET_NAME}' exists`);
  }
}).catch((e) => logger.warn(`Bucket check failed: ${e.message}`));

module.exports = { supabase, supabaseAdmin };
