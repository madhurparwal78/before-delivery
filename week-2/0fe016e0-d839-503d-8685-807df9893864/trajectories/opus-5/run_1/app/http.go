package main

import (
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strings"
)

// httpFailure is the one error shape used across the API.
type httpFailure struct {
	status int
	body   any
}

func (f *httpFailure) Error() string { return http.StatusText(f.status) }

func failure(status int, message string) *httpFailure {
	return &httpFailure{status: status, body: map[string]any{"error": message}}
}

func fieldFailure(errors fieldErrors) *httpFailure {
	return &httpFailure{status: http.StatusUnprocessableEntity, body: map[string]any{"errors": errors}}
}

func refusalFailure(refusal *gateRefusal) *httpFailure {
	body := map[string]any{"error": refusal.Copy, "rule": refusal.Rule}
	for name, value := range refusal.Fields {
		body[name] = value
	}
	return &httpFailure{status: http.StatusConflict, body: body}
}

var errDatabaseUnavailable = failure(http.StatusServiceUnavailable, "database unavailable")

func writeJSON(w http.ResponseWriter, status int, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(payload)
}

func writeFailure(w http.ResponseWriter, err error) {
	if known, ok := err.(*httpFailure); ok {
		writeJSON(w, known.status, known.body)
		return
	}
	writeJSON(w, errDatabaseUnavailable.status, errDatabaseUnavailable.body)
}

// readWriteBody applies the published content type and size limits.
func readWriteBody(r *http.Request) ([]byte, error) {
	contentType := r.Header.Get("Content-Type")
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		return nil, failure(http.StatusUnsupportedMediaType, "requests must use Content-Type: application/json")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil {
		return nil, failure(http.StatusBadRequest, "the request body could not be read")
	}
	if len(raw) > maxBodyBytes {
		return nil, failure(http.StatusRequestEntityTooLarge, "the request body may be up to 16384 bytes")
	}
	return raw, nil
}
