// Package httpx holds the HTTP envelope: body limits, content-type checks,
// the one error shape, sessions and the same-origin rule.
package httpx

import (
	"encoding/json"

	"io"
	"net/http"
	"strings"

	"holdfast/internal/apperr"
)

// MaxBodyBytes is the body limit, inclusive.
const MaxBodyBytes = 16384

// ReadJSON decodes a JSON request body, enforcing the content type and size
// limits. v may be nil for a bodyless request.
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) *apperr.Error {
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	if v == nil {
		io.Copy(io.Discard, r.Body)
		return nil
	}
	ct := strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0])
	if !strings.EqualFold(ct, "application/json") {
		return apperr.UnsupportedMediaType
	}
	data := make([]byte, 0, 512)
	buf := make([]byte, 4096)
	total := 0
	for {
		n, err := r.Body.Read(buf)
		if n > 0 {
			total += n
			if total > MaxBodyBytes {
				io.Copy(io.Discard, r.Body)
				return apperr.BodyTooLarge
			}
			data = append(data, buf[:n]...)
		}
		if err != nil {
			break
		}
	}
	if err := json.Unmarshal(data, v); err != nil {
		return apperr.BadJSON
	}
	return nil
}

// WriteError writes one API error in the published shape.
func WriteError(w http.ResponseWriter, e *apperr.Error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(e.Status)
	w.Write(e.Marshal())
}

// WriteJSON writes a success body.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(v)
}

// WriteRaw writes pre-encoded JSON.
func WriteRaw(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	w.Write(body)
}

// HasBody reports whether the request carries a body to check.
func HasBody(r *http.Request) bool {
	return r.ContentLength != 0
}

// SameOrigin guards a state-changing request. A request whose Origin names
// another origin is refused.
func SameOrigin(r *http.Request) *apperr.Error {
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return nil
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return nil
	}
	host := r.Host
	if originHost(origin) != host {
		return apperr.CrossOrigin
	}
	return nil
}

func originHost(origin string) string {
	origin = strings.TrimPrefix(origin, "http://")
	origin = strings.TrimPrefix(origin, "https://")
	if i := strings.IndexAny(origin, "/"); i >= 0 {
		origin = origin[:i]
	}
	if i := strings.Index(origin, "@"); i >= 0 {
		origin = origin[i+1:]
	}
	return origin
}
