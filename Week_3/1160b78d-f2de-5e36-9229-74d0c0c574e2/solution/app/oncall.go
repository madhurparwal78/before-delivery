package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// oncallCacheTTL is the longest a cached who-is-on-call copy lives.
const oncallCacheTTL = 5 * time.Minute

// oncallCacheMu keeps a copy being filled from outliving the edit that clears it: an edit's clear waits for a fill in
// progress, so a copy computed from the record before the edit is deleted right after it is stored.
var oncallCacheMu sync.Mutex

type scheduleRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// oncallView is the published answer to who is on call.
type oncallView struct {
	Schedule scheduleRef `json:"schedule"`
	At       string      `json:"at"`
	Holder   *personRef  `json:"holder"`
	Gap      bool        `json:"gap"`
	Until    *string     `json:"until"`
}

func (a *App) oncallKey(scheduleID string) string {
	return a.cfg.cacheKey("cache", "oncall", scheduleID)
}

// clearOncallCache drops the cached who-is-on-call copy of a schedule ("" drops every schedule's).
func (a *App) clearOncallCache(ctx context.Context, scheduleID string) {
	oncallCacheMu.Lock()
	defer oncallCacheMu.Unlock()
	if scheduleID != "" {
		a.cache.Del(ctx, a.oncallKey(scheduleID))
		return
	}
	if keys, ok := a.cache.Keys(ctx, a.oncallKey("*")); ok {
		a.cache.Del(ctx, keys...)
	}
}

// oncallAt answers who is on call on a schedule at an instant, with the instant the answer next changes.
func (a *App) oncallAt(ctx context.Context, q dbq, scheduleID string, at time.Time) (oncallView, *time.Time, error) {
	m, err := a.loadScheduleModel(ctx, q, scheduleID)
	if err != nil {
		return oncallView{}, nil, fmt.Errorf("read schedule: %w", err)
	}
	holder, until := m.holderAt(at)
	view := oncallView{Schedule: scheduleRef{ID: m.ID, Name: m.Name}, At: formatInstant(at), Holder: m.personRef(holder.person),
		Gap: holder.person == ""}
	if until != nil {
		text := formatInstant(*until)
		view.Until = &text
	}
	return view, until, nil
}

// oncallCopy is the encoded answer for a schedule and its ETag, from Valkey when a fresh copy is there. state is the
// X-Switchlamp-Cache value: hit, miss, or bypass when Valkey cannot be used.
func (a *App) oncallCopy(ctx context.Context, scheduleID string) (body []byte, etag, state string, err error) {
	oncallCacheMu.Lock()
	defer oncallCacheMu.Unlock()
	now := a.clock.Now()
	key := a.oncallKey(scheduleID)
	if fields, ok := a.cache.Hash(ctx, key); ok && cachedCopyIsCurrent(fields["body"], now) {
		return []byte(fields["body"]), fields["etag"], "hit", nil
	}
	view, until, err := a.oncallAt(ctx, a.db, scheduleID, now)
	if err != nil {
		return nil, "", "", fmt.Errorf("compute on-call answer: %w", err)
	}
	body, err = json.Marshal(view)
	if err != nil {
		return nil, "", "", fmt.Errorf("encode on-call answer: %w", err)
	}
	holder := ""
	if view.Holder != nil {
		holder = view.Holder.ID
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%t|%s", scheduleID, holder, view.Gap, stringOrEmpty(view.Until))))
	etag = `"` + hex.EncodeToString(sum[:8]) + `"`
	lifetime := oncallCacheTTL
	if until != nil {
		lifetime = min(lifetime, until.Sub(now))
	}
	state = "bypass"
	if a.cache.SetHash(ctx, key, map[string]any{"etag": etag, "body": string(body)}, lifetime) {
		state = "miss"
	}
	return body, etag, state, nil
}

// cachedCopyIsCurrent keeps a cached copy from outliving its until second, whatever moved the clock.
func cachedCopyIsCurrent(body string, now time.Time) bool {
	var cached oncallView
	if json.Unmarshal([]byte(body), &cached) != nil {
		return false
	}
	if cached.Until == nil {
		return true
	}
	until, err := parseInstant(*cached.Until)
	return err == nil && !instantReached(now, until)
}

func stringOrEmpty(text *string) string {
	if text == nil {
		return ""
	}
	return *text
}

// firstScheduleID is the schedule shown when none is asked for: the first alphabetically.
func (a *App) firstScheduleID(ctx context.Context) (string, error) {
	var id string
	err := a.db.QueryRow(ctx, `select id from schedules order by name, id limit 1`).Scan(&id)
	if isNoRows(err) {
		return "", errNotFound()
	}
	if err != nil {
		return "", fmt.Errorf("find first schedule: %w", err)
	}
	return id, nil
}

func (a *App) hOncall(rq *Req) error {
	scheduleID := rq.Query("schedule_id")
	if scheduleID == "" {
		first, err := a.firstScheduleID(rq.Ctx())
		if err != nil {
			return fmt.Errorf("choose schedule: %w", err)
		}
		scheduleID = first
	}
	body, etag, state, err := a.oncallCopy(rq.Ctx(), scheduleID)
	if err != nil {
		return fmt.Errorf("answer on-call: %w", err)
	}
	rq.W.Header().Set("ETag", etag)
	rq.W.Header().Set("X-Switchlamp-Cache", state)
	if etagMatches(rq.R.Header.Get("If-None-Match"), etag) {
		rq.W.WriteHeader(http.StatusNotModified)
		return nil
	}
	rq.W.Header().Set("Content-Type", "application/json")
	rq.W.WriteHeader(http.StatusOK)
	if _, err := rq.W.Write(body); err != nil {
		return fmt.Errorf("write on-call answer: %w", err)
	}
	return nil
}

// oncallCountdown is what a page watching a schedule is sent every second.
func (a *App) oncallCountdown(ctx context.Context, scheduleID string) (any, error) {
	now := a.clock.Now()
	view, until, err := a.oncallAt(ctx, a.db, scheduleID, now)
	if err != nil {
		return nil, fmt.Errorf("compute on-call countdown: %w", err)
	}
	var remaining *int
	if until != nil {
		seconds := int(until.Sub(now) / time.Second)
		remaining = &seconds
	}
	return map[string]any{"holder": view.Holder, "gap": view.Gap, "until": view.Until, "remaining_seconds": remaining}, nil
}

func init() {
	routeSetups = append(routeSetups, func(a *App) {
		a.route(route{Pattern: "GET /api/oncall", Access: accStaff, Handler: a.hOncall})
		a.hub.RegisterCountdown("oncall", a.oncallCountdown)
	})
}
