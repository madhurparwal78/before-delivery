package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

// apiError is the one failure shape of the API. Every failure body is produced by writeError.
type apiError struct {
	Status  int
	Body    map[string]any
	Headers map[string]string
}

func (e *apiError) Error() string {
	encoded, _ := json.Marshal(e.Body)
	return http.StatusText(e.Status) + " " + string(encoded)
}

// errCode builds {"error":"<code>"} plus optional key/value pairs the brief prints for that failure.
func errCode(status int, code string, extra ...any) *apiError {
	body := map[string]any{"error": code}
	for i := 0; i+1 < len(extra); i += 2 {
		body[extra[i].(string)] = extra[i+1]
	}
	return &apiError{Status: status, Body: body}
}

// errFields builds the 422 field-error body {"errors":{"<field>":"<sentence>"}}.
func errFields(fields map[string]string) *apiError {
	return &apiError{Status: http.StatusUnprocessableEntity, Body: map[string]any{"errors": fields}}
}

// errField is errFields for one field.
func errField(field, sentence string) *apiError { return errFields(map[string]string{field: sentence}) }

// errStarting is the 503 every route answers until the app has finished booting; its body is {"status":"starting"}.
func errStarting() *apiError {
	return &apiError{Status: http.StatusServiceUnavailable, Body: map[string]any{"status": "starting"}}
}

func errBadJSON() *apiError                { return errCode(http.StatusBadRequest, "invalid_json") }
func errTooLarge() *apiError               { return errCode(http.StatusRequestEntityTooLarge, "body_too_large") }
func errUnauthenticated() *apiError        { return errCode(http.StatusUnauthorized, "unauthenticated") }
func errInvalidKey() *apiError             { return errCode(http.StatusUnauthorized, "invalid_api_key") }
func errNotFound() *apiError               { return errCode(http.StatusNotFound, "not_found") }
func errForbidden() *apiError              { return errCode(http.StatusForbidden, "forbidden") }
func errCrossOrigin() *apiError            { return errCode(http.StatusForbidden, "cross_origin") }
func errBadHandshake(status int) *apiError { return errCode(status, "bad_handshake") }
func errInvalidCredentials() *apiError {
	return errCode(http.StatusUnauthorized, "invalid_credentials")
}
func errExpired() *apiError { return errCode(http.StatusGone, "expired") }
func errMethodNotAllowed() *apiError {
	return errCode(http.StatusMethodNotAllowed, "method_not_allowed")
}
func errUnknownRoutingKey() *apiError { return errCode(http.StatusNotFound, "unknown_routing_key") }
func errQueueUnavailable() *apiError {
	return errCode(http.StatusServiceUnavailable, "queue_unavailable")
}
func errVersionRequired() *apiError {
	return errCode(http.StatusPreconditionRequired, "version_required")
}

// errVersionConflict is the 412 for a save over a newer version; current is the stored record.
func errVersionConflict(current any) *apiError {
	return errCode(http.StatusPreconditionFailed, "version_conflict", "current", current)
}

// errConflict is a 409 with a code.
func errConflict(code string, extra ...any) *apiError {
	return errCode(http.StatusConflict, code, extra...)
}

// writeError is the single place an API failure body is encoded. Unknown errors become a logged 500.
func writeError(w http.ResponseWriter, err error) {
	var api *apiError
	if !errors.As(err, &api) {
		if errors.Is(err, context.Canceled) {
			return
		}
		log.Printf("internal error: %v", err)
		api = errCode(http.StatusInternalServerError, "internal")
	}
	for name, value := range api.Headers {
		w.Header().Set(name, value)
	}
	writeJSON(w, api.Status, api.Body)
}

// writeJSON encodes a JSON response with the given status.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("write response: %v", err)
	}
}
