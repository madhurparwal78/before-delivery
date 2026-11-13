// Package githost opens and reads pull requests on the client's repository host.
package githost

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ErrUnavailable means the host could not be reached or answered 5xx.
var ErrUnavailable = errors.New("repository host is not answering")

// ErrRejected means the host refused the pull request.
var ErrRejected = errors.New("repository host rejected the pull request")

type Client struct {
	baseURL string
	http    *http.Client
}

func New(baseURL string) *Client {
	return &Client{baseURL: baseURL, http: &http.Client{Timeout: 5 * time.Second}}
}

type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type PullRequest struct {
	Number  int    `json:"number"`
	HTMLURL string `json:"html_url"`
	State   string `json:"state"`
	Merged  bool   `json:"merged"`
}

// Bundle is one locale file offered to the pull request.
func Bundle(path string, content []byte) File {
	return File{Path: path, Content: base64.StdEncoding.EncodeToString(content)}
}

func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/git/v1/health", nil)
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

// OpenPullRequest asks the host for a pull request carrying the bundles.
func (c *Client) OpenPullRequest(ctx context.Context, repository, publishID string, files []File) (*PullRequest, error) {
	body, err := json.Marshal(map[string]any{
		"title": "Interline Desk publish " + publishID,
		"head":  "interline/" + publishID,
		"base":  "main",
		"files": files,
	})
	if err != nil {
		return nil, fmt.Errorf("encode pull request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/git/v1/repos/%s/pulls", c.baseURL, repository), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build pull request: %w", err)
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
	switch {
	case resp.StatusCode == http.StatusCreated:
		pr := &PullRequest{}
		if err := json.Unmarshal(read, pr); err != nil || pr.Number == 0 {
			return nil, fmt.Errorf("%w: unreadable pull request", ErrRejected)
		}
		return pr, nil
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return nil, ErrRejected
	default:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
}

// ReadPullRequest asks the host to confirm a pull request it opened.
func (c *Client) ReadPullRequest(ctx context.Context, repository string, number int) (*PullRequest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/git/v1/repos/%s/pulls/%d", c.baseURL, repository, number), nil)
	if err != nil {
		return nil, fmt.Errorf("build pull request read: %w", err)
	}
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
	pr := &PullRequest{}
	if err := json.Unmarshal(read, pr); err != nil {
		return nil, fmt.Errorf("%w: unreadable answer", ErrUnavailable)
	}
	return pr, nil
}
