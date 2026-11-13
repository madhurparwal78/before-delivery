// Package svixclient registers webhook endpoints and hands signed messages to
// Svix, which signs and retries every delivery.
package svixclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ErrUnavailable means Svix did not answer, so events wait in the app.
var ErrUnavailable = errors.New("webhook service is not answering")

// EventTypes are the only two events the desk sends.
var EventTypes = []string{"locale.published", "review.completed"}

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func New(baseURL, apiKey string) *Client {
	return &Client{baseURL: baseURL, apiKey: apiKey, http: &http.Client{Timeout: 5 * time.Second}}
}

type Endpoint struct {
	AppID         string
	EndpointID    string
	SigningSecret string
}

func (c *Client) Health(ctx context.Context) error {
	status, _, err := c.call(ctx, http.MethodGet, "/api/v1/health/", nil, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusNoContent {
		return fmt.Errorf("%w: status %d", ErrUnavailable, status)
	}
	return nil
}

// EnsureEndpoint creates or reuses the project's application and endpoint.
func (c *Client) EnsureEndpoint(ctx context.Context, appUID, appName, url, endpointID string) (*Endpoint, error) {
	if err := c.ensureEventTypes(ctx); err != nil {
		return nil, err
	}
	appID, err := c.ensureApplication(ctx, appUID, appName)
	if err != nil {
		return nil, err
	}
	body := map[string]any{"url": url, "version": 1, "filterTypes": EventTypes, "uid": appUID + "-endpoint"}
	path := fmt.Sprintf("/api/v1/app/%s/endpoint/", appID)
	method := http.MethodPost
	if endpointID != "" {
		path = fmt.Sprintf("/api/v1/app/%s/endpoint/%s/", appID, endpointID)
		method = http.MethodPut
	}
	status, read, err := c.call(ctx, method, path, body, nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusConflict && endpointID == "" {
		status, read, err = c.call(ctx, http.MethodPut,
			fmt.Sprintf("/api/v1/app/%s/endpoint/%s/", appID, appUID+"-endpoint"), body, nil)
		if err != nil {
			return nil, err
		}
	}
	if status != http.StatusOK && status != http.StatusCreated {
		return nil, fmt.Errorf("%w: endpoint status %d: %s", ErrUnavailable, status, string(read))
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(read, &created); err != nil {
		return nil, fmt.Errorf("%w: unreadable endpoint", ErrUnavailable)
	}
	secret, err := c.endpointSecret(ctx, appID, created.ID)
	if err != nil {
		return nil, err
	}
	return &Endpoint{AppID: appID, EndpointID: created.ID, SigningSecret: secret}, nil
}

func (c *Client) ensureEventTypes(ctx context.Context) error {
	for _, eventType := range EventTypes {
		body := map[string]any{"name": eventType, "description": "Interline Desk " + eventType}
		status, read, err := c.call(ctx, http.MethodPost, "/api/v1/event-type/", body, nil)
		if err != nil {
			return err
		}
		if status != http.StatusOK && status != http.StatusCreated && status != http.StatusConflict {
			return fmt.Errorf("%w: event type status %d: %s", ErrUnavailable, status, string(read))
		}
	}
	return nil
}

func (c *Client) ensureApplication(ctx context.Context, appUID, appName string) (string, error) {
	body := map[string]any{"name": appName, "uid": appUID}
	status, read, err := c.call(ctx, http.MethodPost, "/api/v1/app/?get_if_exists=true", body, nil)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK && status != http.StatusCreated {
		return "", fmt.Errorf("%w: application status %d: %s", ErrUnavailable, status, string(read))
	}
	var app struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(read, &app); err != nil {
		return "", fmt.Errorf("%w: unreadable application", ErrUnavailable)
	}
	return app.ID, nil
}

func (c *Client) endpointSecret(ctx context.Context, appID, endpointID string) (string, error) {
	status, read, err := c.call(ctx, http.MethodGet,
		fmt.Sprintf("/api/v1/app/%s/endpoint/%s/secret/", appID, endpointID), nil, nil)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("%w: secret status %d", ErrUnavailable, status)
	}
	var secret struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(read, &secret); err != nil {
		return "", fmt.Errorf("%w: unreadable secret", ErrUnavailable)
	}
	return secret.Key, nil
}

// SendMessage hands one event to Svix. The event id is the message id and the
// idempotency key, so a retry never creates a second message.
func (c *Client) SendMessage(ctx context.Context, appUID, eventType, eventID string, payload any) error {
	body := map[string]any{"eventType": eventType, "eventId": eventID, "payload": payload}
	status, read, err := c.call(ctx, http.MethodPost, fmt.Sprintf("/api/v1/app/%s/msg/", appUID), body,
		map[string]string{"idempotency-key": eventID})
	if err != nil {
		return err
	}
	if status == http.StatusConflict {
		return nil
	}
	if status != http.StatusOK && status != http.StatusCreated && status != http.StatusAccepted {
		return fmt.Errorf("%w: message status %d: %s", ErrUnavailable, status, string(read))
	}
	return nil
}

// DeleteApplication removes a project's application and its endpoints.
func (c *Client) DeleteApplication(ctx context.Context, appUID string) error {
	status, read, err := c.call(ctx, http.MethodDelete, "/api/v1/app/"+appUID+"/", nil, nil)
	if err != nil {
		return err
	}
	if status != http.StatusNoContent && status != http.StatusOK && status != http.StatusNotFound {
		return fmt.Errorf("%w: delete status %d: %s", ErrUnavailable, status, string(read))
	}
	return nil
}

func (c *Client) call(ctx context.Context, method, path string, body any, headers map[string]string) (int, []byte, error) {
	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("encode webhook request: %w", err)
		}
		payload = encoded
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return 0, nil, fmt.Errorf("build webhook request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	read, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if resp.StatusCode >= 500 {
		return resp.StatusCode, read, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	return resp.StatusCode, read, nil
}
