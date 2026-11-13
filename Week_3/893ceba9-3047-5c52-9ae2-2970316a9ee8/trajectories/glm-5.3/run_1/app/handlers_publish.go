package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/lib/pq"
)

var idempotencyKeyRe = regexp.MustCompile(`^[\x20-\x7E]{1,64}$`)

// buildBundle writes the published bundle format for one language.
func buildBundle(pairs map[string]string) []byte {
	names := make([]string, 0, len(pairs))
	for k := range pairs {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool { return names[i] < names[j] })
	var b bundleWriter
	if len(names) == 0 {
		b.writeString("{}\n")
		return b.bytes()
	}
	b.writeString("{\n")
	for i, n := range names {
		name, _ := json.Marshal(n)
		val, _ := json.Marshal(pairs[n])
		b.writeString("  ")
		b.write(name)
		b.writeString(": ")
		b.write(val)
		if i < len(names)-1 {
			b.writeString(",")
		}
		b.writeString("\n")
	}
	b.writeString("}\n")
	return b.bytes()
}

type bundleWriter struct{ buf []byte }

func (w *bundleWriter) writeString(s string) { w.buf = append(w.buf, s...) }
func (w *bundleWriter) write(b []byte)       { w.buf = append(w.buf, b...) }
func (w *bundleWriter) bytes() []byte        { return w.buf }

// approvedStrings collects the branch's approved strings per language.
func (s *Server) approvedStrings(ctx context.Context, p *Project, branchID string) (map[string]map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT seg.language, k.name, seg.value FROM segments seg
		JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id
		WHERE seg.branch_id = $1 AND seg.status = 'approved' AND seg.value IS NOT NULL AND NOT k.deleted
		ORDER BY k.name`, branchID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]map[string]string{}
	for rows.Next() {
		var lang, name, value string
		if err := rows.Scan(&lang, &name, &value); err != nil {
			return nil, err
		}
		if out[lang] == nil {
			out[lang] = map[string]string{}
		}
		out[lang][name] = value
	}
	return out, rows.Err()
}

func (s *Server) approvedStringsLang(ctx context.Context, p *Project, branchID, lang string) (map[string]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT k.name, seg.value FROM segments seg
		JOIN keys k ON k.id = seg.key_id AND k.branch_id = seg.branch_id
		WHERE seg.branch_id = $1 AND seg.language = $2 AND seg.status = 'approved' AND seg.value IS NOT NULL AND NOT k.deleted`, branchID, lang)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]string{}
	for rows.Next() {
		var name, value string
		if err := rows.Scan(&name, &value); err != nil {
			return nil, err
		}
		out[name] = value
	}
	return out, rows.Err()
}

func (s *Server) handlePublishCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if !idempotencyKeyRe.MatchString(key) {
		validationFailed(w, map[string]string{"Idempotency-Key": "Send an Idempotency-Key of 1 to 64 visible characters."})
		return
	}
	var body struct {
		Branch string `json:"branch"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"branch": "Read the request body again."})
		return
	}
	b, branchID, err := s.store.BranchByName(r.Context(), p.ID, body.Branch)
	if err != nil || b == nil {
		notFoundError(w)
		return
	}
	if branchFinal(b.State) {
		writeError(w, http.StatusConflict, "branch_closed", "This branch is merged or abandoned, so it can't change.")
		return
	}

	// idempotent replay of the same key and body
	hash := sha256Hex([]byte(body.Branch))
	var storedStatus int
	var storedBody json.RawMessage
	qerr := s.db.QueryRowContext(r.Context(), `SELECT status, response FROM idempotency WHERE project_id = $1 AND key = $2`, p.ID, key).Scan(&storedStatus, &storedBody)
	if qerr == nil {
		var existingHash string
		if err := s.db.QueryRowContext(r.Context(), `SELECT request_hash FROM idempotency WHERE project_id = $1 AND key = $2`, p.ID, key).Scan(&existingHash); err == nil && existingHash != hash {
			writeError(w, http.StatusConflict, "idempotency_key_reused", "That Idempotency-Key was used with a different request.")
			return
		}
		var stored map[string]any
		_ = json.Unmarshal(storedBody, &stored)
		writeJSON(w, storedStatus, stored["publish"])
		return
	}

	// one publish at a time per project
	var openCount int
	if err := s.db.QueryRowContext(r.Context(), `SELECT count(*) FROM publishes WHERE project_id = $1 AND state IN ('queued','awaiting_host_confirmation')`, p.ID).Scan(&openCount); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if openCount > 0 {
		writeError(w, http.StatusConflict, "publish_in_progress", "Another publish is still running for this project.")
		return
	}

	// bundles: MinIO first, so nothing changes when storage is down
	stringsByLang, err := s.approvedStrings(r.Context(), p, branchID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	bundles := map[string]map[string]any{}
	publishID := newUUID()
	for _, lang := range p.TargetLanguages {
		bundle := buildBundle(stringsByLang[lang])
		objectKey := "projects/" + p.ID + "/publishes/" + publishID + "/" + lang + ".json"
		if err := s.storage.Put(r.Context(), objectKey, bundle, "application/json; charset=utf-8"); err != nil {
			serviceUnavailable(w, "storage_unavailable", "File storage isn't answering. Nothing was saved; try again in a few minutes.", nil)
			return
		}
		bundles[lang] = map[string]any{"object_key": objectKey, "sha256": sha256Hex(bundle)}
	}

	publish := map[string]any{
		"id": publishID, "branch": b.Name, "state": "queued",
		"failure_reason": nil, "languages": p.TargetLanguages,
		"pull_request": nil, "bundles": bundles,
		"created_at": time.Now().UTC().Format(time.RFC3339), "confirmed_at": nil,
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO publishes (id, project_id, branch, state, failure_reason, languages, pull_request_number, pull_request_url, bundles, owner_instance, created_at, confirmed_at)
		VALUES ($1,$2,$3,'queued',NULL,$4,NULL,NULL,$5,$6, now(), NULL)`,
		publishID, p.ID, b.Name, pq.Array(p.TargetLanguages), marshalString(bundles), instanceID); err != nil {
		http.Error(w, "internal", 500)
		return
	}

	// store the idempotency record with the response
	respBody := map[string]any{"publish": publish}
	respJSON, _ := json.Marshal(respBody)
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO idempotency (project_id, key, request_hash, status, response, created_at) VALUES ($1,$2,$3,$4,$5, now())`,
		p.ID, key, hash, http.StatusAccepted, string(respJSON)); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "publish.queued", p.Slug, b.Name)

	// this instance carries the publish out
	go s.runPublish(p, branchID, publishID)

	writeJSON(w, http.StatusAccepted, publish)
}

func marshalString(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// runPublish opens the pull request, polls the repository host for
// confirmation and queues the event. The instance that accepted the publish
// carries it out.
func (s *Server) runPublish(p *Project, branchID, publishID string) {
	ctx := context.Background()
	var branchName string
	if err := s.db.QueryRowContext(ctx, `SELECT branch FROM publishes WHERE id = $1`, publishID).Scan(&branchName); err != nil {
		return
	}
	repo := p.Repository
	files := []pullRequestFiles{}
	for _, lang := range p.TargetLanguages {
		bundle := buildBundleFromDB(ctx, s, p, branchID, lang)
		files = append(files, pullRequestFiles{
			Path:    "locales/" + lang + ".json",
			Content: base64.StdEncoding.EncodeToString(bundle),
		})
	}
	var pr PullRequest
	var opened bool
	for attempt := 1; attempt <= 3; attempt++ {
		c, cancel := contextWithTimeout(ctx, 5*time.Second)
		res, err := s.git.OpenPullRequest(c, repo, publishID, files)
		cancel()
		if err == nil {
			pr = res
			opened = true
			break
		}
		if errors.Is(err, errPullRejected) {
			_, _ = s.db.ExecContext(ctx, `UPDATE publishes SET state = 'failed', failure_reason = 'pull_request_rejected' WHERE id = $1`, publishID)
			_ = s.store.AuditInsert(ctx, "system", "publish.failed", p.Slug, publishID)
			return
		}
		time.Sleep(2 * time.Second)
	}
	if !opened {
		_, _ = s.db.ExecContext(ctx, `UPDATE publishes SET state = 'failed', failure_reason = 'git_host_unavailable' WHERE id = $1`, publishID)
		_ = s.store.AuditInsert(ctx, "system", "publish.failed", p.Slug, publishID)
		return
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE publishes SET state = 'awaiting_host_confirmation', pull_request_number = $1, pull_request_url = $2 WHERE id = $3`,
		pr.Number, pr.URL, publishID)

	// the host confirms the pull request: state open or merged within 30 seconds
	deadline := time.Now().UTC().Add(30 * time.Second)
	for time.Now().UTC().Before(deadline) {
		c, cancel := contextWithTimeout(ctx, 5*time.Second)
		cur, err := s.git.ReadPullRequest(c, repo, pr.Number)
		cancel()
		if err == nil && cur.Number == pr.Number && (cur.State == "open" || cur.State == "merged") {
			_, _ = s.db.ExecContext(ctx, `UPDATE publishes SET state = 'published', confirmed_at = now() WHERE id = $1`, publishID)
			_ = s.store.AuditInsert(ctx, "system", "publish.published", p.Slug, publishID)
			s.queueLocalePublished(ctx, p.ID, publishID)
			return
		}
		time.Sleep(2 * time.Second)
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE publishes SET state = 'failed', failure_reason = 'not_confirmed' WHERE id = $1`, publishID)
	_ = s.store.AuditInsert(ctx, "system", "publish.failed", p.Slug, publishID)
}

func buildBundleFromDB(ctx context.Context, s *Server, p *Project, branchID, lang string) []byte {
	strs, _ := s.approvedStringsLang(ctx, p, branchID, lang)
	return buildBundle(strs)
}

var instanceID = newUUID()

func (s *Server) handlePublishesList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	publishes, err := s.publishesOf(r.Context(), p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if publishes == nil {
		publishes = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"publishes": publishes})
}

func (s *Server) publishesOf(ctx context.Context, projectID string) ([]map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, branch, state, failure_reason, languages, pull_request_number, pull_request_url, bundles, created_at, confirmed_at
		FROM publishes WHERE project_id = $1 ORDER BY created_at DESC`, projectID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []map[string]any
	for rows.Next() {
		v, err := scanPublish(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func scanPublish(rows interface{ Scan(...any) error }) (map[string]any, error) {
	var id, branch, state string
	var failureReason any
	var langs []string
	var prNumber any
	var prURL any
	var bundles []byte
	var createdAt time.Time
	var confirmedAt any
	if err := rows.Scan(&id, &branch, &state, &failureReason, pq.Array(&langs), &prNumber, &prURL, &bundles, &createdAt, &confirmedAt); err != nil {
		return nil, err
	}
	var bundleMap map[string]any
	_ = json.Unmarshal(bundles, &bundleMap)
	var pr any
	if prNumber != nil {
		if n, ok := prNumber.(int64); ok {
			urlStr, _ := prURL.(string)
			pr = map[string]any{"number": int(n), "url": urlStr}
		}
	}
	return map[string]any{
		"id": id, "branch": branch, "state": state, "failure_reason": failureReason,
		"languages": langs, "pull_request": pr, "bundles": bundleMap,
		"created_at": createdAt.UTC().Format(time.RFC3339), "confirmed_at": confirmedAt,
	}, nil
}

func (s *Server) handlePublishGet(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	row := s.db.QueryRowContext(r.Context(), `SELECT id, branch, state, failure_reason, languages, pull_request_number, pull_request_url, bundles, created_at, confirmed_at
		FROM publishes WHERE id = $1 AND project_id = $2`, r.PathValue("id"), p.ID)
	v, err := scanPublish(row)
	if err != nil {
		notFoundError(w)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// ---- tokens ----

func (s *Server) handleTokensList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT id, label, created_at FROM tokens WHERE project_id = $1 ORDER BY created_at`, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	tokens := []map[string]any{}
	for rows.Next() {
		var id, label string
		var at time.Time
		if err := rows.Scan(&id, &label, &at); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		tokens = append(tokens, map[string]any{"id": id, "label": label, "created_at": at.UTC().Format(time.RFC3339)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
}

func (s *Server) handleTokenCreate(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	var body struct {
		Label string `json:"label"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"label": "Read the request body again."})
		return
	}
	if len(body.Label) < 1 || len(body.Label) > 80 {
		validationFailed(w, map[string]string{"label": "The token label is 1 to 80 characters."})
		return
	}
	id := newUUID()
	token := "idk_" + randomToken(32)
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO tokens (id, project_id, label, token_hash, created_at) VALUES ($1,$2,$3,$4, now())`,
		id, p.ID, body.Label, hashToken(token)); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "token.created", p.Slug, body.Label)
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "label": body.Label, "token": token})
}

func (s *Server) handleTokenDelete(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	res, err := s.db.ExecContext(r.Context(), `DELETE FROM tokens WHERE id = $1 AND project_id = $2`, r.PathValue("id"), p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		notFoundError(w)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "token.deleted", p.Slug, "")
	w.WriteHeader(http.StatusNoContent)
}

// ---- CI locale pull ----

func (s *Server) handleCILocale(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	lang := strings.TrimSuffix(r.PathValue("file"), ".json")
	projectID, err := ciProject(r, s.db, slug)
	if err != nil || projectID == "" {
		writeError(w, http.StatusNotFound, "not_found", "We couldn't find that.")
		return
	}
	var proj Project
	pRow := s.db.QueryRowContext(r.Context(), `SELECT id, slug, name, client, source_language, target_languages, repository, mqm_threshold, ai_routes, created_at FROM projects WHERE id = $1`, projectID)
	if err := proj.scan(pRow); err != nil {
		notFoundError(w)
		return
	}
	if !containsLanguage(proj.TargetLanguages, lang) {
		notFoundError(w)
		return
	}
	mainID := mainBranchID(r.Context(), s.db, projectID)
	strs, err := s.approvedStringsLang(r.Context(), &proj, mainID, lang)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	bundle := buildBundle(strs)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bundle)
}

// ---- webhook endpoint ----

func (s *Server) handleWebhookSave(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	var body struct {
		URL string `json:"url"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		validationFailed(w, map[string]string{"url": "Read the request body again."})
		return
	}
	if !strings.HasPrefix(body.URL, "http://") && !strings.HasPrefix(body.URL, "https://") {
		validationFailed(w, map[string]string{"url": "Send an absolute http or https URL."})
		return
	}
	s.svix.EnsureEventTypes(r.Context())
	endpointID, secret, err := s.svix.UpsertEndpoint(r.Context(), p.ID, p.Name, body.URL)
	if err != nil {
		log.Printf("webhook save failed: %v", err)
		serviceUnavailable(w, "webhooks_unavailable", "The webhook service isn't answering. The endpoint wasn't saved; try again in a few minutes.", nil)
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `INSERT INTO webhook_endpoints (project_id, url, signing_secret, svix_endpoint_id) VALUES ($1,$2,$3,$4)
		ON CONFLICT (project_id) DO UPDATE SET url = $2, signing_secret = $3, svix_endpoint_id = $4`,
		p.ID, body.URL, secret, endpointID); err != nil {
		http.Error(w, "internal", 500)
		return
	}
	_ = s.store.AuditInsert(r.Context(), u.Email, "webhook.saved", p.Slug, "")
	writeJSON(w, http.StatusOK, map[string]any{
		"url":            body.URL,
		"event_types":    []string{"locale.published", "review.completed"},
		"signing_secret": secret,
	})
}

func (s *Server) handleWebhookGet(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	var url, secret string
	if err := s.db.QueryRowContext(r.Context(), `SELECT url, signing_secret FROM webhook_endpoints WHERE project_id = $1`, p.ID).Scan(&url, &secret); err != nil {
		notFoundError(w)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url":            url,
		"event_types":    []string{"locale.published", "review.completed"},
		"signing_secret": secret,
	})
}

func (s *Server) handleEventsList(w http.ResponseWriter, r *http.Request) {
	p, err := s.projectInScope(w, r, r.PathValue("slug"))
	if err != nil {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT event_id, type, state, attempts, created_at, sent_at FROM events WHERE project_id = $1 ORDER BY created_at DESC`, p.ID)
	if err != nil {
		http.Error(w, "internal", 500)
		return
	}
	defer func() { _ = rows.Close() }()
	events := []map[string]any{}
	for rows.Next() {
		var eventID, typ, state string
		var attempts int
		var createdAt time.Time
		var sentAt any
		if err := rows.Scan(&eventID, &typ, &state, &attempts, &createdAt, &sentAt); err != nil {
			http.Error(w, "internal", 500)
			return
		}
		events = append(events, map[string]any{
			"event_id": eventID, "type": typ, "state": state, "attempts": attempts,
			"created_at": createdAt.UTC().Format(time.RFC3339), "sent_at": sentAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

// ---- event queueing ----

func (s *Server) hasEndpoint(ctx context.Context, projectID string) bool {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM webhook_endpoints WHERE project_id = $1`, projectID).Scan(&n); err != nil {
		return false
	}
	return n > 0
}

func (s *Server) queueEvent(ctx context.Context, projectID, eventID, typ string, payload map[string]any) {
	if !s.hasEndpoint(ctx, projectID) {
		return
	}
	payloadJSON, _ := json.Marshal(payload)
	_, _ = s.db.ExecContext(ctx, `INSERT INTO events (event_id, project_id, type, state, attempts, payload, owner_instance, created_at, sent_at)
		VALUES ($1,$2,$3,'pending',0,$4,$5, now(), NULL)
		ON CONFLICT (event_id) DO NOTHING`, eventID, projectID, typ, string(payloadJSON), instanceID)
}

func (s *Server) queueLocalePublished(ctx context.Context, projectID, publishID string) {
	var branch string
	var prNumber any
	var prURL any
	var langs []string
	var bundles []byte
	var confirmedAt time.Time
	if err := s.db.QueryRowContext(ctx, `SELECT branch, pull_request_number, pull_request_url, languages, bundles, confirmed_at FROM publishes WHERE id = $1`, publishID).
		Scan(&branch, &prNumber, &prURL, pq.Array(&langs), &bundles, &confirmedAt); err != nil {
		return
	}
	var bundleMap map[string]map[string]any
	_ = json.Unmarshal(bundles, &bundleMap)
	shas := map[string]string{}
	for lang, b := range bundleMap {
		if sha, ok := b["sha256"].(string); ok {
			shas[lang] = sha
		}
	}
	number := 0
	if n, ok := prNumber.(int64); ok {
		number = int(n)
	}
	urlStr, _ := prURL.(string)
	slug := ""
	_ = s.db.QueryRowContext(ctx, `SELECT slug FROM projects WHERE id = $1`, projectID).Scan(&slug)
	eventID := "evt_pub_" + publishID
	s.queueEvent(ctx, projectID, eventID, "locale.published", map[string]any{
		"event_id": eventID, "type": "locale.published", "project": slug, "branch": branch,
		"publish_id":   publishID,
		"pull_request": map[string]any{"number": number, "url": urlStr},
		"languages":    langs,
		"bundles":      shas,
		"published_at": confirmedAt.UTC().Format(time.RFC3339),
	})
}

func (s *Server) queueReviewCompleted(ctx context.Context, assignmentID, projectID, reviewerID, branch, language string, approved int) {
	slug := ""
	_ = s.db.QueryRowContext(ctx, `SELECT slug FROM projects WHERE id = $1`, projectID).Scan(&slug)
	eventID := "evt_rev_" + assignmentID
	s.queueEvent(ctx, projectID, eventID, "review.completed", map[string]any{
		"event_id": eventID, "type": "review.completed", "project": slug, "branch": branch,
		"language": language, "assignment_id": assignmentID, "reviewer_id": reviewerID,
		"segments_approved": approved, "completed_at": time.Now().UTC().Format(time.RFC3339),
	})
}

// sendPendingEvents sends pending events this instance queued, retrying until
// Svix accepts. Each attempt counts in attempts.
func (s *Server) sendPendingEvents() {
	ctx := context.Background()
	rows, err := s.db.QueryContext(ctx, `SELECT event_id, project_id, type, payload, attempts, owner_instance FROM events WHERE state = 'pending'`)
	if err != nil {
		return
	}
	type pending struct {
		id, projectID, typ, owner string
		payload                   []byte
		attempts                  int
	}
	var list []pending
	for rows.Next() {
		var e pending
		if err := rows.Scan(&e.id, &e.projectID, &e.typ, &e.payload, &e.attempts, &e.owner); err != nil {
			rows.Close()
			return
		}
		list = append(list, e)
	}
	rows.Close()
	for _, e := range list {
		if e.owner != instanceID {
			continue
		}
		var payload map[string]any
		_ = json.Unmarshal(e.payload, &payload)
		c, cancel := contextWithTimeout(ctx, 5*time.Second)
		err := s.svix.SendMessage(c, e.projectID, e.typ, e.id, payload)
		cancel()
		attempts := e.attempts + 1
		if err == nil {
			_, _ = s.db.ExecContext(ctx, `UPDATE events SET state = 'sent', attempts = $1, sent_at = now() WHERE event_id = $2`, attempts, e.id)
			continue
		}
		_, _ = s.db.ExecContext(ctx, `UPDATE events SET attempts = $1 WHERE event_id = $2`, attempts, e.id)
	}
}

var _ = fmt.Sprintf
var _ = sql.ErrNoRows
