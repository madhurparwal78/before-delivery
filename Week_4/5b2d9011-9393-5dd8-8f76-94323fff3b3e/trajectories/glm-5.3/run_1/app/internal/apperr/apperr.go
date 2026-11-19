// Package apperr is the one place that defines every API error and maps
// errors to HTTP status codes.
package apperr

import (
	"encoding/json"
	"net/http"
)

// Error is the single error type carried by every API response.
type Error struct {
	Status  int
	Code    string
	Message string
	Fields  map[string]string
	// Extra holds extra members of the error object, in order. The value is
	// rendered before the code and message so last-wins JSON parsers keep the
	// error's own code and message.
	Extra []KV
}

// KV is one extra member of the error object.
type KV struct {
	Key   string
	Value any
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func new(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

// Unauthenticated is returned when no session is presented.
var Unauthenticated = new(http.StatusUnauthorized, "unauthenticated", "Sign in with a callsign first.")

// ForbiddenRole is returned when a founder-only action is attempted.
func ForbiddenRole() *Error { return new(http.StatusForbidden, "founder_only", "That needs the founder role.") }

// NotSeated is returned when a room action comes from a player without a seat.
var NotSeated = new(http.StatusForbidden, "not_seated", "You don't have a seat in that room.")

// NotFound is a generic unknown resource.
var NotFound = new(http.StatusNotFound, "not_found", "No such thing here.")

func notFound(code, message string) *Error { return new(http.StatusNotFound, code, message) }

// RoomNotFound is returned for an unknown or expired room code.
var RoomNotFound = notFound("room_not_found", "No room with that code.")

// StorageUnavailable is returned when Postgres is unreachable.
var StorageUnavailable = new(http.StatusServiceUnavailable, "storage_unavailable", "Storage is offline right now.")

// RoomsUnavailable is returned when Valkey is unreachable.
var RoomsUnavailable = new(http.StatusServiceUnavailable, "rooms_unavailable", "Rooms are offline right now.")

// RoomPaused is returned for in-match actions while the room registry is down.
var RoomPaused = new(http.StatusServiceUnavailable, "room_paused", "Room paused — the room registry dropped.")

// CrossOrigin is returned for a state-changing request from another origin.
var CrossOrigin = new(http.StatusForbidden, "cross_origin", "Requests from other origins are refused.")

// BadJSON is returned for a malformed JSON body.
var BadJSON = new(http.StatusBadRequest, "bad_json", "That request body is not valid JSON.")

// BodyTooLarge is returned for a body over the size limit.
var BodyTooLarge = new(http.StatusRequestEntityTooLarge, "body_too_large", "That request body is too large.")

// UnsupportedMediaType is returned without a JSON content type.
var UnsupportedMediaType = new(http.StatusUnsupportedMediaType, "unsupported_media_type", "Send JSON with Content-Type application/json.")

// Validation builds a 422 with field messages.
func Validation(fields map[string]string) *Error {
	return &Error{Status: http.StatusUnprocessableEntity, Code: "validation", Message: "Some fields need a second look.", Fields: fields}
}

// SingleValidation builds a 422 for one field.
func SingleValidation(field, message string) *Error {
	return Validation(map[string]string{field: message})
}

func conflict(code, message string) *Error { return new(http.StatusConflict, code, message) }

// Gone is a 410.
func gone(code, message string) *Error { return new(http.StatusGone, code, message) }

// AlreadyInRoom is returned when a seated player tries to create a room.
// The room code rides along inside the error object.
func AlreadyInRoom(code string) *Error {
	e := conflict("already_in_room", "You're already in room "+code+".")
	e.Extra = []KV{{Key: "code", Value: code}}
	return e
}

// RoomFull is returned when every seat is taken.
func RoomFull(code string) *Error { return conflict("room_full", "Room "+code+" is full.") }

// MatchInProgress is returned when a new join meets a started room.
func MatchInProgress(code string) *Error {
	return conflict("match_in_progress", "Room "+code+" is mid-match. Ask the host for the next one.")
}

// SeatReleased is returned to a player whose grace has run out.
func SeatReleased(code string) *Error { return conflict("seat_released", "Your seat in "+code+" was released.") }

// InviteExpired is returned when the invite window has passed.
var InviteExpired = gone("invite_expired", "This invite expired. Ask the host for a new room.")

// WrongPhase is returned for a lobby action outside the lobby.
var WrongPhase = conflict("wrong_phase", "The match has already started.")

// NotAllReady is returned when a seated player is not ready.
var NotAllReady = conflict("not_all_ready", "Everyone must be ready first.")

// NotHost is returned when a non-host tries to start or end.
var NotHost = conflict("not_host", "Only the host can start.")

// ReportConflict is returned for a reused report id with a different body.
var ReportConflict = conflict("report_conflict", "That report id was used for a different report.")

// PurchaseConflict is returned for a reused purchase id with a different item.
var PurchaseConflict = conflict("purchase_conflict", "That purchase id was used for a different item.")

// ShopClosed is returned for a purchase outside an intermission.
var ShopClosed = conflict("shop_closed", "The ammo station is closed until the next intermission.")

// InsufficientCredits is returned when the balance can't cover the price.
func InsufficientCredits(itemName string, price int) *Error {
	return conflict("insufficient_credits", "Not enough credits — "+itemName+" costs "+itoa(price)+" cr.")
}

// AtCapacity is returned when the buyer already holds the limit.
var AtCapacity = conflict("at_capacity", "You're carrying as many as you can.")

// PriceChangeExists is returned for a duplicate schedule row.
var PriceChangeExists = conflict("price_change_exists", "A change for that item at that time already exists.")

// PriceChangeInEffect is returned when removing an already-effective row.
var PriceChangeInEffect = conflict("price_change_in_effect", "That price is already in effect and can't be removed.")

// SignupsNotOpen is returned before the sign-up window opens.
func SignupsNotOpen() *Error { return conflict("signups_not_open", "Sign-ups for this night aren't open yet.") }

// SignupsClosed is returned from the closing instant on.
func SignupsClosed(closeAbbrTime string) *Error {
	return conflict("signups_closed", "Sign-ups for this night closed at "+closeAbbrTime+" studio time.")
}

// NightFull is returned when the night's capacity is reached.
var NightFull = conflict("night_full", "This night is full.")

// Marshal renders the error body. Extra members come first so a duplicated
// "code" key is won by the error's own code under last-wins parsers.
func (e *Error) Marshal() []byte {
	var buf []byte
	buf = append(buf, `{"error":{`...)
	for i, kv := range e.Extra {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = appendKV(buf, kv)
	}
	if len(e.Extra) > 0 {
		buf = append(buf, ',')
	}
	buf = appendKV(buf, KV{Key: "code", Value: e.Code})
	buf = append(buf, ',')
	buf = appendKV(buf, KV{Key: "message", Value: e.Message})
	if len(e.Fields) > 0 {
		buf = append(buf, `,"fields":`...)
		fb, err := json.Marshal(e.Fields)
		if err == nil {
			buf = append(buf, fb...)
		}
	}
	buf = append(buf, '}', '}')
	return buf
}

func appendKV(buf []byte, kv KV) []byte {
	kb, _ := json.Marshal(kv.Key)
	vb, err := json.Marshal(kv.Value)
	if err != nil {
		vb = []byte("null")
	}
	buf = append(buf, kb...)
	buf = append(buf, ':')
	buf = append(buf, vb...)
	return buf
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
