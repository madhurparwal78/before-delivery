// Package store reads and writes every product record in Postgres.
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"switchlamp/internal/domain"
)

// Store owns the pool and all record access.
type Store struct {
	pool *pgxpool.Pool
}

// New builds a Store.
func New(p *pgxpool.Pool) *Store { return &Store{pool: p} }

// Pool exposes the pool for the few transaction helpers elsewhere.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// UserRecord is a person row.
type UserRecord struct {
	ID                 string
	Name               string
	Email              string
	Role               string
	Timezone           string
	QuietStart         *string
	QuietEnd           *string
	NotificationDelays []int
	LowUrgencyDelay    int
	Removed            bool
}

const userCols = `id, name, email, role, timezone, coalesce(quiet_start,''), coalesce(quiet_end,''), notification_delays, low_urgency_delay, (removed_at IS NOT NULL)`

func scanUser(scan func(dest ...any) error) (*UserRecord, error) {
	var u UserRecord
	var qs, qe string
	var delays []byte
	if err := scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Timezone, &qs, &qe, &delays, &u.LowUrgencyDelay, &u.Removed); err != nil {
		return nil, err
	}
	if qs != "" {
		u.QuietStart = &qs
	}
	if qe != "" {
		u.QuietEnd = &qe
	}
	if err := json.Unmarshal(delays, &u.NotificationDelays); err != nil {
		return nil, err
	}
	return &u, nil
}

// Users lists every person not removed, by name.
func (s *Store) Users(ctx context.Context) ([]*UserRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+userCols+` FROM users WHERE removed_at IS NULL ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*UserRecord
	for rows.Next() {
		u, err := scanUser(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// AllUsers lists people including removed ones, for name lookups.
func (s *Store) AllUsers(ctx context.Context) ([]*UserRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+userCols+` FROM users`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*UserRecord
	for rows.Next() {
		u, err := scanUser(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// UserNames builds an id to name map over everyone, removed included.
func (s *Store) UserNames(ctx context.Context) (map[string]string, error) {
	users, err := s.AllUsers(ctx)
	if err != nil {
		return nil, err
	}
	m := make(map[string]string, len(users))
	for _, u := range users {
		m[u.ID] = u.Name
	}
	return m, nil
}

// User finds one person by id.
func (s *Store) User(ctx context.Context, id string) (*UserRecord, error) {
	return scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id).Scan)
}

// UserByEmail finds a person by address.
func (s *Store) UserByEmail(ctx context.Context, email string) (*UserRecord, error) {
	u, err := scanUser(s.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE lower(email) = lower($1)`, email).Scan)
	if err != nil {
		return nil, err
	}
	if u.Removed {
		return nil, fmt.Errorf("removed")
	}
	return u, nil
}

// ServiceRecord is a service row.
type ServiceRecord struct {
	ID                 string
	Name               string
	Team               string
	PolicyID           *string
	DependsOn          []string
	GroupingMode       string
	GroupingMinutes    *int
	AckTimeoutMinutes  *int
	AutoResolveMinutes *int
	Version            int
}

const serviceCols = `id, name, team, policy_id, depends_on, grouping_mode, grouping_minutes, ack_timeout_minutes, auto_resolve_minutes, version`

func scanService(scan func(dest ...any) error) (*ServiceRecord, error) {
	var sv ServiceRecord
	var depends []byte
	if err := scan(&sv.ID, &sv.Name, &sv.Team, &sv.PolicyID, &depends, &sv.GroupingMode,
		&sv.GroupingMinutes, &sv.AckTimeoutMinutes, &sv.AutoResolveMinutes, &sv.Version); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(depends, &sv.DependsOn); err != nil {
		return nil, err
	}
	return &sv, nil
}

// Services lists every service by name.
func (s *Store) Services(ctx context.Context) ([]*ServiceRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+serviceCols+` FROM services ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ServiceRecord
	for rows.Next() {
		sv, err := scanService(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, sv)
	}
	return out, rows.Err()
}

// Service finds one service.
func (s *Store) Service(ctx context.Context, id string) (*ServiceRecord, error) {
	return scanService(s.pool.QueryRow(ctx, `SELECT `+serviceCols+` FROM services WHERE id = $1`, id).Scan)
}

// PolicyRecord is a policy row.
type PolicyRecord struct {
	ID      string
	Name    string
	Repeats int
	Levels  []domain.PolicyLevel
	Version int
}

// Policies lists every policy by name.
func (s *Store) Policies(ctx context.Context) ([]*PolicyRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, repeats, levels, version FROM policies ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*PolicyRecord
	for rows.Next() {
		var p PolicyRecord
		var levels []byte
		if err := rows.Scan(&p.ID, &p.Name, &p.Repeats, &levels, &p.Version); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(levels, &p.Levels); err != nil {
			return nil, err
		}
		out = append(out, &p)
	}
	return out, rows.Err()
}

// Policy finds one policy.
func (s *Store) Policy(ctx context.Context, id string) (*PolicyRecord, error) {
	var p PolicyRecord
	var levels []byte
	err := s.pool.QueryRow(ctx, `SELECT id, name, repeats, levels, version FROM policies WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &p.Repeats, &levels, &p.Version)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(levels, &p.Levels); err != nil {
		return nil, err
	}
	return &p, nil
}

// ScheduleRecord is a schedule row.
type ScheduleRecord struct {
	ID           string
	Name         string
	Zone         string
	RecordFormat int
	UpgradedAt   *time.Time
	Version      int
}

// Schedules lists every schedule by name.
func (s *Store) Schedules(ctx context.Context) ([]*ScheduleRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, zone, record_format, upgraded_at, version FROM schedules ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ScheduleRecord
	for rows.Next() {
		var sc ScheduleRecord
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.Zone, &sc.RecordFormat, &sc.UpgradedAt, &sc.Version); err != nil {
			return nil, err
		}
		out = append(out, &sc)
	}
	return out, rows.Err()
}

// Schedule finds one schedule.
func (s *Store) Schedule(ctx context.Context, id string) (*ScheduleRecord, error) {
	var sc ScheduleRecord
	err := s.pool.QueryRow(ctx, `SELECT id, name, zone, record_format, upgraded_at, version FROM schedules WHERE id = $1`, id).
		Scan(&sc.ID, &sc.Name, &sc.Zone, &sc.RecordFormat, &sc.UpgradedAt, &sc.Version)
	if err != nil {
		return nil, err
	}
	return &sc, nil
}

// Layers lists a schedule's layers in order.
func (s *Store) Layers(ctx context.Context, scheduleID string) ([]*domain.Layer, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, name, "order", shift_days, handoff_time, start_date, people, restrictions, edited_at
		FROM layers WHERE schedule_id = $1 ORDER BY "order"`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*domain.Layer
	for rows.Next() {
		var l domain.Layer
		var people, restrictions []byte
		if err := rows.Scan(&l.ID, &l.Name, &l.Order, &l.ShiftDays, &l.HandoffTime, &l.StartDate, &people, &restrictions, &l.EditedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(people, &l.People); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(restrictions, &l.Restrictions); err != nil {
			return nil, err
		}
		l.ScheduleID = scheduleID
		out = append(out, &l)
	}
	return out, rows.Err()
}

// Overrides lists a schedule's overrides in time order.
func (s *Store) Overrides(ctx context.Context, scheduleID string) ([]domain.Override, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, person_id, "start", "end" FROM overrides
		WHERE schedule_id = $1 AND "end" > now() - interval '14 days' ORDER BY "start"`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Override
	for rows.Next() {
		var o domain.Override
		if err := rows.Scan(&o.ID, &o.PersonID, &o.Start, &o.End); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// IntegrationRecord is an integration row.
type IntegrationRecord struct {
	ID         string
	ServiceID  string
	Name       string
	RoutingKey string
}

// IntegrationByRoutingKey resolves a routing key.
func (s *Store) IntegrationByRoutingKey(ctx context.Context, key string) (*IntegrationRecord, error) {
	var i IntegrationRecord
	err := s.pool.QueryRow(ctx, `SELECT id, service_id, name, routing_key FROM integrations WHERE routing_key = $1`, key).
		Scan(&i.ID, &i.ServiceID, &i.Name, &i.RoutingKey)
	if err != nil {
		return nil, err
	}
	return &i, nil
}

// Integrations lists every integration by name.
func (s *Store) Integrations(ctx context.Context) ([]*IntegrationRecord, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, service_id, name, routing_key FROM integrations ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*IntegrationRecord
	for rows.Next() {
		var i IntegrationRecord
		if err := rows.Scan(&i.ID, &i.ServiceID, &i.Name, &i.RoutingKey); err != nil {
			return nil, err
		}
		out = append(out, &i)
	}
	return out, rows.Err()
}

// Integration finds one integration.
func (s *Store) Integration(ctx context.Context, id string) (*IntegrationRecord, error) {
	var i IntegrationRecord
	err := s.pool.QueryRow(ctx, `SELECT id, service_id, name, routing_key FROM integrations WHERE id = $1`, id).
		Scan(&i.ID, &i.ServiceID, &i.Name, &i.RoutingKey)
	if err != nil {
		return nil, err
	}
	return &i, nil
}

// NextIncidentNumber allocates the next incident number.
func (s *Store) NextIncidentNumber(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT coalesce(max(number), 4) + 1 FROM incidents`).Scan(&n)
	return n, err
}
