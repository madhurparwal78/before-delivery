// Package apierr is the one place that maps a domain failure onto an HTTP status
// and the single wire error shape.
package apierr

import (
	"encoding/json"
	"net/http"
	"sort"
)

// Error is the only error type the API writes.
type Error struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	// Extra carries the few codes that publish a value alongside the message.
	Extra map[string]any
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// New builds an error from a status, code and sentence.
func New(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

// WithExtra attaches published values to the error object.
func (e *Error) WithExtra(key string, value any) *Error {
	if e.Extra == nil {
		e.Extra = map[string]any{}
	}
	e.Extra[key] = value
	return e
}

// Validation builds the 422 shape from field messages.
func Validation(fields map[string]string) *Error {
	return &Error{
		Status:  http.StatusUnprocessableEntity,
		Code:    "validation",
		Message: "Some fields need another look.",
		Fields:  fields,
	}
}

// Field builds a 422 for a single field.
func Field(name, message string) *Error {
	return Validation(map[string]string{name: message})
}

// Write renders an error as JSON. A nil or unknown error becomes a 500.
func Write(w http.ResponseWriter, err error) {
	e, ok := err.(*Error)
	if !ok || e == nil {
		e = Internal()
	}
	body := map[string]any{}
	for k, v := range e.Extra {
		body[k] = v
	}
	body["code"] = e.Code
	body["message"] = e.Message
	if len(e.Fields) > 0 {
		fields := make(map[string]string, len(e.Fields))
		keys := make([]string, 0, len(e.Fields))
		for k := range e.Fields {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fields[k] = e.Fields[k]
		}
		body["fields"] = fields
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": body})
}

// The transport and shared errors, named once.

func BadJSON() *Error {
	return New(http.StatusBadRequest, "bad_json", "That request body isn't valid JSON.")
}

func BodyTooLarge() *Error {
	return New(http.StatusRequestEntityTooLarge, "body_too_large", "That request body is larger than 16384 bytes.")
}

func UnsupportedMediaType() *Error {
	return New(http.StatusUnsupportedMediaType, "unsupported_media_type", "Send this request as application/json.")
}

func CrossOrigin() *Error {
	return New(http.StatusForbidden, "cross_origin", "This request came from another origin.")
}

func Unauthenticated() *Error {
	return New(http.StatusUnauthorized, "unauthenticated", "Start a session with a callsign first.")
}

func NotFound() *Error {
	return New(http.StatusNotFound, "not_found", "There's nothing here.")
}

func FounderOnly() *Error {
	return New(http.StatusForbidden, "founder_only", "Only the founder can do that.")
}

func StorageUnavailable() *Error {
	return New(http.StatusServiceUnavailable, "storage_unavailable", "Storage is offline right now.")
}

func RoomsUnavailable() *Error {
	return New(http.StatusServiceUnavailable, "rooms_unavailable", "The room registry is offline right now.")
}

func RoomPaused() *Error {
	return New(http.StatusServiceUnavailable, "room_paused", "The room is paused while the room registry is away.")
}

func Internal() *Error {
	return New(http.StatusInternalServerError, "internal", "Something went wrong on the server.")
}
