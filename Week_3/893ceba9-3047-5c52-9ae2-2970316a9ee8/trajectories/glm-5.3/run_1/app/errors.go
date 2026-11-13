package main

import (
	"encoding/json"
	"net/http"
)

// APIError is the single error shape used by every endpoint.
type APIError struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
	Details map[string]any    `json:"details,omitempty"`
}

type apiErrorBody struct {
	Error APIError `json:"error"`
}

func (e APIError) Error() string { return e.Message }

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, apiErrorBody{Error: APIError{Code: code, Message: message}})
}

func writeErrorFields(w http.ResponseWriter, status int, code, message string, fields map[string]string) {
	writeJSON(w, status, apiErrorBody{Error: APIError{Code: code, Message: message, Fields: fields}})
}

func writeErrorDetails(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	writeJSON(w, status, apiErrorBody{Error: APIError{Code: code, Message: message, Details: details}})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body == nil {
		return
	}
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(body)
}

func notFoundError(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, "not_found", "We couldn't find that.")
}

func unauthenticated(w http.ResponseWriter) {
	writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in to use the desk.")
}

func forbidden(w http.ResponseWriter) {
	writeError(w, http.StatusForbidden, "forbidden", "Your account can't do that.")
}

func validationFailed(w http.ResponseWriter, fields map[string]string) {
	writeErrorFields(w, http.StatusUnprocessableEntity, "validation_failed", "Some fields need attention.", fields)
}

func payloadTooLarge(w http.ResponseWriter) {
	writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "That request is too large.")
}

func unsupportedMedia(w http.ResponseWriter) {
	writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "That content type isn't accepted here.")
}

func serviceUnavailable(w http.ResponseWriter, code, message string, details map[string]any) {
	writeErrorDetails(w, http.StatusServiceUnavailable, code, message, details)
}
