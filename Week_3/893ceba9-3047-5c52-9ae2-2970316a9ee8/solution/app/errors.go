package main

import (
	"errors"
	"net/http"
	"slices"
)

// apiError is the one error shape every endpoint answers with.
type apiError struct {
	Status  int
	Code    string
	Message string
	Details map[string]any
	Fields  map[string]string
}

func (e *apiError) Error() string { return e.Code + ": " + e.Message }

func newErr(status int, code, message string) *apiError {
	return &apiError{Status: status, Code: code, Message: message}
}

func (e *apiError) with(details map[string]any) *apiError {
	e.Details = details
	return e
}

func errUnauthenticated() *apiError {
	return newErr(http.StatusUnauthorized, "unauthenticated", "Sign in to continue.")
}

func errNotFound() *apiError {
	return newErr(http.StatusNotFound, "not_found", "That resource doesn't exist.")
}

func errForbidden() *apiError {
	return newErr(http.StatusForbidden, "forbidden", "Your account can't do that.")
}

func errValidation(fields map[string]string) *apiError {
	return &apiError{Status: http.StatusUnprocessableEntity, Code: "validation_failed", Message: "Some fields need attention.", Fields: fields}
}

func errField(field, message string) *apiError {
	return errValidation(map[string]string{field: message})
}

func errIllegalTransition(from, to string) *apiError {
	return newErr(http.StatusConflict, "illegal_transition", "That change isn't allowed from "+from+".").
		with(map[string]any{"from": from, "to": to})
}

func errStorage() *apiError {
	return newErr(http.StatusServiceUnavailable, "storage_unavailable", "File storage isn't answering. Nothing was saved; try again in a few minutes.")
}

// errStorageDown marks an object-store failure so handlers answer with the published 503.
var errStorageDown = errors.New("object storage unavailable")

// errorPrecedence is the one published order of the API's errors. A request meets the steps in this order:
// limitBody (413), authn (401), scopedProject (404), requireOwner (403), decodeJSON and readUpload (415),
// the idempotent replay, then the handler's own state conflicts (409), validation (422) and dependencies (503).
// When a handler finds candidates of several kinds at once, firstByPrecedence picks the one to answer.
var errorPrecedence = []int{
	http.StatusRequestEntityTooLarge, http.StatusUnauthorized, http.StatusNotFound, http.StatusForbidden,
	http.StatusUnsupportedMediaType, http.StatusConflict, http.StatusUnprocessableEntity, http.StatusServiceUnavailable,
}

func precedenceRank(err error) int {
	if ae := asAPIError(err); ae != nil {
		if i := slices.Index(errorPrecedence, ae.Status); i >= 0 {
			return i
		}
	}
	return len(errorPrecedence)
}

// firstByPrecedence returns the candidate error that comes first in errorPrecedence, or nil when there is none.
func firstByPrecedence(candidates ...error) error {
	var first error
	for _, err := range candidates {
		if err != nil && (first == nil || precedenceRank(err) < precedenceRank(first)) {
			first = err
		}
	}
	return first
}

func asAPIError(err error) *apiError {
	var ae *apiError
	if errors.As(err, &ae) {
		return ae
	}
	if errors.Is(err, errStorageDown) {
		return errStorage()
	}
	return nil
}
