package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type StatusService struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type StatusMaintenance struct {
	Service string    `json:"service"`
	EndsAt  time.Time `json:"ends_at"`
}

type StatusUpdate struct {
	ID          string     `json:"id,omitempty"`
	Title       string     `json:"title"`
	State       string     `json:"state"`
	StateLabel  string     `json:"state_label,omitempty"`
	Body        string     `json:"body"`
	Services    []string   `json:"services"`
	ServiceIDs  []string   `json:"service_ids,omitempty"`
	PublishedAt *time.Time `json:"published_at"`
}

type StatusView struct {
	Firm        string              `json:"firm"`
	Headline    string              `json:"headline"`
	Plate       string              `json:"plate"`
	Slower      bool                `json:"slower"`
	Services    []StatusService     `json:"services"`
	Maintenance []StatusMaintenance `json:"maintenance"`
	Updates     []StatusUpdate      `json:"updates"`
}

// StatusPage answers the public status, from the cache when it is there and
// straight from the record when Valkey is unreachable.
func (a *App) StatusPage(ctx context.Context) (*StatusView, string, string, error) {
	if etag, body, ok := a.cacheGet(ctx, "cache:status:json"); ok {
		var view StatusView
		if err := json.Unmarshal([]byte(body), &view); err == nil {
			return &view, etag, "hit", nil
		}
	}
	view, err := a.buildStatus(ctx)
	if err != nil {
		return nil, "", "", err
	}
	body, err := json.Marshal(view)
	if err != nil {
		return nil, "", "", fmt.Errorf("write status: %w", err)
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	if !a.cacheUp.Load() {
		view.Slower = true
		return view, etag, "bypass", nil
	}
	a.cacheSet(ctx, "cache:status:json", etag, string(body), 5*time.Minute)
	return view, etag, "miss", nil
}

func (a *App) buildStatus(ctx context.Context) (*StatusView, error) {
	services, err := a.ListServices(ctx)
	if err != nil {
		return nil, err
	}
	view := &StatusView{Firm: "Tarecross Software", Services: []StatusService{},
		Maintenance: []StatusMaintenance{}, Updates: []StatusUpdate{}}
	worst := "Operational"
	for _, s := range services {
		view.Services = append(view.Services, StatusService{Name: s.Name, Status: s.Status})
		worst = worstStatus(worst, s.Status)
	}
	switch {
	case worst == "Operational":
		view.Headline = "All services are running."
	case worst == "Maintenance":
		view.Headline = "Maintenance is under way."
	default:
		view.Headline = "Some services are affected."
	}
	windows, err := a.RunningMaintenance(ctx)
	if err != nil {
		return nil, err
	}
	for _, w := range windows {
		view.Maintenance = append(view.Maintenance, StatusMaintenance{Service: w.Service, EndsAt: w.EndsAt})
	}
	updates, err := a.ListStatusUpdates(ctx, true)
	if err != nil {
		return nil, err
	}
	view.Plate = "dusk"
	for i, u := range updates {
		view.Updates = append(view.Updates, StatusUpdate{Title: u.Title, State: u.State,
			StateLabel: updateStateLabels[u.State], Body: u.Body, Services: u.Services, PublishedAt: u.PublishedAt})
		if i == 0 && u.State != "resolved" {
			view.Plate = "night"
		}
	}
	return view, nil
}

// ListStatusUpdates answers published updates newest first, and with
// publishedOnly false also the drafts, which never reach a public surface.
func (a *App) ListStatusUpdates(ctx context.Context, publishedOnly bool) ([]StatusUpdate, error) {
	query := `SELECT id, title, body, state, service_ids, published_at FROM status_updates`
	if publishedOnly {
		query += ` WHERE published_at IS NOT NULL`
	}
	query += ` ORDER BY published_at DESC NULLS FIRST, created_at DESC`
	rows, err := a.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list updates: %w", err)
	}
	defer rows.Close()
	names, err := a.serviceNames(ctx)
	if err != nil {
		return nil, err
	}
	out := []StatusUpdate{}
	for rows.Next() {
		var u StatusUpdate
		var ids []byte
		if err := rows.Scan(&u.ID, &u.Title, &u.Body, &u.State, &ids, &u.PublishedAt); err != nil {
			return nil, fmt.Errorf("read update: %w", err)
		}
		if err := jsonInto(ids, &u.ServiceIDs); err != nil {
			return nil, err
		}
		u.Services = []string{}
		for _, id := range u.ServiceIDs {
			if name, ok := names[id]; ok {
				u.Services = append(u.Services, name)
			}
		}
		u.StateLabel = updateStateLabels[u.State]
		out = append(out, u)
	}
	return out, rows.Err()
}

func (a *App) serviceNames(ctx context.Context) (map[string]string, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, name FROM services`)
	if err != nil {
		return nil, fmt.Errorf("read service names: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("read service name: %w", err)
		}
		out[id] = name
	}
	return out, rows.Err()
}

func validateUpdate(title, body, state string) error {
	errs := map[string]string{}
	if strings.TrimSpace(title) == "" {
		errs["title"] = "Enter a title."
	}
	if strings.TrimSpace(body) == "" {
		errs["body"] = "Write the update."
	}
	if _, ok := updateStateLabels[state]; !ok {
		errs["state"] = "Choose a listed state."
	}
	if len(errs) > 0 {
		return errFieldMap(errs)
	}
	return nil
}

func (a *App) CreateStatusUpdate(ctx context.Context, title, body, state string, serviceIDs []string) (*StatusUpdate, error) {
	if err := validateUpdate(title, body, state); err != nil {
		return nil, err
	}
	if serviceIDs == nil {
		serviceIDs = []string{}
	}
	id := newID()
	if _, err := a.pool.Exec(ctx, `INSERT INTO status_updates (id, title, body, state, service_ids, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, title, body, state, mustJSON(serviceIDs), a.Clock.Now()); err != nil {
		return nil, fmt.Errorf("save draft: %w", err)
	}
	return a.GetStatusUpdate(ctx, id)
}

func (a *App) GetStatusUpdate(ctx context.Context, id string) (*StatusUpdate, error) {
	updates, err := a.ListStatusUpdates(ctx, false)
	if err != nil {
		return nil, err
	}
	for _, u := range updates {
		if u.ID == id {
			return &u, nil
		}
	}
	return nil, errNotFound
}

func (a *App) UpdateStatusUpdate(ctx context.Context, id, title, body, state string, serviceIDs []string) (*StatusUpdate, error) {
	current, err := a.GetStatusUpdate(ctx, id)
	if err != nil {
		return nil, err
	}
	if current.PublishedAt != nil {
		return nil, errCode(409, "already_published")
	}
	if err := validateUpdate(title, body, state); err != nil {
		return nil, err
	}
	if serviceIDs == nil {
		serviceIDs = []string{}
	}
	if _, err := a.pool.Exec(ctx, `UPDATE status_updates SET title=$1, body=$2, state=$3, service_ids=$4 WHERE id=$5`,
		title, body, state, mustJSON(serviceIDs), id); err != nil {
		return nil, fmt.Errorf("save draft: %w", err)
	}
	return a.GetStatusUpdate(ctx, id)
}

// PublishStatusUpdate makes an update public and immutable, clears the cached
// status and queues one mail per current subscriber.
func (a *App) PublishStatusUpdate(ctx context.Context, id string) (*StatusUpdate, int, error) {
	a.Lock()
	defer a.Unlock()
	update, err := a.GetStatusUpdate(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	if update.PublishedAt != nil {
		return nil, 0, errCode(409, "already_published")
	}
	now := a.Clock.Now()
	if _, err := a.pool.Exec(ctx, `UPDATE status_updates SET published_at=$1 WHERE id=$2 AND published_at IS NULL`,
		now, id); err != nil {
		return nil, 0, fmt.Errorf("publish update: %w", err)
	}
	subscribers, err := a.listSubscribers(ctx)
	if err != nil {
		return nil, 0, err
	}
	for _, s := range subscribers {
		subject := fmt.Sprintf("[Tarecross status] %s", update.Title)
		body := fmt.Sprintf("State: %s\n\n%s\n\nUnsubscribe: %s/status/unsubscribe/%s\n",
			updateStateLabels[update.State], update.Body, a.publicURL(), s.token)
		if err := a.queueMail(ctx, s.email, subject, body, nil, now); err != nil {
			return nil, 0, err
		}
	}
	a.clearStatusCache(ctx)
	a.publishStatus(ctx)
	published, err := a.GetStatusUpdate(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	return published, len(subscribers), nil
}

type subscriber struct {
	id, email, token string
}

func (a *App) listSubscribers(ctx context.Context) ([]subscriber, error) {
	rows, err := a.pool.Query(ctx, `SELECT id, email, token FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list subscribers: %w", err)
	}
	defer rows.Close()
	var out []subscriber
	for rows.Next() {
		var s subscriber
		if err := rows.Scan(&s.id, &s.email, &s.token); err != nil {
			return nil, fmt.Errorf("read subscriber: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (a *App) Subscribe(ctx context.Context, email string) error {
	email = strings.TrimSpace(email)
	if !strings.Contains(email, "@") || strings.HasPrefix(email, "@") || strings.HasSuffix(email, "@") ||
		strings.Contains(email, " ") || !strings.Contains(email[strings.Index(email, "@"):], ".") {
		return errFields("email", "Enter a valid email address.")
	}
	if _, err := a.pool.Exec(ctx, `INSERT INTO subscribers (id, email, token, created_at) VALUES ($1,$2,$3,$4)
		ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`, newID(), email, randomHex(16), a.Clock.Now()); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	return nil
}

func (a *App) Unsubscribe(ctx context.Context, token string) error {
	tag, err := a.pool.Exec(ctx, `UPDATE subscribers SET unsubscribed_at=$1 WHERE token=$2`, a.Clock.Now(), token)
	if err != nil {
		return fmt.Errorf("unsubscribe: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}

// OnCallCached answers who is on call with a cached copy and an ETag, where no
// copy outlives its until second.
func (a *App) OnCallCached(ctx context.Context, scheduleID string) (*OnCall, string, string, error) {
	key := "cache:oncall:" + scheduleID
	if etag, body, ok := a.cacheGet(ctx, key); ok {
		var state OnCall
		if err := json.Unmarshal([]byte(body), &state); err == nil {
			if state.Until == nil || a.Clock.Now().Before(*state.Until) {
				state.At = a.Clock.Now()
				return &state, etag, "hit", nil
			}
		}
	}
	state, err := a.OnCall(ctx, scheduleID, a.Clock.Now())
	if err != nil {
		return nil, "", "", err
	}
	body, err := json.Marshal(state)
	if err != nil {
		return nil, "", "", fmt.Errorf("write on call: %w", err)
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	if !a.cacheUp.Load() {
		return state, etag, "bypass", nil
	}
	ttl := 5 * time.Minute
	if state.Until != nil {
		if until := state.Until.Sub(a.Clock.Now()); until < ttl {
			ttl = until
		}
	}
	a.cacheSet(ctx, key, etag, string(body), ttl)
	return state, etag, "miss", nil
}

// SubscriberCount counts the people a published update goes to.
func (a *App) SubscriberCount(ctx context.Context) (int, error) {
	var n int
	if err := a.pool.QueryRow(ctx, `SELECT count(*) FROM subscribers WHERE unsubscribed_at IS NULL`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count subscribers: %w", err)
	}
	return n, nil
}

// SubscriberByToken answers the address one unsubscribe link belongs to.
func (a *App) SubscriberByToken(ctx context.Context, token string) (string, error) {
	var email string
	err := a.pool.QueryRow(ctx, `SELECT email FROM subscribers WHERE token=$1`, token).Scan(&email)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read subscriber: %w", err)
	}
	return email, nil
}
