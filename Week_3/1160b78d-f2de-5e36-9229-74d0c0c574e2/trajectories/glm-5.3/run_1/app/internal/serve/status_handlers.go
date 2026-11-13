package serve

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"switchlamp/internal/copytext"
	"switchlamp/internal/domain"
	"switchlamp/internal/store"
)

// statusRoutes registers the public status and admin routes.
func (s *Server) statusRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/status", s.handleStatusJSON)
	m.HandleFunc("POST /api/status/subscribers", s.handleSubscribe)
	m.HandleFunc("GET /api/status-updates", s.require("lead", s.handleListUpdates))
	m.HandleFunc("POST /api/status-updates", s.require("lead", s.handleCreateUpdate))
	m.HandleFunc("PUT /api/status-updates/{id}", s.require("lead", s.handlePutUpdate))
	m.HandleFunc("POST /api/status-updates/{id}/publish", s.require("lead", s.handlePublishUpdate))
	m.HandleFunc("GET /api/webhooks", s.require("admin", s.handleListWebhooks))
	m.HandleFunc("POST /api/webhooks", s.require("admin", s.handleCreateWebhook))
	m.HandleFunc("DELETE /api/webhooks/{id}", s.require("admin", s.handleDeleteWebhook))
	m.HandleFunc("GET /api/webhooks/{id}/deliveries", s.require("admin", s.handleWebhookDeliveries))
	m.HandleFunc("POST /api/webhook-deliveries/{id}/replay", s.require("admin", s.handleReplayDelivery))
	m.HandleFunc("POST /api/analytics/jobs", s.require("responder", s.handleRunAnalytics))
	m.HandleFunc("GET /api/analytics/jobs/{id}", s.require("responder", s.handleGetAnalytics))
	m.HandleFunc("GET /api/analytics/jobs/{id}/download", s.require("responder", s.handleDownloadAnalytics))
}

// buildStatus computes the public status body, which never holds responder
// detail: no notes, drafts, people's names, holders, dedup keys, sources or
// incident numbers.
func (s *Server) buildStatus(ctx context.Context) map[string]any {
	now := s.engine.Now()
	services, _ := s.store.Services(ctx)
	byID := map[string]*store.ServiceRecord{}
	for _, sv := range services {
		byID[sv.ID] = sv
	}
	var svcItems []map[string]any
	worst := ""
	for _, sv := range services {
		_, shown := s.serviceStatus(ctx, sv, byID)
		if shown != "" {
			worst = domain.WorstStatus(worst, shown)
		}
		svcItems = append(svcItems, map[string]any{"name": sv.Name, "status": shown})
	}
	sort.Slice(svcItems, func(i, j int) bool {
		return svcItems[i]["name"].(string) < svcItems[j]["name"].(string)
	})
	// Headline: running when all are Operational, maintenance when the worst is
	// Maintenance, and affected otherwise.
	headline := copytext.HeadlineRunning
	switch worst {
	case "", domain.StatusOperational:
		headline = copytext.HeadlineRunning
	case domain.StatusMaintenance:
		headline = copytext.HeadlineMaintenance
	default:
		headline = copytext.HeadlineAffected
	}
	// Maintenance banners for running windows.
	var banners []map[string]any
	rows, err := s.store.Pool().Query(ctx, `SELECT sv.name, w.ends_at FROM maintenance_windows w
		JOIN services sv ON sv.id = w.service_id
		WHERE w.starts_at <= $1 AND w.ends_at > $1 ORDER BY w.starts_at`, now)
	if err == nil {
		for rows.Next() {
			var name string
			var endsAt time.Time
			if rows.Scan(&name, &endsAt) == nil {
				banners = append(banners, map[string]any{
					"service": name,
					"ends_at": endsAt.UTC().Format(time.RFC3339),
				})
			}
		}
		rows.Close()
	}
	// Published updates, newest first.
	var updates []map[string]any
	urows, err := s.store.Pool().Query(ctx, `SELECT title, state, body, published_at FROM status_updates
		WHERE published_at IS NOT NULL ORDER BY published_at DESC`)
	if err == nil {
		for urows.Next() {
			var title, state, body string
			var published time.Time
			if urows.Scan(&title, &state, &body, &published) == nil {
				updates = append(updates, map[string]any{
					"title": title, "state": copytext.StateLabel(state), "body": body,
					"published_at": published.UTC().Format(time.RFC3339),
				})
			}
		}
		urows.Close()
	}
	// The plate is night while the latest published update is not resolved.
	plate := "dusk"
	var latestState *string
	if len(updates) > 0 {
		if st, ok := updates[0]["title"].(string); ok {
			_ = st
		}
	}
	_ = latestState
	prows, err := s.store.Pool().Query(ctx, `SELECT state FROM status_updates WHERE published_at IS NOT NULL
		ORDER BY published_at DESC LIMIT 1`)
	if err == nil {
		var state string
		if prows.Next() && prows.Scan(&state) == nil {
			if state != "resolved" {
				plate = "night"
			}
		}
		prows.Close()
	}
	return map[string]any{
		"firm": "Tarecross Software", "headline": headline, "plate": plate,
		"slower": !s.cache.Up(ctx),
		"services": svcItems, "maintenance": banners, "updates": updates,
	}
}

// handleStatusJSON answers the public status with ETag and cache header.
func (s *Server) handleStatusJSON(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	body := s.buildStatus(ctx)
	etag := `"` + statusETag(body) + `"`
	cacheState := "miss"
	if s.cache.Up(ctx) {
		if _, cached, ok := s.cache.Get(ctx, "cache:status:json"); ok {
			w.Header().Set("X-Switchlamp-Cache", "hit")
			w.Header().Set("ETag", etag)
			if match := r.Header.Get("If-None-Match"); match == etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(cached))
			return
		}
		s.cache.Set(ctx, "cache:status:json", etag, string(mustJSON(body)))
	} else {
		cacheState = "bypass"
		body["slower"] = true
	}
	w.Header().Set("X-Switchlamp-Cache", cacheState)
	w.Header().Set("ETag", etag)
	if match := r.Header.Get("If-None-Match"); match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

func statusETag(body map[string]any) string {
	headline, _ := body["headline"].(string)
	plate, _ := body["plate"].(string)
	services, _ := body["services"].([]map[string]any)
	names := ""
	for _, svc := range services {
		n, _ := svc["name"].(string)
		st, _ := svc["status"].(string)
		names += n + st
	}
	return fmt.Sprintf("st-%d", hashString(headline+plate+names))
}

func hashString(s string) uint32 {
	var h uint32 = 2166136261
	for _, c := range s {
		h ^= uint32(c)
		h *= 16777619
	}
	return h
}

func (s *Server) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	if !validEmail(body.Email) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"email": copytext.EmailInvalid})
		return
	}
	ctx := r.Context()
	// A repeated address answers the same.
	var existing string
	if err := s.store.Pool().QueryRow(ctx, `SELECT token FROM subscribers WHERE lower(email) = lower($1)`, body.Email).
		Scan(&existing); err == nil {
		writeJSON(w, http.StatusCreated, map[string]string{"status": "subscribed"})
		return
	}
	s.store.Pool().Exec(ctx, `INSERT INTO subscribers (id, email, token) VALUES ($1,$2,$3)`,
		genID(), body.Email, newToken())
	writeJSON(w, http.StatusCreated, map[string]string{"status": "subscribed"})
}

func validEmail(email string) bool {
	at := -1
	for i, c := range email {
		if c == '@' {
			if at >= 0 {
				return false
			}
			at = i
		}
	}
	return at > 0 && at < len(email)-1
}

func (s *Server) handleListUpdates(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	rows, err := s.store.Pool().Query(ctx, `SELECT id, title, body, state, service_ids, published_at
		FROM status_updates ORDER BY created_at DESC`)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, title, body, state string
		var ids []byte
		var published *time.Time
		if err := rows.Scan(&id, &title, &body, &state, &ids, &published); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
		var serviceIDs []string
		json.Unmarshal(ids, &serviceIDs)
		items = append(items, map[string]any{
			"id": id, "title": title, "body": body, "state": state,
			"service_ids": serviceIDs, "published_at": published,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateUpdate(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	s.upsertUpdate(w, r, "", http.StatusCreated)
}

func (s *Server) handlePutUpdate(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	s.upsertUpdate(w, r, r.PathValue("id"), http.StatusOK)
}

func (s *Server) upsertUpdate(w http.ResponseWriter, r *http.Request, id string, successStatus int) {
	var body struct {
		Title     string   `json:"title"`
		Body      string   `json:"body"`
		State     string   `json:"state"`
		ServiceIDs []string `json:"service_ids"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	fields := map[string]string{}
	if body.Title == "" {
		fields["title"] = "Title is required."
	}
	if body.Body == "" {
		fields["body"] = "Body is required."
	}
	switch body.State {
	case "investigating", "identified", "monitoring", "resolved":
	default:
		fields["state"] = "Choose a listed state."
	}
	if len(fields) > 0 {
		errorsBody(w, http.StatusUnprocessableEntity, fields)
		return
	}
	ctx := r.Context()
	if id == "" {
		id = genID()
		if _, err := s.store.Pool().Exec(ctx, `INSERT INTO status_updates (id, title, body, state, service_ids)
			VALUES ($1,$2,$3,$4,$5)`, id, body.Title, body.Body, body.State, mustJSON(body.ServiceIDs)); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
	} else {
		// Published updates are immutable.
		var published *time.Time
		if err := s.store.Pool().QueryRow(ctx, `SELECT published_at FROM status_updates WHERE id = $1`, id).
			Scan(&published); err != nil {
			apiError(w, http.StatusNotFound, "not_found")
			return
		}
		if published != nil {
			apiError(w, http.StatusConflict, "already_published")
			return
		}
		if _, err := s.store.Pool().Exec(ctx, `UPDATE status_updates SET title = $2, body = $3, state = $4, service_ids = $5
			WHERE id = $1`, id, body.Title, body.Body, body.State, mustJSON(body.ServiceIDs)); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
	}
	s.writeUpdate(w, ctx, id, successStatus, 0)
}

func (s *Server) writeUpdate(w http.ResponseWriter, ctx context.Context, id string, status int, subscribers int) {
	var title, body, state string
	var ids []byte
	var published *time.Time
	if err := s.store.Pool().QueryRow(ctx, `SELECT title, body, state, service_ids, published_at
		FROM status_updates WHERE id = $1`, id).Scan(&title, &body, &state, &ids, &published); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	var serviceIDs []string
	json.Unmarshal(ids, &serviceIDs)
	out := map[string]any{
		"id": id, "title": title, "body": body, "state": state,
		"service_ids": serviceIDs, "published_at": published,
	}
	if subscribers > 0 {
		out["subscribers"] = subscribers
	}
	writeJSON(w, status, out)
}

func (s *Server) handlePublishUpdate(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	id := r.PathValue("id")
	var published *time.Time
	var title, body, state string
	var ids []byte
	if err := s.store.Pool().QueryRow(ctx, `SELECT published_at, title, body, state, service_ids
		FROM status_updates WHERE id = $1`, id).Scan(&published, &title, &body, &state, &ids); err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if published != nil {
		apiError(w, http.StatusConflict, "already_published")
		return
	}
	now := s.engine.Now()
	if _, err := s.store.Pool().Exec(ctx, `UPDATE status_updates SET published_at = $2 WHERE id = $1`, id, now); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	// One mail per current subscriber, queued whether or not mail is reachable.
	subs := []struct{ email, token string }{}
	rows, err := s.store.Pool().Query(ctx, `SELECT email, token FROM subscribers`)
	if err == nil {
		for rows.Next() {
			var e, t string
			if rows.Scan(&e, &t) == nil {
				subs = append(subs, struct{ email, token string }{e, t})
			}
		}
		rows.Close()
	}
	var serviceIDs []string
	json.Unmarshal(ids, &serviceIDs)
	for _, sub := range subs {
		unsub := s.cfg.PublicURL + "/status/unsubscribe/" + sub.token
		mailBody := fmt.Sprintf("State: %s\n\n%s\n\nUnsubscribe: %s\n", copytext.StateLabel(state), body, unsub)
		subject := "[Tarecross status] " + title
		if err := s.mailQ.Enqueue(ctx, sub.email, subject, mailBody, now); err != nil {
			continue
		}
	}
	// Publishing clears the status cache at once.
	s.cache.Del(ctx, "cache:status:json", "cache:status:html")
	s.live.Publish("status", map[string]any{"published": title})
	s.writeUpdate(w, ctx, id, http.StatusOK, len(subs))
}

func (s *Server) handleListWebhooks(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	rows, err := s.store.Pool().Query(ctx, `SELECT id, name, path, event_types, service_ids FROM webhook_endpoints`)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, path string
		var types, ids []byte
		if err := rows.Scan(&id, &name, &path, &types, &ids); err != nil {
			apiError(w, http.StatusInternalServerError, "internal")
			return
		}
		var eventTypes, serviceIDs []string
		json.Unmarshal(types, &eventTypes)
		json.Unmarshal(ids, &serviceIDs)
		items = append(items, map[string]any{
			"id": id, "name": name, "path": path, "event_types": eventTypes, "service_ids": serviceIDs,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateWebhook(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		Name       string   `json:"name"`
		Path       string   `json:"path"`
		EventTypes []string `json:"event_types"`
		ServiceIDs []string `json:"service_ids"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	fields := map[string]string{}
	if body.Name == "" {
		fields["name"] = "Name is required."
	}
	if !hasSlashPrefix(body.Path) {
		fields["path"] = copytext.PathSlash
	}
	if len(fields) > 0 {
		errorsBody(w, http.StatusUnprocessableEntity, fields)
		return
	}
	secret := "whsec_" + newToken() + newToken()
	ctx := r.Context()
	id := genID()
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO webhook_endpoints (id, name, path, event_types, service_ids, secret)
		VALUES ($1,$2,$3,$4,$5,$6)`, id, body.Name, body.Path, mustJSON(body.EventTypes), mustJSON(body.ServiceIDs), secret); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "name": body.Name, "path": body.Path,
		"event_types": body.EventTypes, "service_ids": body.ServiceIDs,
		// The secret is shown only here.
		"secret": secret,
	})
}

func hasSlashPrefix(p string) bool { return len(p) > 0 && p[0] == '/' }

func (s *Server) handleDeleteWebhook(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	if _, err := s.store.Pool().Exec(r.Context(), `DELETE FROM webhook_endpoints WHERE id = $1`, r.PathValue("id")); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleWebhookDeliveries(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	limit := 25
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 100 {
			limit = n
		}
	}
	items, err := s.hooks.Deliveries(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "next_cursor": nil})
}

func (s *Server) handleReplayDelivery(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ok, err := s.hooks.ReplayDelivery(r.Context(), r.PathValue("id"))
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if !ok {
		apiError(w, http.StatusConflict, "delivery_in_progress")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "replay_queued"})
}

// Analytics rows.
type analyticsRow struct {
	Name        string  `json:"name"`
	Kind        string  `json:"kind"`
	Incidents   int     `json:"incidents"`
	MTTAMinutes string  `json:"mtta_minutes"`
	MTTRMinutes string  `json:"mttr_minutes"`
}

func (s *Server) handleRunAnalytics(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := readBody(w, r, &body, bodyLimit); err != nil {
		return
	}
	ctx := r.Context()
	// With to absent it is today's date in the firm's zone on the server clock.
	if body.To == "" {
		body.To = s.engine.Now().In(domain.FirmLoc()).Format("2006-01-02")
	}
	if body.From == "" {
		to, _ := time.ParseInLocation("2006-01-02", body.To, domain.FirmLoc())
		body.From = to.AddDate(0, 0, -29).Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", body.From); err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"from": copytext.FmtDate})
		return
	}
	if _, err := time.Parse("2006-01-02", body.To); err != nil {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"to": copytext.FmtDate})
		return
	}
	fromDate, _ := time.ParseInLocation("2006-01-02", body.From, domain.FirmLoc())
	toDate, _ := time.ParseInLocation("2006-01-02", body.To, domain.FirmLoc())
	if toDate.Before(fromDate) {
		errorsBody(w, http.StatusUnprocessableEntity, map[string]string{"to": copytext.RangeEnd})
		return
	}
	// A finished result is cached in Valkey until an incident in range changes.
	if s.cache.Up(ctx) {
		if cached, ok := s.cache.GetAnalytics(ctx, body.From, body.To); ok {
			var job map[string]any
			if jsonUnmarshal(cached, &job) == nil {
				job["cached"] = true
				writeJSON(w, http.StatusOK, job)
				return
			}
		}
	}
	id := genID()
	services, _ := s.store.Services(ctx)
	if _, err := s.store.Pool().Exec(ctx, `INSERT INTO analytics_jobs (id, "from", "to", state, done, total)
		VALUES ($1,$2,$3,'running',0,$4)`, id, body.From, body.To, len(services)+1); err != nil {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	// The job runs in the background and finishes even if every page is
	// closed, so it never shares the request's context.
	jobCtx := context.Background()
	go s.runAnalytics(jobCtx, id, body.From, body.To)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"id": id, "from": body.From, "to": body.To, "state": "running", "done": 0, "total": len(services) + 1,
		"rows": nil, "overall": nil, "cached": false,
	})
}

func (s *Server) handleGetAnalytics(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	var from, to, state string
	var done, total int
	var rows, overall []byte
	if err := s.store.Pool().QueryRow(ctx, `SELECT "from", "to", state, done, total, rows, overall
		FROM analytics_jobs WHERE id = $1`, r.PathValue("id")).
		Scan(&from, &to, &state, &done, &total, &rows, &overall); err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	body := map[string]any{
		"id": r.PathValue("id"), "from": from, "to": to, "state": state,
		"done": done, "total": total, "cached": false,
	}
	if rows != nil {
		var parsed []analyticsRow
		json.Unmarshal(rows, &parsed)
		body["rows"] = parsed
	} else {
		body["rows"] = nil
	}
	if overall != nil {
		var parsed map[string]any
		json.Unmarshal(overall, &parsed)
		body["overall"] = parsed
	} else {
		body["overall"] = nil
	}
	writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleDownloadAnalytics(w http.ResponseWriter, r *http.Request, u *SessionUser) {
	ctx := r.Context()
	var state string
	var rows []byte
	var from, to string
	if err := s.store.Pool().QueryRow(ctx, `SELECT state, rows, "from", "to" FROM analytics_jobs WHERE id = $1`,
		r.PathValue("id")).Scan(&state, &rows, &from, &to); err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	if state != "done" {
		apiError(w, http.StatusConflict, "job_running")
		return
	}
	var parsed []analyticsRow
	json.Unmarshal(rows, &parsed)
	w.Header().Set("Content-Type", "text/csv")
	w.WriteHeader(http.StatusOK)
	cw := csv.NewWriter(w)
	cw.Write([]string{"name", "incidents", "mtta_minutes", "mttr_minutes"})
	for _, row := range parsed {
		cw.Write([]string{row.Name, strconv.Itoa(row.Incidents), row.MTTAMinutes, row.MTTRMinutes})
	}
	// The All services row.
	var overall []byte
	s.store.Pool().QueryRow(ctx, `SELECT overall FROM analytics_jobs WHERE id = $1`, r.PathValue("id")).Scan(&overall)
	var ov struct {
		Incidents   int    `json:"incidents"`
		MTTAMinutes string `json:"mtta_minutes"`
		MTTRMinutes string `json:"mttr_minutes"`
	}
	json.Unmarshal(overall, &ov)
	cw.Write([]string{"All services", strconv.Itoa(ov.Incidents), ov.MTTAMinutes, ov.MTTRMinutes})
	cw.Flush()
}

// runAnalytics measures one service at a time, taking at least one real second
// per service, and sends done over the socket after each.
func (s *Server) runAnalytics(ctx context.Context, id, from, to string) {
	defer func() {
		if r := recover(); r != nil {
			_ = r
		}
	}()
	var total int
	s.store.Pool().QueryRow(ctx, `SELECT total FROM analytics_jobs WHERE id = $1`, id).Scan(&total)
	services, _ := s.store.Services(ctx)
	sorted := make([]*store.ServiceRecord, len(services))
	copy(sorted, services)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	var rows []analyticsRow
	allTimes := []int64{}
	allAck := []int64{}
	teams := map[string][]int64{}
	teamAcks := map[string][]int64{}
	teamIncidents := map[string]int{}

	// Firm-zone range bounds, both ends included.
	fromDate, _ := time.ParseInLocation("2006-01-02", from, domain.FirmLoc())
	startRange := fromDate
	endDate, _ := time.ParseInLocation("2006-01-02", to, domain.FirmLoc())
	endRange := endDate.AddDate(0, 0, 1)

	for _, sv := range sorted {
		rows = append(rows, s.measureService(ctx, sv, startRange, endRange, teams, teamAcks, teamIncidents, &allAck, &allTimes))
		time.Sleep(time.Second)
		var done int
		s.store.Pool().Exec(ctx, `UPDATE analytics_jobs SET done = done + 1 WHERE id = $1`, id)
		s.store.Pool().QueryRow(ctx, `SELECT done FROM analytics_jobs WHERE id = $1`, id).Scan(&done)
		s.live.Publish("analytics", map[string]any{"job_id": id, "done": done, "total": total})
	}
	// Teams, alphabetically.
	var teamNames []string
	for t := range teams {
		teamNames = append(teamNames, t)
	}
	sort.Strings(teamNames)
	for _, t := range teamNames {
		inc := teamIncidents[t]
		mtta := meanMinutes(teamAcks[t])
		mttr := meanMinutes(teams[t])
		rows = append(rows, analyticsRow{Name: t, Kind: "team", Incidents: inc, MTTAMinutes: mtta, MTTRMinutes: mttr})
	}
	overall := map[string]any{
		"incidents": len(allTimes), "mtta_minutes": meanMinutes(allAck), "mttr_minutes": meanMinutes(allTimes),
	}
	// The teams pass counts as the final step.
	s.store.Pool().Exec(ctx, `UPDATE analytics_jobs SET done = total, state = 'done', rows = $2, overall = $3, finished_at = now()
		WHERE id = $1`, id, mustJSON(rows), mustJSON(overall))
	if s.cache.Up(ctx) {
		job := map[string]any{
			"id": id, "from": from, "to": to, "state": "done", "done": total, "total": total,
			"rows": rows, "overall": overall, "cached": false,
		}
		s.cache.SetAnalytics(ctx, from, to, string(mustJSON(job)))
	}
	s.live.Publish("analytics", map[string]any{"job_id": id, "done": total, "total": total, "state": "done"})
}

// measureService measures one service's incidents in the range. Team figures
// collect across services so a team's row uses the same rules over all its
// incidents, never a mean of means.
func (s *Server) measureService(ctx context.Context, sv *store.ServiceRecord, start, end time.Time,
	teams, teamAcks map[string][]int64, teamIncidents map[string]int, allAck, allTimes *[]int64) analyticsRow {
	rows, err := s.store.Pool().Query(ctx, `SELECT i.id, i.opened_at, i.closed_at
		FROM incidents i WHERE i.service_id = $1 AND i.opened_at >= $2 AND i.opened_at < $3
		AND (i.resolve_reason IS NULL OR i.resolve_reason != 'Merged')`,
		sv.ID, start, end)
	if err != nil {
		return analyticsRow{Name: sv.Name, Kind: "service", Incidents: 0, MTTAMinutes: "n/a", MTTRMinutes: "n/a"}
	}
	defer rows.Close()
	count := 0
	var ackSecs []int64
	var resolveSecs []int64
	type snoozeSpan struct {
		from, to time.Time
	}
	for rows.Next() {
		var id string
		var opened time.Time
		var closed *time.Time
		if err := rows.Scan(&id, &opened, &closed); err != nil {
			continue
		}
		// A source closed by merge is left out completely.
		count++
		// Time to acknowledge runs from opening to the first acknowledge,
		// whatever happens later.
		var firstAck *time.Time
		s.store.Pool().QueryRow(ctx, `SELECT min(at) FROM timelines WHERE incident_id = $1 AND kind = 'acknowledged'`, id).Scan(&firstAck)
		if firstAck != nil {
			business := businessSeconds(opened, *firstAck)
			ackSecs = append(ackSecs, business)
			teamAcks[sv.Team] = append(teamAcks[sv.Team], business)
			*allAck = append(*allAck, business)
		}
		// Time to resolve runs from opening to resolution, minus snoozed time.
		if closed != nil {
			var snoozed int64
			srows, serr := s.store.Pool().Query(ctx, `SELECT at, kind FROM timelines
				WHERE incident_id = $1 AND kind IN ('snoozed','snooze_ended') ORDER BY at`, id)
			if serr == nil {
				var snoozeStart *time.Time
				for srows.Next() {
					var at time.Time
					var kind string
					if srows.Scan(&at, &kind) == nil {
						if kind == "snoozed" {
							t := at
							snoozeStart = &t
						} else if snoozeStart != nil {
							snoozed += int64(at.Sub(*snoozeStart).Seconds())
							snoozeStart = nil
						}
					}
				}
				srows.Close()
				// A snooze still running at resolution counts to the end.
				if snoozeStart != nil {
					snoozed += int64(closed.Sub(*snoozeStart).Seconds())
				}
			}
			secs := businessSeconds(opened, *closed) - snoozed
			resolveSecs = append(resolveSecs, secs)
			teams[sv.Team] = append(teams[sv.Team], secs)
			*allTimes = append(*allTimes, secs)
		}
	}
	teamIncidents[sv.Team] += count
	return analyticsRow{
		Name: sv.Name, Kind: "service", Incidents: count,
		MTTAMinutes: meanMinutes(ackSecs), MTTRMinutes: meanMinutes(resolveSecs),
	}
}

// businessSeconds counts only seconds inside business hours: Monday to Friday,
// 08:00 to 18:00, in the firm's zone, with no holidays. Each period includes
// its start second and excludes its end second.
func businessSeconds(from, to time.Time) int64 {
	if !to.After(from) {
		return 0
	}
	loc := domain.FirmLoc()
	total := int64(0)
	day := from.In(loc)
	day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	for day.Before(to) {
		if day.Weekday() >= time.Monday && day.Weekday() <= time.Friday {
			open := time.Date(day.Year(), day.Month(), day.Day(), 8, 0, 0, 0, loc)
			closeT := time.Date(day.Year(), day.Month(), day.Day(), 18, 0, 0, 0, loc)
			segStart := from
			if open.After(segStart) {
				segStart = open
			}
			segEnd := to
			if closeT.Before(segEnd) {
				segEnd = closeT
			}
			if segEnd.After(segStart) {
				total += int64(segEnd.Sub(segStart).Seconds())
			}
		}
		day = day.AddDate(0, 0, 1)
	}
	return total
}

// meanMinutes renders a mean in minutes, rounded half up to one decimal, with
// n/a when there is nothing to measure.
func meanMinutes(secs []int64) string {
	if len(secs) == 0 {
		return "n/a"
	}
	var total int64
	for _, s := range secs {
		total += s
	}
	// Mean in minutes, half up to one decimal.
	meanMicro := total * 10 / int64(len(secs))
	// minutes * 10 => tenth-of-minute total
	tenths := meanMicro / 60
	if meanMicro%60 >= 30 {
		tenths++
	}
	return fmt.Sprintf("%.1f", float64(tenths)/10.0)
}

var _ = errors.New
