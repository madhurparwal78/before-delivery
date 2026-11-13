package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"time"

	"github.com/jackc/pgx/v5"
)

// ApprovedStrings reads a branch's approved strings in one language.
func (s *Store) ApprovedStrings(ctx context.Context, db DB, projectID, branchName, language string) (map[string]string, error) {
	rows, err := db.Query(ctx, `select k.name, s.value from segments s
	        join branches b on b.id = s.branch_id
	        join keys k on k.branch_id = s.branch_id and k.key_id = s.key_id
	        where b.project_id = $1 and b.name = $2 and s.language = $3 and s.status = 'approved'
	          and s.value is not null and not k.deleted`, projectID, branchName, language)
	if err != nil {
		return nil, fmt.Errorf("read approved strings: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			return nil, fmt.Errorf("scan approved string: %w", err)
		}
		out[name] = value
	}
	return out, rows.Err()
}

func (s *Store) InsertPublish(ctx context.Context, db DB, projectID string, p *Publish) error {
	if _, err := db.Exec(ctx, `insert into publishes (id, project_id, branch, state, languages, created_at)
	        values ($1,$2,$3,$4,$5,$6)`, p.ID, projectID, p.Branch, p.State, p.Languages, p.CreatedAt); err != nil {
		return fmt.Errorf("insert publish: %w", err)
	}
	return nil
}

// ErrPublishInProgress means the project already has a publish running.
var ErrPublishInProgress = errors.New("a publish is already running")

// ClaimPublish takes the project's one publish slot, so that of simultaneous
// requests exactly one is accepted.
func (s *Store) ClaimPublish(ctx context.Context, projectID string, p *Publish) error {
	return s.InTx(ctx, func(tx pgx.Tx) error {
		hash := fnv.New32a()
		_, _ = hash.Write([]byte("publish" + projectID))
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(hash.Sum32())); err != nil {
			return fmt.Errorf("lock publish slot: %w", err)
		}
		running, err := s.PublishInProgress(ctx, tx, projectID)
		if err != nil {
			return err
		}
		if running {
			return ErrPublishInProgress
		}
		return s.InsertPublish(ctx, tx, projectID, p)
	})
}

// DropPublish removes a claimed publish whose bundles could not be stored.
func (s *Store) DropPublish(ctx context.Context, projectID, publishID string) error {
	if _, err := s.Pool.Exec(ctx, `delete from publishes where project_id = $1 and id = $2`,
		projectID, publishID); err != nil {
		return fmt.Errorf("drop publish: %w", err)
	}
	return nil
}

func (s *Store) PublishInProgress(ctx context.Context, db DB, projectID string) (bool, error) {
	var n int
	if err := db.QueryRow(ctx, `select count(*) from publishes where project_id = $1
	        and state in ('queued','awaiting_host_confirmation')`, projectID).Scan(&n); err != nil {
		return false, fmt.Errorf("count running publishes: %w", err)
	}
	return n > 0, nil
}

func (s *Store) SetPublishBundles(ctx context.Context, projectID, publishID string, bundles map[string]Bundle) error {
	encoded, err := json.Marshal(bundles)
	if err != nil {
		return fmt.Errorf("encode bundles: %w", err)
	}
	if _, err := s.Pool.Exec(ctx, `update publishes set bundles = $3 where project_id = $1 and id = $2`,
		projectID, publishID, encoded); err != nil {
		return fmt.Errorf("store bundles: %w", err)
	}
	return nil
}

func (s *Store) SetPublishAwaiting(ctx context.Context, publishID string, number int, url string) error {
	if _, err := s.Pool.Exec(ctx, `update publishes set state = 'awaiting_host_confirmation',
	        pr_number = $2, pr_url = $3 where id = $1`, publishID, number, url); err != nil {
		return fmt.Errorf("mark publish awaiting: %w", err)
	}
	return nil
}

func (s *Store) SetPublishPublished(ctx context.Context, publishID string, at time.Time) error {
	if _, err := s.Pool.Exec(ctx, `update publishes set state = 'published', confirmed_at = $2 where id = $1`,
		publishID, at); err != nil {
		return fmt.Errorf("mark publish published: %w", err)
	}
	return nil
}

func (s *Store) SetPublishFailed(ctx context.Context, publishID, reason string) error {
	if _, err := s.Pool.Exec(ctx, `update publishes set state = 'failed', failure_reason = $2 where id = $1`,
		publishID, reason); err != nil {
		return fmt.Errorf("mark publish failed: %w", err)
	}
	return nil
}

const publishColumns = `id, branch, state, failure_reason, languages, pr_number, pr_url, bundles,
        created_at, confirmed_at`

func scanPublish(row pgx.Row) (*Publish, error) {
	p := &Publish{}
	var number *int
	var url *string
	var bundles []byte
	err := row.Scan(&p.ID, &p.Branch, &p.State, &p.FailureReason, &p.Languages, &number, &url, &bundles,
		&p.CreatedAt, &p.ConfirmedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan publish: %w", err)
	}
	p.CreatedAt = p.CreatedAt.UTC()
	if p.ConfirmedAt != nil {
		at := p.ConfirmedAt.UTC()
		p.ConfirmedAt = &at
	}
	if number != nil && url != nil {
		p.PullRequest = &PullRequest{Number: *number, URL: *url}
	}
	p.Bundles = map[string]Bundle{}
	if len(bundles) > 0 {
		if err := json.Unmarshal(bundles, &p.Bundles); err != nil {
			return nil, fmt.Errorf("decode bundles: %w", err)
		}
	}
	return p, nil
}

func (s *Store) PublishByID(ctx context.Context, projectID, publishID string) (*Publish, error) {
	return scanPublish(s.Pool.QueryRow(ctx, `select `+publishColumns+` from publishes
	        where project_id = $1 and id = $2`, projectID, publishID))
}

func (s *Store) Publishes(ctx context.Context, projectID string) ([]*Publish, error) {
	rows, err := s.Pool.Query(ctx, `select `+publishColumns+` from publishes where project_id = $1
	        order by created_at desc`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list publishes: %w", err)
	}
	defer rows.Close()
	out := []*Publish{}
	for rows.Next() {
		p, err := scanPublish(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// LastPublish reads the newest publish of a project.
func (s *Store) LastPublish(ctx context.Context, projectID string) (*Publish, error) {
	p, err := scanPublish(s.Pool.QueryRow(ctx, `select `+publishColumns+` from publishes
	        where project_id = $1 order by created_at desc limit 1`, projectID))
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return p, err
}

// StoredResponse reads an idempotent replay.
func (s *Store) StoredResponse(ctx context.Context, projectID, key string) (status int, bodyHash string, body []byte, err error) {
	row := s.Pool.QueryRow(ctx, `select status, body_hash, response from idempotency
	        where project_id = $1 and key = $2`, projectID, key)
	if err := row.Scan(&status, &bodyHash, &body); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, "", nil, ErrNotFound
		}
		return 0, "", nil, fmt.Errorf("read idempotency record: %w", err)
	}
	return status, bodyHash, body, nil
}

func (s *Store) StoreResponse(ctx context.Context, projectID, key, bodyHash string, status int, body []byte) error {
	if _, err := s.Pool.Exec(ctx, `insert into idempotency (project_id, key, body_hash, status, response, created_at)
	        values ($1,$2,$3,$4,$5,$6) on conflict (project_id, key) do nothing`,
		projectID, key, bodyHash, status, body, Now()); err != nil {
		return fmt.Errorf("store idempotency record: %w", err)
	}
	return nil
}

func (s *Store) CreateToken(ctx context.Context, projectID, label string) (id, token string, err error) {
	id = NewID()
	token = "idk_" + RandomToken(32)
	if _, err := s.Pool.Exec(ctx, `insert into tokens (id, project_id, label, token_hash, created_at)
	        values ($1,$2,$3,$4,$5)`, id, projectID, label, HashToken(token), Now()); err != nil {
		return "", "", fmt.Errorf("create token: %w", err)
	}
	return id, token, nil
}

func (s *Store) Tokens(ctx context.Context, projectID string) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `select id, label, created_at from tokens where project_id = $1
	        order by created_at`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list tokens: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, label string
		var at time.Time
		if err := rows.Scan(&id, &label, &at); err != nil {
			return nil, fmt.Errorf("scan token: %w", err)
		}
		out = append(out, map[string]any{"id": id, "label": label, "created_at": at.UTC()})
	}
	return out, rows.Err()
}

func (s *Store) RevokeToken(ctx context.Context, projectID, tokenID string) error {
	tag, err := s.Pool.Exec(ctx, `delete from tokens where project_id = $1 and id = $2`, projectID, tokenID)
	if err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

type Webhook struct {
	URL           string
	SigningSecret string
	AppUID        string
	EndpointID    string
}

func (s *Store) Webhook(ctx context.Context, projectID string) (*Webhook, error) {
	hook := &Webhook{}
	err := s.Pool.QueryRow(ctx, `select url, signing_secret, app_uid, endpoint_id from webhooks
	        where project_id = $1`, projectID).
		Scan(&hook.URL, &hook.SigningSecret, &hook.AppUID, &hook.EndpointID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read webhook endpoint: %w", err)
	}
	return hook, nil
}

func (s *Store) SaveWebhook(ctx context.Context, projectID string, hook *Webhook) error {
	if _, err := s.Pool.Exec(ctx, `insert into webhooks (project_id, url, signing_secret, app_uid, endpoint_id)
	        values ($1,$2,$3,$4,$5) on conflict (project_id) do update set url = excluded.url,
	        signing_secret = excluded.signing_secret, app_uid = excluded.app_uid,
	        endpoint_id = excluded.endpoint_id`,
		projectID, hook.URL, hook.SigningSecret, hook.AppUID, hook.EndpointID); err != nil {
		return fmt.Errorf("save webhook endpoint: %w", err)
	}
	return nil
}

// QueueEvent records one event to hand to Svix. The event id doubles as the
// Svix message id, so a retry never creates a second message.
func (s *Store) QueueEvent(ctx context.Context, projectID, eventID, eventType, appUID string, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode event payload: %w", err)
	}
	if _, err := s.Pool.Exec(ctx, `insert into events (id, project_id, event_id, type, payload, app_uid,
	        state, created_at) values ($1,$2,$3,$4,$5,$6,'pending',$7) on conflict (event_id) do nothing`,
		NewID(), projectID, eventID, eventType, encoded, appUID, Now()); err != nil {
		return fmt.Errorf("queue event: %w", err)
	}
	return nil
}

type PendingEvent struct {
	EventID string
	Type    string
	AppUID  string
	Payload json.RawMessage
}

func (s *Store) PendingEvents(ctx context.Context) ([]PendingEvent, error) {
	rows, err := s.Pool.Query(ctx, `select event_id, type, app_uid, payload from events
	        where state = 'pending' order by created_at`)
	if err != nil {
		return nil, fmt.Errorf("list pending events: %w", err)
	}
	defer rows.Close()
	out := []PendingEvent{}
	for rows.Next() {
		var event PendingEvent
		if err := rows.Scan(&event.EventID, &event.Type, &event.AppUID, &event.Payload); err != nil {
			return nil, fmt.Errorf("scan pending event: %w", err)
		}
		out = append(out, event)
	}
	return out, rows.Err()
}

func (s *Store) CountEventAttempt(ctx context.Context, eventID string) error {
	if _, err := s.Pool.Exec(ctx, `update events set attempts = attempts + 1 where event_id = $1`,
		eventID); err != nil {
		return fmt.Errorf("count event attempt: %w", err)
	}
	return nil
}

func (s *Store) MarkEventSent(ctx context.Context, eventID string, at time.Time) error {
	if _, err := s.Pool.Exec(ctx, `update events set state = 'sent', sent_at = $2 where event_id = $1`,
		eventID, at); err != nil {
		return fmt.Errorf("mark event sent: %w", err)
	}
	return nil
}

func (s *Store) Events(ctx context.Context, projectID string) ([]Event, error) {
	rows, err := s.Pool.Query(ctx, `select event_id, type, state, attempts, created_at, sent_at from events
	        where project_id = $1 order by created_at`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.EventID, &event.Type, &event.State, &event.Attempts, &event.CreatedAt,
			&event.SentAt); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		event.CreatedAt = event.CreatedAt.UTC()
		if event.SentAt != nil {
			at := event.SentAt.UTC()
			event.SentAt = &at
		}
		out = append(out, event)
	}
	return out, rows.Err()
}

// QueueAppDeletion keeps a Svix application deletion to retry.
func (s *Store) QueueAppDeletion(ctx context.Context, appUID string) error {
	if _, err := s.Pool.Exec(ctx, `insert into svix_app_deletions (app_uid, queued_at) values ($1,$2)
	        on conflict (app_uid) do nothing`, appUID, Now()); err != nil {
		return fmt.Errorf("queue application deletion: %w", err)
	}
	return nil
}

func (s *Store) PendingAppDeletions(ctx context.Context) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `select app_uid from svix_app_deletions order by queued_at`)
	if err != nil {
		return nil, fmt.Errorf("list application deletions: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, fmt.Errorf("scan application deletion: %w", err)
		}
		out = append(out, uid)
	}
	return out, rows.Err()
}

func (s *Store) ClearAppDeletion(ctx context.Context, appUID string) error {
	if _, err := s.Pool.Exec(ctx, `delete from svix_app_deletions where app_uid = $1`, appUID); err != nil {
		return fmt.Errorf("clear application deletion: %w", err)
	}
	return nil
}
