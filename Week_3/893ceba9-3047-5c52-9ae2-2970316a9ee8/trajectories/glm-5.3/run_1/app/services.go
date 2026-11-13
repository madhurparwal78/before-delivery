package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// GitHost is the repository host stand-in.
type GitHost struct {
	BaseURL string
	Client  *http.Client
}

type PullRequest struct {
	Number int    `json:"number"`
	URL    string `json:"html_url"`
	State  string `json:"state"`
}

func NewGitHost(cfg Config) *GitHost {
	return &GitHost{BaseURL: cfg.GitHostURL, Client: &http.Client{Timeout: 5 * time.Second}}
}

func (g *GitHost) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.BaseURL+"/git/v1/health", nil)
	if err != nil {
		return err
	}
	resp, err := g.Client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("git health status %d", resp.StatusCode)
	}
	return nil
}

type pullRequestFiles struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func (g *GitHost) OpenPullRequest(ctx context.Context, repo, publishID string, files []pullRequestFiles) (PullRequest, error) {
	body := map[string]any{
		"title": "Interline Desk publish " + publishID,
		"head":  "interline/" + publishID,
		"base":  "main",
		"files": files,
	}
	buf, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.BaseURL+"/git/v1/repos/"+repo+"/pulls", bytes.NewReader(buf))
	if err != nil {
		return PullRequest{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.Client.Do(req)
	if err != nil {
		return PullRequest{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == 201 {
		var pr PullRequest
		if err := json.Unmarshal(raw, &pr); err != nil {
			return PullRequest{}, errBadBody
		}
		return pr, nil
	}
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return PullRequest{}, errPullRejected
	}
	return PullRequest{}, errGitDown
}

func (g *GitHost) ReadPullRequest(ctx context.Context, repo string, number int) (PullRequest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/git/v1/repos/%s/pulls/%d", g.BaseURL, repo, number), nil)
	if err != nil {
		return PullRequest{}, err
	}
	resp, err := g.Client.Do(req)
	if err != nil {
		return PullRequest{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return PullRequest{}, errGitDown
	}
	var pr PullRequest
	if err := json.Unmarshal(raw, &pr); err != nil {
		return PullRequest{}, errBadBody
	}
	return pr, nil
}

// AIEngine is the drafting engine stand-in.
type AIEngine struct {
	BaseURL string
	Client  *http.Client
}

type DraftResult struct {
	Draft  string    `json:"draft"`
	Issues []IssueIn `json:"issues"`
}

func NewAIEngine(cfg Config) *AIEngine {
	return &AIEngine{BaseURL: cfg.AIEngineURL, Client: &http.Client{Timeout: 5 * time.Second}}
}

func (a *AIEngine) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.BaseURL+"/ai/v1/health", nil)
	if err != nil {
		return err
	}
	resp, err := a.Client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("ai health status %d", resp.StatusCode)
	}
	return nil
}

func (a *AIEngine) Draft(ctx context.Context, engine, sourceLang, targetLang, key, text string) (DraftResult, error) {
	body := map[string]string{"key": key, "text": text}
	buf, _ := json.Marshal(body)
	url := fmt.Sprintf("%s/ai/v1/draft?engine=%s&source=%s&target=%s", a.BaseURL, engine, sourceLang, targetLang)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return DraftResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.Client.Do(req)
	if err != nil {
		return DraftResult{}, errAIDown
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return DraftResult{}, errAIDown
	}
	var res struct {
		Draft  *string   `json:"draft"`
		Issues []IssueIn `json:"issues"`
	}
	if err := json.Unmarshal(raw, &res); err != nil || res.Draft == nil {
		return DraftResult{}, errAIDown
	}
	return DraftResult{Draft: *res.Draft, Issues: res.Issues}, nil
}

// SvixService manages applications, endpoints and messages.
type SvixService struct {
	BaseURL string
	APIKey  string
	Client  *http.Client
}

func NewSvix(cfg Config) *SvixService {
	return &SvixService{BaseURL: cfg.SvixURL, APIKey: cfg.SvixAPIKey, Client: &http.Client{Timeout: 5 * time.Second}}
}

func (s *SvixService) do(ctx context.Context, method, path string, body any) ([]byte, int, error) {
	var reader io.Reader
	if body != nil {
		switch b := body.(type) {
		case []byte:
			reader = bytes.NewReader(b)
		default:
			buf, _ := json.Marshal(body)
			reader = bytes.NewReader(buf)
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, s.BaseURL+path, reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+s.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := s.Client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return raw, resp.StatusCode, nil
}

func (s *SvixService) Health(ctx context.Context) error {
	_, status, err := s.do(ctx, http.MethodGet, "/api/v1/health/", nil)
	if err != nil {
		return err
	}
	if status != 200 {
		return fmt.Errorf("svix health status %d", status)
	}
	return nil
}

// EnsureEventTypes creates the two event types once per Svix server.
func (s *SvixService) EnsureEventTypes(ctx context.Context) {
	for _, et := range []string{"locale.published", "review.completed"} {
		body := map[string]string{"name": et, "description": "Interline Desk event"}
		buf, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.BaseURL+"/api/v1/event-type", bytes.NewReader(buf))
		if err != nil {
			continue
		}
		req.Header.Set("Authorization", "Bearer "+s.APIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := s.Client.Do(req)
		if err != nil {
			_ = resp
			continue
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
}

type svixEndpointResponse struct {
	ID string `json:"id"`
}

// UpsertEndpoint creates or reuses the application and its endpoint, and
// returns the endpoint's signing secret.
func (s *SvixService) UpsertEndpoint(ctx context.Context, projectID, name, callbackURL string) (endpointID, signingSecret string, err error) {
	appUID := "idk-" + projectID
	body := map[string]string{"uid": appUID, "name": name}
	buf, _ := json.Marshal(body)
	if _, status, cerr := s.do(ctx, http.MethodPost, "/api/v1/app", buf); cerr != nil && status != 201 && status != 200 && status != 409 {
		return "", "", cerr
	}
	// find or create the endpoint for this URL
	raw, status, err := s.do(ctx, http.MethodGet, "/api/v1/app/"+appUID+"/endpoint", nil)
	if err != nil {
		return "", "", err
	}
	var listResp struct {
		Data []struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		} `json:"data"`
	}
	if status == 200 {
		_ = json.Unmarshal(raw, &listResp)
	}
	var existingID string
	for _, e := range listResp.Data {
		if e.URL == callbackURL {
			existingID = e.ID
			break
		}
	}
	if existingID != "" {
		secret, err := s.endpointSecret(ctx, appUID, existingID)
		if err != nil {
			return "", "", err
		}
		return existingID, secret, nil
	}
	epBody := map[string]any{
		"url":        callbackURL,
		"eventTypes": []string{"locale.published", "review.completed"},
	}
	raw, status, err = s.do(ctx, http.MethodPost, "/api/v1/app/"+appUID+"/endpoint", epBody)
	if err != nil {
		return "", "", err
	}
	if status != 201 && status != 200 {
		return "", "", fmt.Errorf("svix endpoint status %d", status)
	}
	var ep svixEndpointResponse
	if err := json.Unmarshal(raw, &ep); err != nil {
		return "", "", err
	}
	secret, err := s.endpointSecret(ctx, appUID, ep.ID)
	if err != nil {
		return "", "", err
	}
	return ep.ID, secret, nil
}

// endpointSecret reads the endpoint's signing secret from Svix.
func (s *SvixService) endpointSecret(ctx context.Context, appUID, endpointID string) (string, error) {
	raw, status, err := s.do(ctx, http.MethodGet, "/api/v1/app/"+appUID+"/endpoint/"+endpointID+"/secret/", nil)
	if err != nil {
		return "", err
	}
	if status != 200 {
		return "", fmt.Errorf("svix secret status %d", status)
	}
	var out struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", err
	}
	return out.Key, nil
}

func (s *SvixService) DeleteApplication(ctx context.Context, projectID string) error {
	_, _, err := s.do(ctx, http.MethodDelete, "/api/v1/app/idk-"+projectID, nil)
	return err
}

func (s *SvixService) SendMessage(ctx context.Context, projectID, eventType, eventID string, payload map[string]any) error {
	msg := map[string]any{
		"eventType": eventType,
		"eventId":   eventID,
		"payload":   payload,
	}
	raw, status, err := s.do(ctx, http.MethodPost, "/api/v1/app/idk-"+projectID+"/msg", msg)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("svix message status %d: %s", status, string(raw))
	}
	return nil
}

var (
	errGitDown      = fmt.Errorf("git host unavailable")
	errPullRejected = fmt.Errorf("pull request rejected")
	errAIDown       = fmt.Errorf("ai engine unavailable")
	errBadBody      = fmt.Errorf("bad body from stand-in")
)
