// Package aiengine asks the routed AI engine for one draft at a time.
package aiengine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// ErrUnavailable means the engine failed, so drafting stops.
var ErrUnavailable = errors.New("AI engine is not answering")

type Client struct {
	baseURL string
	http    *http.Client
}

func New(baseURL string) *Client {
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: 5 * time.Second}}
}

type Draft struct {
	Text   string
	Issues []domain.Issue
}

func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/ai/v1/health", nil)
	if err != nil {
		return fmt.Errorf("build health request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	return nil
}

type draftAnswer struct {
	Draft  *string        `json:"draft"`
	Issues []domain.Issue `json:"issues"`
}

// Draft asks the engine routed for a language to draft one segment.
func (c *Client) Draft(ctx context.Context, engine, sourceLang, targetLang, keyName, text string) (*Draft, error) {
	body, err := json.Marshal(map[string]string{"key": keyName, "text": text})
	if err != nil {
		return nil, fmt.Errorf("encode draft request: %w", err)
	}
	query := url.Values{"engine": {engine}, "source": {sourceLang}, "target": {targetLang}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/ai/v1/draft?"+query.Encode(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build draft request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	read, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	answer := draftAnswer{}
	if err := json.Unmarshal(read, &answer); err != nil || answer.Draft == nil {
		return nil, fmt.Errorf("%w: unreadable draft", ErrUnavailable)
	}
	draft := &Draft{Text: *answer.Draft}
	for _, issue := range answer.Issues {
		if domain.ValidIssueCategory(issue.Category) && domain.ValidIssueSeverity(issue.Severity) {
			draft.Issues = append(draft.Issues, issue)
		}
	}
	return draft, nil
}
