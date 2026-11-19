package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
)

// apiError is the one error shape of the API.
type apiError struct {
	status  int
	code    string
	message string
	fields  map[string]string
	extra   map[string]any
}

func (e *apiError) Error() string { return e.code + ": " + e.message }

// errorCatalog maps every error code to its status and sentence. It is the one place
// that decides which status an error answers with.
var errorCatalog = map[string]struct {
	status  int
	message string
}{
	"bad_json":               {http.StatusBadRequest, "The request body is not valid JSON."},
	"unauthenticated":        {http.StatusUnauthorized, "Start a session with a callsign first."},
	"cross_origin":           {http.StatusForbidden, "Requests from another origin are refused."},
	"studio_key_invalid":     {http.StatusForbidden, "That studio key isn't right."},
	"founder_only":           {http.StatusForbidden, "Only the founder can do that."},
	"not_seated":             {http.StatusForbidden, "You don't have a seat in this room."},
	"not_host":               {http.StatusForbidden, "Only the host can do that."},
	"not_found":              {http.StatusNotFound, "Nothing here."},
	"room_not_found":         {http.StatusNotFound, "No room with that code."},
	"body_too_large":         {http.StatusRequestEntityTooLarge, "The request body is larger than 16,384 bytes."},
	"unsupported_media_type": {http.StatusUnsupportedMediaType, "Send the body as application/json."},
	"validation":             {http.StatusUnprocessableEntity, "Some fields need another look."},
	"already_in_room":        {http.StatusConflict, "You're already in a room."},
	"room_full":              {http.StatusConflict, "That room is full."},
	"match_in_progress":      {http.StatusConflict, "That room is mid-match."},
	"seat_released":          {http.StatusConflict, "Your seat in that room was released."},
	"invite_expired":         {http.StatusGone, "That invite expired."},
	"wrong_phase":            {http.StatusConflict, "The room is not in a phase that allows that."},
	"not_all_ready":          {http.StatusConflict, "Everyone must be ready first."},
	"report_conflict":        {http.StatusConflict, "That report id was already used for a different report."},
	"purchase_conflict":      {http.StatusConflict, "That purchase id was already used for a different purchase."},
	"shop_closed":            {http.StatusConflict, "The ammo station is closed until the next intermission."},
	"insufficient_credits":   {http.StatusConflict, "Not enough credits."},
	"at_capacity":            {http.StatusConflict, "You're carrying as many as you can."},
	"price_change_exists":    {http.StatusConflict, "A change for that item at that time already exists."},
	"price_change_in_effect": {http.StatusConflict, "That price is already in effect and can't be removed."},
	"signups_not_open":       {http.StatusConflict, "Sign-ups for this night are not open yet."},
	"signups_closed":         {http.StatusConflict, "Sign-ups for this night are closed."},
	"night_full":             {http.StatusConflict, "This night is full."},
	"storage_unavailable":    {http.StatusServiceUnavailable, "Storage is offline right now."},
	"rooms_unavailable":      {http.StatusServiceUnavailable, "Rooms are offline right now."},
	"room_paused":            {http.StatusServiceUnavailable, "The room is paused while the room registry is down."},
	"internal":               {http.StatusInternalServerError, "Something went wrong on the server."},
}

func fail(code string) *apiError {
	entry := errorCatalog[code]
	return &apiError{status: entry.status, code: code, message: entry.message}
}

func failMessage(code, message string) *apiError {
	e := fail(code)
	e.message = message
	return e
}

func failFields(fields map[string]string) *apiError {
	e := fail("validation")
	e.fields = fields
	return e
}

// errStorageDown marks a Postgres failure that the HTTP layer answers as 503.
var errStorageDown = errors.New("storage unavailable")

func (e *apiError) body() map[string]any {
	inner := map[string]any{"code": e.code, "message": e.message}
	for k, v := range e.extra {
		inner[k] = v
	}
	if e.fields != nil {
		inner["fields"] = e.fields
	}
	return map[string]any{"error": inner}
}

// toAPIError turns any error into the API error that answers it.
func toAPIError(err error) *apiError {
	var ae *apiError
	switch {
	case errors.As(err, &ae):
		return ae
	case errors.Is(err, errStorageDown):
		return fail("storage_unavailable")
	default:
		return fail("internal")
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeStatus(w, status, string(payload))
}

// writeStatus writes an already-encoded JSON payload.
func writeStatus(w http.ResponseWriter, status int, payload string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if _, err := io.WriteString(w, payload); err != nil {
		log.Printf("write response: %v", err)
	}
}

func writeError(w http.ResponseWriter, err error) {
	ae := toAPIError(err)
	writeJSON(w, ae.status, ae.body())
}
