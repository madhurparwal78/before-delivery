package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
)

var webhookEventTypes = []string{"locale.published", "review.completed"}

func errWebhooksDown() *apiError {
	return newErr(http.StatusServiceUnavailable, "webhooks_unavailable",
		"The webhook service isn't answering. The endpoint wasn't saved; try again in a few minutes.")
}

func (a *App) handlePutWebhook(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if u, err := url.Parse(in.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errField("url", "Enter an absolute http or https URL.")
	}
	ctx := r.Context()
	var secret string
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		endpointID, key, err := a.svix.saveEndpoint(ctx, p.ID, p.Name, in.URL)
		if err != nil {
			log.Printf("save webhook endpoint for %s: %v", p.Slug, err)
			return errWebhooksDown()
		}
		secret = key
		_, err = tx.Exec(ctx, `INSERT INTO webhooks (project_id, url, svix_endpoint_id, signing_secret) VALUES ($1, $2, $3, $4)
			ON CONFLICT (project_id) DO UPDATE SET url = EXCLUDED.url, svix_endpoint_id = EXCLUDED.svix_endpoint_id,
			signing_secret = EXCLUDED.signing_secret`, p.ID, in.URL, endpointID, secret)
		if err != nil {
			return fmt.Errorf("save webhook: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "webhook.saved", p, in.URL)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": in.URL, "event_types": webhookEventTypes, "signing_secret": secret})
	return nil
}

func (a *App) handleGetWebhook(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var endpoint, secret string
	err = a.pool.QueryRow(r.Context(), "SELECT url, signing_secret FROM webhooks WHERE project_id = $1", p.ID).Scan(&endpoint, &secret)
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound()
	}
	if err != nil {
		return fmt.Errorf("load webhook: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": endpoint, "event_types": webhookEventTypes, "signing_secret": secret})
	return nil
}

func (a *App) handleEvents(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), "SELECT event_id, type, state, attempts, created_at, sent_at FROM events WHERE project_id = $1 ORDER BY seq", p.ID)
	if err != nil {
		return fmt.Errorf("list events: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var eventID, typ, state string
		var attempts int
		var created time.Time
		var sent *time.Time
		if err := rows.Scan(&eventID, &typ, &state, &attempts, &created, &sent); err != nil {
			return fmt.Errorf("scan event: %w", err)
		}
		out = append(out, map[string]any{"event_id": eventID, "type": typ, "state": state, "attempts": attempts,
			"created_at": fmtTime(created), "sent_at": fmtTimePtr(sent)})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": out})
	return nil
}

// queueEvent stores an event for delivery, but only when the project has a webhook endpoint.
// This instance is the one that will send it.
func (a *App) queueEvent(ctx context.Context, tx pgx.Tx, p *Project, eventID, typ string, payload map[string]any) error {
	var hooked int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM webhooks WHERE project_id = $1", p.ID).Scan(&hooked); err != nil {
		return fmt.Errorf("check webhook: %w", err)
	}
	if hooked == 0 {
		return nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode event: %w", err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO events (id, project_id, event_id, type, payload, state, created_at, instance)
		VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) ON CONFLICT (event_id) DO NOTHING`, newID(), p.ID, eventID, typ, raw, time.Now().UTC(), a.instance)
	if err != nil {
		return fmt.Errorf("queue event: %w", err)
	}
	return nil
}

// kick wakes the delivery loop after a commit that may have queued an event.
func (a *App) kick() {
	select {
	case a.wake <- struct{}{}:
	default:
	}
}

// deliveryLoop sends this instance's pending events at once and again every WEBHOOK_RETRY_SECONDS,
// and retries cleanups that failed when a project was erased.
func (a *App) deliveryLoop(ctx context.Context) {
	tick := time.NewTicker(a.cfg.WebhookRetry)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.wake:
		case <-tick.C:
		}
		pass, cancel := context.WithTimeout(ctx, time.Minute)
		a.runCleanups(pass)
		a.flushEvents(pass)
		cancel()
	}
}

func (a *App) flushEvents(ctx context.Context) {
	rows, err := a.pool.Query(ctx, "SELECT id, project_id, event_id, type, payload FROM events WHERE state = 'pending' AND instance = $1 ORDER BY seq", a.instance)
	if err != nil {
		log.Printf("list pending events: %v", err)
		return
	}
	type pending struct {
		id, project, eventID, typ string
		payload                   json.RawMessage
	}
	var todo []pending
	for rows.Next() {
		var e pending
		if err := rows.Scan(&e.id, &e.project, &e.eventID, &e.typ, &e.payload); err != nil {
			rows.Close()
			log.Printf("scan pending event: %v", err)
			return
		}
		todo = append(todo, e)
	}
	rows.Close()
	for _, e := range todo {
		sendCtx, cancel := context.WithTimeout(ctx, 2*upstreamTimeout)
		err := a.svix.send(sendCtx, e.project, e.eventID, e.typ, e.payload)
		cancel()
		if err != nil {
			if _, uerr := a.pool.Exec(ctx, "UPDATE events SET attempts = attempts + 1 WHERE id = $1", e.id); uerr != nil {
				log.Printf("count attempt for %s: %v", e.eventID, uerr)
			}
			continue
		}
		if _, uerr := a.pool.Exec(ctx, "UPDATE events SET attempts = attempts + 1, state = 'sent', sent_at = $2 WHERE id = $1", e.id, time.Now().UTC()); uerr != nil {
			log.Printf("mark %s sent: %v", e.eventID, uerr)
		}
	}
}

// cleanupAfterErase removes an erased project's objects and its Svix application; whatever fails is retried.
func (a *App) cleanupAfterErase(ctx context.Context, projectID string, hadWebhook bool) {
	if err := a.s3.DeletePrefix(ctx, "projects/"+projectID+"/"); err != nil {
		a.queueCleanup(ctx, "objects", "projects/"+projectID+"/")
	}
	if hadWebhook {
		if err := a.svix.deleteApp(ctx, projectID); err != nil {
			a.queueCleanup(ctx, "svix", projectID)
		}
	}
}

func (a *App) queueCleanup(ctx context.Context, kind, ref string) {
	if _, err := a.pool.Exec(ctx, "INSERT INTO cleanups (kind, ref, instance) VALUES ($1, $2, $3)", kind, ref, a.instance); err != nil {
		log.Printf("queue %s cleanup: %v", kind, err)
	}
}

func (a *App) runCleanups(ctx context.Context) {
	rows, err := a.pool.Query(ctx, "SELECT id, kind, ref FROM cleanups WHERE instance = $1 ORDER BY id", a.instance)
	if err != nil {
		log.Printf("list cleanups: %v", err)
		return
	}
	type job struct {
		id        int64
		kind, ref string
	}
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.id, &j.kind, &j.ref); err != nil {
			rows.Close()
			return
		}
		jobs = append(jobs, j)
	}
	rows.Close()
	for _, j := range jobs {
		var err error
		if j.kind == "svix" {
			err = a.svix.deleteApp(ctx, j.ref)
		} else {
			err = a.s3.DeletePrefix(ctx, j.ref)
		}
		if err != nil {
			continue
		}
		if _, err := a.pool.Exec(ctx, "DELETE FROM cleanups WHERE id = $1", j.id); err != nil {
			log.Printf("clear finished cleanup: %v", err)
		}
	}
}
