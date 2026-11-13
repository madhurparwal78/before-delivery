-- Notifications and mail (notify*.go, mail*.go, ack*.go).
--
-- steps: one notification step of an incident for a person. Stored status is scheduled | held | sent | cancelled;
--   `queued` is derived (an email step whose send second has passed and which the mail server has not accepted).
--   The second an email goes out is release_at when set (a low-urgency notice held through quiet hours), else due_at.
--   assignment is incidents.assignment when the step was written; used_at is the second its acknowledge link was used.
-- mail_outbox: every outbound message, durable until the mail server accepts it. Status-update mail is read by the
--   status desk as `select count(*) from mail_outbox where kind = 'status' and sent_at is null`.
create table if not exists steps (
  id text primary key,
  incident_id text not null references incidents (id),
  person_id text not null references users (id),
  kind text not null check (kind in ('step', 'low_urgency')),
  channel text not null check (channel in ('in_app', 'email')),
  due_at timestamptz not null,
  release_at timestamptz,
  status text not null check (status in ('scheduled', 'held', 'sent', 'cancelled')),
  sent_at timestamptz,
  assignment int not null,
  used_at timestamptz,
  seq bigserial
);
create index if not exists steps_incident on steps (incident_id, due_at, seq);

create table if not exists mail_outbox (
  id bigserial primary key,
  kind text not null check (kind in ('step', 'low_urgency', 'status')),
  step_id text references steps (id),
  to_address text not null,
  subject text not null,
  body text not null,
  due_at timestamptz not null,
  sent_at timestamptz
);
create index if not exists mail_outbox_unsent on mail_outbox (due_at, id) where sent_at is null;
