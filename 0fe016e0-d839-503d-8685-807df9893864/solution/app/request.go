package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

const maxBodyBytes = 16384

// Field messages, verbatim from the brief.
const (
	msgNotAccepted      = "is not an accepted field"
	msgNotObject        = "must be a JSON object"
	msgRequired         = "is required"
	msgUnknownFlag      = "is not a known flag"
	msgUnknownCohort    = "is not a known cohort"
	msgUnknownDevice    = "is not a known device"
	msgReference        = "must be 1 to 64 printable characters"
	msgReferenceUsed    = "has already been used"
	msgEventCode        = "must be 1 to 32 letters, digits or hyphens"
	msgEventRecorded    = "has already been recorded"
	msgOccurredAt       = "must be a whole number of minutes"
	msgOccurredInFuture = "cannot be in the future"
	msgSeverityBand     = "must be BAND-LOW, BAND-MED or BAND-HIGH"
	msgMaxAdverseRate   = "must be a whole number from 0 to 10000"
	msgMinSoak          = "must be a whole number from 0 to 525600"
	msgFormat           = "must be text"
	msgIdempotencyKey   = "must be 1 to 64 letters, digits, hyphens or underscores"
	msgKeyMismatch      = "was used with a different request"
)

var (
	wholeNumberPattern    = regexp.MustCompile(`^-?(0|[1-9][0-9]*)$`)
	eventCodePattern      = regexp.MustCompile(`^[A-Z0-9-]{1,32}$`)
	idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
)

// fieldErrors collects every failing field; the first failing check of a field is kept.
type fieldErrors map[string]string

func (errors fieldErrors) add(field, message string) {
	if _, failed := errors[field]; !failed {
		errors[field] = message
	}
}

// readWriteBody applies the content type (415) and size (413) rules of every write route.
func readWriteBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Content-Type must be application/json"})
		return nil, false
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the request body could not be read"})
		return nil, false
	}
	if len(raw) > maxBodyBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "the request body is larger than 16384 bytes"})
		return nil, false
	}
	return raw, true
}

// requestFields is a write body decoded strictly against one route's published shape.
type requestFields struct {
	values map[string]json.RawMessage
	errors fieldErrors
}

// decodeFields parses the body as a JSON object and flags every field outside the shape.
// It reports false when the body is not a JSON object at all.
func decodeFields(raw []byte, accepted ...string) (requestFields, bool) {
	fields := requestFields{errors: fieldErrors{}}
	if !bytes.HasPrefix(bytes.TrimLeft(raw, " \t\r\n"), []byte("{")) || json.Unmarshal(raw, &fields.values) != nil {
		fields.errors.add("body", msgNotObject)
		return fields, false
	}
	for name := range fields.values {
		known := false
		for _, field := range accepted {
			known = known || field == name
		}
		if !known {
			fields.errors.add(name, msgNotAccepted)
		}
	}
	return fields, true
}

// given returns the field's raw value when it is present and not null.
func (fields requestFields) given(name string) (json.RawMessage, bool) {
	value, present := fields.values[name]
	if !present || string(value) == "null" {
		return nil, false
	}
	return value, true
}

// required returns the raw value of a required field, or records `is required`.
func (fields requestFields) required(name string) (json.RawMessage, bool) {
	value, given := fields.given(name)
	if !given {
		fields.errors.add(name, msgRequired)
	}
	return value, given
}

// text decodes a JSON string; ok is false for any other JSON value.
func text(value json.RawMessage) (string, bool) {
	var decoded string
	err := json.Unmarshal(value, &decoded)
	return decoded, err == nil
}

// wholeNumber accepts a JSON number written with no fraction and no exponent, within bounds.
func wholeNumber(value json.RawMessage, minimum, maximum int) (int, bool) {
	if !wholeNumberPattern.Match(value) {
		return 0, false
	}
	number, err := strconv.Atoi(string(value))
	if err != nil || number < minimum || number > maximum {
		return 0, false
	}
	return number, true
}

// trimAttestation removes leading and trailing spaces, tabs, carriage returns and line feeds.
func trimAttestation(reference string) string {
	return strings.Trim(reference, " \t\r\n")
}

// attestationWithinLimits checks 1 to 64 characters, each printable ASCII from space to tilde.
func attestationWithinLimits(reference string) bool {
	if len(reference) < 1 || len(reference) > 64 {
		return false
	}
	for _, character := range []byte(reference) {
		if character < ' ' || character > '~' {
			return false
		}
	}
	return true
}

// normaliseEventCode trims like a reference and upper-cases before every check and storage.
func normaliseEventCode(code string) string {
	return strings.ToUpper(trimAttestation(code))
}

func validIdempotencyKey(key string) bool {
	return idempotencyKeyPattern.MatchString(key)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	payload, _ := json.Marshal(body)
	writeJSONBytes(w, status, payload)
}

func writeJSONBytes(w http.ResponseWriter, status int, payload []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(payload)
}
