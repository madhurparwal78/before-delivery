package core

import (
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const pbkdf2Iterations = 64000

type User struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Email              string  `json:"email"`
	Role               string  `json:"role"`
	Timezone           string  `json:"timezone"`
	QuietStart         *string `json:"quiet_start,omitempty"`
	QuietEnd           *string `json:"quiet_end,omitempty"`
	NotificationDelays []int   `json:"notification_delays,omitempty"`
	LowUrgencyDelay    int     `json:"low_urgency_delay,omitempty"`
}

// Actor is whoever is acting: a signed-in person, an API key, an integration or
// Switchlamp itself for a timer.
type Actor struct {
	User     *User
	KeyName  string
	KeyScope string
	System   string
}

func (a Actor) Name() string {
	switch {
	case a.User != nil:
		return a.User.Name
	case a.KeyName != "":
		return a.KeyName
	case a.System != "":
		return a.System
	default:
		return "Switchlamp"
	}
}

func (a Actor) Role() string {
	if a.User != nil {
		return a.User.Role
	}
	if a.KeyName != "" {
		// A key stands in for a responder, within its scope.
		return "responder"
	}
	return "admin"
}

func (a Actor) IsUser(id string) bool { return a.User != nil && a.User.ID == id }

func (a Actor) CanWrite() bool {
	if a.KeyName != "" {
		return a.KeyScope == "write"
	}
	return true
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("salt: %w", err)
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, pbkdf2Iterations, 32)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return fmt.Sprintf("pbkdf2$%d$%s$%s", pbkdf2Iterations, hex.EncodeToString(salt), hex.EncodeToString(key)), nil
}

func checkPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	var iter int
	if _, err := fmt.Sscanf(parts[1], "%d", &iter); err != nil {
		return false
	}
	salt, err := hex.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	if err != nil {
		return false
	}
	return hmac.Equal(got, want)
}

func hashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

const userColumns = `id, name, email, role, timezone, quiet_start, quiet_end, notification_delays, low_urgency_delay`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	var delays []byte
	if err := row.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Timezone, &u.QuietStart, &u.QuietEnd, &delays, &u.LowUrgencyDelay); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(delays, &u.NotificationDelays); err != nil {
		return nil, fmt.Errorf("read notification delays: %w", err)
	}
	return &u, nil
}

func (a *App) SignIn(ctx context.Context, email, password string) (*User, string, error) {
	var hash string
	var id string
	err := a.pool.QueryRow(ctx, `SELECT id, password_hash FROM users WHERE lower(email)=lower($1) AND removed_at IS NULL`, email).
		Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", errCode(401, "invalid_credentials")
	}
	if err != nil {
		return nil, "", fmt.Errorf("find person: %w", err)
	}
	if !checkPassword(hash, password) {
		return nil, "", errCode(401, "invalid_credentials")
	}
	user, err := a.UserByID(ctx, id)
	if err != nil {
		return nil, "", err
	}
	token := randomHex(32)
	if _, err := a.pool.Exec(ctx, `INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)`,
		token, id, a.Clock.Now()); err != nil {
		return nil, "", fmt.Errorf("open session: %w", err)
	}
	return user, token, nil
}

func (a *App) SignOut(ctx context.Context, token string) error {
	if _, err := a.pool.Exec(ctx, `UPDATE sessions SET revoked_at=$1 WHERE token=$2 AND revoked_at IS NULL`,
		a.Clock.Now(), token); err != nil {
		return fmt.Errorf("close session: %w", err)
	}
	return nil
}

func (a *App) UserBySession(ctx context.Context, token string) (*User, error) {
	row := a.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users u
		WHERE u.removed_at IS NULL AND u.id = (SELECT user_id FROM sessions WHERE token=$1 AND revoked_at IS NULL)`, token)
	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read session person: %w", err)
	}
	return user, nil
}

func (a *App) UserByID(ctx context.Context, id string) (*User, error) {
	row := a.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE id=$1`, id)
	user, err := scanUser(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read person: %w", err)
	}
	return user, nil
}

func (a *App) ListUsers(ctx context.Context) ([]*User, error) {
	rows, err := a.pool.Query(ctx, `SELECT `+userColumns+` FROM users WHERE removed_at IS NULL ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list people: %w", err)
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, fmt.Errorf("read person: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetRole applies a role change at once and ends that person's open sockets.
func (a *App) SetRole(ctx context.Context, id, role string) (*User, error) {
	if !contains([]string{"responder", "lead", "admin", "stakeholder"}, role) {
		return nil, errFields("role", "Choose a listed role.")
	}
	user, err := a.UserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if user.Role == "admin" && role != "admin" {
		admins, err := a.countAdmins(ctx)
		if err != nil {
			return nil, err
		}
		if admins <= 1 {
			return nil, errCode(409, "last_admin")
		}
	}
	if _, err := a.pool.Exec(ctx, `UPDATE users SET role=$1 WHERE id=$2`, role, id); err != nil {
		return nil, fmt.Errorf("set role: %w", err)
	}
	a.Hub.CloseUser(id, 4403)
	return a.UserByID(ctx, id)
}

func (a *App) countAdmins(ctx context.Context) (int, error) {
	var n int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE role='admin' AND removed_at IS NULL`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count admins: %w", err)
	}
	return n, nil
}

func (a *App) ForceSignOut(ctx context.Context, id string) error {
	if _, err := a.pool.Exec(ctx, `UPDATE sessions SET revoked_at=$1 WHERE user_id=$2 AND revoked_at IS NULL`,
		a.Clock.Now(), id); err != nil {
		return fmt.Errorf("sign person out: %w", err)
	}
	a.Hub.CloseUser(id, 4401)
	return nil
}

// RemovalBreak is one thing a removal would break.
type RemovalBreak struct {
	Schedule string     `json:"schedule,omitempty"`
	Start    *time.Time `json:"start,omitempty"`
	End      *time.Time `json:"end,omitempty"`
	Policy   string     `json:"policy,omitempty"`
	Level    int        `json:"level,omitempty"`
	Text     string     `json:"-"`
}

// RemoveUser refuses while that person still holds a future shift or is named
// as a policy level's target, listing everything that would break.
func (a *App) RemoveUser(ctx context.Context, id string) ([]RemovalBreak, error) {
	user, err := a.UserByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if user.Role == "admin" {
		admins, err := a.countAdmins(ctx)
		if err != nil {
			return nil, err
		}
		if admins <= 1 {
			return nil, errCode(409, "last_admin")
		}
	}
	breaks, err := a.removalBreaks(ctx, user)
	if err != nil {
		return nil, err
	}
	if len(breaks) > 0 {
		return breaks, &APIError{Status: 409, Body: map[string]any{"error": "still_needed", "breaks": breaks}}
	}
	now := a.Clock.Now()
	if _, err := a.pool.Exec(ctx, `UPDATE users SET removed_at=$1 WHERE id=$2`, now, id); err != nil {
		return nil, fmt.Errorf("remove person: %w", err)
	}
	if _, err := a.pool.Exec(ctx, `UPDATE sessions SET revoked_at=$1 WHERE user_id=$2 AND revoked_at IS NULL`, now, id); err != nil {
		return nil, fmt.Errorf("close sessions: %w", err)
	}
	a.Hub.CloseUser(id, 4401)
	return nil, nil
}

func (a *App) removalBreaks(ctx context.Context, user *User) ([]RemovalBreak, error) {
	now := a.Clock.Now()
	var breaks []RemovalBreak
	schedules, err := a.ListSchedules(ctx)
	if err != nil {
		return nil, err
	}
	for _, s := range schedules {
		final, err := a.FinalSchedule(ctx, s.ID, now, now.AddDate(0, 0, 60), s.Zone)
		if err != nil {
			return nil, err
		}
		for _, b := range final.Blocks {
			if b.Person != nil && b.Person.ID == user.ID {
				start, end := b.Start, b.End
				breaks = append(breaks, RemovalBreak{
					Schedule: s.Name, Start: &start, End: &end,
					Text: fmt.Sprintf("%s: %s to %s", s.Name, LocalTime(start, zoneOr(s.Zone)), LocalTime(end, zoneOr(s.Zone))),
				})
			}
		}
	}
	policies, err := a.ListPolicies(ctx)
	if err != nil {
		return nil, err
	}
	for _, p := range policies {
		for i, level := range p.Levels {
			for _, target := range level.Targets {
				if target.Type == "person" && target.ID == user.ID {
					breaks = append(breaks, RemovalBreak{
						Policy: p.Name, Level: i + 1,
						Text: fmt.Sprintf("%s: level %d", p.Name, i+1),
					})
				}
			}
		}
	}
	sort.SliceStable(breaks, func(i, j int) bool {
		a, b := breaks[i], breaks[j]
		if (a.Policy == "") != (b.Policy == "") {
			return a.Policy == ""
		}
		if a.Policy == "" {
			if a.Schedule != b.Schedule {
				return a.Schedule < b.Schedule
			}
			return a.Start.Before(*b.Start)
		}
		if a.Policy != b.Policy {
			return a.Policy < b.Policy
		}
		return a.Level < b.Level
	})
	return breaks, nil
}

// APIKey is one key's record. The key itself is kept only as a hash.
type APIKey struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Scope       string     `json:"scope"`
	Prefix      string     `json:"prefix"`
	GraceEndsAt *time.Time `json:"grace_ends_at"`
	RevokedAt   *time.Time `json:"revoked_at"`
}

func (a *App) ListAPIKeys(ctx context.Context) ([]APIKey, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, name, scope, prefix, grace_ends_at, revoked_at FROM api_keys ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list keys: %w", err)
	}
	defer rows.Close()
	out := []APIKey{}
	for rows.Next() {
		var k APIKey
		if err := rows.Scan(&k.ID, &k.Name, &k.Scope, &k.Prefix, &k.GraceEndsAt, &k.RevokedAt); err != nil {
			return nil, fmt.Errorf("read key: %w", err)
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (a *App) CreateAPIKey(ctx context.Context, name, scope string) (map[string]any, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errFields("name", "Enter a name.")
	}
	if scope != "read" && scope != "write" {
		return nil, errFields("scope", "Choose read or write.")
	}
	key := "slk_" + randomHex(16)
	id := newID()
	if _, err := a.pool.Exec(ctx, `INSERT INTO api_keys (id, name, scope, prefix, hash, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, name, scope, key[:12], hashAPIKey(key), a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("create key: %w", err)
	}
	return map[string]any{"id": id, "name": name, "scope": scope, "key": key}, nil
}

func (a *App) RotateAPIKey(ctx context.Context, id string, graceMinutes int) (map[string]any, error) {
	if graceMinutes < 0 || graceMinutes > 1440 {
		return nil, errFields("grace_minutes", "Use a whole number of minutes from 0 to 1440.")
	}
	var oldHash, oldPrefix string
	var revoked *time.Time
	err := a.pool.QueryRow(ctx, `SELECT hash, prefix, revoked_at FROM api_keys WHERE id=$1`, id).Scan(&oldHash, &oldPrefix, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read key: %w", err)
	}
	if revoked != nil {
		return nil, errCode(409, "key_revoked")
	}
	key := "slk_" + randomHex(16)
	grace := a.Clock.Now().Add(time.Duration(graceMinutes) * time.Minute)
	if _, err := a.pool.Exec(ctx, `UPDATE api_keys SET hash=$1, prefix=$2, old_hash=$3, old_prefix=$4, grace_ends_at=$5 WHERE id=$6`,
		hashAPIKey(key), key[:12], oldHash, oldPrefix, grace, id); err != nil {
		return nil, fmt.Errorf("rotate key: %w", err)
	}
	return map[string]any{"key": key, "grace_ends_at": grace}, nil
}

func (a *App) RevokeAPIKey(ctx context.Context, id string) error {
	tag, err := a.pool.Exec(ctx, `UPDATE api_keys SET revoked_at=$1 WHERE id=$2`, a.Clock.Now(), id)
	if err != nil {
		return fmt.Errorf("revoke key: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}

// ActorForKey answers the actor a bearer key stands for, or nil when the key is
// dead.
func (a *App) ActorForKey(ctx context.Context, key string) (*Actor, error) {
	hash := hashAPIKey(key)
	rows, err := a.pool.Query(ctx, `SELECT name, scope, hash, old_hash, grace_ends_at, revoked_at FROM api_keys`)
	if err != nil {
		return nil, fmt.Errorf("read keys: %w", err)
	}
	defer rows.Close()
	now := a.Clock.Now()
	for rows.Next() {
		var name, scope, current string
		var old *string
		var grace, revoked *time.Time
		if err := rows.Scan(&name, &scope, &current, &old, &grace, &revoked); err != nil {
			return nil, fmt.Errorf("read key: %w", err)
		}
		if revoked != nil {
			continue
		}
		if hmac.Equal([]byte(hash), []byte(current)) {
			return &Actor{KeyName: name, KeyScope: scope}, nil
		}
		if old != nil && hmac.Equal([]byte(hash), []byte(*old)) && grace != nil && now.Before(*grace) {
			return &Actor{KeyName: name, KeyScope: scope}, nil
		}
	}
	return nil, rows.Err()
}

// SavedFilter is one person's named incident filter.
type SavedFilter struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Status    string  `json:"status"`
	ServiceID *string `json:"service_id"`
}

func (a *App) SavedFilters(ctx context.Context, userID string) ([]SavedFilter, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, name, status, service_id FROM saved_filters WHERE user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("list filters: %w", err)
	}
	defer rows.Close()
	out := []SavedFilter{}
	for rows.Next() {
		var f SavedFilter
		if err := rows.Scan(&f.ID, &f.Name, &f.Status, &f.ServiceID); err != nil {
			return nil, fmt.Errorf("read filter: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (a *App) SaveFilter(ctx context.Context, userID, name, status string, serviceID *string) (SavedFilter, error) {
	if strings.TrimSpace(name) == "" {
		return SavedFilter{}, errFields("name", "Enter a name.")
	}
	if !contains([]string{"open", "triggered", "acknowledged", "snoozed", "resolved", "all"}, status) {
		return SavedFilter{}, errFields("status", "Choose a listed status.")
	}
	f := SavedFilter{ID: newID(), Name: name, Status: status, ServiceID: serviceID}
	if _, err := a.pool.Exec(ctx, `INSERT INTO saved_filters (id, user_id, name, status, service_id, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, f.ID, userID, name, status, serviceID, a.Clock.Now()); err != nil {
		return SavedFilter{}, fmt.Errorf("save filter: %w", err)
	}
	return f, nil
}

func (a *App) DeleteFilter(ctx context.Context, userID, id string) error {
	tag, err := a.pool.Exec(ctx, `DELETE FROM saved_filters WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return fmt.Errorf("remove filter: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}
