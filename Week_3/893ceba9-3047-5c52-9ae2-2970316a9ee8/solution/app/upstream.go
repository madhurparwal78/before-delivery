package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const upstreamTimeout = 5 * time.Second

// Upstream is an HTTP service the app calls: the Git host or the AI engine (WireMock stands in for both).
type Upstream struct {
	base   string
	client *http.Client
}

func newUpstream(base string) *Upstream {
	return &Upstream{base: strings.TrimRight(base, "/"), client: &http.Client{Timeout: upstreamTimeout}}
}

// call sends one request and returns the status and body; any transport failure is an error.
func (u *Upstream) call(ctx context.Context, method, path string, query url.Values, body any) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("encode request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	full := u.base + path
	if len(query) > 0 {
		full += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, full, reader)
	if err != nil {
		return 0, nil, fmt.Errorf("build request: %w", bareErr(err))
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%s %s: %w", method, path, bareErr(err))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("read %s: %w", path, err)
	}
	return resp.StatusCode, data, nil
}

func (u *Upstream) healthy(ctx context.Context, path string) bool {
	status, _, err := u.call(ctx, http.MethodGet, path, nil, nil)
	return err == nil && status == http.StatusOK
}

// Svix talks to the webhook service.
type Svix struct {
	base   string
	key    string
	client *http.Client
}

var errSvixDown = errors.New("webhook service unavailable")

func newSvix(cfg Config) *Svix {
	return &Svix{base: strings.TrimRight(cfg.SvixURL, "/"), key: cfg.SvixAPIKey, client: &http.Client{Timeout: upstreamTimeout}}
}

// call returns the status and body; transport failures and 5xx answers are errSvixDown.
func (s *Svix) call(ctx context.Context, method, path string, body any, headers map[string]string) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("encode request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.base+path, reader)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", errSvixDown, bareErr(err))
	}
	req.Header.Set("Authorization", "Bearer "+s.key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", errSvixDown, bareErr(err))
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("%w: read %s: %v", errSvixDown, path, bareErr(err))
	}
	if resp.StatusCode >= 500 {
		return resp.StatusCode, data, fmt.Errorf("%w: %s answered %d", errSvixDown, path, resp.StatusCode)
	}
	return resp.StatusCode, data, nil
}

func (s *Svix) healthy(ctx context.Context) bool {
	status, _, err := s.call(ctx, http.MethodGet, "/api/v1/health/", nil, nil)
	return err == nil && status == http.StatusOK
}

func svixUID(projectID string) string { return "idk-" + projectID }

// saveEndpoint makes sure the project's application exists and has exactly one endpoint for url.
func (s *Svix) saveEndpoint(ctx context.Context, projectID, name, endpointURL string) (endpointID, secret string, err error) {
	uid := svixUID(projectID)
	for _, name := range webhookEventTypes {
		status, body, err := s.call(ctx, http.MethodPost, "/api/v1/event-type/", map[string]any{"name": name, "description": "Interline Desk " + name}, nil)
		if err != nil {
			return "", "", err
		}
		if status >= 300 && status != http.StatusConflict {
			return "", "", fmt.Errorf("create event type %s: status %d: %s", name, status, body)
		}
	}
	status, body, err := s.call(ctx, http.MethodPost, "/api/v1/app/?get_if_exists=true", map[string]any{"name": name, "uid": uid}, nil)
	if err != nil {
		return "", "", err
	}
	if status >= 300 {
		return "", "", fmt.Errorf("create application: status %d: %s", status, body)
	}
	status, body, err = s.call(ctx, http.MethodGet, "/api/v1/app/"+uid+"/endpoint/", nil, nil)
	if err != nil {
		return "", "", err
	}
	var listing struct {
		Data []struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		} `json:"data"`
	}
	if status >= 300 || json.Unmarshal(body, &listing) != nil {
		return "", "", fmt.Errorf("list endpoints: status %d: %s", status, body)
	}
	spec := map[string]any{"url": endpointURL, "filterTypes": []string{"locale.published", "review.completed"}, "version": 1}
	for _, ep := range listing.Data {
		if ep.URL == endpointURL {
			endpointID = ep.ID
		}
	}
	if endpointID == "" && len(listing.Data) > 0 {
		endpointID = listing.Data[0].ID
		status, body, err = s.call(ctx, http.MethodPut, "/api/v1/app/"+uid+"/endpoint/"+endpointID+"/", spec, nil)
	} else if endpointID == "" {
		status, body, err = s.call(ctx, http.MethodPost, "/api/v1/app/"+uid+"/endpoint/", spec, nil)
		var created struct {
			ID string `json:"id"`
		}
		if err == nil && status < 300 {
			if err := json.Unmarshal(body, &created); err != nil {
				return "", "", fmt.Errorf("read created endpoint: %w", err)
			}
			endpointID = created.ID
		}
	}
	if err != nil {
		return "", "", err
	}
	if status >= 300 {
		return "", "", fmt.Errorf("save endpoint: status %d: %s", status, body)
	}
	status, body, err = s.call(ctx, http.MethodGet, "/api/v1/app/"+uid+"/endpoint/"+endpointID+"/secret/", nil, nil)
	if err != nil {
		return "", "", err
	}
	var key struct {
		Key string `json:"key"`
	}
	if status >= 300 || json.Unmarshal(body, &key) != nil || key.Key == "" {
		return "", "", fmt.Errorf("read signing secret: status %d: %s", status, body)
	}
	return endpointID, key.Key, nil
}

// send creates one message; the event id is both the Svix message id and the idempotency key.
func (s *Svix) send(ctx context.Context, projectID, eventID, eventType string, payload json.RawMessage) error {
	status, body, err := s.call(ctx, http.MethodPost, "/api/v1/app/"+svixUID(projectID)+"/msg/",
		map[string]any{"eventType": eventType, "eventId": eventID, "payload": payload},
		map[string]string{"idempotency-key": eventID})
	if err != nil {
		return err
	}
	if status == http.StatusConflict {
		return nil
	}
	if status >= 300 {
		return fmt.Errorf("send message: status %d: %s", status, body)
	}
	return nil
}

func (s *Svix) deleteApp(ctx context.Context, projectID string) error {
	status, body, err := s.call(ctx, http.MethodDelete, "/api/v1/app/"+svixUID(projectID)+"/", nil, nil)
	if err != nil {
		return err
	}
	if status >= 300 && status != http.StatusNotFound {
		return fmt.Errorf("delete application: status %d: %s", status, body)
	}
	return nil
}

// probe reports each service's health, cached for a few seconds.
type probe struct {
	mu      sync.Mutex
	checked time.Time
	result  map[string]string
}

const probeTTL = 10 * time.Second

func (a *App) integrations(ctx context.Context) map[string]string {
	a.probe.mu.Lock()
	defer a.probe.mu.Unlock()
	if a.probe.result != nil && time.Since(a.probe.checked) < probeTTL {
		return a.probe.result
	}
	var wg sync.WaitGroup
	var git, ai, hooks bool
	wg.Add(3)
	go func() { defer wg.Done(); git = a.git.healthy(ctx, "/git/v1/health") }()
	go func() { defer wg.Done(); ai = a.ai.healthy(ctx, "/ai/v1/health") }()
	go func() { defer wg.Done(); hooks = a.svix.healthy(ctx) }()
	wg.Wait()
	word := func(up bool) string {
		if up {
			return "up"
		}
		return "down"
	}
	a.probe.result = map[string]string{"git_host": word(git), "ai_engine": word(ai), "webhooks": word(hooks)}
	a.probe.checked = time.Now()
	return a.probe.result
}

func (a *App) handleIntegrations(w http.ResponseWriter, r *http.Request) error {
	if _, err := a.authn(r); err != nil {
		return err
	}
	probeCtx, cancel := detached(r.Context())
	defer cancel()
	writeJSON(w, http.StatusOK, a.integrations(probeCtx))
	return nil
}
