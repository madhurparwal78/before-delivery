package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
)

// Error codes of the catalogue.
const (
	codeUnauthenticated   = "UNAUTHENTICATED"
	codePaymentDeclined   = "PAYMENT_DECLINED"
	codeForbidden         = "FORBIDDEN"
	codeNotToday          = "NOT_TODAY"
	codeNotYourCoachID    = "NOT_YOUR_COACH_ID"
	codeNotFound          = "NOT_FOUND"
	codeSlotTaken         = "SLOT_TAKEN"
	codeMatchFull         = "MATCH_FULL"
	codeMatchClosed       = "MATCH_CLOSED"
	codeAlreadyJoined     = "ALREADY_JOINED"
	codeHoldExpired       = "HOLD_EXPIRED"
	codeAlreadyPaid       = "ALREADY_PAID"
	codeShareVoid         = "SHARE_VOID"
	codeShareSettled      = "SHARE_SETTLED"
	codeInvalidTransition = "INVALID_TRANSITION"
	codeNotStarted        = "NOT_STARTED"
	codeCheckInClosed     = "CHECK_IN_CLOSED"
	codeBookingStarted    = "BOOKING_STARTED"
	codeIdempotency       = "IDEMPOTENCY_CONFLICT"
	codeVersionStale      = "VERSION_STALE"
	codeTooLarge          = "TOO_LARGE"
	codeUnsupportedMedia  = "UNSUPPORTED_MEDIA_TYPE"
	codeValidation        = "VALIDATION"
	codeRateLimited       = "RATE_LIMITED"
	codeNotConfirmed      = "PAYMENT_NOT_CONFIRMED"
	codePaymentUnavail    = "PAYMENT_UNAVAILABLE"
	codeInternal          = "INTERNAL"
)

type catalogueEntry struct {
	status  int
	message string
}

var catalogue = map[string]catalogueEntry{
	codeUnauthenticated:   {http.StatusUnauthorized, "Sign in to continue."},
	codePaymentDeclined:   {http.StatusPaymentRequired, "Your card was declined, so nothing was charged."},
	codeForbidden:         {http.StatusForbidden, "Your role cannot do that."},
	codeNotToday:          {http.StatusForbidden, "Only today's bookings can be marked."},
	codeNotYourCoachID:    {http.StatusForbidden, "You can only book lesson blocks on your own name."},
	codeNotFound:          {http.StatusNotFound, "We could not find that."},
	codeSlotTaken:         {http.StatusConflict, "Someone else got that spot first."},
	codeMatchFull:         {http.StatusConflict, "Someone else got that spot first."},
	codeMatchClosed:       {http.StatusConflict, "This match has closed."},
	codeAlreadyJoined:     {http.StatusConflict, "You are already in this match."},
	codeHoldExpired:       {http.StatusConflict, "This hold has ended. Pick the slot again."},
	codeAlreadyPaid:       {http.StatusConflict, "This is already paid."},
	codeShareVoid:         {http.StatusConflict, "This share is no longer due."},
	codeShareSettled:      {http.StatusConflict, "This share was covered by the organiser."},
	codeInvalidTransition: {http.StatusConflict, "This booking cannot change that way now."},
	codeNotStarted:        {http.StatusConflict, "This booking is still inside its grace time."},
	codeCheckInClosed:     {http.StatusConflict, "Check-in closed when the booking ended."},
	codeBookingStarted:    {http.StatusConflict, "This booking has already started."},
	codeIdempotency:       {http.StatusConflict, "That key was already used for a different request."},
	codeVersionStale:      {http.StatusPreconditionFailed, "Someone changed this first. Reload to see the latest."},
	codeTooLarge:          {http.StatusRequestEntityTooLarge, "That request is too large."},
	codeUnsupportedMedia:  {http.StatusUnsupportedMediaType, "Send the request as JSON."},
	codeValidation:        {http.StatusUnprocessableEntity, "Check the highlighted fields."},
	codeRateLimited:       {http.StatusTooManyRequests, "Too many tries. Wait a moment and try again."},
	codeNotConfirmed:      {http.StatusBadGateway, "The payment was not confirmed, so nothing changed."},
	codePaymentUnavail:    {http.StatusServiceUnavailable, "Payments are down, so nothing was charged. Try again in a minute."},
	codeInternal:          {http.StatusInternalServerError, "Something went wrong on our side. Try again."},
}

const holdUnavailableMessage = "Payments are down, so we could not hold this slot. Try again in a minute."

// apiError is an error answered through the catalogue.
type apiError struct {
	code       string
	message    string
	fields     map[string]string
	retryAfter int
}

func (e *apiError) Error() string { return e.code + ": " + e.message }

func fail(code string) *apiError {
	return &apiError{code: code, message: catalogue[code].message}
}

func failValidation(fields map[string]string) *apiError {
	err := fail(codeValidation)
	err.fields = fields
	return err
}

func failHoldUnavailable() *apiError {
	err := fail(codePaymentUnavail)
	err.message = holdUnavailableMessage
	return err
}

func failRateLimited(retryAfter int) *apiError {
	err := fail(codeRateLimited)
	err.retryAfter = retryAfter
	return err
}

// answer is the one place an error's status and body are built from the catalogue.
func (e *apiError) answer() result {
	body := map[string]any{"code": e.code, "message": e.message}
	if e.fields != nil {
		body["errors"] = e.fields
	}
	return result{status: catalogue[e.code].status, body: body}
}

// writeError is the one place an error body is written.
func writeError(w http.ResponseWriter, err error) {
	var api *apiError
	if !errors.As(err, &api) {
		log.Printf("internal error: %v", err)
		api = fail(codeInternal)
	}
	if api.retryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(api.retryAfter))
	}
	res := api.answer()
	writeJSON(w, res.status, res.body)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		log.Printf("encode response: %v", err)
		status, payload = http.StatusInternalServerError, []byte(`{"code":"INTERNAL","message":"Something went wrong on our side. Try again."}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if _, err := w.Write(payload); err != nil {
		log.Printf("write response: %v", err)
	}
}
