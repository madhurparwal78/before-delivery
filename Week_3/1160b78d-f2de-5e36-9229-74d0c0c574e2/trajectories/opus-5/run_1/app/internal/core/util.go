package core

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

// APIError is the one failure shape the whole API answers with.
type APIError struct {
	Status int
	Body   map[string]any
}

func (e *APIError) Error() string {
	return fmt.Sprintf("api error %d: %v", e.Status, e.Body)
}

func errCode(status int, code string) *APIError {
	return &APIError{Status: status, Body: map[string]any{"error": code}}
}

func errFields(pairs ...string) *APIError {
	errs := map[string]any{}
	for i := 0; i+1 < len(pairs); i += 2 {
		errs[pairs[i]] = pairs[i+1]
	}
	return &APIError{Status: 422, Body: map[string]any{"errors": errs}}
}

func errFieldMap(errs map[string]string) *APIError {
	out := map[string]any{}
	for k, v := range errs {
		out[k] = v
	}
	return &APIError{Status: 422, Body: map[string]any{"errors": out}}
}

var (
	errNotFound  = errCode(404, "not_found")
	errForbidden = errCode(403, "forbidden")
)

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return strings.Join([]string{h[0:8], h[8:12], h[12:16], h[16:20], h[20:32]}, "-")
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func joinNames(names []string) string {
	if len(names) == 0 {
		return "Nobody"
	}
	return strings.Join(names, ", ")
}

func ptr[T any](v T) *T { return &v }

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}
