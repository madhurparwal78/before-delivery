package api

import (
	"encoding/json"
	"log"
	"net/http"
)

// apiError is the one error shape of the whole API.
type apiError struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
	Fields  map[string]string
}

func (e *apiError) Error() string { return e.Code + ": " + e.Message }

type errorBody struct {
	Code    string            `json:"code"`
	Message string            `json:"message"`
	Details map[string]any    `json:"details,omitempty"`
	Fields  map[string]string `json:"fields,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	encoded, err := json.Marshal(body)
	if err != nil {
		log.Printf("encode response: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"code":"internal","message":"The desk could not answer that."}}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

func writeError(w http.ResponseWriter, e *apiError) {
	writeJSON(w, e.Status, map[string]any{"error": errorBody{
		Code: e.Code, Message: e.Message, Details: e.Details, Fields: e.Fields,
	}})
}

// Errors of the published catalogue.

func errUnauthenticated() *apiError {
	return &apiError{Status: http.StatusUnauthorized, Code: "unauthenticated", Message: "Sign in to use this."}
}

func errInvalidCredentials() *apiError {
	return &apiError{Status: http.StatusUnauthorized, Code: "invalid_credentials",
		Message: "That email and password don't match."}
}

func errForbidden() *apiError {
	return &apiError{Status: http.StatusForbidden, Code: "forbidden", Message: "Only the engineer can do that."}
}

func errNotFound() *apiError {
	return &apiError{Status: http.StatusNotFound, Code: "not_found", Message: "We couldn't find that."}
}

func errPayloadTooLarge() *apiError {
	return &apiError{Status: http.StatusRequestEntityTooLarge, Code: "payload_too_large",
		Message: "That request is larger than the limit."}
}

func errUnsupportedMediaType() *apiError {
	return &apiError{Status: http.StatusUnsupportedMediaType, Code: "unsupported_media_type",
		Message: "That content type isn't accepted here."}
}

func errValidation(fields map[string]string) *apiError {
	return &apiError{Status: http.StatusUnprocessableEntity, Code: "validation_failed",
		Message: "Some fields need attention.", Fields: fields}
}

func errField(field, message string) *apiError {
	return errValidation(map[string]string{field: message})
}

func errConflict(code, message string) *apiError {
	return &apiError{Status: http.StatusConflict, Code: code, Message: message}
}

func errConflictDetails(code, message string, details map[string]any) *apiError {
	return &apiError{Status: http.StatusConflict, Code: code, Message: message, Details: details}
}

func errIllegalTransition(from, to string) *apiError {
	return errConflictDetails("illegal_transition", "That change isn't allowed.",
		map[string]any{"from": from, "to": to})
}

func errDependency(code, message string, details map[string]any) *apiError {
	return &apiError{Status: http.StatusServiceUnavailable, Code: code, Message: message, Details: details}
}

func errStorageUnavailable() *apiError {
	return errDependency("storage_unavailable",
		"File storage isn't answering. Nothing was saved; try again in a few minutes.", nil)
}

func errWebhooksUnavailable() *apiError {
	return errDependency("webhooks_unavailable",
		"The webhook service isn't answering. The endpoint wasn't saved; try again in a few minutes.", nil)
}

func errAIEngineUnavailable(tmReused, aiDrafted int) *apiError {
	return errDependency("ai_engine_unavailable",
		"The AI engine isn't answering. Exact matches from translation memory still apply; other segments stay untranslated.",
		map[string]any{"tm_reused": tmReused, "ai_drafted": aiDrafted})
}

// errInternal reports a fault of the desk itself.
func errInternal(err error) *apiError {
	log.Printf("request failed: %v", err)
	return &apiError{Status: http.StatusInternalServerError, Code: "internal",
		Message: "The desk could not answer that."}
}
