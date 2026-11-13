package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	gitAttempts     = 3
	gitRetryGap     = 2 * time.Second
	confirmEvery    = 2 * time.Second
	confirmWindow   = 30 * time.Second
	publishQueued   = "queued"
	publishAwaiting = "awaiting_host_confirmation"
	publishDone     = "published"
	publishFailed   = "failed"
)

// publishMoves lists, per state, the states a publish may move to: the one publish state machine.
// A publish starts queued; its states with a move left are the ones that hold the project's one publish slot.
var publishMoves = map[string][]string{
	publishQueued:   {publishAwaiting, publishFailed},
	publishAwaiting: {publishDone, publishFailed},
}

// runningPublishStates are the publish states that still have a move left.
var runningPublishStates = []string{publishQueued, publishAwaiting}

// publishChange is what a publish move records besides the new state.
type publishChange struct {
	PRNumber    *int
	PRURL       *string
	ConfirmedAt *time.Time
	Reason      *string
}

// movePublish applies one legal publish move; it changes nothing when the publish is no longer in a state that may move to `to`.
func movePublish(ctx context.Context, q db, pubID, to string, c publishChange) error {
	var from []string
	for state, next := range publishMoves {
		if slices.Contains(next, to) {
			from = append(from, state)
		}
	}
	tag, err := q.Exec(ctx, `UPDATE publishes SET state = $2, pr_number = COALESCE($3, pr_number), pr_url = COALESCE($4, pr_url),
		confirmed_at = COALESCE($5, confirmed_at), failure_reason = COALESCE($6, failure_reason) WHERE id = $1 AND state = ANY($7)`,
		pubID, to, c.PRNumber, c.PRURL, c.ConfirmedAt, c.Reason, from)
	if err != nil {
		return fmt.Errorf("move publish to %s: %w", to, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("publish %s cannot move to %s", pubID, to)
	}
	return nil
}

var idempotencyKeyPattern = regexp.MustCompile(`^[\x21-\x7e]{1,64}$`)

// approvedStrings collects a branch's live approved translations per language.
func approvedStrings(ctx context.Context, q db, p *Project, branchID string) (map[string]map[string]string, error) {
	out := map[string]map[string]string{}
	for _, lang := range p.TargetLanguages {
		out[lang] = map[string]string{}
	}
	rows, err := q.Query(ctx, `SELECT s.language, k.name, s.value FROM segments s JOIN branch_keys k ON k.branch_id = s.branch_id AND k.key_id = s.key_id
		WHERE s.branch_id = $1 AND NOT k.deleted AND s.status = 'approved' AND s.value IS NOT NULL`, branchID)
	if err != nil {
		return nil, fmt.Errorf("collect approved strings: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var lang, name, value string
		if err := rows.Scan(&lang, &name, &value); err != nil {
			return nil, fmt.Errorf("scan approved string: %w", err)
		}
		if out[lang] != nil {
			out[lang][name] = value
		}
	}
	return out, rows.Err()
}

type publishRow struct {
	ID            string
	Branch        string
	State         string
	FailureReason *string
	Languages     []string
	PRNumber      *int
	PRURL         *string
	Bundles       map[string]map[string]string
	CreatedAt     time.Time
	ConfirmedAt   *time.Time
}

const publishColumns = "id, branch, state, failure_reason, languages, pr_number, pr_url, bundles, created_at, confirmed_at"

func scanPublish(row pgx.Row) (*publishRow, error) {
	var r publishRow
	if err := row.Scan(&r.ID, &r.Branch, &r.State, &r.FailureReason, &r.Languages, &r.PRNumber, &r.PRURL, &r.Bundles, &r.CreatedAt, &r.ConfirmedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

func (r *publishRow) json() map[string]any {
	var pr any
	if r.PRNumber != nil {
		pr = map[string]any{"number": *r.PRNumber, "url": derefOr(r.PRURL, "")}
	}
	return map[string]any{"id": r.ID, "branch": r.Branch, "state": r.State, "failure_reason": r.FailureReason, "languages": r.Languages,
		"pull_request": pr, "bundles": r.Bundles, "created_at": fmtTime(r.CreatedAt), "confirmed_at": fmtTimePtr(r.ConfirmedAt)}
}

func (a *App) lastPublish(ctx context.Context, p *Project) (any, error) {
	r, err := scanPublish(a.pool.QueryRow(ctx, "SELECT "+publishColumns+" FROM publishes WHERE project_id = $1 ORDER BY seq DESC LIMIT 1", p.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load last publish: %w", err)
	}
	return r.json(), nil
}

func (a *App) handlePublishes(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), "SELECT "+publishColumns+" FROM publishes WHERE project_id = $1 ORDER BY seq DESC", p.ID)
	if err != nil {
		return fmt.Errorf("list publishes: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		pub, err := scanPublish(rows)
		if err != nil {
			return fmt.Errorf("scan publish: %w", err)
		}
		out = append(out, pub.json())
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"publishes": out})
	return nil
}

func (a *App) handlePublish(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	pub, err := scanPublish(a.pool.QueryRow(r.Context(), "SELECT "+publishColumns+" FROM publishes WHERE id = $1 AND project_id = $2", r.PathValue("id"), p.ID))
	if errors.Is(err, pgx.ErrNoRows) {
		return errNotFound()
	}
	if err != nil {
		return fmt.Errorf("load publish: %w", err)
	}
	writeJSON(w, http.StatusOK, pub.json())
	return nil
}

func (a *App) handleCreatePublish(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		Branch string `json:"branch"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	key := r.Header.Get("Idempotency-Key")
	bodyHash := sha256Hex([]byte(in.Branch))
	ctx := r.Context()
	var stored int
	var response json.RawMessage
	var bundles map[string][]byte
	var pubID string
	var up uploads
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if idempotencyKeyPattern.MatchString(key) {
			var hash string
			err := tx.QueryRow(ctx, "SELECT body_hash, status, response FROM idempotency WHERE project_id = $1 AND key = $2", p.ID, key).Scan(&hash, &stored, &response)
			if err == nil {
				if hash != bodyHash {
					return newErr(http.StatusConflict, "idempotency_key_reused", "That Idempotency-Key was already used for a different request.")
				}
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("look up idempotency key: %w", err)
			}
		}
		fields := map[string]string{}
		if !idempotencyKeyPattern.MatchString(key) {
			fields["Idempotency-Key"] = "Send an Idempotency-Key of 1 to 64 visible ASCII characters."
		}
		var conflict error
		b, err := branchByName(ctx, tx, p.ID, in.Branch)
		switch ae := asAPIError(err); {
		case ae != nil && ae.Code == "not_found":
			fields["branch"] = "Choose main or an open or in-review branch."
		case err != nil:
			return err
		default:
			conflict = b.requireLive()
		}
		if conflict == nil {
			var running int
			if err := tx.QueryRow(ctx, "SELECT count(*) FROM publishes WHERE project_id = $1 AND state = ANY($2)", p.ID, runningPublishStates).Scan(&running); err != nil {
				return fmt.Errorf("check running publish: %w", err)
			}
			if running > 0 {
				conflict = newErr(http.StatusConflict, "publish_in_progress", "Another publish is still running for this project.")
			}
		}
		var invalid error
		if len(fields) > 0 {
			invalid = errValidation(fields)
		}
		if err := firstByPrecedence(conflict, invalid); err != nil {
			return err
		}
		strs, err := approvedStrings(ctx, tx, p, b.ID)
		if err != nil {
			return err
		}
		pubID = newID()
		bundles = map[string][]byte{}
		meta := map[string]map[string]string{}
		for _, lang := range p.TargetLanguages {
			data := buildBundle(strs[lang])
			objectKey := fmt.Sprintf("projects/%s/publishes/%s/%s.json", p.ID, pubID, lang)
			if err := up.put(ctx, a, objectKey, data, "application/json"); err != nil {
				return err
			}
			bundles[lang] = data
			meta[lang] = map[string]string{"object_key": objectKey, "sha256": sha256Hex(data)}
		}
		row := &publishRow{ID: pubID, Branch: b.Name, State: publishQueued, Languages: p.TargetLanguages, Bundles: meta, CreatedAt: now()}
		if _, err := tx.Exec(ctx, `INSERT INTO publishes (id, project_id, branch, state, languages, bundles, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			row.ID, p.ID, row.Branch, row.State, row.Languages, row.Bundles, row.CreatedAt); err != nil {
			return fmt.Errorf("create publish: %w", err)
		}
		if response, err = json.Marshal(row.json()); err != nil {
			return fmt.Errorf("encode publish: %w", err)
		}
		stored = http.StatusAccepted
		if _, err := tx.Exec(ctx, "INSERT INTO idempotency (project_id, key, body_hash, status, response) VALUES ($1, $2, $3, $4, $5)",
			p.ID, key, bodyHash, stored, []byte(response)); err != nil {
			return fmt.Errorf("store idempotent response: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "publish.requested", p, b.Name)
	})
	if err != nil {
		up.discard(ctx, a)
		return err
	}
	if pubID != "" {
		go a.carryOut(context.WithoutCancel(ctx), p, pubID, bundles)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(stored)
	writeBody(w, append(response, '\n'))
	return nil
}

// carryOut opens the pull request and waits for the repository host to confirm it.
func (a *App) carryOut(parent context.Context, p *Project, pubID string, bundles map[string][]byte) {
	ctx, cancel := context.WithTimeout(parent, gitAttempts*(upstreamTimeout+gitRetryGap)+confirmWindow+2*upstreamTimeout+time.Minute)
	defer cancel()
	files := []map[string]string{}
	for _, lang := range p.TargetLanguages {
		files = append(files, map[string]string{"path": "locales/" + lang + ".json", "content": base64.StdEncoding.EncodeToString(bundles[lang])})
	}
	request := map[string]any{"title": "Interline Desk publish " + pubID, "head": "interline/" + pubID, "base": "main", "files": files}
	var number int
	var url string
	reason := "git_host_unavailable"
	for attempt := 1; attempt <= gitAttempts; attempt++ {
		status, body, err := a.git.call(ctx, http.MethodPost, "/git/v1/repos/"+p.Repository+"/pulls", nil, request)
		retry := err != nil || status >= 500
		if !retry {
			var created struct {
				Number  *int   `json:"number"`
				HTMLURL string `json:"html_url"`
			}
			if status == http.StatusCreated && json.Unmarshal(body, &created) == nil && created.Number != nil {
				number, url, reason = *created.Number, created.HTMLURL, ""
			} else {
				reason = "pull_request_rejected"
			}
			break
		}
		if attempt < gitAttempts {
			time.Sleep(gitRetryGap)
		}
	}
	if reason != "" {
		a.finishPublish(ctx, p, pubID, publishFailed, reason, nil)
		return
	}
	if err := movePublish(ctx, a.pool, pubID, publishAwaiting, publishChange{PRNumber: &number, PRURL: &url}); err != nil {
		log.Printf("publish %s: record pull request: %v", pubID, err)
		return
	}
	deadline := time.Now().Add(confirmWindow)
	for time.Now().Before(deadline) {
		time.Sleep(confirmEvery)
		status, body, err := a.git.call(ctx, http.MethodGet, fmt.Sprintf("/git/v1/repos/%s/pulls/%d", p.Repository, number), nil, nil)
		if err != nil || status != http.StatusOK {
			continue
		}
		var pull struct {
			Number int    `json:"number"`
			State  string `json:"state"`
		}
		if json.Unmarshal(body, &pull) == nil && pull.Number == number && (pull.State == "open" || pull.State == "merged") {
			a.finishPublish(ctx, p, pubID, publishDone, "", &prInfo{number, url})
			return
		}
	}
	a.finishPublish(ctx, p, pubID, publishFailed, "not_confirmed", nil)
}

type prInfo struct {
	Number int
	URL    string
}

// finishPublish records the outcome of a publish; a confirmed one also queues its locale.published event.
func (a *App) finishPublish(ctx context.Context, p *Project, pubID, state, reason string, pr *prInfo) {
	err := a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		at := now()
		if state == publishDone {
			if err := movePublish(ctx, tx, pubID, publishDone, publishChange{ConfirmedAt: &at}); err != nil {
				return err
			}
			pub, err := scanPublish(tx.QueryRow(ctx, "SELECT "+publishColumns+" FROM publishes WHERE id = $1", pubID))
			if err != nil {
				return fmt.Errorf("reload publish: %w", err)
			}
			hashes := map[string]string{}
			for lang, b := range pub.Bundles {
				hashes[lang] = b["sha256"]
			}
			payload := map[string]any{"event_id": "evt_pub_" + pubID, "type": "locale.published", "project": p.Slug, "branch": pub.Branch,
				"publish_id": pubID, "pull_request": map[string]any{"number": pr.Number, "url": pr.URL}, "languages": pub.Languages,
				"bundles": hashes, "published_at": fmtTime(at)}
			if err := a.queueEvent(ctx, tx, p, "evt_pub_"+pubID, "locale.published", payload); err != nil {
				return err
			}
			return a.audit(ctx, tx, "system", "publish.published", p, fmt.Sprintf("%s: pull request #%d", pub.Branch, pr.Number))
		}
		if err := movePublish(ctx, tx, pubID, publishFailed, publishChange{Reason: &reason}); err != nil {
			return err
		}
		return a.audit(ctx, tx, "system", "publish.failed", p, reason)
	})
	if ae := asAPIError(err); err != nil && (ae == nil || ae.Code != "not_found") {
		log.Printf("publish %s: finish as %s: %v", pubID, state, err)
	}
}

func (a *App) handleTokens(w http.ResponseWriter, r *http.Request) error {
	_, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	rows, err := a.pool.Query(r.Context(), "SELECT id, label, created_at FROM tokens WHERE project_id = $1 ORDER BY seq", p.ID)
	if err != nil {
		return fmt.Errorf("list tokens: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, label string
		var at time.Time
		if err := rows.Scan(&id, &label, &at); err != nil {
			return fmt.Errorf("scan token: %w", err)
		}
		out = append(out, map[string]any{"id": id, "label": label, "created_at": fmtTime(at)})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": out})
	return nil
}

func (a *App) handleCreateToken(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	var in struct {
		Label string `json:"label"`
	}
	if err := decodeJSON(r, &in); err != nil {
		return err
	}
	if n := utf8.RuneCountInString(in.Label); n < 1 || n > 80 {
		return errField("label", "Use 1 to 80 characters.")
	}
	ctx := r.Context()
	id := newID()
	token := "idk_" + randomString(40)
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO tokens (id, project_id, label, token_hash, created_at) VALUES ($1, $2, $3, $4, $5)",
			id, p.ID, in.Label, tokenHash(token), time.Now().UTC()); err != nil {
			return fmt.Errorf("create token: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "token.created", p, in.Label)
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "label": in.Label, "token": token})
	return nil
}

func (a *App) handleRevokeToken(w http.ResponseWriter, r *http.Request) error {
	pr, p, err := a.ownerProject(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	err = a.inProject(ctx, p.ID, func(tx pgx.Tx) error {
		var label string
		err := tx.QueryRow(ctx, "DELETE FROM tokens WHERE id = $1 AND project_id = $2 RETURNING label", r.PathValue("id"), p.ID).Scan(&label)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotFound()
		}
		if err != nil {
			return fmt.Errorf("revoke token: %w", err)
		}
		return a.audit(ctx, tx, pr.Email, "token.revoked", p, label)
	})
	if err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// handleLocalePull serves main's approved strings to CI; it accepts only a project token.
func (a *App) handleLocalePull(w http.ResponseWriter, r *http.Request) error {
	header := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || token == "" {
		return errUnauthenticated()
	}
	var tokenProject, label string
	err := a.pool.QueryRow(r.Context(), "SELECT project_id, label FROM tokens WHERE token_hash = $1", tokenHash(token)).Scan(&tokenProject, &label)
	if errors.Is(err, pgx.ErrNoRows) {
		return errUnauthenticated()
	}
	if err != nil {
		return fmt.Errorf("look up token: %w", err)
	}
	p, err := projectBySlug(r.Context(), a.pool, r.PathValue("slug"))
	if err != nil {
		return err
	}
	lang, isJSON := strings.CutSuffix(r.PathValue("file"), ".json")
	if p.ID != tokenProject || !isJSON || !slices.Contains(p.TargetLanguages, lang) {
		return errNotFound()
	}
	main, err := mainBranch(r.Context(), a.pool, p.ID)
	if err != nil {
		return err
	}
	strs, err := approvedStrings(r.Context(), a.pool, p, main.ID)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	writeBody(w, buildBundle(strs[lang]))
	return nil
}
