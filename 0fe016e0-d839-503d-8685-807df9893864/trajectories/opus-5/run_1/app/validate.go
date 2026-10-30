package main

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

const maxBodyBytes = 16384

// fieldErrors collects every failing field of one request.
type fieldErrors map[string]string

func (f fieldErrors) add(field, message string) {
	if _, present := f[field]; !present {
		f[field] = message
	}
}

func (f fieldErrors) any() bool { return len(f) > 0 }

// parseFields decodes a write body strictly against its published shape.
func parseFields(raw []byte, allowed []string, required []string) (map[string]json.RawMessage, fieldErrors) {
	errors := fieldErrors{}
	fields := map[string]json.RawMessage{}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&fields); err != nil {
		errors.add("body", "must be a JSON object")
		return nil, errors
	}
	if decoder.More() {
		errors.add("body", "must be a JSON object")
		return nil, errors
	}
	for name := range fields {
		accepted := false
		for _, candidate := range allowed {
			if candidate == name {
				accepted = true
				break
			}
		}
		if !accepted {
			errors.add(name, "is not an accepted field")
		}
	}
	for _, name := range required {
		value, present := fields[name]
		if !present || isJSONNull(value) {
			errors.add(name, "is required")
		}
	}
	return fields, errors
}

func isJSONNull(raw json.RawMessage) bool {
	return string(bytes.TrimSpace(raw)) == "null"
}

func asString(raw json.RawMessage) (string, bool) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	return value, true
}

var wholeNumberPattern = regexp.MustCompile(`^-?[0-9]+$`)

// asWholeNumber accepts only a JSON number written with no fraction part and no
// exponent.
func asWholeNumber(raw json.RawMessage) (int, bool) {
	text := string(bytes.TrimSpace(raw))
	if !wholeNumberPattern.MatchString(text) {
		return 0, false
	}
	value, err := strconv.Atoi(text)
	if err != nil {
		return 0, false
	}
	return value, true
}

const referenceTrimSet = " \t\r\n"

// trimReference normalises an attestation reference (DP-04).
func trimReference(value string) string { return strings.Trim(value, referenceTrimSet) }

func printableASCII(value string) bool {
	for _, character := range value {
		if character < ' ' || character > '~' {
			return false
		}
	}
	return true
}

func referenceWithinLimits(reference string) bool {
	return len([]rune(reference)) >= 1 && len([]rune(reference)) <= 64 && printableASCII(reference)
}

// normaliseEventCode trims and upper-cases an adverse event code (DP-08).
func normaliseEventCode(value string) string {
	return strings.ToUpper(strings.Trim(value, referenceTrimSet))
}

var eventCodePattern = regexp.MustCompile(`^[A-Z0-9-]{1,32}$`)

func eventCodeWithinLimits(code string) bool { return eventCodePattern.MatchString(code) }

var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func idempotencyKeyWithinLimits(key string) bool { return idempotencyKeyPattern.MatchString(key) }

func isSeverityBand(code string) bool {
	return code == "BAND-LOW" || code == "BAND-MED" || code == "BAND-HIGH"
}
