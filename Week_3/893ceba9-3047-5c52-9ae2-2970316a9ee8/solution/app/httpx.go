package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strings"
	"time"
)

const (
	jsonLimit      = 1_000_000
	fileLimit      = 5_000_000
	multipartLimit = 5_100_000
)

type errorBody struct {
	Error struct {
		Code    string            `json:"code"`
		Message string            `json:"message"`
		Details map[string]any    `json:"details,omitempty"`
		Fields  map[string]string `json:"fields,omitempty"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		log.Printf("encode response: %v", err)
		status, body = http.StatusInternalServerError, []byte(`{"error":{"code":"internal_error","message":"Something went wrong."}}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	writeBody(w, append(body, '\n'))
}

func writeError(w http.ResponseWriter, ae *apiError) {
	var b errorBody
	b.Error.Code, b.Error.Message, b.Error.Details, b.Error.Fields = ae.Code, ae.Message, ae.Details, ae.Fields
	writeJSON(w, ae.Status, b)
}

// handler adapts a function that returns an error into an http.HandlerFunc with the one error shape.
func handler(fn func(w http.ResponseWriter, r *http.Request) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := fn(w, r)
		if err == nil {
			return
		}
		if ae := asAPIError(err); ae != nil {
			writeError(w, ae)
			return
		}
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, newErr(http.StatusRequestEntityTooLarge, "payload_too_large", "That request is too large."))
			return
		}
		log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
		writeError(w, newErr(http.StatusInternalServerError, "internal_error", "Something went wrong."))
	}
}

// limitBody is the first step of the error precedence: an oversized body is refused before anything else.
func limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		limit := int64(jsonLimit)
		if isMultipart(r) {
			limit = multipartLimit
		}
		if r.ContentLength > limit {
			writeError(w, newErr(http.StatusRequestEntityTooLarge, "payload_too_large", "That request is too large."))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}

func withDeadline(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
		next.ServeHTTP(w, r)
	})
}

func isJSONContent(r *http.Request) bool {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mt == "application/json"
}

// decodeJSON enforces the JSON content type, then reads the body into v.
func decodeJSON(r *http.Request, v any) error {
	if !isJSONContent(r) {
		return newErr(http.StatusUnsupportedMediaType, "unsupported_media_type", "Send this request as application/json.")
	}
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = []byte("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(v); err != nil {
		return errValidation(map[string]string{"body": "The request body must be valid JSON of the documented shape."})
	}
	return nil
}

type upload struct {
	Filename    string
	ContentType string
	Data        []byte
	Fields      map[string]string
}

// readUpload enforces multipart/form-data and the 5,000,000 byte file limit.
func readUpload(r *http.Request) (*upload, error) {
	if !isMultipart(r) {
		return nil, newErr(http.StatusUnsupportedMediaType, "unsupported_media_type", "Send this request as multipart/form-data.")
	}
	mr, err := r.MultipartReader()
	if err != nil {
		return nil, errField("file", "The upload must be multipart/form-data with a file part.")
	}
	up := &upload{Fields: map[string]string{}}
	found := false
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, uploadReadError(err)
		}
		if part.FileName() == "" && part.FormName() != "file" {
			text, err := io.ReadAll(io.LimitReader(part, 1024))
			if err != nil {
				return nil, uploadReadError(err)
			}
			up.Fields[part.FormName()] = string(text)
			continue
		}
		if part.FormName() != "file" || found {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(part, fileLimit+1))
		if err != nil {
			return nil, uploadReadError(err)
		}
		if len(data) > fileLimit {
			return nil, newErr(http.StatusRequestEntityTooLarge, "payload_too_large", "That file is larger than 5,000,000 bytes.")
		}
		up.Filename, up.ContentType, up.Data = part.FileName(), part.Header.Get("Content-Type"), data
		found = true
	}
	if !found {
		return nil, errField("file", "Choose a file to upload.")
	}
	return up, nil
}

// isMultipart reports whether the request declares multipart/form-data; an unparseable Content-Type is not multipart.
func isMultipart(r *http.Request) bool {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mt == "multipart/form-data"
}

// uploadReadError keeps an oversized body as payload_too_large and reports any other read failure on the file field.
func uploadReadError(err error) error {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		return tooLarge
	}
	return errField("file", "The upload could not be read.")
}

func cleanFilename(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	if i := strings.LastIndex(name, "/"); i >= 0 {
		name = name[i+1:]
	}
	return name
}

// writeBody sends a response body; a failed write means the client went away, so it is only logged.
func writeBody(w http.ResponseWriter, body []byte) {
	if _, err := w.Write(body); err != nil {
		log.Printf("write response: %v", err)
	}
}
