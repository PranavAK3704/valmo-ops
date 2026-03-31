-- ================================================================
-- Valmo Ops LMS — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ================================================================

-- Agent profiles (one row per user, upserted on login)
CREATE TABLE IF NOT EXISTS agent_profiles (
  email          TEXT PRIMARY KEY,
  role           TEXT,
  hub            TEXT,
  level          INTEGER DEFAULT 1,
  total_xp       INTEGER DEFAULT 0,
  streak_current INTEGER DEFAULT 0,
  streak_longest INTEGER DEFAULT 0,
  videos_watched INTEGER DEFAULT 0,
  assessments_passed INTEGER DEFAULT 0,
  avg_score      NUMERIC(5,2) DEFAULT 0,
  last_active    TIMESTAMPTZ DEFAULT NOW(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Gamification events (append-only log — every XP earn, achievement, level-up)
CREATE TABLE IF NOT EXISTS gamification_events (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email          TEXT NOT NULL,
  event_type     TEXT NOT NULL, -- xp_earned | achievement_unlocked | level_up | streak_bonus
  xp_amount      INTEGER DEFAULT 0,
  reason         TEXT,
  process_name   TEXT,
  new_level      INTEGER,
  achievement_id TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gam_events_email   ON gamification_events(email);
CREATE INDEX IF NOT EXISTS idx_gam_events_created ON gamification_events(created_at DESC);

-- Captain sessions (one row per completed process session)
CREATE TABLE IF NOT EXISTS captain_sessions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   TEXT UNIQUE NOT NULL,
  email        TEXT NOT NULL,
  process_name TEXT NOT NULL,
  pct          INTEGER,  -- Process Cycle Time (seconds)
  total_pkrt   INTEGER,  -- Total pause time (seconds)
  pause_count  INTEGER DEFAULT 0,
  query_count  INTEGER DEFAULT 0,
  error_count  INTEGER DEFAULT 0,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cap_sessions_email   ON captain_sessions(email);
CREATE INDEX IF NOT EXISTS idx_cap_sessions_process ON captain_sessions(process_name);
CREATE INDEX IF NOT EXISTS idx_cap_sessions_date    ON captain_sessions(completed_at DESC);

-- Per-pause detail — enables QFD bifurcation by query/issue type
CREATE TABLE IF NOT EXISTS captain_pauses (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id           TEXT NOT NULL,
  email                TEXT NOT NULL,
  process_name         TEXT,
  pause_index          INTEGER,          -- 0-based position within the session
  pause_reason         TEXT,             -- issue text typed by captain
  resolution_method    TEXT,             -- 'jarvis' | 'video' | 'other'
  resolution_successful BOOLEAN,
  pkrt                 INTEGER,          -- seconds (pause to resume duration)
  chat_transcript      JSONB,            -- [{role, content}] if method = jarvis
  video_watched        TEXT,             -- video name if method = video
  paused_at            TIMESTAMPTZ,
  resumed_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cap_pauses_session  ON captain_pauses(session_id);
CREATE INDEX IF NOT EXISTS idx_cap_pauses_email    ON captain_pauses(email);
CREATE INDEX IF NOT EXISTS idx_cap_pauses_process  ON captain_pauses(process_name);
ALTER TABLE captain_pauses DISABLE ROW LEVEL SECURITY;

-- L1 ART metrics — daily snapshot per agent per queue
CREATE TABLE IF NOT EXISTS l1_art_metrics (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email        TEXT NOT NULL,
  date         DATE NOT NULL,
  queue        TEXT NOT NULL,
  art_hours    NUMERIC(8,2),
  ticket_count INTEGER DEFAULT 0,
  reopen_count INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email, date, queue)
);
CREATE INDEX IF NOT EXISTS idx_art_email ON l1_art_metrics(email);
CREATE INDEX IF NOT EXISTS idx_art_date  ON l1_art_metrics(date DESC);

-- Simulations (created by admin via slides-to-sim pipeline)
CREATE TABLE IF NOT EXISTS simulations (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  process_name TEXT,
  hub          TEXT,
  step_count   INTEGER DEFAULT 0,
  steps_json   JSONB,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Simulation completions (one row per agent per sim, upserted on replay)
CREATE TABLE IF NOT EXISTS sim_completions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email        TEXT NOT NULL,
  sim_id       TEXT NOT NULL,
  process_name TEXT,
  score        INTEGER,       -- 0–100
  mode         TEXT,          -- guided | practice
  time_seconds INTEGER,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email, sim_id)
);
CREATE INDEX IF NOT EXISTS idx_sim_completions_email  ON sim_completions(email);
CREATE INDEX IF NOT EXISTS idx_sim_completions_sim_id ON sim_completions(sim_id);

-- LMS admin portal users (educators + admins who log into the web portal)
CREATE TABLE IF NOT EXISTS lms_portal_users (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'educator', -- educator | admin
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_sign_in_at TIMESTAMPTZ
);

-- LMS configuration key-value store (XP weights, feature flags, etc.)
CREATE TABLE IF NOT EXISTS lms_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default XP weights if not already present
INSERT INTO lms_config (key, value) VALUES (
  'xp_weights',
  '{"sim_complete":50,"sim_perfect_score":100,"streak_bonus":25,"first_time_process":30,"daily_login":10,"assessment_pass":75,"captain_no_error":40}'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- ── Access policy: internal tool, anon key is safe ──────────────
-- Disable RLS so the extension's anon key can INSERT/SELECT freely.
-- Revisit when adding external auth.
ALTER TABLE agent_profiles      DISABLE ROW LEVEL SECURITY;
ALTER TABLE gamification_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE captain_sessions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE l1_art_metrics      DISABLE ROW LEVEL SECURITY;
ALTER TABLE simulations         DISABLE ROW LEVEL SECURITY;
ALTER TABLE sim_completions     DISABLE ROW LEVEL SECURITY;
ALTER TABLE lms_portal_users    DISABLE ROW LEVEL SECURITY;
ALTER TABLE lms_config          DISABLE ROW LEVEL SECURITY;

-- ── Helpful views for the admin portal ──────────────────────────

-- Hub leaderboard (ordered by XP)
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  email,
  role,
  hub,
  level,
  total_xp,
  streak_current,
  streak_longest,
  videos_watched,
  assessments_passed,
  avg_score,
  last_active,
  RANK() OVER (PARTITION BY hub ORDER BY total_xp DESC) AS hub_rank,
  RANK() OVER (ORDER BY total_xp DESC)                  AS global_rank
FROM agent_profiles
ORDER BY total_xp DESC;

-- Captain performance summary (last 30 days)
CREATE OR REPLACE VIEW captain_performance AS
SELECT
  email,
  COUNT(*)                            AS sessions,
  ROUND(AVG(pct) / 60.0, 1)          AS avg_pct_min,
  ROUND(AVG(total_pkrt) / 60.0, 1)   AS avg_pkrt_min,
  ROUND(AVG(pause_count), 1)          AS avg_pauses,
  ROUND(AVG(query_count), 1)          AS avg_queries,
  SUM(error_count)                    AS total_errors,
  MIN(completed_at)                   AS first_session,
  MAX(completed_at)                   AS last_session
FROM captain_sessions
WHERE completed_at > NOW() - INTERVAL '30 days'
GROUP BY email;

-- L1 agent ART summary (latest per agent)
CREATE OR REPLACE VIEW l1_performance AS
SELECT
  email,
  ROUND(AVG(art_hours), 2)            AS avg_art_hours,
  SUM(ticket_count)                   AS total_tickets,
  SUM(reopen_count)                   AS total_reopens,
  ROUND(SUM(reopen_count) * 100.0 / NULLIF(SUM(ticket_count), 0), 1) AS reopen_rate_pct,
  MAX(date)                           AS last_updated
FROM l1_art_metrics
WHERE date > CURRENT_DATE - 30
GROUP BY email;

-- ================================================================
-- TRIGGERS
-- ================================================================

-- Level thresholds: every 500 XP = 1 level (cap at 20)
-- XP trigger: on every gamification_events INSERT, update agent_profiles
CREATE OR REPLACE FUNCTION fn_apply_xp()
RETURNS TRIGGER AS $$
DECLARE
  new_total INTEGER;
  new_level  INTEGER;
BEGIN
  -- Upsert profile row so it always exists
  INSERT INTO agent_profiles (email, role, total_xp, level, last_active)
  VALUES (NEW.email, 'Captain', NEW.xp_amount, 1, NOW())
  ON CONFLICT (email) DO UPDATE
    SET total_xp    = agent_profiles.total_xp + NEW.xp_amount,
        last_active = NOW(),
        updated_at  = NOW();

  -- Recalculate level based on new total
  SELECT total_xp INTO new_total FROM agent_profiles WHERE email = NEW.email;
  new_level := LEAST(20, GREATEST(1, (new_total / 500) + 1));

  UPDATE agent_profiles
  SET level = new_level
  WHERE email = NEW.email AND level <> new_level;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_apply_xp ON gamification_events;
CREATE TRIGGER trg_apply_xp
  AFTER INSERT ON gamification_events
  FOR EACH ROW
  WHEN (NEW.xp_amount > 0)
  EXECUTE FUNCTION fn_apply_xp();

-- ================================================================
-- ASSESSMENTS
-- Trainers create MCQ assessments linked to processes/sims
-- ================================================================

CREATE TABLE IF NOT EXISTS assessments (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT NOT NULL,
  process_name  TEXT,
  sim_id        TEXT REFERENCES simulations(id) ON DELETE SET NULL,
  passing_score INTEGER DEFAULT 70,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE assessments DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS assessment_questions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id  UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question       TEXT NOT NULL,
  options        JSONB NOT NULL,  -- [{"key":"A","text":"..."},...]
  correct_key    TEXT NOT NULL,   -- "A" | "B" | "C" | "D"
  explanation    TEXT,
  order_index    INTEGER DEFAULT 0
);
ALTER TABLE assessment_questions DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_aq_assessment ON assessment_questions(assessment_id);

CREATE TABLE IF NOT EXISTS assessment_results (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email         TEXT NOT NULL,
  assessment_id UUID NOT NULL REFERENCES assessments(id),
  score         INTEGER NOT NULL,  -- 0-100
  passed        BOOLEAN NOT NULL,
  answers       JSONB,             -- {"<question_id>": "A", ...}
  attempt_count INTEGER DEFAULT 1,
  completed_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE assessment_results DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ar_email      ON assessment_results(email);
CREATE INDEX IF NOT EXISTS idx_ar_assessment ON assessment_results(assessment_id);

-- ================================================================
-- SIM ASSIGNMENTS
-- Admin assigns specific sims to specific hubs or individual captains
-- ================================================================

CREATE TABLE IF NOT EXISTS sim_assignments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sim_id       TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  assigned_to  TEXT NOT NULL,                -- hub name OR captain email
  assign_type  TEXT NOT NULL DEFAULT 'hub',  -- 'hub' | 'captain'
  is_mandatory BOOLEAN DEFAULT false,
  due_date     DATE,
  assigned_by  TEXT,
  assigned_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sim_assign_sim    ON sim_assignments(sim_id);
CREATE INDEX IF NOT EXISTS idx_sim_assign_target ON sim_assignments(assigned_to);
ALTER TABLE sim_assignments DISABLE ROW LEVEL SECURITY;

-- View: mandatory sims a captain hasn't completed yet
CREATE OR REPLACE VIEW captain_pending_sims AS
SELECT
  a.assigned_to   AS email,
  a.sim_id,
  s.title         AS sim_title,
  s.process_name,
  a.is_mandatory,
  a.due_date,
  c.completed_at  AS completed_at
FROM sim_assignments a
JOIN simulations s ON s.id = a.sim_id
LEFT JOIN sim_completions c
  ON c.sim_id = a.sim_id AND c.email = a.assigned_to
WHERE a.assign_type = 'captain'
UNION ALL
-- Hub-level assignments expanded to each captain in that hub
SELECT
  p.email,
  a.sim_id,
  s.title,
  s.process_name,
  a.is_mandatory,
  a.due_date,
  c.completed_at
FROM sim_assignments a
JOIN simulations s ON s.id = a.sim_id
JOIN agent_profiles p ON p.hub = a.assigned_to AND p.role = 'Captain'
LEFT JOIN sim_completions c
  ON c.sim_id = a.sim_id AND c.email = p.email
WHERE a.assign_type = 'hub';

-- ================================================================
-- PHASE 1 — HUB IDENTITY & DATA INTEGRITY
-- Run these ALTER statements after the initial schema above.
-- All ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS are safe
-- to re-run on an existing database.
-- ================================================================

-- ── hubs table — single source of truth for all 12,000 hubs ────────────────
-- Hub codes are provisioned by Valmo ops and given to hub managers.
-- Format: {CITY_3}-{3_DIGIT_NUMBER}  e.g. MUM-042, DEL-117
-- Captains enter this code on first login; the extension validates against this table.
CREATE TABLE IF NOT EXISTS hubs (
  hub_code      TEXT PRIMARY KEY,          -- e.g. 'MUM-042'
  hub_name      TEXT NOT NULL,             -- e.g. 'Mumbai Hub 42'
  city          TEXT,
  region        TEXT,
  manager_email TEXT,
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE hubs DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_hubs_city   ON hubs(city);
CREATE INDEX IF NOT EXISTS idx_hubs_region ON hubs(region);
CREATE INDEX IF NOT EXISTS idx_hubs_active ON hubs(active) WHERE active = true;

-- ── Add hub_code to agent_profiles ─────────────────────────────────────────
-- hub (text) kept for backward compat; hub_code is the validated FK going forward
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS hub_code TEXT REFERENCES hubs(hub_code);
CREATE INDEX IF NOT EXISTS idx_profiles_hub_code ON agent_profiles(hub_code);

-- ── Add hub_code to captain_sessions ───────────────────────────────────────
-- Denormalized on every row so hub queries never need a join to agent_profiles
ALTER TABLE captain_sessions ADD COLUMN IF NOT EXISTS hub_code TEXT REFERENCES hubs(hub_code);
CREATE INDEX IF NOT EXISTS idx_sessions_hub_code    ON captain_sessions(hub_code);
CREATE INDEX IF NOT EXISTS idx_sessions_hub_proc    ON captain_sessions(hub_code, process_name);
CREATE INDEX IF NOT EXISTS idx_sessions_hub_date    ON captain_sessions(hub_code, completed_at DESC);

-- ── Add hub_code to captain_pauses ─────────────────────────────────────────
ALTER TABLE captain_pauses ADD COLUMN IF NOT EXISTS hub_code TEXT REFERENCES hubs(hub_code);
CREATE INDEX IF NOT EXISTS idx_pauses_hub_code ON captain_pauses(hub_code);
CREATE INDEX IF NOT EXISTS idx_pauses_hub_proc ON captain_pauses(hub_code, process_name);

-- ── Add bucket column to captain_pauses (Phase 3 query bifurcation) ────────
ALTER TABLE captain_pauses ADD COLUMN IF NOT EXISTS bucket TEXT;
  -- Values: 'PROCESS_GAP' | 'POLICY_UNCLEAR' | 'SYSTEM_ISSUE' |
  --         'CUSTOMER_COMPLEXITY' | 'REPETITIVE' | 'UNCLASSIFIED'
CREATE INDEX IF NOT EXISTS idx_pauses_bucket ON captain_pauses(bucket);

-- ── Add hub_code to sim_assignments ────────────────────────────────────────
-- Going forward, hub-type assignments use hub_code (validated FK).
-- assigned_to is kept for backward compat with existing rows.
ALTER TABLE sim_assignments ADD COLUMN IF NOT EXISTS hub_code TEXT REFERENCES hubs(hub_code);
CREATE INDEX IF NOT EXISTS idx_sim_assign_hub_code ON sim_assignments(hub_code);

-- ── Update captain_pending_sims view to use hub_code ───────────────────────
CREATE OR REPLACE VIEW captain_pending_sims AS
SELECT
  a.assigned_to   AS email,
  a.sim_id,
  s.title         AS sim_title,
  s.process_name,
  a.is_mandatory,
  a.due_date,
  c.completed_at  AS completed_at
FROM sim_assignments a
JOIN simulations s ON s.id = a.sim_id
LEFT JOIN sim_completions c
  ON c.sim_id = a.sim_id AND c.email = a.assigned_to
WHERE a.assign_type = 'captain'
UNION ALL
-- Hub-level assignments: join on hub_code when available, fall back to hub name
SELECT
  p.email,
  a.sim_id,
  s.title,
  s.process_name,
  a.is_mandatory,
  a.due_date,
  c.completed_at
FROM sim_assignments a
JOIN simulations s ON s.id = a.sim_id
JOIN agent_profiles p ON (
  (a.hub_code IS NOT NULL AND p.hub_code = a.hub_code)
  OR
  (a.hub_code IS NULL AND p.hub = a.assigned_to)
) AND p.role = 'Captain'
LEFT JOIN sim_completions c
  ON c.sim_id = a.sim_id AND c.email = p.email
WHERE a.assign_type = 'hub';

-- ── Hub performance view (Phase 4/5 foundation) ────────────────────────────
CREATE OR REPLACE VIEW hub_performance AS
SELECT
  hub_code,
  COUNT(*)                                        AS total_sessions,
  ROUND(AVG(pct) / 60.0, 1)                      AS avg_pct_min,
  ROUND(AVG(total_pkrt) / 60.0, 1)               AS avg_pkrt_min,
  ROUND(AVG(pause_count), 2)                      AS avg_qfd,
  ROUND(AVG(error_count), 3)                      AS avg_iper,
  COUNT(DISTINCT email)                           AS active_captains,
  COUNT(DISTINCT process_name)                    AS processes_tracked,
  MAX(completed_at)                               AS last_session
FROM captain_sessions
WHERE completed_at > NOW() - INTERVAL '30 days'
  AND hub_code IS NOT NULL
GROUP BY hub_code;

-- ── Hub + process breakdown view (trainer enforcement, Phase 5) ────────────
CREATE OR REPLACE VIEW hub_process_weakness AS
SELECT
  hub_code,
  process_name,
  COUNT(*)                        AS sessions,
  ROUND(AVG(pause_count), 2)      AS avg_qfd,
  ROUND(AVG(error_count), 3)      AS avg_iper,
  ROUND(AVG(pct) / 60.0, 1)      AS avg_pct_min,
  COUNT(DISTINCT email)           AS captains_ran
FROM captain_sessions
WHERE completed_at > NOW() - INTERVAL '30 days'
  AND hub_code IS NOT NULL
GROUP BY hub_code, process_name
ORDER BY avg_qfd DESC;

-- ── Seed: sample hub for testing ───────────────────────────────────────────
INSERT INTO hubs (hub_code, hub_name, city, region, active)
VALUES ('TEST-001', 'Test Hub 1', 'Mumbai', 'West', true)
ON CONFLICT (hub_code) DO NOTHING;
