-- ============================================================
-- ConnectPro — Complete Supabase PostgreSQL Schema
-- Paste entirely into Supabase SQL Editor and run.
-- ============================================================

-- ─── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ─── Enum Types ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE meeting_status AS ENUM ('scheduled', 'active', 'ended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE meeting_type AS ENUM ('video', 'audio', 'webinar');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE participant_role AS ENUM ('host', 'co-host', 'moderator', 'participant');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'meeting_join','meeting_reminder','meeting_invite',
    'file_shared','mention','new_message','system'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE message_type AS ENUM ('text','image','file','system','emoji');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Helper: updated_at trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════
-- TABLE: profiles
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT UNIQUE NOT NULL,
  full_name      TEXT NOT NULL DEFAULT '',
  avatar_url     TEXT,
  bio            TEXT,
  job_title      TEXT,
  company        TEXT,
  phone          TEXT,
  location       TEXT,
  timezone       TEXT DEFAULT 'UTC',
  language       TEXT DEFAULT 'en',
  role           user_role DEFAULT 'user' NOT NULL,
  is_active      BOOLEAN DEFAULT TRUE NOT NULL,
  is_verified    BOOLEAN DEFAULT FALSE NOT NULL,
  is_online      BOOLEAN DEFAULT FALSE NOT NULL,
  last_seen      TIMESTAMPTZ DEFAULT NOW(),
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_email       ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role        ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active   ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_is_online   ON profiles(is_online);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name   ON profiles USING gin(full_name gin_trgm_ops);

-- Trigger
DROP TRIGGER IF EXISTS on_profiles_updated ON profiles;
CREATE TRIGGER on_profiles_updated
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view any profile"
  ON profiles FOR SELECT
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Service role can manage profiles"
  ON profiles FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- AUTO-CREATE PROFILE ON SIGNUP
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active, is_verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'user',
    TRUE,
    CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN TRUE ELSE FALSE END
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        is_verified = CASE WHEN NEW.email_confirmed_at IS NOT NULL THEN TRUE ELSE profiles.is_verified END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also handle email confirmation
CREATE OR REPLACE FUNCTION public.handle_user_updated()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.profiles SET is_verified = TRUE WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_updated();

-- ═══════════════════════════════════════════════════════════
-- TABLE: user_settings
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_settings (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  theme                  TEXT DEFAULT 'dark',
  language               TEXT DEFAULT 'en',
  notifications_enabled  BOOLEAN DEFAULT TRUE,
  meeting_notifications  BOOLEAN DEFAULT TRUE,
  message_notifications  BOOLEAN DEFAULT TRUE,
  sound_enabled          BOOLEAN DEFAULT TRUE,
  video_quality          TEXT DEFAULT 'hd',
  audio_input            TEXT,
  audio_output           TEXT,
  video_input            TEXT,
  blur_background        BOOLEAN DEFAULT FALSE,
  noise_suppression      BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at             TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

DROP TRIGGER IF EXISTS on_user_settings_updated ON user_settings;
CREATE TRIGGER on_user_settings_updated
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own settings"
  ON user_settings FOR ALL
  USING (auth.uid() = user_id);
CREATE POLICY "Service role all settings"
  ON user_settings FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: meetings
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS meetings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id           TEXT UNIQUE NOT NULL,
  host_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  password             TEXT,
  pin                  VARCHAR(6),
  status               meeting_status DEFAULT 'scheduled' NOT NULL,
  meeting_type         meeting_type DEFAULT 'video' NOT NULL,
  max_participants     INTEGER DEFAULT 100 CHECK (max_participants BETWEEN 2 AND 1000),
  enable_waiting_room  BOOLEAN DEFAULT TRUE,
  enable_recording     BOOLEAN DEFAULT FALSE,
  is_recurring         BOOLEAN DEFAULT FALSE,
  recurring_rule       JSONB,
  notes                TEXT,
  summary              TEXT,
  scheduled_at         TIMESTAMPTZ,
  started_at           TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  duration_seconds     INTEGER GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL AND started_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
         ELSE NULL END
  ) STORED,
  created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meetings_host_id     ON meetings(host_id);
CREATE INDEX IF NOT EXISTS idx_meetings_meeting_id  ON meetings(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status      ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled   ON meetings(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_created_at  ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_title       ON meetings USING gin(title gin_trgm_ops);

DROP TRIGGER IF EXISTS on_meetings_updated ON meetings;
CREATE TRIGGER on_meetings_updated
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- NOTE: The SELECT policy referencing meeting_participants is defined below,
-- after the meeting_participants table is created.

CREATE POLICY "Hosts can update own meetings"
  ON meetings FOR UPDATE
  USING (host_id = auth.uid());

CREATE POLICY "Authenticated users can create meetings"
  ON meetings FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND host_id = auth.uid());

CREATE POLICY "Admins can manage all meetings"
  ON meetings FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can manage meetings"
  ON meetings FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: meeting_participants
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS meeting_participants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        participant_role DEFAULT 'participant' NOT NULL,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  left_at     TIMESTAMPTZ,
  duration_seconds INTEGER GENERATED ALWAYS AS (
    CASE WHEN left_at IS NOT NULL
         THEN EXTRACT(EPOCH FROM (left_at - joined_at))::INTEGER
         ELSE NULL END
  ) STORED,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mp_meeting_id ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_mp_user_id    ON meeting_participants(user_id);

ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view meeting members"
  ON meeting_participants FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM meeting_participants mp2 WHERE mp2.meeting_id = meeting_id AND mp2.user_id = auth.uid())
  );

CREATE POLICY "Service role can manage participants"
  ON meeting_participants FOR ALL
  USING (auth.role() = 'service_role');

-- Deferred meetings SELECT policy (requires meeting_participants to exist)
CREATE POLICY "Users can view meetings they participate in"
  ON meetings FOR SELECT
  USING (
    host_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = meetings.id AND user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════
-- TABLE: meeting_messages (Chat)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS meeting_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  message_type message_type DEFAULT 'text' NOT NULL,
  reply_to    UUID REFERENCES meeting_messages(id) ON DELETE SET NULL,
  mentions    UUID[] DEFAULT '{}',
  reactions   JSONB DEFAULT '{}',
  is_edited   BOOLEAN DEFAULT FALSE,
  is_pinned   BOOLEAN DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mm_meeting_id ON meeting_messages(meeting_id);
CREATE INDEX IF NOT EXISTS idx_mm_sender_id  ON meeting_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_mm_created_at ON meeting_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_mm_is_pinned  ON meeting_messages(is_pinned) WHERE is_pinned = TRUE;

DROP TRIGGER IF EXISTS on_meeting_messages_updated ON meeting_messages;
CREATE TRIGGER on_meeting_messages_updated
  BEFORE UPDATE ON meeting_messages
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE meeting_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view meeting messages"
  ON meeting_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = meeting_messages.meeting_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Participants can send messages"
  ON meeting_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = meeting_messages.meeting_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Senders can edit own messages"
  ON meeting_messages FOR UPDATE
  USING (sender_id = auth.uid());

CREATE POLICY "Service role can manage messages"
  ON meeting_messages FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: files
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS files (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uploader_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  meeting_id   UUID REFERENCES meetings(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url   TEXT,
  mime_type    TEXT NOT NULL,
  size         BIGINT NOT NULL DEFAULT 0 CHECK (size >= 0),
  description  TEXT,
  bucket       TEXT NOT NULL DEFAULT 'meeting-files',
  download_count INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_uploader_id ON files(uploader_id);
CREATE INDEX IF NOT EXISTS idx_files_meeting_id  ON files(meeting_id);
CREATE INDEX IF NOT EXISTS idx_files_created_at  ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_name        ON files USING gin(name gin_trgm_ops);

DROP TRIGGER IF EXISTS on_files_updated ON files;
CREATE TRIGGER on_files_updated
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own files or meeting files"
  ON files FOR SELECT
  USING (
    uploader_id = auth.uid()
    OR (meeting_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = files.meeting_id AND user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can upload files"
  ON files FOR INSERT
  WITH CHECK (uploader_id = auth.uid() AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can delete own files"
  ON files FOR DELETE
  USING (uploader_id = auth.uid());

CREATE POLICY "Admins can manage all files"
  ON files FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can manage files"
  ON files FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: whiteboards
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS whiteboards (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id   UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  created_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title        TEXT DEFAULT 'Meeting Whiteboard',
  snapshot_url TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whiteboards_meeting_id ON whiteboards(meeting_id);

DROP TRIGGER IF EXISTS on_whiteboards_updated ON whiteboards;
CREATE TRIGGER on_whiteboards_updated
  BEFORE UPDATE ON whiteboards
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Meeting participants can view whiteboards"
  ON whiteboards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = whiteboards.meeting_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage whiteboards"
  ON whiteboards FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: whiteboard_elements
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS whiteboard_elements (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whiteboard_id  UUID NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
  created_by     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,   -- pen, rect, circle, text, arrow, image
  data           JSONB NOT NULL DEFAULT '{}',
  position       JSONB NOT NULL DEFAULT '{"x":0,"y":0}',
  style          JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_we_whiteboard_id ON whiteboard_elements(whiteboard_id);

ALTER TABLE whiteboard_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Meeting participants can view whiteboard elements"
  ON whiteboard_elements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM whiteboards w
      JOIN meeting_participants mp ON mp.meeting_id = w.meeting_id
      WHERE w.id = whiteboard_elements.whiteboard_id AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage elements"
  ON whiteboard_elements FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: notifications
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       notification_type NOT NULL DEFAULT 'system',
  title      TEXT NOT NULL,
  message    TEXT,
  data       JSONB DEFAULT '{}',
  is_read    BOOLEAN DEFAULT FALSE NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_user_id    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_is_read    ON notifications(is_read, user_id);
CREATE INDEX IF NOT EXISTS idx_notif_created_at ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users update own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users delete own notifications"
  ON notifications FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage notifications"
  ON notifications FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: meeting_invitations
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS meeting_invitations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  invited_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  token       TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  accepted    BOOLEAN DEFAULT FALSE,
  expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mi_meeting_id ON meeting_invitations(meeting_id);
CREATE INDEX IF NOT EXISTS idx_mi_email      ON meeting_invitations(email);
CREATE INDEX IF NOT EXISTS idx_mi_token      ON meeting_invitations(token);

ALTER TABLE meeting_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage invitations"
  ON meeting_invitations FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users see invitations sent to them"
  ON meeting_invitations FOR SELECT
  USING (user_id = auth.uid() OR invited_by = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- TABLE: meeting_recordings
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS meeting_recordings (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id   UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  recorded_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url   TEXT,
  duration_seconds INTEGER,
  size         BIGINT,
  status       TEXT DEFAULT 'processing', -- processing, ready, failed
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rec_meeting_id ON meeting_recordings(meeting_id);

ALTER TABLE meeting_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Meeting participants can view recordings"
  ON meeting_recordings FOR SELECT
  USING (
    recorded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM meeting_participants
      WHERE meeting_id = meeting_recordings.meeting_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage recordings"
  ON meeting_recordings FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: activity_logs
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  resource_id UUID,
  details     JSONB DEFAULT '{}',
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_al_user_id    ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_al_action     ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_al_created_at ON activity_logs(created_at DESC);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view activity logs"
  ON activity_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can manage logs"
  ON activity_logs FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- TABLE: reports
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL, -- user, message, meeting
  resource_id  UUID NOT NULL,
  reason       TEXT NOT NULL,
  description  TEXT,
  status       TEXT DEFAULT 'pending', -- pending, reviewed, resolved
  reviewed_by  UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_id  ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_status       ON reports(status);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can submit reports"
  ON reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Admins can manage reports"
  ON reports FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','moderator')));

CREATE POLICY "Service role can manage reports"
  ON reports FOR ALL
  USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════
-- STORAGE BUCKETS
-- ═══════════════════════════════════════════════════════════
-- Run these in the Supabase Storage section or use API:

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars',        'avatars',        TRUE,  5242880,    ARRAY['image/jpeg','image/png','image/gif','image/webp']),
  ('meeting-files',  'meeting-files',  FALSE, 104857600,  NULL),
  ('recordings',     'recordings',     FALSE, 5368709120, ARRAY['video/mp4','video/webm']),
  ('whiteboards',    'whiteboards',    FALSE, 10485760,   ARRAY['image/png']),
  ('documents',      'documents',      FALSE, 52428800,   NULL),
  ('chat-images',    'chat-images',    FALSE, 10485760,   ARRAY['image/jpeg','image/png','image/gif','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Authenticated users can view meeting files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'meeting-files' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload meeting files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'meeting-files' AND auth.role() = 'authenticated');

CREATE POLICY "Users can delete own meeting files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'meeting-files' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Authenticated users can view chat images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-images' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload chat images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-images' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view whiteboards"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'whiteboards' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can upload whiteboards"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'whiteboards' AND auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════
-- USEFUL VIEWS
-- ═══════════════════════════════════════════════════════════

-- Meeting summary view
CREATE OR REPLACE VIEW meeting_summary AS
SELECT
  m.id,
  m.meeting_id,
  m.title,
  m.status,
  m.meeting_type,
  m.scheduled_at,
  m.started_at,
  m.ended_at,
  m.duration_seconds,
  p.full_name AS host_name,
  p.avatar_url AS host_avatar,
  COUNT(mp.id) AS participant_count
FROM meetings m
JOIN profiles p ON p.id = m.host_id
LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
GROUP BY m.id, p.full_name, p.avatar_url;

-- User stats view
CREATE OR REPLACE VIEW user_stats AS
SELECT
  u.id,
  u.full_name,
  u.email,
  COUNT(DISTINCT m.id) AS total_meetings_hosted,
  COUNT(DISTINCT mp.meeting_id) AS total_meetings_joined,
  COALESCE(SUM(f.size), 0) AS total_storage_used
FROM profiles u
LEFT JOIN meetings m ON m.host_id = u.id
LEFT JOIN meeting_participants mp ON mp.user_id = u.id
LEFT JOIN files f ON f.uploader_id = u.id
GROUP BY u.id;

-- ═══════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════

-- Get meeting with participant details
CREATE OR REPLACE FUNCTION get_meeting_with_participants(p_meeting_id TEXT)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'meeting', row_to_json(m.*),
    'host', row_to_json(h.*),
    'participants', (
      SELECT jsonb_agg(jsonb_build_object(
        'user', row_to_json(p.*),
        'role', mp.role,
        'joined_at', mp.joined_at
      ))
      FROM meeting_participants mp
      JOIN profiles p ON p.id = mp.user_id
      WHERE mp.meeting_id = m.id
    )
  )
  INTO result
  FROM meetings m
  JOIN profiles h ON h.id = m.host_id
  WHERE m.meeting_id = p_meeting_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup ended meetings older than 90 days
CREATE OR REPLACE FUNCTION cleanup_old_meetings()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM meetings
  WHERE status = 'ended'
    AND ended_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════
-- SEED: Admin user (update email after running)
-- ═══════════════════════════════════════════════════════════
-- After creating your admin account via Supabase Auth UI or API,
-- run this to promote the account:
--
-- UPDATE profiles SET role = 'admin' WHERE email = 'admin@connectpro.io';

-- ═══════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ═══════════════════════════════════════════════════════════
