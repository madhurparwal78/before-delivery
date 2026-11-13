package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/marlowquill/interline-desk/internal/domain"
	"github.com/marlowquill/interline-desk/internal/githost"
	"github.com/marlowquill/interline-desk/internal/store"
)

const timeLayout = "2006-01-02T15:04:05Z"

func publishBody(p *store.Publish) map[string]any {
	return map[string]any{
		"id": p.ID, "branch": p.Branch, "state": p.State, "failure_reason": p.FailureReason,
		"languages": p.Languages, "pull_request": p.PullRequest, "bundles": p.Bundles,
		"created_at": p.CreatedAt, "confirmed_at": p.ConfirmedAt,
	}
}

func (s *Server) handleCreatePublish(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return errPayloadTooLarge()
	}
	key := r.Header.Get("Idempotency-Key")
	if !idempotencyKey.MatchString(key) {
		return errField("Idempotency-Key", "Send an Idempotency-Key of 1 to 64 visible ASCII characters.")
	}
	sum := sha256.Sum256(raw)
	bodyHash := hex.EncodeToString(sum[:])
	ctx := r.Context()
	status, storedHash, storedBody, err := s.store.StoredResponse(ctx, c.project.ID, key)
	switch {
	case err == nil && storedHash == bodyHash:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(storedBody)
		return nil
	case err == nil:
		return errConflict("idempotency_key_reused", "That Idempotency-Key was used with a different request.")
	case !errors.Is(err, store.ErrNotFound):
		return errInternal(err)
	}

	var body struct {
		Branch string `json:"branch"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			return errField("body", "That request body is not valid JSON.")
		}
	}
	if body.Branch == "" {
		return errField("branch", "Choose the branch to publish.")
	}
	branch, fail := s.branchFor(r, c.project, body.Branch)
	if fail != nil {
		return fail
	}
	if fail := requireLive(branch); fail != nil {
		return fail
	}
	publish := &store.Publish{ID: store.NewID(), Branch: branch.Name, State: "queued",
		Languages: c.project.TargetLanguages, CreatedAt: store.Now(), Bundles: map[string]store.Bundle{}}
	if err := s.store.ClaimPublish(ctx, c.project.ID, publish); err != nil {
		if errors.Is(err, store.ErrPublishInProgress) {
			return errConflict("publish_in_progress", "Another publish is still running for this project.")
		}
		return errInternal(err)
	}
	bundles, files, fail := s.writeBundles(ctx, c.project, publish.ID, branch.Name)
	if fail != nil {
		if err := s.store.DropPublish(ctx, c.project.ID, publish.ID); err != nil {
			return errInternal(err)
		}
		return fail
	}
	publish.Bundles = bundles
	if err := s.store.SetPublishBundles(ctx, c.project.ID, publish.ID, bundles); err != nil {
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "publish.queued", c.project.Slug,
		branch.Name, &c.project.ID); err != nil {
		return errInternal(err)
	}
	encoded, err := json.Marshal(publishBody(publish))
	if err != nil {
		return errInternal(err)
	}
	if err := s.store.StoreResponse(ctx, c.project.ID, key, bodyHash, http.StatusAccepted, encoded); err != nil {
		return errInternal(err)
	}

	project := *c.project
	go s.runPublish(&project, publish.ID, branch.Name, bundles, files)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write(encoded)
	return nil
}

// writeBundles stores one bundle per target language. A publish that cannot
// store its bundles is rejected and changes nothing.
func (s *Server) writeBundles(ctx context.Context, project *store.Project, publishID, branchName string) (map[string]store.Bundle, []githost.File, *apiError) {
	bundles := map[string]store.Bundle{}
	var files []githost.File
	storeCtx, cancel := withTimeout(ctx, 20*time.Second)
	defer cancel()
	for _, language := range project.TargetLanguages {
		values, err := s.store.ApprovedStrings(ctx, s.store.Pool, project.ID, branchName, language)
		if err != nil {
			return nil, nil, errInternal(err)
		}
		content := domain.Bundle(values)
		sum := sha256.Sum256(content)
		objectKey := fmt.Sprintf("projects/%s/publishes/%s/%s.json", project.ID, publishID, language)
		if err := s.objects.Put(storeCtx, objectKey, "application/json", content); err != nil {
			return nil, nil, errStorageUnavailable()
		}
		bundles[language] = store.Bundle{ObjectKey: objectKey, SHA256: hex.EncodeToString(sum[:])}
		files = append(files, githost.Bundle("locales/"+language+".json", content))
	}
	return bundles, files, nil
}

// runPublish opens the pull request and waits for the host to confirm it. The
// instance that accepted the publish carries it out.
func (s *Server) runPublish(project *store.Project, publishID, branchName string, bundles map[string]store.Bundle, files []githost.File) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var pr *githost.PullRequest
	var err error
	for attempt := 1; attempt <= 3; attempt++ {
		pr, err = s.git.OpenPullRequest(ctx, project.Repository, publishID, files)
		if err == nil || errors.Is(err, githost.ErrRejected) {
			break
		}
		if attempt < 3 {
			time.Sleep(2 * time.Second)
		}
	}
	switch {
	case errors.Is(err, githost.ErrRejected):
		s.failPublish(ctx, project, publishID, "pull_request_rejected")
		return
	case err != nil:
		s.prober.Invalidate()
		s.failPublish(ctx, project, publishID, "git_host_unavailable")
		return
	}
	if err := s.store.SetPublishAwaiting(ctx, publishID, pr.Number, pr.HTMLURL); err != nil {
		log.Printf("publish %s: mark awaiting: %v", publishID, err)
		return
	}

	deadline := time.Now().Add(publishTimeout)
	for time.Now().Before(deadline) {
		time.Sleep(2 * time.Second)
		confirmed, err := s.git.ReadPullRequest(ctx, project.Repository, pr.Number)
		if err != nil || confirmed.Number != pr.Number {
			continue
		}
		if confirmed.State != "open" && confirmed.State != "merged" {
			continue
		}
		at := store.Now()
		if err := s.store.SetPublishPublished(ctx, publishID, at); err != nil {
			log.Printf("publish %s: mark published: %v", publishID, err)
			return
		}
		if err := s.store.AddAudit(ctx, s.store.Pool, "system", "publish.published", project.Slug,
			fmt.Sprintf("pull request #%d", pr.Number), &project.ID); err != nil {
			log.Printf("publish %s: audit: %v", publishID, err)
		}
		s.queueLocalePublished(ctx, project, publishID, branchName, pr, bundles, at)
		return
	}
	s.failPublish(ctx, project, publishID, "not_confirmed")
}

func (s *Server) failPublish(ctx context.Context, project *store.Project, publishID, reason string) {
	if err := s.store.SetPublishFailed(ctx, publishID, reason); err != nil {
		log.Printf("publish %s: mark failed: %v", publishID, err)
		return
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, "system", "publish.failed", project.Slug, reason,
		&project.ID); err != nil {
		log.Printf("publish %s: audit: %v", publishID, err)
	}
}

func (s *Server) queueLocalePublished(ctx context.Context, project *store.Project, publishID, branchName string, pr *githost.PullRequest, bundles map[string]store.Bundle, at time.Time) {
	hook, err := s.store.Webhook(ctx, project.ID)
	if errors.Is(err, store.ErrNotFound) {
		return
	}
	if err != nil {
		log.Printf("publish %s: read webhook endpoint: %v", publishID, err)
		return
	}
	digests := map[string]string{}
	for language, bundle := range bundles {
		digests[language] = bundle.SHA256
	}
	eventID := "evt_pub_" + publishID
	payload := map[string]any{
		"event_id": eventID, "type": "locale.published", "project": project.Slug, "branch": branchName,
		"publish_id": publishID, "pull_request": map[string]any{"number": pr.Number, "url": pr.HTMLURL},
		"languages": project.TargetLanguages, "bundles": digests, "published_at": at.Format(timeLayout),
	}
	if err := s.store.QueueEvent(ctx, project.ID, eventID, "locale.published", hook.AppUID, payload); err != nil {
		log.Printf("publish %s: queue event: %v", publishID, err)
		return
	}
	s.notifyEventQueued(eventID)
}

func (s *Server) handleListPublishes(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	publishes, err := s.store.Publishes(r.Context(), c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	bodies := []map[string]any{}
	for _, publish := range publishes {
		bodies = append(bodies, publishBody(publish))
	}
	writeJSON(w, http.StatusOK, map[string]any{"publishes": bodies})
	return nil
}

func (s *Server) handleGetPublish(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	publish, err := s.store.PublishByID(r.Context(), c.project.ID, r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound()
	}
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, publishBody(publish))
	return nil
}

func (s *Server) handleListTokens(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	tokens, err := s.store.Tokens(r.Context(), c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tokens": tokens})
	return nil
}

func (s *Server) handleCreateToken(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		Label string `json:"label"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	label := strings.TrimSpace(body.Label)
	if !lengthBetween(label, 1, 80) {
		return errField("label", "Give the token a label of 1 to 80 characters.")
	}
	ctx := r.Context()
	id, token, err := s.store.CreateToken(ctx, c.project.ID, label)
	if err != nil {
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "token.created", c.project.Slug, label,
		&c.project.ID); err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "label": label, "token": token})
	return nil
}

func (s *Server) handleRevokeToken(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	ctx := r.Context()
	if err := s.store.RevokeToken(ctx, c.project.ID, r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return errNotFound()
		}
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "token.revoked", c.project.Slug,
		r.PathValue("id"), &c.project.ID); err != nil {
		return errInternal(err)
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// handleCILocale hands CI one language's approved strings in the bundle format.
func (s *Server) handleCILocale(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	if c.project.Slug != r.PathValue("slug") {
		return errNotFound()
	}
	name := r.PathValue("lang")
	if !strings.HasSuffix(name, ".json") {
		return errNotFound()
	}
	language := strings.TrimSuffix(name, ".json")
	if !containsString(c.project.TargetLanguages, language) {
		return errNotFound()
	}
	ctx := r.Context()
	values, err := s.store.ApprovedStrings(ctx, s.store.Pool, c.project.ID, "main", language)
	if err != nil {
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, "ci:"+c.tokenLabel, "locale.pulled", c.project.Slug,
		language, &c.project.ID); err != nil {
		return errInternal(err)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(domain.Bundle(values))
	return nil
}

func (s *Server) handleGetWebhook(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	hook, err := s.store.Webhook(r.Context(), c.project.ID)
	if errors.Is(err, store.ErrNotFound) {
		return errNotFound()
	}
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": hook.URL,
		"event_types":    []string{"locale.published", "review.completed"},
		"signing_secret": hook.SigningSecret})
	return nil
}

func (s *Server) handleSaveWebhook(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	var body struct {
		URL string `json:"url"`
	}
	if fail := readJSON(r, &body); fail != nil {
		return fail
	}
	if !absoluteURL.MatchString(strings.TrimSpace(body.URL)) {
		return errField("url", "Give an absolute http or https URL.")
	}
	ctx := r.Context()
	existing, err := s.store.Webhook(ctx, c.project.ID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return errInternal(err)
	}
	endpointID := ""
	if existing != nil {
		endpointID = existing.EndpointID
	}
	appUID := "idk-" + c.project.ID
	endpoint, err := s.webhooks.EnsureEndpoint(ctx, appUID, c.project.Name, strings.TrimSpace(body.URL), endpointID)
	if err != nil {
		s.prober.Invalidate()
		return errWebhooksUnavailable()
	}
	hook := &store.Webhook{URL: strings.TrimSpace(body.URL), SigningSecret: endpoint.SigningSecret,
		AppUID: appUID, EndpointID: endpoint.EndpointID}
	if err := s.store.SaveWebhook(ctx, c.project.ID, hook); err != nil {
		return errInternal(err)
	}
	if err := s.store.AddAudit(ctx, s.store.Pool, c.user.Email, "webhook.saved", c.project.Slug, hook.URL,
		&c.project.ID); err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": hook.URL,
		"event_types":    []string{"locale.published", "review.completed"},
		"signing_secret": hook.SigningSecret})
	return nil
}

func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request, c *call) *apiError {
	events, err := s.store.Events(r.Context(), c.project.ID)
	if err != nil {
		return errInternal(err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
	return nil
}
