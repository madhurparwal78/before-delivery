package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) UserByEmail(ctx context.Context, email string) (*User, error) {
	u := &User{}
	err := s.Pool.QueryRow(ctx, `select id, name, email, role, password_hash from users
	        where lower(email) = lower($1)`, email).Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read user: %w", err)
	}
	return u, nil
}

func (s *Store) UserBySession(ctx context.Context, sessionID string) (*User, error) {
	u := &User{}
	err := s.Pool.QueryRow(ctx, `select u.id, u.name, u.email, u.role, u.password_hash from sessions s
	        join users u on u.id = s.user_id where s.id = $1 and s.expires_at > now()`, sessionID).
		Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read session: %w", err)
	}
	if u.Role == "reviewer" {
		var scopes int
		if err := s.Pool.QueryRow(ctx, `select count(*) from reviewer_scopes where user_id = $1`, u.ID).
			Scan(&scopes); err != nil {
			return nil, fmt.Errorf("count reviewer scope: %w", err)
		}
		if scopes == 0 {
			return nil, ErrNotFound
		}
	}
	return u, nil
}

func (s *Store) CreateSession(ctx context.Context, userID string, ttl time.Duration) (string, error) {
	id := RandomToken(40)
	now := Now()
	if _, err := s.Pool.Exec(ctx, `insert into sessions (id, user_id, created_at, expires_at)
	        values ($1,$2,$3,$4)`, id, userID, now, now.Add(ttl)); err != nil {
		return "", fmt.Errorf("create session: %w", err)
	}
	return id, nil
}

func (s *Store) DeleteSession(ctx context.Context, id string) error {
	if _, err := s.Pool.Exec(ctx, `delete from sessions where id = $1`, id); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func (s *Store) ReviewerInScope(ctx context.Context, userID, projectID string) (bool, error) {
	var n int
	if err := s.Pool.QueryRow(ctx, `select count(*) from reviewer_scopes where user_id = $1 and project_id = $2`,
		userID, projectID).Scan(&n); err != nil {
		return false, fmt.Errorf("read reviewer scope: %w", err)
	}
	return n > 0, nil
}

// TokenByValue finds a project API token by the value CI presented.
func (s *Store) TokenByValue(ctx context.Context, token string) (id, label, projectID string, err error) {
	row := s.Pool.QueryRow(ctx, `select id, label, project_id from tokens where token_hash = $1`,
		HashToken(strings.TrimSpace(token)))
	err = row.Scan(&id, &label, &projectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", ErrNotFound
	}
	if err != nil {
		return "", "", "", fmt.Errorf("read token: %w", err)
	}
	return id, label, projectID, nil
}

// Reviewers lists the reviewers invited to a project.
func (s *Store) Reviewers(ctx context.Context, projectID string) ([]*User, error) {
	rows, err := s.Pool.Query(ctx, `select u.id, u.name, u.email, u.role from users u
	        join reviewer_scopes r on r.user_id = u.id where r.project_id = $1 order by u.name`, projectID)
	if err != nil {
		return nil, fmt.Errorf("list reviewers: %w", err)
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u := &User{}
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role); err != nil {
			return nil, fmt.Errorf("scan reviewer: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// AuditEntries lists the entries inside the retention window, newest first.
func (s *Store) AuditEntries(ctx context.Context, retention time.Duration) ([]AuditEntry, error) {
	rows, err := s.Pool.Query(ctx, `select id, at, actor, action, project, detail from audit
	        where at > now() - $1::interval order by at desc, id desc`, retention.String())
	if err != nil {
		return nil, fmt.Errorf("list audit entries: %w", err)
	}
	defer rows.Close()
	entries := []AuditEntry{}
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.ID, &e.At, &e.Actor, &e.Action, &e.Project, &e.Detail); err != nil {
			return nil, fmt.Errorf("scan audit entry: %w", err)
		}
		e.At = e.At.UTC()
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// PruneAudit deletes entries past the retention period.
func (s *Store) PruneAudit(ctx context.Context, retention time.Duration) error {
	if _, err := s.Pool.Exec(ctx, `delete from audit where at <= now() - $1::interval`, retention.String()); err != nil {
		return fmt.Errorf("prune audit entries: %w", err)
	}
	return nil
}
