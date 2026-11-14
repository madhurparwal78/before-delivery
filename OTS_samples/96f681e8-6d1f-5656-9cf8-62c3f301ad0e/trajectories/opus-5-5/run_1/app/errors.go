package main

import (
	"fmt"
	"net/http"
)

type apiError struct {
	Status     int               `json:"-"`
	Code       string            `json:"code"`
	Message    string            `json:"message"`
	Errors     map[string]string `json:"errors,omitempty"`
	RetryAfter int               `json:"-"`
}

func (e *apiError) Error() string { return fmt.Sprintf("%d %s", e.Status, e.Code) }

var catalogue = map[string]struct {
	status  int
	message string
}{
	"UNAUTHENTICATED":        {401, "Sign in to continue."},
	"PAYMENT_DECLINED":       {402, "Your card was declined, so nothing was charged."},
	"FORBIDDEN":              {403, "Your role cannot do that."},
	"NOT_TODAY":              {403, "Only today's bookings can be marked."},
	"NOT_YOUR_COACH_ID":      {403, "You can only book lesson blocks on your own name."},
	"NOT_FOUND":              {404, "We could not find that."},
	"SLOT_TAKEN":             {409, "Someone else got that spot first."},
	"MATCH_FULL":             {409, "Someone else got that spot first."},
	"MATCH_CLOSED":           {409, "This match has closed."},
	"ALREADY_JOINED":         {409, "You are already in this match."},
	"HOLD_EXPIRED":           {409, "This hold has ended. Pick the slot again."},
	"ALREADY_PAID":           {409, "This is already paid."},
	"SHARE_VOID":             {409, "This share is no longer due."},
	"SHARE_SETTLED":          {409, "This share was covered by the organiser."},
	"INVALID_TRANSITION":     {409, "This booking cannot change that way now."},
	"NOT_STARTED":            {409, "This booking is still inside its grace time."},
	"CHECK_IN_CLOSED":        {409, "Check-in closed when the booking ended."},
	"BOOKING_STARTED":        {409, "This booking has already started."},
	"IDEMPOTENCY_CONFLICT":   {409, "That key was already used for a different request."},
	"VERSION_STALE":          {412, "Someone changed this first. Reload to see the latest."},
	"TOO_LARGE":              {413, "That request is too large."},
	"UNSUPPORTED_MEDIA_TYPE": {415, "Send the request as JSON."},
	"VALIDATION":             {422, "Check the highlighted fields."},
	"RATE_LIMITED":           {429, "Too many tries. Wait a moment and try again."},
	"PAYMENT_NOT_CONFIRMED":  {502, "The payment was not confirmed, so nothing changed."},
	"PAYMENT_UNAVAILABLE":    {503, "Payments are down, so nothing was charged. Try again in a minute."},
	"INTERNAL":               {500, "Something went wrong on our side. Try again."},
}

const holdUnavailableMessage = "Payments are down, so we could not hold this slot. Try again in a minute."

func fail(code string) *apiError {
	entry, ok := catalogue[code]
	if !ok {
		code, entry = "INTERNAL", catalogue["INTERNAL"]
	}
	return &apiError{Status: entry.status, Code: code, Message: entry.message}
}

func invalid(errs map[string]string) *apiError {
	e := fail("VALIDATION")
	e.Errors = errs
	return e
}

func invalidField(field, message string) *apiError {
	return invalid(map[string]string{field: message})
}

// Field messages for 422 answers.
const (
	msgCourt          = "Pick a court from 1 to 7."
	msgStart          = "Pick a start inside opening hours on the slot grid."
	msgStartFuture    = "Pick a start in the future."
	msgMatchTooLate   = "Too late to open a match for this time."
	msgMinutes        = "Pick 60, 90 or 120 minutes."
	msgNote           = "Keep the note to 280 characters."
	msgDescription    = "Keep the description to 280 characters."
	msgCoPlayers      = "Add exactly three club players, or none."
	msgSplitTooLate   = "Too late to split this booking."
	msgStudents       = "Add one to four club players."
	msgWeeks          = "Pick 1 to 8 weeks."
	msgLevels         = "Use levels from 1.0 to 7.0 in steps of 0.5, lowest first."
	msgLevel          = "Your level is outside this match's range."
	msgCents          = "Use whole cents from 1 to 10000."
	msgPeakTime       = "Use HH:MM on the half hour, start before end."
	msgPeakDays       = "Use mon to sun, each once."
	msgEffectiveFrom  = "Pick a date from tomorrow on."
	msgLateFee        = "Use a whole number from 0 to 100."
	msgVersion        = "Send the version you edited."
	msgDate           = "Use a date like 2027-03-28."
	msgLimit          = "Ask for 1 to 50 rows."
	msgCursor         = "This cursor is not valid."
	msgIdempotencyKey = "Use 1 to 100 visible characters."
)

func writeAPIError(w http.ResponseWriter, e *apiError) {
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", fmt.Sprint(e.RetryAfter))
	}
	writeJSON(w, e.Status, e)
}
