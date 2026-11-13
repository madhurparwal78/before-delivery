package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Migrate applies the schema idempotently on every serve.
func (s *Store) Migrate(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS meta (k text PRIMARY KEY, v text NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS users (
			id uuid PRIMARY KEY,
			name text NOT NULL,
			email text NOT NULL UNIQUE,
			password_hash text NOT NULL,
			role text NOT NULL DEFAULT 'responder',
			timezone text NOT NULL DEFAULT 'America/Chicago',
			quiet_start text,
			quiet_end text,
			notification_delays jsonb NOT NULL DEFAULT '[5,15]',
			low_urgency_delay int NOT NULL DEFAULT 0,
			created_at timestamptz NOT NULL DEFAULT now(),
			removed_at timestamptz
		)`,
		`CREATE TABLE IF NOT EXISTS sessions (
			token text PRIMARY KEY,
			user_id uuid NOT NULL REFERENCES users(id),
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS clock (
			id int PRIMARY KEY DEFAULT 1,
			offset_seconds bigint NOT NULL DEFAULT 0,
			frozen boolean NOT NULL DEFAULT false,
			frozen_at timestamptz
		)`,
		`INSERT INTO clock (id, offset_seconds, frozen) VALUES (1, 0, false) ON CONFLICT DO NOTHING`,
		`CREATE TABLE IF NOT EXISTS schedules (
			id uuid PRIMARY KEY,
			name text NOT NULL,
			zone text NOT NULL,
			record_format int NOT NULL DEFAULT 2,
			upgraded_at timestamptz,
			version int NOT NULL DEFAULT 1,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS layers (
			id uuid PRIMARY KEY,
			schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
			name text NOT NULL,
			"order" int NOT NULL,
			shift_days int NOT NULL,
			handoff_time text NOT NULL,
			start_date text NOT NULL,
			people jsonb NOT NULL,
			restrictions jsonb NOT NULL DEFAULT '[]',
			edited_at timestamptz NOT NULL DEFAULT now(),
			version int NOT NULL DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS overrides (
			id uuid PRIMARY KEY,
			schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
			person_id uuid REFERENCES users(id),
			"start" timestamptz NOT NULL,
			"end" timestamptz NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS policies (
			id uuid PRIMARY KEY,
			name text NOT NULL,
			repeats int NOT NULL DEFAULT 0,
			levels jsonb NOT NULL,
			version int NOT NULL DEFAULT 1,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS services (
			id uuid PRIMARY KEY,
			name text NOT NULL,
			team text NOT NULL,
			policy_id uuid REFERENCES policies(id),
			depends_on jsonb NOT NULL DEFAULT '[]',
			grouping_mode text NOT NULL DEFAULT 'none',
			grouping_minutes int,
			ack_timeout_minutes int,
			auto_resolve_minutes int,
			version int NOT NULL DEFAULT 1,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS integrations (
			id uuid PRIMARY KEY,
			service_id uuid NOT NULL REFERENCES services(id),
			name text NOT NULL,
			routing_key text NOT NULL UNIQUE,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS incidents (
			id uuid PRIMARY KEY,
			number bigint NOT NULL,
			title text NOT NULL,
			service_id uuid NOT NULL REFERENCES services(id),
			status text NOT NULL,
			urgency text NOT NULL DEFAULT 'low',
			level int NOT NULL DEFAULT 1,
			cycle int NOT NULL DEFAULT 0,
			policy_snapshot jsonb NOT NULL,
			holders jsonb NOT NULL DEFAULT '[]',
			opened_at timestamptz NOT NULL,
			ack_deadline timestamptz,
			snoozed_until timestamptz,
			snoozed_by uuid,
			auto_resolve_at timestamptz,
			escalate_at timestamptz,
			escalation_finished boolean NOT NULL DEFAULT false,
			grouping_until timestamptz,
			resolve_reason text,
			merged_into uuid,
			impacted_services jsonb NOT NULL DEFAULT '[]',
			responders jsonb NOT NULL DEFAULT '[]',
			responders_removed boolean NOT NULL DEFAULT false,
			version int NOT NULL DEFAULT 1,
			closed_at timestamptz,
			updated_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS incidents_number ON incidents (number)`,
		`CREATE TABLE IF NOT EXISTS alerts (
			id uuid PRIMARY KEY,
			incident_id uuid NOT NULL REFERENCES incidents(id),
			routing_key text,
			dedup_key text NOT NULL,
			status text NOT NULL,
			summary text NOT NULL,
			source text NOT NULL,
			severity text NOT NULL,
			event_count int NOT NULL DEFAULT 1,
			opened_at timestamptz NOT NULL,
			resolved_at timestamptz
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedup_open ON alerts (routing_key, dedup_key) WHERE status != 'resolved'`,
		`CREATE TABLE IF NOT EXISTS timelines (
			id uuid PRIMARY KEY,
			incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
			at timestamptz NOT NULL,
			kind text NOT NULL,
			actor text NOT NULL,
			text text NOT NULL,
			from_number bigint,
			ack_at timestamptz
		)`,
		`CREATE INDEX IF NOT EXISTS timelines_incident ON timelines (incident_id, at)`,
		`CREATE TABLE IF NOT EXISTS note_drafts (
			incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
			user_id uuid NOT NULL REFERENCES users(id),
			body text NOT NULL,
			saved_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (incident_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS steps (
			id uuid PRIMARY KEY,
			incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
			person_id uuid NOT NULL REFERENCES users(id),
			kind text NOT NULL,
			channel text NOT NULL,
			due_at timestamptz NOT NULL,
			status text NOT NULL,
			sent_at timestamptz,
			token text,
			token_expires timestamptz,
			quiet_release timestamptz,
			used boolean NOT NULL DEFAULT false
		)`,
		`CREATE INDEX IF NOT EXISTS steps_incident ON steps (incident_id)`,
		`CREATE TABLE IF NOT EXISTS responder_requests (
			id uuid PRIMARY KEY,
			incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
			person_id uuid NOT NULL REFERENCES users(id),
			state text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now(),
			answered_at timestamptz
		)`,
		`CREATE TABLE IF NOT EXISTS event_log (
			id uuid PRIMARY KEY,
			integration_id uuid NOT NULL,
			event_id text,
			at timestamptz NOT NULL,
			action text NOT NULL,
			dedup_key text,
			outcome text NOT NULL,
			reason text,
			incident_number bigint
		)`,
		`CREATE INDEX IF NOT EXISTS event_log_integration ON event_log (integration_id, at)`,
		`CREATE TABLE IF NOT EXISTS dead_letters (
			id uuid PRIMARY KEY,
			event_id text,
			routing_key text NOT NULL,
			reason text NOT NULL,
			raw text NOT NULL,
			attempts int NOT NULL DEFAULT 3,
			dead_at timestamptz NOT NULL DEFAULT now(),
			replayed_at timestamptz,
			integration_id uuid
		)`,
		`CREATE TABLE IF NOT EXISTS maintenance_windows (
			id uuid PRIMARY KEY,
			service_id uuid NOT NULL REFERENCES services(id),
			starts_at timestamptz NOT NULL,
			ends_at timestamptz NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS status_updates (
			id uuid PRIMARY KEY,
			title text NOT NULL,
			body text NOT NULL,
			state text NOT NULL,
			service_ids jsonb NOT NULL DEFAULT '[]',
			published_at timestamptz,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS subscribers (
			id uuid PRIMARY KEY,
			email text NOT NULL UNIQUE,
			token text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS webhook_endpoints (
			id uuid PRIMARY KEY,
			name text NOT NULL,
			path text NOT NULL,
			event_types jsonb NOT NULL,
			service_ids jsonb NOT NULL DEFAULT '[]',
			secret text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS deliveries (
			id uuid PRIMARY KEY,
			endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
			event_id text NOT NULL,
			type text NOT NULL,
			incident_id uuid NOT NULL,
			status text NOT NULL,
			next_attempt_at timestamptz,
			attempt int NOT NULL DEFAULT 0,
			payload jsonb NOT NULL,
			occurred_at timestamptz NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS attempts (
			id uuid PRIMARY KEY,
			delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
			attempt int NOT NULL,
			at timestamptz NOT NULL,
			status_code int,
			body text,
			outcome text NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS api_keys (
			id uuid PRIMARY KEY,
			name text NOT NULL,
			scope text NOT NULL,
			key_hash text NOT NULL,
			previous_hash text,
			grace_ends_at timestamptz,
			revoked_at timestamptz,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS mail_queue (
			id uuid PRIMARY KEY,
			to_addr text NOT NULL,
			subject text NOT NULL,
			body text NOT NULL,
			due_at timestamptz NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS idempotency (
			key text PRIMARY KEY,
			endpoint text NOT NULL,
			body_hash text NOT NULL,
			response_body text NOT NULL,
			status int NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS live_log (
			seq bigint PRIMARY KEY,
			type text NOT NULL,
			at timestamptz NOT NULL,
			data jsonb NOT NULL,
			audience text NOT NULL DEFAULT 'all'
		)`,
		`CREATE TABLE IF NOT EXISTS saved_filters (
			id uuid PRIMARY KEY,
			user_id uuid NOT NULL REFERENCES users(id),
			name text NOT NULL,
			status text NOT NULL,
			service_id uuid,
			created_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS analytics_jobs (
			id uuid PRIMARY KEY,
			"from" text NOT NULL,
			"to" text NOT NULL,
			state text NOT NULL,
			done int NOT NULL DEFAULT 0,
			total int NOT NULL,
			rows jsonb,
			overall jsonb,
			created_at timestamptz NOT NULL DEFAULT now(),
			finished_at timestamptz
		)`,
		`CREATE TABLE IF NOT EXISTS calendar_tokens (
			token text PRIMARY KEY,
			user_id uuid NOT NULL REFERENCES users(id),
			expires_at timestamptz NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS intake_seq (
			routing_key text NOT NULL,
			dedup_key text NOT NULL,
			last_seq int NOT NULL DEFAULT 0,
			PRIMARY KEY (routing_key, dedup_key)
		)`,
		`CREATE TABLE IF NOT EXISTS applied_events (
			event_id text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS applied_seqs (
			routing_key text NOT NULL,
			dedup_key text NOT NULL,
			key_seq int NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (routing_key, dedup_key, key_seq)
		)`,
		`CREATE TABLE IF NOT EXISTS waiting_events (
			routing_key text NOT NULL,
			dedup_key text NOT NULL,
			key_seq int NOT NULL,
			event_id text NOT NULL,
			body jsonb NOT NULL,
			first_seen timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (routing_key, dedup_key, key_seq)
		)`,
	}
	for _, stmt := range statements {
		if _, err := s.Pool.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("applying schema: %w\n%s", err, stmt)
		}
	}
	// Column additions for tables created by an earlier serve, applied
	// idempotently like the rest of the schema.
	for _, stmt := range []string{
		`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS previous_hash text`,
		`ALTER TABLE dead_letters ADD COLUMN IF NOT EXISTS replayed_at timestamptz`,
	} {
		if _, err := s.Pool.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("applying schema: %w\n%s", err, stmt)
		}
	}
	return nil
}

// IsSeeded reports whether the database already holds seed data.
func (s *Store) IsSeeded(ctx context.Context) (bool, error) {
	var n int
	err := s.Pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE removed_at IS NULL`).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// Now returns the real wall clock; the server clock adds the stored offset.
func (s *Store) RealNow() time.Time { return time.Now().UTC().Truncate(time.Second) }

// ClockState is the persisted server clock.
type ClockState struct {
	OffsetSeconds int64
	Frozen       bool
	FrozenAt     *time.Time
}

// LoadClock reads the clock row.
func (s *Store) LoadClock(ctx context.Context) (ClockState, error) {
	var c ClockState
	var frozenAt *time.Time
	err := s.Pool.QueryRow(ctx, `SELECT offset_seconds, frozen, frozen_at FROM clock WHERE id = 1`).
		Scan(&c.OffsetSeconds, &c.Frozen, &frozenAt)
	if err != nil {
		return c, err
	}
	c.FrozenAt = frozenAt
	return c, nil
}

// SaveClock writes the clock row.
func (s *Store) SaveClock(ctx context.Context, offset int64, frozen bool, frozenAt *time.Time) error {
	_, err := s.Pool.Exec(ctx, `UPDATE clock SET offset_seconds = $1, frozen = $2, frozen_at = $3 WHERE id = 1`,
		offset, frozen, frozenAt)
	return err
}

// MetaSet stores a metadata value.
func (s *Store) MetaSet(ctx context.Context, k, v string) error {
	_, err := s.Pool.Exec(ctx, `INSERT INTO meta (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = $2`, k, v)
	return err
}

// MetaGet reads a metadata value.
func (s *Store) MetaGet(ctx context.Context, k string) (string, error) {
	var v string
	err := s.Pool.QueryRow(ctx, `SELECT v FROM meta WHERE k = $1`, k).Scan(&v)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return v, err
}

