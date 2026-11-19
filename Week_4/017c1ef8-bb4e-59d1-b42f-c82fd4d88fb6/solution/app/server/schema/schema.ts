
/**
 * The whole schema, applied idempotently every time the app serves.
 * Every timestamp is written from the business clock, never from the database's own clock.
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS clock (
    id int PRIMARY KEY CHECK (id = 1),
    offset_ms bigint NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS members (
    id text PRIMARY KEY,
    email text NOT NULL,
    handle text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    headline text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '',
    about text NOT NULL DEFAULT '',
    visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'connections', 'private')),
    photo_id text,
    confirmed boolean NOT NULL DEFAULT false,
    confirm_code text,
    created_at timestamptz NOT NULL,
    notifications_seen_at timestamptz NOT NULL,
    version_intro int NOT NULL DEFAULT 1,
    version_about int NOT NULL DEFAULT 1,
    version_experience int NOT NULL DEFAULT 1,
    version_education int NOT NULL DEFAULT 1,
    version_skills int NOT NULL DEFAULT 1
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS members_email_key ON members (lower(email))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS members_handle_key ON members (handle)`,

  `CREATE TABLE IF NOT EXISTS member_experience (
    id text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    position int NOT NULL,
    title text NOT NULL,
    company text NOT NULL,
    start text NOT NULL,
    "end" text
  )`,
  `CREATE INDEX IF NOT EXISTS member_experience_member ON member_experience (member_id, position)`,

  `CREATE TABLE IF NOT EXISTS member_education (
    id text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    position int NOT NULL,
    school text NOT NULL,
    degree text NOT NULL,
    start text NOT NULL,
    "end" text
  )`,
  `CREATE INDEX IF NOT EXISTS member_education_member ON member_education (member_id, position)`,

  `CREATE TABLE IF NOT EXISTS skills (
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    name text NOT NULL,
    skill_key text NOT NULL,
    position int NOT NULL,
    featured_position int,
    PRIMARY KEY (member_id, skill_key)
  )`,

  `CREATE TABLE IF NOT EXISTS endorsements (
    owner_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    skill_key text NOT NULL,
    endorser_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (owner_id, skill_key, endorser_id)
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    created_at timestamptz NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS photos (
    id text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    object_key text NOT NULL,
    content_type text NOT NULL,
    bytes int NOT NULL,
    created_at timestamptz NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS resumes (
    id text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    object_key text NOT NULL,
    bytes int NOT NULL,
    sha256 text NOT NULL,
    created_at timestamptz NOT NULL
  )`,

  // One row per connected pair, stored with member_lo < member_hi.
  `CREATE TABLE IF NOT EXISTS connections (
    member_lo text NOT NULL REFERENCES members ON DELETE CASCADE,
    member_hi text NOT NULL REFERENCES members ON DELETE CASCADE,
    connected_at timestamptz NOT NULL,
    PRIMARY KEY (member_lo, member_hi),
    CHECK (member_lo < member_hi)
  )`,
  `CREATE INDEX IF NOT EXISTS connections_hi ON connections (member_hi)`,

  // Every request ever created. 'ignored' is still open for its sender; 'cancelled' means a block deleted it.
  `CREATE TABLE IF NOT EXISTS invitations (
    id text PRIMARY KEY,
    sender_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    receiver_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    state text NOT NULL CHECK (state IN ('pending', 'accepted', 'withdrawn', 'ignored', 'cancelled')),
    created_at timestamptz NOT NULL,
    resolved_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS invitations_sender ON invitations (sender_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS invitations_receiver ON invitations (receiver_id, state)`,

  `CREATE TABLE IF NOT EXISTS blocks (
    blocker_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    blocked_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  )`,
  `CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks (blocked_id)`,

  // target_id is a member id or a company id.
  `CREATE TABLE IF NOT EXISTS follows (
    follower_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    target_id text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (follower_id, target_id)
  )`,
  `CREATE INDEX IF NOT EXISTS follows_target ON follows (target_id)`,

  `CREATE TABLE IF NOT EXISTS companies (
    id text PRIMARY KEY,
    handle text NOT NULL UNIQUE,
    name text NOT NULL,
    location text NOT NULL DEFAULT '',
    about text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS company_admins (
    company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    PRIMARY KEY (company_id, member_id)
  )`,

  // A repost with thoughts is a post whose shared_post_id names the original (no foreign key: the original may be deleted).
  `CREATE TABLE IF NOT EXISTS posts (
    id text PRIMARY KEY,
    author_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    text text NOT NULL,
    mentions jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL,
    edited_at timestamptz,
    photo_id text,
    shared_post_id text
  )`,
  `CREATE INDEX IF NOT EXISTS posts_author_created ON posts (author_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS posts_created ON posts (created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS post_hashtags (
    post_id text NOT NULL REFERENCES posts ON DELETE CASCADE,
    tag text NOT NULL,
    PRIMARY KEY (post_id, tag)
  )`,
  `CREATE INDEX IF NOT EXISTS post_hashtags_tag ON post_hashtags (tag)`,

  // A plain repost: one row per member and original.
  `CREATE TABLE IF NOT EXISTS reposts (
    id text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    post_id text NOT NULL REFERENCES posts ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    UNIQUE (member_id, post_id)
  )`,
  `CREATE INDEX IF NOT EXISTS reposts_created ON reposts (created_at DESC, id DESC)`,

  `CREATE TABLE IF NOT EXISTS reactions (
    post_id text NOT NULL REFERENCES posts ON DELETE CASCADE,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('like', 'celebrate', 'support', 'insightful', 'funny')),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (post_id, member_id)
  )`,

  // deleted_at marks a deleted comment; a deleted comment without live replies is simply not shown.
  `CREATE TABLE IF NOT EXISTS comments (
    id text PRIMARY KEY,
    post_id text NOT NULL REFERENCES posts ON DELETE CASCADE,
    parent_id text REFERENCES comments ON DELETE CASCADE,
    author_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    text text NOT NULL,
    mentions jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL,
    deleted_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS comments_post ON comments (post_id, created_at, id)`,

  `CREATE TABLE IF NOT EXISTS conversations (
    id text PRIMARY KEY,
    member_lo text NOT NULL REFERENCES members ON DELETE CASCADE,
    member_hi text NOT NULL REFERENCES members ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    UNIQUE (member_lo, member_hi)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id text PRIMARY KEY,
    conversation_id text NOT NULL REFERENCES conversations ON DELETE CASCADE,
    sender_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    text text NOT NULL,
    sent_at timestamptz NOT NULL,
    read_at timestamptz,
    seq bigserial
  )`,
  // Messages sent in the same millisecond keep their stored order through seq.
  `CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, sent_at DESC, seq DESC)`,

  // Stored notification events. Grouped reaction and comment items are derived from their own tables at read time.
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    kind text NOT NULL,
    actor_id text REFERENCES members ON DELETE CASCADE,
    post_id text REFERENCES posts ON DELETE CASCADE,
    comment_id text REFERENCES comments ON DELETE CASCADE,
    detail text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS notifications_member ON notifications (member_id, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS jobs (
    id text PRIMARY KEY,
    company_id text NOT NULL REFERENCES companies ON DELETE CASCADE,
    poster_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    title text NOT NULL,
    location text NOT NULL,
    workplace text NOT NULL CHECK (workplace IN ('on-site', 'hybrid', 'remote')),
    description text NOT NULL,
    posted_at timestamptz NOT NULL,
    closes_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS jobs_posted ON jobs (posted_at DESC, id)`,
  // Each editable job field keeps its own version and the admin who made the current one.
  `CREATE TABLE IF NOT EXISTS job_field_versions (
    job_id text NOT NULL REFERENCES jobs ON DELETE CASCADE,
    field text NOT NULL CHECK (field IN ('title', 'location', 'workplace', 'closes_at', 'description', 'questions')),
    version int NOT NULL DEFAULT 1,
    by_member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    PRIMARY KEY (job_id, field)
  )`,
  `CREATE TABLE IF NOT EXISTS job_questions (
    id text PRIMARY KEY,
    job_id text NOT NULL REFERENCES jobs ON DELETE CASCADE,
    position int NOT NULL,
    type text NOT NULL CHECK (type IN ('short_answer', 'yes_no', 'single_choice', 'number')),
    text text NOT NULL,
    required boolean NOT NULL DEFAULT false,
    knock_out boolean NOT NULL DEFAULT false,
    ideal text,
    options jsonb,
    accepted jsonb,
    minimum bigint,
    maximum bigint
  )`,
  `CREATE INDEX IF NOT EXISTS job_questions_job ON job_questions (job_id, position)`,
  `CREATE TABLE IF NOT EXISTS saved_jobs (
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    job_id text NOT NULL REFERENCES jobs ON DELETE CASCADE,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (member_id, job_id)
  )`,

  `CREATE TABLE IF NOT EXISTS applications (
    id text PRIMARY KEY,
    job_id text NOT NULL REFERENCES jobs ON DELETE CASCADE,
    applicant_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    state text NOT NULL CHECK (state IN ('applied', 'viewed', 'interviewing', 'offered', 'rejected', 'withdrawn')),
    answers jsonb NOT NULL DEFAULT '{}',
    resume_id text REFERENCES resumes,
    created_at timestamptz NOT NULL,
    entered_at timestamptz NOT NULL,
    UNIQUE (job_id, applicant_id)
  )`,
  `CREATE TABLE IF NOT EXISTS application_history (
    seq bigserial PRIMARY KEY,
    application_id text NOT NULL REFERENCES applications ON DELETE CASCADE,
    state text NOT NULL,
    at timestamptz NOT NULL,
    by text NOT NULL CHECK (by IN ('you', 'hiring_team', 'automatic')),
    reason text
  )`,
  `CREATE INDEX IF NOT EXISTS application_history_application ON application_history (application_id, seq)`,

  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    member_id text NOT NULL REFERENCES members ON DELETE CASCADE,
    scope text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    status int NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (member_id, scope, key)
  )`,

  // Email waiting to be delivered. These times are real time: delivery retries are not business rules.
  `CREATE TABLE IF NOT EXISTS mail_outbox (
    id bigserial PRIMARY KEY,
    to_address text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    queued_at timestamptz NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    sent_at timestamptz
  )`,
  `CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox (next_attempt_at) WHERE sent_at IS NULL`,
];
