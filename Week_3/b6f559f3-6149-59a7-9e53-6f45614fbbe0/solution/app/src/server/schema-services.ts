/** Tables of the uploads, publishing, mail and invite services. `assets` and `versions` live in the core schema. */
export const SERVICES_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS outbox (
     id bigserial PRIMARY KEY,
     kind text NOT NULL,
     ref text NOT NULL,
     project_id text,
     to_email text NOT NULL,
     subject text NOT NULL,
     body text NOT NULL,
     status text NOT NULL DEFAULT 'queued',
     attempts integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL,
     sent_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS outbox_ref ON outbox (kind, ref)`,
  `CREATE INDEX IF NOT EXISTS outbox_queued ON outbox (status, id)`,
  `CREATE TABLE IF NOT EXISTS invites (
     id text PRIMARY KEY,
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     email text NOT NULL,
     role text NOT NULL,
     token_hash text NOT NULL UNIQUE,
     invited_by text NOT NULL REFERENCES people (id),
     created_at timestamptz NOT NULL,
     expires_at timestamptz NOT NULL,
     accepted_at timestamptz,
     accepted_by text REFERENCES people (id)
   )`,
  `CREATE INDEX IF NOT EXISTS invites_project ON invites (project_id)`,
];
