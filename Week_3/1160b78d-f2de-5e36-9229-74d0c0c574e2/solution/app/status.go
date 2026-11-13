package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"
)

const (
	firmName         = "Tarecross Software"
	statusCacheTTL   = 5 * time.Minute
	headlineRunning  = "All services are running."
	headlineMaint    = "Maintenance is under way."
	headlineAffected = "Some services are affected."
	plateDusk        = "dusk"
	plateNight       = "night"
)

// statusView is the public status: everything the page and /api/status show, and nothing about responders.
type statusView struct {
	Firm        string            `json:"firm"`
	Headline    string            `json:"headline"`
	Plate       string            `json:"plate"`
	Slower      bool              `json:"slower"`
	Services    []serviceShown    `json:"services"`
	Maintenance []maintenanceShow `json:"maintenance"`
	Updates     []updateShown     `json:"updates"`
}

type serviceShown struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type maintenanceShow struct {
	Service string `json:"service"`
	EndsAt  string `json:"ends_at"`
}

type updateShown struct {
	Title       string   `json:"title"`
	State       string   `json:"state"`
	Body        string   `json:"body"`
	Services    []string `json:"services"`
	PublishedAt string   `json:"published_at"`
}

// headlineFor is the one line of current status for the worst shown status.
func headlineFor(worst string) string {
	switch worst {
	case statusOperational:
		return headlineRunning
	case statusMaintenance:
		return headlineMaint
	}
	return headlineAffected
}

// buildStatus computes the public status from Postgres at the server clock.
func (a *App) buildStatus(ctx context.Context) (statusView, error) {
	now := a.clock.Now()
	standings, err := a.serviceStandings(ctx, a.db, now)
	if err != nil {
		return statusView{}, fmt.Errorf("rate services: %w", err)
	}
	view := statusView{Firm: firmName, Plate: plateDusk, Slower: !a.cache.Up(), Services: []serviceShown{},
		Maintenance: []maintenanceShow{}, Updates: []updateShown{}}
	worst := statusOperational
	for _, s := range standings {
		view.Services = append(view.Services, serviceShown{Name: s.Name, Status: s.Shown})
		worst = worse(worst, s.Shown)
	}
	sort.Slice(view.Services, func(i, j int) bool { return view.Services[i].Name < view.Services[j].Name })
	view.Headline = headlineFor(worst)

	windows, err := loadWindows(ctx, a.db, "")
	if err != nil {
		return statusView{}, fmt.Errorf("load maintenance windows: %w", err)
	}
	for _, window := range windows {
		if window.stateAt(now) == windowRunning {
			view.Maintenance = append(view.Maintenance, maintenanceShow{Service: standings[window.ServiceID].Name, EndsAt: formatInstant(window.EndsAt)})
		}
	}
	sort.SliceStable(view.Maintenance, func(i, j int) bool { return view.Maintenance[i].EndsAt < view.Maintenance[j].EndsAt })

	rows, err := a.db.Query(ctx, `select title, state, body, service_ids, published_at from status_updates
		where published_at is not null order by published_at desc, seq desc`)
	if err != nil {
		return statusView{}, fmt.Errorf("read published updates: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var update updateShown
		var serviceIDs []string
		var publishedAt time.Time
		if err := rows.Scan(&update.Title, &update.State, &update.Body, &serviceIDs, &publishedAt); err != nil {
			return statusView{}, fmt.Errorf("scan published update: %w", err)
		}
		update.PublishedAt = formatInstant(publishedAt)
		update.Services = []string{}
		for _, id := range serviceIDs {
			update.Services = append(update.Services, standings[id].Name)
		}
		view.Updates = append(view.Updates, update)
	}
	if err := rows.Err(); err != nil {
		return statusView{}, fmt.Errorf("read published updates: %w", err)
	}
	if len(view.Updates) > 0 && view.Updates[0].State != "resolved" {
		view.Plate = plateNight
	}
	return view, nil
}

// statusCopy is a rendered status answer with its validators.
type statusCopy struct {
	etag  string
	body  []byte
	cache string // hit | miss | bypass
}

// statusGate keeps a slow reader from caching an answer that a change has made stale since it read: every clearing
// moves the generation on, and an answer is stored only if the generation is still the one it was read under.
var statusGate struct {
	mu         sync.Mutex
	generation uint64
}

func statusKey(a *App, kind string) string { return a.cfg.cacheKey("cache", "status", kind) }

// clearStatusCache drops the cached public status (json and html).
func (a *App) clearStatusCache(ctx context.Context) {
	statusGate.mu.Lock()
	defer statusGate.mu.Unlock()
	statusGate.generation++
	a.cache.Del(ctx, statusKey(a, "json"), statusKey(a, "html"))
}

func etagOf(body []byte) string {
	sum := sha256.Sum256(body)
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}

// cachedStatus answers from the cached copy of one kind (json or html) or renders it from Postgres, caching it when
// Valkey is reachable.
func (a *App) cachedStatus(ctx context.Context, kind string, render func(statusView) ([]byte, error)) (statusCopy, error) {
	key := statusKey(a, kind)
	if fields, found := a.cache.Hash(ctx, key); found {
		return statusCopy{etag: fields["etag"], body: []byte(fields["body"]), cache: "hit"}, nil
	}
	statusGate.mu.Lock()
	generation := statusGate.generation
	statusGate.mu.Unlock()
	view, err := a.buildStatus(ctx)
	if err != nil {
		return statusCopy{}, fmt.Errorf("build status: %w", err)
	}
	body, err := render(view)
	if err != nil {
		return statusCopy{}, fmt.Errorf("render status: %w", err)
	}
	answer := statusCopy{etag: etagOf(body), body: body, cache: "bypass"}
	statusGate.mu.Lock()
	defer statusGate.mu.Unlock()
	if statusGate.generation == generation {
		a.cache.SetHash(ctx, key, map[string]any{"etag": answer.etag, "body": string(body)}, statusCacheTTL)
	}
	if a.cache.Up() {
		answer.cache = "miss"
	}
	return answer, nil
}

// serveStatus writes a status answer, or a 304 when the visitor already holds it.
func (rq *Req) serveStatus(answer statusCopy, contentType string) error {
	header := rq.W.Header()
	header.Set("ETag", answer.etag)
	header.Set("X-Switchlamp-Cache", answer.cache)
	header.Set("Cache-Control", "no-cache")
	if etagMatches(rq.R.Header.Get("If-None-Match"), answer.etag) {
		rq.W.WriteHeader(http.StatusNotModified)
		return nil
	}
	header.Set("Content-Type", contentType)
	rq.W.WriteHeader(http.StatusOK)
	_, err := rq.W.Write(answer.body)
	if err != nil {
		return fmt.Errorf("write status: %w", err)
	}
	return nil
}

func encodeStatusJSON(view statusView) ([]byte, error) {
	body, err := json.Marshal(view)
	if err != nil {
		return nil, fmt.Errorf("encode status: %w", err)
	}
	return body, nil
}

func (a *App) hStatusJSON(rq *Req) error {
	answer, err := a.cachedStatus(rq.Ctx(), "json", encodeStatusJSON)
	if err != nil {
		return fmt.Errorf("serve status: %w", err)
	}
	if err := rq.serveStatus(answer, "application/json"); err != nil {
		return fmt.Errorf("answer status request: %w", err)
	}
	return nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/status", Access: accPublic, Handler: a.hStatusJSON})
	})
}
