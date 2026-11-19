import { query } from './db.js';

export const applySchema = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS members (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      handle text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      name text NOT NULL,
      headline text NOT NULL DEFAULT '',
      location text NOT NULL DEFAULT '',
      visibility text NOT NULL DEFAULT 'public',
      confirmed boolean NOT NULL DEFAULT false,
      photo_id text,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS confirmation_codes (
      email text PRIMARY KEY,
      code text NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_sections (
      member_id text PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      about text NOT NULL DEFAULT '',
      intro_version int NOT NULL DEFAULT 1,
      about_version int NOT NULL DEFAULT 1,
      experience_version int NOT NULL DEFAULT 1,
      education_version int NOT NULL DEFAULT 1,
      skills_version int NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS experience (
      id text PRIMARY KEY,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      title text NOT NULL,
      company text NOT NULL,
      start_month text NOT NULL,
      end_month text,
      position int NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS education (
      id text PRIMARY KEY,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      school text NOT NULL,
      degree text NOT NULL,
      start_month text NOT NULL,
      end_month text,
      position int NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS skills (
      id text PRIMARY KEY,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      name text NOT NULL,
      UNIQUE (member_id, name)
    );
    CREATE TABLE IF NOT EXISTS featured_skills (
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      skill_id text NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      position int NOT NULL,
      PRIMARY KEY (member_id, skill_id)
    );
    CREATE TABLE IF NOT EXISTS connections (
      requester_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      addressee_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      state text NOT NULL,
      requested_at timestamptz NOT NULL,
      connected_at timestamptz,
      withdrawn_at timestamptz,
      ignored_at timestamptz,
      PRIMARY KEY (requester_id, addressee_id)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      blocked_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      at timestamptz NOT NULL,
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS follows (
      follower_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      target_id text NOT NULL,
      at timestamptz NOT NULL,
      PRIMARY KEY (follower_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS posts (
      id text PRIMARY KEY,
      author_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      text text NOT NULL,
      photo_id text,
      shared_post_id text REFERENCES posts(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL,
      edited_at timestamptz,
      deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS reposts (
      id text PRIMARY KEY,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reactions (
      post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      type text NOT NULL,
      at timestamptz NOT NULL,
      PRIMARY KEY (post_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id text PRIMARY KEY,
      post_id text NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      parent_id text REFERENCES comments(id) ON DELETE CASCADE,
      author_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      text text NOT NULL,
      created_at timestamptz NOT NULL,
      deleted boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS endorsements (
      owner_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      skill_id text NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      endorser_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      at timestamptz NOT NULL,
      PRIMARY KEY (owner_id, skill_id, endorser_id)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      other_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      PRIMARY KEY (conversation_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id text PRIMARY KEY,
      conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      text text NOT NULL,
      sent_at timestamptz NOT NULL,
      read_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS companies (
      id text PRIMARY KEY,
      handle text NOT NULL UNIQUE,
      name text NOT NULL,
      location text NOT NULL DEFAULT '',
      about text NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS company_admins (
      company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      PRIMARY KEY (company_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id text PRIMARY KEY,
      company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      poster_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      title text NOT NULL,
      location text NOT NULL DEFAULT '',
      workplace text NOT NULL DEFAULT 'on-site',
      posted_at timestamptz NOT NULL,
      closes_at timestamptz NOT NULL,
      description text NOT NULL DEFAULT '',
      title_version int NOT NULL DEFAULT 1,
      location_version int NOT NULL DEFAULT 1,
      workplace_version int NOT NULL DEFAULT 1,
      closes_at_version int NOT NULL DEFAULT 1,
      description_version int NOT NULL DEFAULT 1,
      questions_version int NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS screening_questions (
      id text PRIMARY KEY,
      job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      type text NOT NULL,
      text text NOT NULL,
      required boolean NOT NULL DEFAULT false,
      knock_out boolean NOT NULL DEFAULT false,
      ideal text,
      options jsonb,
      accepted jsonb,
      minimum numeric,
      maximum numeric,
      position int NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS saved_jobs (
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      at timestamptz NOT NULL,
      PRIMARY KEY (member_id, job_id)
    );
    CREATE TABLE IF NOT EXISTS applications (
      id text PRIMARY KEY,
      job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      applicant_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      resume_id text,
      state text NOT NULL DEFAULT 'applied',
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS application_history (
      id text PRIMARY KEY,
      application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      state text NOT NULL,
      at timestamptz NOT NULL,
      by text NOT NULL,
      reason text
    );
    CREATE TABLE IF NOT EXISTS application_answers (
      application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      question_id text NOT NULL REFERENCES screening_questions(id) ON DELETE CASCADE,
      answer jsonb NOT NULL,
      PRIMARY KEY (application_id, question_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id text PRIMARY KEY,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      kind text NOT NULL,
      post_id text,
      comment_id text,
      skill_id text,
      job_id text,
      application_id text,
      actor_id text,
      count int NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      seen_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      member_id text NOT NULL,
      route text NOT NULL,
      key text NOT NULL,
      status int NOT NULL,
      body jsonb NOT NULL,
      body_hash text NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (member_id, route, key)
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id text PRIMARY KEY,
      kind text NOT NULL,
      owner_id text NOT NULL,
      content_type text NOT NULL,
      bytes int NOT NULL,
      sha256 text,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS editor_presence (
      job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      opened_at timestamptz NOT NULL,
      last_seen timestamptz NOT NULL,
      PRIMARY KEY (job_id, member_id)
    );
    CREATE TABLE IF NOT EXISTS typing_signals (
      kind text NOT NULL,
      scope text NOT NULL,
      member_id text NOT NULL,
      field text NOT NULL DEFAULT '',
      at timestamptz NOT NULL,
      PRIMARY KEY (kind, scope, member_id, field)
    );
    CREATE TABLE IF NOT EXISTS clock_moves (
      id int PRIMARY KEY DEFAULT 1,
      at timestamptz NOT NULL
    );
    INSERT INTO clock_moves (id, at) VALUES (1, '-infinity'::timestamptz) ON CONFLICT DO NOTHING;
  `);
};
