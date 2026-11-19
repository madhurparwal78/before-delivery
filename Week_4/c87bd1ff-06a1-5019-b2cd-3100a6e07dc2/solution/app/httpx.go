package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const bodyLimit = 16384

// apiError is the one error shape every API failure goes through.
type apiError struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	Extra   map[string]any
}

func (e *apiError) Error() string { return e.Code + ": " + e.Message }

func failure(status int, code, message string) *apiError {
	return &apiError{Status: status, Code: code, Message: message}
}

func invalid(field, message string) *apiError {
	return &apiError{Status: 422, Code: "invalid", Message: message, Fields: map[string]string{field: message}}
}

func invalidFields(fields map[string]string) *apiError {
	var first string
	for _, m := range fields {
		first = m
		break
	}
	return &apiError{Status: 422, Code: "invalid", Message: first, Fields: fields}
}

var (
	errSignedOut     = failure(401, "signed_out", "Sign in to continue.")
	errForbidden     = failure(403, "forbidden", "This belongs to another role.")
	errNotFound      = failure(404, "not_found", "That is not in the saleroom.")
	errTransition    = failure(409, "invalid_transition", "That move is not allowed from the current state.")
	errUnexpected    = failure(500, "server_error", "Something went wrong in the saleroom. Try again.")
	errForeignOrigin = failure(403, "forbidden_origin", "Requests must come from the saleroom.")
)

func (e *apiError) body() map[string]any {
	out := map[string]any{"error": e.Code, "message": e.Message}
	if e.Fields != nil {
		out["fields"] = e.Fields
	}
	for k, v := range e.Extra {
		out[k] = v
	}
	return out
}

// reqCtx carries one request: the viewer, the decoded body and the writer.
type reqCtx struct {
	w      http.ResponseWriter
	r      *http.Request
	a      *App
	viewer *Viewer
	body   []byte
}

func (c *reqCtx) json(status int, v any) error {
	c.w.Header().Set("Content-Type", "application/json")
	c.w.Header().Set("Cache-Control", "no-store")
	c.w.WriteHeader(status)
	return json.NewEncoder(c.w).Encode(v)
}

func (c *reqCtx) fail(e *apiError) error { return c.json(e.Status, e.body()) }

// decode reads the JSON body into a map keeping numbers exact.
func (c *reqCtx) decode() (map[string]any, *apiError) {
	dec := json.NewDecoder(bytes.NewReader(c.body))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil || m == nil {
		return nil, failure(400, "bad_request", "Send a JSON object.")
	}
	return m, nil
}

// wholeNumber reads a JSON integer; false when absent, fractional or not a number.
func wholeNumber(v any) (int, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	var i int64
	if _, err := fmt.Sscanf(n.String(), "%d", &i); err != nil || strings.ContainsAny(n.String(), ".eE") {
		return 0, false
	}
	if i > 1<<31-1 || i < -(1<<31) {
		return 0, false
	}
	return int(i), true
}

type handlerFunc func(c *reqCtx) error

// route registers a handler. role is "" (open), "any" (signed in) or a role name.
func (a *App) route(mux *http.ServeMux, pattern, role string, fn handlerFunc) {
	mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		c := &reqCtx{w: w, r: r, a: a}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if e := a.guardWrite(c); e != nil {
				c.fail(e)
				return
			}
		}
		viewer, err := a.viewerFor(r)
		if err != nil {
			logf("session lookup: %v", err)
			c.fail(errUnexpected)
			return
		}
		c.viewer = viewer
		if role != "" {
			if viewer == nil {
				c.fail(errSignedOut)
				return
			}
			if role != "any" && !viewer.hasRole(role) {
				c.fail(errForbidden)
				return
			}
		}
		if err := fn(c); err != nil {
			var ae *apiError
			if errors.As(err, &ae) {
				c.fail(ae)
				return
			}
			logf("%s %s: %v", r.Method, r.URL.Path, err)
			c.fail(errUnexpected)
		}
	})
}

// guardWrite enforces origin, content type and body size on state-changing requests.
func (a *App) guardWrite(c *reqCtx) *apiError {
	if !a.sameOrigin(c.r) {
		return errForeignOrigin
	}
	if c.r.ContentLength == 0 && c.r.Body != nil && c.r.Header.Get("Transfer-Encoding") == "" {
		return nil
	}
	if c.r.ContentLength > bodyLimit {
		return failure(413, "too_large", "That request is too large.")
	}
	data, err := io.ReadAll(http.MaxBytesReader(c.w, c.r.Body, bodyLimit))
	if err != nil {
		return failure(413, "too_large", "That request is too large.")
	}
	if len(data) == 0 {
		return nil
	}
	if ct := c.r.Header.Get("Content-Type"); !strings.HasPrefix(strings.ToLower(ct), "application/json") {
		return failure(415, "unsupported_media_type", "Send application/json.")
	}
	c.body = data
	return nil
}

// sameOrigin is true when no Origin header is sent, or it names this app.
func (a *App) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if u.Host == r.Host {
		return true
	}
	if a.cfg.publicURL != "" {
		if p, err := url.Parse(a.cfg.publicURL); err == nil && p.Host == u.Host {
			return true
		}
	}
	return false
}

func (a *App) origin(r *http.Request) string {
	if a.cfg.publicURL != "" {
		return a.cfg.publicURL
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
